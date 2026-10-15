export const DECIMAL_NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

// trimHoconWs: strip HOCON_WS characters from both ends of a string.
// Mirrors isHoconWhitespace in src/internal/lexer/lexer.ts byte-for-byte.
// HOCON_WS = Java Character.isWhitespace set
//          ∪ { 0x00A0 NBSP, 0x2007 FIGURE SPACE, 0x202F NARROW NO-BREAK SPACE }
//          ∪ { 0xFEFF BOM }
// Do NOT use stdlib String.trim() — it strips NEL (U+0085) and other
// Unicode space separators that HOCON does not classify as whitespace.
function isHoconWs(cp: number): boolean {
  // ASCII control whitespace: tab, LF, VT, FF, CR
  if (cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D) return true
  // File/group/record/unit separators (0x1C-0x1F)
  if (cp >= 0x1C && cp <= 0x1F) return true
  // ASCII space, NBSP (0x00A0), BOM (0xFEFF)
  if (cp === 0x20 || cp === 0xA0 || cp === 0xFEFF) return true
  // Ogham space mark (Zs)
  if (cp === 0x1680) return true
  // En quad through hair space (Zs, 0x2000-0x200A)
  if (cp >= 0x2000 && cp <= 0x200A) return true
  // Line separator (Zl), paragraph separator (Zp), narrow no-break space (Zs),
  // medium mathematical space (Zs)
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F) return true
  // Ideographic space (Zs)
  if (cp === 0x3000) return true
  return false
}

function trimHoconWs(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && isHoconWs(s.charCodeAt(start))) { start++ }
  while (end > start && isHoconWs(s.charCodeAt(end - 1))) { end-- }
  return s.slice(start, end)
}

const TRUTHY = new Set(['true', 'yes', 'on'])
const FALSY = new Set(['false', 'no', 'off'])

export function coerceBoolean(value: string): boolean | undefined {
  const lower = value.toLowerCase()
  if (TRUTHY.has(lower)) return true
  if (FALSY.has(lower)) return false
  return undefined
}

export function coerceNumber(value: string): number | undefined {
  if (!DECIMAL_NUMBER_RE.test(value)) return undefined
  return Number(value)
}

// ─── exact unit arithmetic (E20) ──────────────────────────────────────────────
// The number in a unit value is read from its text as an exact decimal and
// multiplied by the unit exactly (xx.hocon E20): `1.001s` is 1001 ms, not the
// 1000.9999999999999 a double product gives, and `9us` is 0.009 ms. A duration
// is then rounded once, to the nearest double in the output unit; a byte size
// is truncated toward zero first (Lightbend BigDecimal.toBigInteger).

/** A unit value split into its exact number (`mantissa / 10^scale`) and its unit text. */
interface UnitText {
  readonly mantissa: bigint
  readonly scale: number
  readonly unit: string
}

/** `[ws] number [ws] unit [ws]`, or undefined when there is no number. */
function splitUnitText(value: string): UnitText | undefined {
  const trimmed = trimHoconWs(value)
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (i === 0 && (ch === '-' || ch === '+')) { i++; continue }
    if (ch !== '.' && (ch < '0' || ch > '9')) break
    i++
  }
  const number = trimmed.slice(0, i)
  // Number() decides which spellings are numbers (`1.`, `.5`, `+1` are; `.`,
  // `-`, `1.2.3` are not), as before; the digits are then read exactly.
  if (i === 0 || Number.isNaN(Number(number))) return undefined
  const unsigned = number[0] === '-' || number[0] === '+' ? number.slice(1) : number
  const dot = unsigned.indexOf('.')
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1)
  const magnitude = BigInt((dot === -1 ? unsigned : unsigned.slice(0, dot) + fraction) || '0')
  return {
    mantissa: number[0] === '-' ? -magnitude : magnitude,
    scale: fraction.length,
    unit: trimHoconWs(trimmed.slice(i)),
  }
}

function bitLength(n: bigint): number {
  return n.toString(2).length
}

/** `x * 2^e`, exact while the result is a normal double. */
function timesPowerOfTwo(x: number, e: number): number {
  while (e > 1000) { x *= 2 ** 1000; e -= 1000 }
  while (e < -1000) { x *= 2 ** -1000; e += 1000 }
  return x * 2 ** e
}

/**
 * `n / d` (d > 0) rounded once to the nearest double (ties to even). The
 * quotient is taken to 65 bits with the remainder folded into the lowest bit,
 * so Number(bigint)'s own rounding to 53 bits sees an exact tie only when there
 * is one. Below the normal range (2^-1022) the result can round twice.
 */
function ratioToNumber(n: bigint, d: bigint): number {
  if (n === 0n) return 0
  const negative = n < 0n
  const a = negative ? -n : n
  let shift = 65 - (bitLength(a) - bitLength(d))
  for (;;) {
    const num = shift >= 0 ? a << BigInt(shift) : a
    const den = shift >= 0 ? d : d << BigInt(-shift)
    const q = num / den
    const length = bitLength(q)
    if (length > 65) { shift--; continue }
    if (length < 65) { shift++; continue }
    const sticky = num % den === 0n ? 0n : 1n
    const value = timesPowerOfTwo(Number(q | sticky), -shift)
    return negative ? -value : value
  }
}

/** Nanoseconds per duration unit. */
const DURATION_UNITS = new Map<string, bigint>([
  // S19.1–S19.3: the bare nano/micro/milli (+plural) aliases are part of the
  // spec's unit lists (HOCON.md L1307–L1309) and accepted by Lightbend
  // (typesafe-config 1.4.6 probe, 2026-08-18).
  ...['ns', 'nano', 'nanos', 'nanosecond', 'nanoseconds'].map((u) => [u, 1n] as const),
  ...['us', 'micro', 'micros', 'microsecond', 'microseconds'].map((u) => [u, 1_000n] as const),
  ...['ms', 'milli', 'millis', 'millisecond', 'milliseconds'].map((u) => [u, 1_000_000n] as const),
  ...['s', 'second', 'seconds'].map((u) => [u, 1_000_000_000n] as const),
  ...['m', 'minute', 'minutes'].map((u) => [u, 60_000_000_000n] as const),
  ...['h', 'hour', 'hours'].map((u) => [u, 3_600_000_000_000n] as const),
  ...['d', 'day', 'days'].map((u) => [u, 86_400_000_000_000n] as const),
])

/** Nanoseconds per output unit. */
const OUTPUT_DURATION_UNITS = new Map<string, bigint>([
  ['ns', 1n], ['us', 1_000n], ['ms', 1_000_000n], ['s', 1_000_000_000n],
  ['m', 60_000_000_000n], ['h', 3_600_000_000_000n], ['d', 86_400_000_000_000n],
])

export type DurationUnit = 'ns' | 'us' | 'ms' | 's' | 'm' | 'h' | 'd'

export function parseDuration(value: string, outputUnit: DurationUnit = 'ms'): number {
  const text = splitUnitText(value)
  if (text === undefined) return NaN
  const per = OUTPUT_DURATION_UNITS.get(outputUnit)
  if (per === undefined) return NaN
  // S18.1 + S18.4: no unit means milliseconds. S19.8: units are case-sensitive
  // (HOCON.md L1304, lowercase only).
  const unit = text.unit === '' ? 1_000_000n : DURATION_UNITS.get(text.unit)
  if (unit === undefined) return NaN
  return ratioToNumber(text.mantissa * unit, 10n ** BigInt(text.scale) * per)
}

const BYTE_UNITS = new Map<string, bigint>([
  // S21.1–S21.4 — the EXACT Lightbend/typesafe-config unit set (1.4.6 probe,
  // 2026-08-18). Multi-letter units are case-sensitive: the SI decimal short
  // form is `kB` (NOT `KB`/`kb` — Lightbend rejects both), higher decimals
  // are `MB`…`YB`, binary prefixes are `Ki`/`KiB`…`Yi`/`YiB` with capital
  // first letter, and long forms are lowercase only (`kilobyte`, never
  // `Kilobyte`). Only the bare byte unit (`B`/`b`) and the single-letter
  // -Xmx forms accept both cases.
  ...['B', 'b', 'byte', 'bytes'].map((u) => [u, 1n] as const),
  ...([
    ['kB', 'kilo'], ['MB', 'mega'], ['GB', 'giga'], ['TB', 'tera'],
    ['PB', 'peta'], ['EB', 'exa'], ['ZB', 'zetta'], ['YB', 'yotta'],
  ] as const).flatMap(([short, prefix], i) => {
    const size = 1000n ** BigInt(i + 1)
    return [[short, size], [`${prefix}byte`, size], [`${prefix}bytes`, size]] as const
  }),
  ...([
    ['K', 'kibi'], ['M', 'mebi'], ['G', 'gibi'], ['T', 'tebi'],
    ['P', 'pebi'], ['E', 'exbi'], ['Z', 'zebi'], ['Y', 'yobi'],
  ] as const).flatMap(([letter, prefix], i) => {
    const size = 1024n ** BigInt(i + 1)
    return [
      [`${letter}i`, size], [`${letter}iB`, size], [`${prefix}byte`, size], [`${prefix}bytes`, size],
      // S21.4 — single letters are powers of two (java -Xmx convention), in
      // both cases, through the full ladder.
      [letter, size], [letter.toLowerCase(), size],
    ] as const
  }),
])

const OUTPUT_BYTE_UNITS = new Map<string, number>([
  ['B', 1], ['KB', 1_000], ['KiB', 1_024], ['MB', 1_000_000], ['MiB', 1_048_576],
  ['GB', 1_000_000_000], ['GiB', 1_073_741_824], ['TB', 1_000_000_000_000], ['TiB', 1_099_511_627_776],
])

export type ByteUnit = 'B' | 'KB' | 'KiB' | 'MB' | 'MiB' | 'GB' | 'GiB' | 'TB' | 'TiB'

const BYTE_SIZE_OVERFLOW = 'byte size overflows representable range (max 2^53-1 bytes)'

/**
 * The error a byte size that does not fit a JS number (beyond 2^53-1 bytes)
 * throws from parseBytes and Config.getBytes. readBytes reports it as the
 * 'overflow' problem.
 */
export function byteSizeOverflow(): RangeError {
  return new RangeError(BYTE_SIZE_OVERFLOW)
}

export function parseBytes(value: string, outputUnit: ByteUnit = 'B'): number {
  const text = splitUnitText(value)
  if (text === undefined) return NaN
  const per = OUTPUT_BYTE_UNITS.get(outputUnit)
  if (per === undefined) return NaN
  // S18.1 + S18.4: no unit means bytes. Units are matched exactly, with case.
  const unit = text.unit === '' ? 1n : BYTE_UNITS.get(text.unit)
  if (unit === undefined) return NaN
  // The exact product, truncated toward zero (BigInt division).
  const bytes = (text.mantissa * unit) / 10n ** BigInt(text.scale)
  // S21.4: a JS number holds bytes exactly only up to 2^53-1; beyond that,
  // throw rather than return an imprecise result.
  if (bytes > MAX_SAFE_BYTES || bytes < -MAX_SAFE_BYTES) throw byteSizeOverflow()
  // Exact integer over an exact divisor: one rounding.
  return Number(bytes) / per
}

const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER)

// ─── unit readers ─────────────────────────────────────────────────────────────
// What a unit value accepts, as one rule per unit system: the grammar above plus
// the unit system's own invariants. `text` is the value as written (a string
// scalar, or a number in decimal form). Config.getDuration / getBytes /
// getPeriod and the zod markers read through these.

/** Why a text is not a value of a unit system. */
export type UnitProblem = 'invalid' | 'negative' | 'overflow'

/**
 * A reader's answer: the value, or why the text is not one. `P` is the
 * problems the reader can report, so a caller that maps them can be checked
 * for completeness.
 */
export type UnitReading<T = number, P extends UnitProblem = UnitProblem> =
  | { ok: true; value: T }
  | { ok: false; problem: P }

/** A duration in `outputUnit` (default `ms`; a bare number is milliseconds). */
export function readDuration(text: string, outputUnit?: DurationUnit): UnitReading<number, 'invalid'> {
  const value = parseDuration(text, outputUnit)
  return Number.isNaN(value) ? { ok: false, problem: 'invalid' } : { ok: true, value }
}

/** A byte size in `outputUnit` (default `B`; a bare number is bytes). */
export function readBytes(text: string, outputUnit?: ByteUnit): UnitReading {
  let value: number
  try {
    value = parseBytes(text, outputUnit)
  } catch (err) {
    // Only parseBytes' own overflow; any other RangeError is not a reading.
    if (err instanceof RangeError && err.message === BYTE_SIZE_OVERFLOW) {
      return { ok: false, problem: 'overflow' }
    }
    throw err
  }
  if (Number.isNaN(value)) return { ok: false, problem: 'invalid' }
  // Lightbend getBytesBigInteger: byte sizes are non-negative.
  if (value < 0) return { ok: false, problem: 'negative' }
  return { ok: true, value }
}

/**
 * A calendar period, as {@link Config.getPeriod} returns it. Weeks are folded
 * into days (`2w` is 14 days). A component may be negative.
 */
export interface Period {
  readonly years: number
  readonly months: number
  readonly days: number
}

// S20.1–S20.4 — the period units (HOCON.md L1324–L1333), case-sensitive like
// the duration units (L1304). No unit means days (L1321). A Map, not a Record,
// so that a unit spelled like an Object.prototype member does not match.
const PERIOD_UNITS = new Map<string, { field: keyof Period; factor: number }>([
  ['', { field: 'days', factor: 1 }],
  ['d', { field: 'days', factor: 1 }], ['day', { field: 'days', factor: 1 }], ['days', { field: 'days', factor: 1 }],
  ['w', { field: 'days', factor: 7 }], ['week', { field: 'days', factor: 7 }], ['weeks', { field: 'days', factor: 7 }],
  ['m', { field: 'months', factor: 1 }], ['mo', { field: 'months', factor: 1 }],
  ['month', { field: 'months', factor: 1 }], ['months', { field: 'months', factor: 1 }],
  ['y', { field: 'years', factor: 1 }], ['year', { field: 'years', factor: 1 }], ['years', { field: 'years', factor: 1 }],
])

// Lightbend reads the number with Integer.parseInt, and rs / py hold each
// component in an i32, so a component outside the i32 range is invalid.
const I32_MIN = -(2 ** 31)
const I32_MAX = 2 ** 31 - 1

/**
 * A period. Integer only (Lightbend `Integer.parseInt`), so `7.5` is invalid,
 * unlike a duration or a byte size; a bare number is days.
 */
export function readPeriod(text: string): UnitReading<Period, 'invalid'> {
  const trimmed = trimHoconWs(text)
  let i = 0
  while (i < trimmed.length && '+-0123456789'.includes(trimmed[i])) i++
  const digits = trimmed.slice(0, i)
  const unit = PERIOD_UNITS.get(trimHoconWs(trimmed.slice(i)))
  if (!/^[+-]?\d+$/.test(digits) || unit === undefined) return { ok: false, problem: 'invalid' }
  const n = Number(digits) * unit.factor
  if (n < I32_MIN || n > I32_MAX) return { ok: false, problem: 'invalid' }
  // `-0` reads as 0, as in rs / py, where the components are integers.
  const value: Period = { years: 0, months: 0, days: 0, [unit.field]: n === 0 ? 0 : n }
  return { ok: true, value }
}
