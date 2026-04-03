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
