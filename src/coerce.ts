import { ratioToNumber } from './internal/exact-ratio.js'

// The integer and fraction digits are separate groups so the match stays
// linear on a long digit string (`\d+\.?\d*` backtracks quadratically).
export const DECIMAL_NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

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
  /** The number is `mantissa × 10^-scale`; `scale` is negative for a large exponent. */
  readonly mantissa: bigint
  readonly scale: number
  readonly unit: string
}

function isDigitChar(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/**
 * `[ws] number [ws] unit [ws]`, or undefined when there is no number. The
 * number is the Java double grammar Lightbend reads (E20 exponent forms):
 * `[+-]? (digits [. digits?] | . digits) ([eE] [+-]? digits)?`. An `e`/`E`
 * not followed by a digit is the start of the unit (`1E` is one exbibyte, the single-letter `E` unit).
 */
function splitUnitText(value: string): UnitText | undefined {
  const t = trimHoconWs(value)
  let i = 0
  const negative = t[0] === '-'
  if (t[0] === '-' || t[0] === '+') i++
  const intStart = i
  while (isDigitChar(t[i])) i++
  const intDigits = t.slice(intStart, i)
  let fraction = ''
  if (t[i] === '.') {
    const fracStart = ++i
    while (isDigitChar(t[i])) i++
    fraction = t.slice(fracStart, i)
  }
  if (intDigits === '' && fraction === '') return undefined
  let exponent = 0
  if (t[i] === 'e' || t[i] === 'E') {
    let j = i + 1
    if (t[j] === '+' || t[j] === '-') j++
    if (isDigitChar(t[j])) {
      const expStart = j
      while (isDigitChar(t[j])) j++
      // Past ±10^12 the bounds in the parsers decide anyway; clamp so the
      // exponent stays an exact integer.
      // Leading zeros carry no magnitude (`1e0000000000003` is 1e3).
      const digits = t.slice(expStart, j).replace(/^0+(?=\d)/, '')
      const magnitude = digits.length > 12 ? 1e12 : Number(digits)
      exponent = t[i + 1] === '-' ? -magnitude : magnitude
      i = j
    }
  }
  const magnitude = BigInt((intDigits + fraction) || '0')
  return {
    mantissa: negative ? -magnitude : magnitude,
    scale: fraction.length - exponent,
    unit: trimHoconWs(t.slice(i)),
  }
}

/**
 * The power of ten of `mantissa × 10^-scale` (its leading digit's place),
 * from the digit count alone: lets a parser settle a huge exponent before
 * building 10^|scale|. Undefined for a zero mantissa.
 */
function decimalMagnitude(text: UnitText): number | undefined {
  if (text.mantissa === 0n) return undefined
  const digits = (text.mantissa < 0n ? -text.mantissa : text.mantissa).toString().length
  return digits - 1 - text.scale
}

/** `mantissa × factor × 10^-scale` as a ratio `[numerator, denominator]`, exactly. */
function scaledRatio(text: UnitText, factor: bigint): [bigint, bigint] {
  return text.scale >= 0
    ? [text.mantissa * factor, 10n ** BigInt(text.scale)]
    : [text.mantissa * factor * 10n ** BigInt(-text.scale), 1n]
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
  // A unit and an output unit are within 10^14 of each other, so past these
  // bounds the result is surely beyond a double (E21) or below its smallest
  // value; decide without building the power of ten.
  const magnitude = decimalMagnitude(text)
  if (magnitude === undefined) return 0
  if (magnitude > 330) return text.mantissa < 0n ? -Infinity : Infinity
  // Keep the sign, as the exact path's rounding does (a tiny negative is -0).
  if (magnitude < -345) return text.mantissa < 0n ? -0 : 0
  const [n, d] = scaledRatio(text, unit)
  return ratioToNumber(n, d * per)
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
 * The error parseBytes throws for a byte size that does not fit a JS number
 * (beyond 2^53-1 bytes). readBytes reports it as the 'overflow' problem.
 */
function byteSizeOverflow(): RangeError {
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
  // At 10^16 or more the size is past 2^53-1 whatever the unit (≥ 1 byte);
  // below 10^-25 it is under one byte even in yottabytes, so it truncates to
  // 0. Decide those without building the power of ten.
  const magnitude = decimalMagnitude(text)
  if (magnitude === undefined) return 0
  if (magnitude >= 16) throw byteSizeOverflow()
  if (magnitude < -25) return 0
  // The exact product, truncated toward zero (BigInt division).
  const [n, d] = scaledRatio(text, unit)
  const bytes = n / d
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
export function readDuration(text: string, outputUnit?: DurationUnit): UnitReading<number, 'invalid' | 'overflow'> {
  const value = parseDuration(text, outputUnit)
  if (Number.isNaN(value)) return { ok: false, problem: 'invalid' }
  // E21: a duration that does not fit the representation (here, a finite
  // double in the output unit) is an error, never Infinity.
  if (!Number.isFinite(value)) return { ok: false, problem: 'overflow' }
  return { ok: true, value }
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
 * Whether a duration or byte size names its unit (`30s`, `"64 KiB"`, `1E`), as
 * the readers split it: a bare number (`30`, `"30"`, `"1e3"`) does not. Only
 * meaningful for a text the reader accepts.
 */
export function namesMagnitudeUnit(text: string): boolean {
  const split = splitUnitText(text)
  return split !== undefined && split.unit !== ''
}

/**
 * Whether a period names its unit (`7d`, `"2 w"`): a bare integer, which is
 * days, does not. Only meaningful for a text {@link readPeriod} accepts.
 */
export function namesPeriodUnit(text: string): boolean {
  return splitPeriodText(text).unit !== ''
}

/** A period's leading sign-and-digit run and its unit text, both trimmed. */
function splitPeriodText(text: string): { digits: string; unit: string } {
  const trimmed = trimHoconWs(text)
  let i = 0
  while (i < trimmed.length && '+-0123456789'.includes(trimmed[i])) i++
  return { digits: trimmed.slice(0, i), unit: trimHoconWs(trimmed.slice(i)) }
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
  const split = splitPeriodText(text)
  const digits = split.digits
  const unit = PERIOD_UNITS.get(split.unit)
  if (!/^[+-]?\d+$/.test(digits) || unit === undefined) return { ok: false, problem: 'invalid' }
  const n = Number(digits) * unit.factor
  if (n < I32_MIN || n > I32_MAX) return { ok: false, problem: 'invalid' }
  // `-0` reads as 0, as in rs / py, where the components are integers.
  const value: Period = { years: 0, months: 0, days: 0, [unit.field]: n === 0 ? 0 : n }
  return { ok: true, value }
}
