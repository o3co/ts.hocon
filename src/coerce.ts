const TRUTHY = new Set(['true', 'yes', 'on'])
const FALSY = new Set(['false', 'no', 'off'])

export function coerceBoolean(value: string): boolean | undefined {
  const lower = value.toLowerCase()
  if (TRUTHY.has(lower)) return true
  if (FALSY.has(lower)) return false
  return undefined
}

export function coerceNumber(value: string): number | undefined {
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return undefined
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
  const trimmed = value.trim()
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (ch !== '-' && ch !== '.' && (ch < '0' || ch > '9')) break
    i++
  }
  if (i === 0) return NaN
  const num = Number(trimmed.slice(0, i))
  if (Number.isNaN(num)) return NaN
  const unit = trimmed.slice(i).trim()
  const mult = DURATION_UNITS[unit]
  if (mult === undefined) return NaN
  const ms = num * mult
  const divisor = OUTPUT_DURATION_UNITS[outputUnit]
  if (divisor === undefined) return NaN
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
}

const OUTPUT_BYTE_UNITS: Record<string, number> = {
  B: 1, KB: 1_000, KiB: 1_024, MB: 1_000_000, MiB: 1_048_576,
  GB: 1_000_000_000, GiB: 1_073_741_824, TB: 1_000_000_000_000, TiB: 1_099_511_627_776,
}

export type ByteUnit = 'B' | 'KB' | 'KiB' | 'MB' | 'MiB' | 'GB' | 'GiB' | 'TB' | 'TiB'

export function parseBytes(value: string, outputUnit: ByteUnit = 'B'): number {
  const trimmed = value.trim()
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (ch < '0' || ch > '9') break
    i++
  }
  if (i === 0) return NaN
  const num = Number(trimmed.slice(0, i))
  if (Number.isNaN(num)) return NaN
  const unit = trimmed.slice(i).trim()
  const mult = BYTE_UNITS[unit]
  if (mult === undefined) return NaN
  const bytes = num * mult
  const divisor = OUTPUT_BYTE_UNITS[outputUnit]
  if (divisor === undefined) return NaN
  return bytes / divisor
}
