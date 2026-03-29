const TRUTHY = new Set(['true', 'yes', 'on'])
const FALSY = new Set(['false', 'no', 'off'])

export function coerceBoolean(value: string): boolean | undefined {
  const lower = value.toLowerCase()
  if (TRUTHY.has(lower)) return true
  if (FALSY.has(lower)) return false
  return undefined
}

export function coerceNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  // Only allow JSON-like numeric literals (no hex, octal, Infinity etc.)
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return undefined
  return Number(trimmed)
}
