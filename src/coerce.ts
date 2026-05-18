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
  ns: 1e-6, nanosecond: 1e-6, nanoseconds: 1e-6,
  us: 1e-3, microsecond: 1e-3, microseconds: 1e-3,
  ms: 1, millisecond: 1, milliseconds: 1,
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
  const unit = trimHoconWs(trimmed.slice(i)).toLowerCase()
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
  B: 1, byte: 1, bytes: 1,
  KB: 1_000, kilobyte: 1_000, kilobytes: 1_000,
  KiB: 1_024, kibibyte: 1_024, kibibytes: 1_024,
  MB: 1_000_000, megabyte: 1_000_000, megabytes: 1_000_000,
  MiB: 1_048_576, mebibyte: 1_048_576, mebibytes: 1_048_576,
  GB: 1_000_000_000, gigabyte: 1_000_000_000, gigabytes: 1_000_000_000,
  GiB: 1_073_741_824, gibibyte: 1_073_741_824, gibibytes: 1_073_741_824,
  TB: 1_000_000_000_000, terabyte: 1_000_000_000_000, terabytes: 1_000_000_000_000,
  TiB: 1_099_511_627_776, tebibyte: 1_099_511_627_776, tebibytes: 1_099_511_627_776,
  // lowercase short-form aliases
  b: 1,
  kb: 1_000, kib: 1_024,
  mb: 1_000_000, mib: 1_048_576,
  gb: 1_000_000_000, gib: 1_073_741_824,
  tb: 1_000_000_000_000, tib: 1_099_511_627_776,
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
  if (unit === '') {
    return Math.trunc(num) / divisor
  }
  // Try exact match first (preserves KB vs KiB distinction)
  let mult = BYTE_UNITS[unit]
  // Try lowercase for long-form names (megabytes, Megabytes, MEGABYTES)
  if (mult === undefined) {
    mult = BYTE_UNITS[unit.toLowerCase()]
  }
  if (mult === undefined) return NaN
  const bytes = num * mult
  const result = bytes / divisor
  return outputUnit === 'B' ? Math.round(result) : result
}
