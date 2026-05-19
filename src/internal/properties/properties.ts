import type { HoconValue } from '../../value.js'

export function parseProperties(input: string): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null)

  // Collect (key, value) pairs first so we can sort before inserting.
  // S23.4 — HOCON.md L1485: when a key conflict exists between a scalar ("a=hello")
  // and an object expansion ("a.b=world"), the object must always win.
  // Sorting keys gives a single deterministic processing order regardless of input
  // line order (mirrors go.hocon's sort.Strings(keys) and spec L1476-1479 intent).
  const pairs: [string, string][] = []
  for (const line of input.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue

    const sepIdx = findSeparator(trimmed)
    if (sepIdx === -1) continue

    const key = trimmed.slice(0, sepIdx).trim()
    const value = trimmed.slice(sepIdx + 1).trim()
    if (key === '') continue

    pairs.push([key, value])
  }

  // Sort by key so conflict-direction is input-order independent.
  pairs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)

  for (const [key, value] of pairs) {
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
  // S23.4 — HOCON.md L1485: object must always win over scalar.
  // If the last segment already holds an object, do not overwrite it with a scalar.
  if (typeof current[last] === 'object' && current[last] !== null) return
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
