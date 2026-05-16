// tests/numeric-array.test.ts
//
// Unit tests for the numericObjectToArray helper (S15 spec compliance).
// Spec: docs/superpowers/specs/2026-05-16-s15-numeric-obj-array-design.md §"Integer key parse rule"
import { describe, it, expect } from 'vitest'
import type { HoconValue } from '../src/value.js'
import { numericObjectToArray } from '../src/value/numeric-array.js'

function str(raw: string): HoconValue {
  return { kind: 'scalar', raw, valueType: 'string' }
}

function obj(entries: Record<string, HoconValue>): HoconValue {
  return { kind: 'object', fields: new Map(Object.entries(entries)) }
}

function arr(...items: HoconValue[]): HoconValue {
  return { kind: 'array', items }
}

// ---------------------------------------------------------------------------
// Non-object inputs → null
// ---------------------------------------------------------------------------
describe('numericObjectToArray — non-object inputs', () => {
  it('returns null for scalar value', () => {
    expect(numericObjectToArray(str('hello'))).toBeNull()
  })

  it('returns null for array value', () => {
    expect(numericObjectToArray(arr(str('a')))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Empty object → null (S15.4)
// ---------------------------------------------------------------------------
describe('numericObjectToArray — empty object', () => {
  it('returns null for empty object (S15.4: empty NOT converted)', () => {
    expect(numericObjectToArray(obj({}))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integer key eligibility table (spec §"Integer key parse rule")
// ---------------------------------------------------------------------------
describe('numericObjectToArray — key eligibility', () => {
  // Eligible keys
  it('"0" is eligible', () => {
    const result = numericObjectToArray(obj({ '0': str('a') }))
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })

  it('"1" is eligible', () => {
    const result = numericObjectToArray(obj({ '1': str('a') }))
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })

  it('"42" is eligible', () => {
    const result = numericObjectToArray(obj({ '42': str('a') }))
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })

  it('"2147483647" (i32 max) is eligible', () => {
    const result = numericObjectToArray(obj({ '2147483647': str('a') }))
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
  })

  // Rejected: leading sign
  it('"+1" is rejected (E3: leading + sign)', () => {
    expect(numericObjectToArray(obj({ '+1': str('a') }))).toBeNull()
  })

  it('"-0" is rejected (E4: leading - sign on zero)', () => {
    expect(numericObjectToArray(obj({ '-0': str('a') }))).toBeNull()
  })

  it('"-1" is rejected (negative integer)', () => {
    expect(numericObjectToArray(obj({ '-1': str('a') }))).toBeNull()
  })

  // Rejected: leading zeros
  it('"00" is rejected (E2: leading zero)', () => {
    expect(numericObjectToArray(obj({ '00': str('a') }))).toBeNull()
  })

  it('"01" is rejected (leading zero)', () => {
    expect(numericObjectToArray(obj({ '01': str('a') }))).toBeNull()
  })

  it('"007" is rejected (leading zeros)', () => {
    expect(numericObjectToArray(obj({ '007': str('a') }))).toBeNull()
  })

  // Rejected: whitespace
  it('" 1" (leading space) is rejected', () => {
    expect(numericObjectToArray(obj({ ' 1': str('a') }))).toBeNull()
  })

  it('"1 " (trailing space) is rejected', () => {
    expect(numericObjectToArray(obj({ '1 ': str('a') }))).toBeNull()
  })

  // Rejected: empty
  it('"" (empty key) is rejected', () => {
    expect(numericObjectToArray(obj({ '': str('a') }))).toBeNull()
  })

  // Rejected: overflow (i32 max + 1)
  it('"2147483648" is rejected (i32 overflow)', () => {
    expect(numericObjectToArray(obj({ '2147483648': str('a') }))).toBeNull()
  })

  it('"99999999999" is rejected (large overflow)', () => {
    expect(numericObjectToArray(obj({ '99999999999': str('a') }))).toBeNull()
  })

  // Rejected: non-decimal forms
  it('"0x1" is rejected (hex)', () => {
    expect(numericObjectToArray(obj({ '0x1': str('a') }))).toBeNull()
  })

  it('"1e2" is rejected (scientific notation)', () => {
    expect(numericObjectToArray(obj({ '1e2': str('a') }))).toBeNull()
  })

  it('"1.0" is rejected (decimal point)', () => {
    expect(numericObjectToArray(obj({ '1.0': str('a') }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sort & compaction (S15.6, S15.7)
// ---------------------------------------------------------------------------
describe('numericObjectToArray — sort and compaction', () => {
  it('S15.7: sorts {"1":"b","0":"a"} → ["a","b"]', () => {
    const result = numericObjectToArray(obj({ '1': str('b'), '0': str('a') }))
    expect(result).not.toBeNull()
    expect(result!.map((v) => (v as { raw: string }).raw)).toEqual(['a', 'b'])
  })

  it('S15.6: compacts {"0":"a","2":"c"} → ["a","c"] (no undefined slot)', () => {
    const result = numericObjectToArray(obj({ '0': str('a'), '2': str('c') }))
    expect(result).not.toBeNull()
    expect(result!.map((v) => (v as { raw: string }).raw)).toEqual(['a', 'c'])
  })

  it('S15.5: ignores non-int keys {"0":"a","foo":"b","1":"c"} → ["a","c"]', () => {
    const result = numericObjectToArray(obj({ '0': str('a'), 'foo': str('b'), '1': str('c') }))
    expect(result).not.toBeNull()
    expect(result!.map((v) => (v as { raw: string }).raw)).toEqual(['a', 'c'])
  })
})

// ---------------------------------------------------------------------------
// No eligible keys → null (all keys ineligible)
// ---------------------------------------------------------------------------
describe('numericObjectToArray — all keys ineligible', () => {
  it('{"foo":"a","bar":"b"} → null (no integer keys)', () => {
    expect(numericObjectToArray(obj({ 'foo': str('a'), 'bar': str('b') }))).toBeNull()
  })

  it('{"+1":"a"} → null (all keys rejected by pre-filter)', () => {
    expect(numericObjectToArray(obj({ '+1': str('a') }))).toBeNull()
  })

  it('{"00":"a","01":"b"} → null (all leading-zero forms rejected)', () => {
    expect(numericObjectToArray(obj({ '00': str('a'), '01': str('b') }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Non-recursive: nested objects not converted
// ---------------------------------------------------------------------------
describe('numericObjectToArray — non-recursive', () => {
  it('nested numeric-keyed object is NOT converted (laziness)', () => {
    // outer = {"0": {"0":"x","1":"y"}}
    // numericObjectToArray on outer should return [inner_object], not [["x","y"]]
    const inner = obj({ '0': str('x'), '1': str('y') })
    const outer = obj({ '0': inner })
    const result = numericObjectToArray(outer)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(1)
    // The inner element should be the object itself, not a converted array
    expect(result![0]).toBe(inner)
  })
})
