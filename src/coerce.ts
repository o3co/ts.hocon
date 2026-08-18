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

const DURATION_UNITS: Record<string, number> = {
  // S19.1–S19.3: the bare nano/micro/milli (+plural) aliases are part of the
  // spec's unit lists (HOCON.md L1307–L1309) and accepted by Lightbend
  // (typesafe-config 1.4.6 probe, 2026-08-18); they were missing here.
  ns: 1e-6, nano: 1e-6, nanos: 1e-6, nanosecond: 1e-6, nanoseconds: 1e-6,
  us: 1e-3, micro: 1e-3, micros: 1e-3, microsecond: 1e-3, microseconds: 1e-3,
  ms: 1, milli: 1, millis: 1, millisecond: 1, milliseconds: 1,
  s: 1_000, second: 1_000, seconds: 1_000,
  m: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
}

const OUTPUT_DURATION_UNITS: Record<string, number> = {
  ns: 1e-6, us: 1e-3, ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000,
}

export type DurationUnit = 'ns' | 'us' | 'ms' | 's' | 'm' | 'h' | 'd'

export function parseDuration(value: string, outputUnit: DurationUnit = 'ms'): number {
  const trimmed = trimHoconWs(value)
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (i === 0 && (ch === '-' || ch === '+')) { i++; continue }
    if (ch !== '.' && (ch < '0' || ch > '9')) break
    i++
  }
  if (i === 0) return NaN
  const num = Number(trimmed.slice(0, i))
  if (Number.isNaN(num)) return NaN
  // S19.8 — unit match is case-sensitive per HOCON.md L1304 (lowercase only).
  const unit = trimHoconWs(trimmed.slice(i))
  const divisor = OUTPUT_DURATION_UNITS[outputUnit]
  if (divisor === undefined) return NaN
  // S18.1 + S18.4: bare number (no unit) → treat as default unit (ms)
  if (unit === '') {
    return num / divisor
  }
  const mult = DURATION_UNITS[unit]
  if (mult === undefined) return NaN
  const ms = num * mult
  return ms / divisor
}

const BYTE_UNITS: Record<string, number> = {
  // S21.1–S21.4 — the EXACT Lightbend/typesafe-config unit set (1.4.6 probe,
  // 2026-08-18). Multi-letter units are case-sensitive: the SI decimal short
  // form is `kB` (NOT `KB`/`kb` — Lightbend rejects both), higher decimals
  // are `MB`…`YB`, binary prefixes are `Ki`/`KiB`…`Yi`/`YiB` with capital
  // first letter, and long forms are lowercase only (`kilobyte`, never
  // `Kilobyte`). Only the bare byte unit (`B`/`b`) and the single-letter
  // -Xmx forms accept both cases. The old case-insensitive fallback and the
  // lowercase alias rows accepted spellings Lightbend rejects — removed.
  B: 1, b: 1, byte: 1, bytes: 1,
  kB: 1_000, kilobyte: 1_000, kilobytes: 1_000,
  MB: 1_000_000, megabyte: 1_000_000, megabytes: 1_000_000,
  GB: 1_000_000_000, gigabyte: 1_000_000_000, gigabytes: 1_000_000_000,
  TB: 1_000_000_000_000, terabyte: 1_000_000_000_000, terabytes: 1_000_000_000_000,
  PB: 1e15, petabyte: 1e15, petabytes: 1e15,
  EB: 1e18, exabyte: 1e18, exabytes: 1e18,
  ZB: 1e21, zettabyte: 1e21, zettabytes: 1e21,
  YB: 1e24, yottabyte: 1e24, yottabytes: 1e24,
  Ki: 1_024, KiB: 1_024, kibibyte: 1_024, kibibytes: 1_024,
  Mi: 1_048_576, MiB: 1_048_576, mebibyte: 1_048_576, mebibytes: 1_048_576,
  Gi: 1_073_741_824, GiB: 1_073_741_824, gibibyte: 1_073_741_824, gibibytes: 1_073_741_824,
  Ti: 1_099_511_627_776, TiB: 1_099_511_627_776, tebibyte: 1_099_511_627_776, tebibytes: 1_099_511_627_776,
  Pi: 1_024 ** 5, PiB: 1_024 ** 5, pebibyte: 1_024 ** 5, pebibytes: 1_024 ** 5,
  Ei: 1_024 ** 6, EiB: 1_024 ** 6, exbibyte: 1_024 ** 6, exbibytes: 1_024 ** 6,
  Zi: 1_024 ** 7, ZiB: 1_024 ** 7, zebibyte: 1_024 ** 7, zebibytes: 1_024 ** 7,
  Yi: 1_024 ** 8, YiB: 1_024 ** 8, yobibyte: 1_024 ** 8, yobibytes: 1_024 ** 8,
  // S21.4 — single-letter abbreviations → powers of two (java -Xmx
  // convention); Lightbend accepts BOTH cases here, through the full ladder.
  K: 1_024, k: 1_024,
  M: 1_024 ** 2, m: 1_024 ** 2,
  G: 1_024 ** 3, g: 1_024 ** 3,
  T: 1_024 ** 4, t: 1_024 ** 4,
  P: 1_024 ** 5, p: 1_024 ** 5,
  E: 1_024 ** 6, e: 1_024 ** 6,
  Z: 1_024 ** 7, z: 1_024 ** 7,
  Y: 1_024 ** 8, y: 1_024 ** 8,
}

const OUTPUT_BYTE_UNITS: Record<string, number> = {
  B: 1, KB: 1_000, KiB: 1_024, MB: 1_000_000, MiB: 1_048_576,
  GB: 1_000_000_000, GiB: 1_073_741_824, TB: 1_000_000_000_000, TiB: 1_099_511_627_776,
}

export type ByteUnit = 'B' | 'KB' | 'KiB' | 'MB' | 'MiB' | 'GB' | 'GiB' | 'TB' | 'TiB'

export function parseBytes(value: string, outputUnit: ByteUnit = 'B'): number {
  const trimmed = trimHoconWs(value)
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (i === 0 && (ch === '-' || ch === '+')) { i++; continue }
    if (ch !== '.' && (ch < '0' || ch > '9')) break
    i++
  }
  if (i === 0) return NaN
  const num = Number(trimmed.slice(0, i))
  if (Number.isNaN(num)) return NaN
  const unit = trimHoconWs(trimmed.slice(i))
  const divisor = OUTPUT_BYTE_UNITS[outputUnit]
  if (divisor === undefined) return NaN
  // S18.1 + S18.4: bare number (no unit) → treat as default unit (bytes)
  // Use Math.trunc per Lightbend BigDecimal.toBigInteger (truncate toward zero)
  // S21.4 overflow guard applies to unit-less path too: a bare integer like
  // 9007199254740993 (2^53+1) cannot be represented exactly in float64 and must
  // throw rather than silently return an imprecise result.
  if (unit === '') {
    const bytes = Math.trunc(num)
    if (Math.abs(bytes) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('byte size overflows representable range (max 2^53-1 bytes)')
    }
    return bytes / divisor
  }
  // Exact, case-sensitive match — Lightbend's unit table is case-sensitive
  // (`kB` parses, `KB`/`kb`/`Megabytes` are errors), so no case folding.
  const mult = BYTE_UNITS[unit]
  if (mult === undefined) return NaN
  const bytes = num * mult
  // S21.4 overflow guard: JS number is float64 (MAX_SAFE_INTEGER = 2^53-1 ≈ 9.0e15).
  // Values like 1E (2^60 ≈ 1.15e18) exceed MAX_SAFE_INTEGER and cannot be represented
  // exactly — throw rather than silently return an imprecise result.
  if (Math.abs(bytes) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('byte size overflows representable range (max 2^53-1 bytes)')
  }
  const result = bytes / divisor
  return outputUnit === 'B' ? Math.round(result) : result
}
