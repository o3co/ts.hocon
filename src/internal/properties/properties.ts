import type { HoconValue } from '../../value.js'

export function parseProperties(input: string): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null)

  for (const line of input.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue

    const sepIdx = findSeparator(trimmed)
    if (sepIdx === -1) continue

    const key = trimmed.slice(0, sepIdx).trim()
    const value = trimmed.slice(sepIdx + 1).trim()
    if (key === '') continue

    setNested(root, key.split('.'), value)
  }

  return root
}

function findSeparator(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '=' || line[i] === ':') return i
  }
  return -1
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function setNested(obj: Record<string, unknown>, segments: string[], value: string): void {
  let current = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (seg === undefined || DANGEROUS_KEYS.has(seg)) return
    if (!(seg in current) || typeof current[seg] !== 'object' || current[seg] === null) {
      current[seg] = Object.create(null)
    }
    current = current[seg] as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (last === undefined || DANGEROUS_KEYS.has(last)) return
  current[last] = value
}

/**
 * Convert a .properties file string into a HoconValue (object with string scalars).
 * All values remain as strings — no type coercion is applied.
 */
export function propertiesToHoconValue(input: string): HoconValue {
  const parsed = parseProperties(input)
  return recordToHoconValue(parsed)
}

function recordToHoconValue(obj: Record<string, unknown>): HoconValue & { kind: 'object' } {
  const fields = new Map<string, HoconValue>()
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      fields.set(key, { kind: 'scalar', raw: val, valueType: 'string' })
    } else if (val !== null && typeof val === 'object') {
      fields.set(key, recordToHoconValue(val as Record<string, unknown>))
    }
  }
  return { kind: 'object', fields }
}
