// tests/value-accessors.test.ts
import { describe, expect, it } from 'vitest'
import {
  asString, asNumber, asBoolean, asObject, asArray,
  isObject, isArray, isScalar, isNull,
} from '../src/value.js'
import type { HoconValue } from '../src/value.js'

const str = (raw: string): HoconValue => ({ kind: 'scalar', raw, valueType: 'string' })
const num = (raw: string): HoconValue => ({ kind: 'scalar', raw, valueType: 'number' })
const bool = (raw: string): HoconValue => ({ kind: 'scalar', raw, valueType: 'boolean' })
const nul = (): HoconValue => ({ kind: 'scalar', raw: 'null', valueType: 'null' })
const obj = (fields: Record<string, HoconValue>): HoconValue =>
  ({ kind: 'object', fields: new Map(Object.entries(fields)) })
const arr = (...items: HoconValue[]): HoconValue => ({ kind: 'array', items })

describe('asString (strict — scalar/string only)', () => {
  it('returns raw for a string scalar', () => {
    expect(asString(str('hello'))).toBe('hello')
  })
  it('returns undefined for non-string scalars (strict, no coercion)', () => {
    expect(asString(num('42'))).toBeUndefined()
    expect(asString(bool('true'))).toBeUndefined()
    expect(asString(nul())).toBeUndefined()
  })
  it('returns undefined for object and array', () => {
    expect(asString(obj({}))).toBeUndefined()
    expect(asString(arr())).toBeUndefined()
  })
})

describe('asNumber (scalar → coerceNumber, lenient like getNumber)', () => {
  it('returns the value for a numeric scalar', () => {
    expect(asNumber(num('3.14'))).toBe(3.14)
    expect(asNumber(num('-7'))).toBe(-7)
  })
  it('coerces a numeric-looking string scalar (parity with getNumber)', () => {
    expect(asNumber(str('42'))).toBe(42)
  })
  it('returns undefined for non-numeric scalars', () => {
    expect(asNumber(str('hello'))).toBeUndefined()
    expect(asNumber(bool('true'))).toBeUndefined()
    expect(asNumber(nul())).toBeUndefined()
  })
  it('returns undefined for object and array', () => {
    expect(asNumber(obj({}))).toBeUndefined()
    expect(asNumber(arr())).toBeUndefined()
  })
})

describe('asBoolean (scalar → coerceBoolean)', () => {
  it('returns the value for a boolean scalar', () => {
    expect(asBoolean(bool('true'))).toBe(true)
    expect(asBoolean(bool('false'))).toBe(false)
  })
  it('coerces boolean-like string scalars (yes/no/on/off)', () => {
    expect(asBoolean(str('yes'))).toBe(true)
    expect(asBoolean(str('off'))).toBe(false)
  })
  it('returns undefined for non-boolean scalars', () => {
    expect(asBoolean(str('maybe'))).toBeUndefined()
    expect(asBoolean(num('1'))).toBeUndefined()
    expect(asBoolean(nul())).toBeUndefined()
  })
  it('returns undefined for object and array', () => {
    expect(asBoolean(obj({}))).toBeUndefined()
    expect(asBoolean(arr())).toBeUndefined()
  })
})

describe('asObject', () => {
  it('returns the fields map for an object', () => {
    const m = asObject(obj({ a: str('x'), b: num('1') }))
    expect(m).toBeDefined()
    expect(m?.get('a')).toEqual(str('x'))
    expect([...m!.keys()]).toEqual(['a', 'b'])
  })
  it('returns undefined for scalar and array', () => {
    expect(asObject(str('x'))).toBeUndefined()
    expect(asObject(arr())).toBeUndefined()
  })
})

describe('asArray', () => {
  it('returns the items for an array', () => {
    const items = asArray(arr(num('1'), num('2')))
    expect(items).toBeDefined()
    expect(items).toHaveLength(2)
    expect(items?.[0]).toEqual(num('1'))
  })
  it('returns undefined for scalar and object', () => {
    expect(asArray(str('x'))).toBeUndefined()
    expect(asArray(obj({}))).toBeUndefined()
  })
})

describe('type guards isObject / isArray / isScalar', () => {
  it('isObject is true only for objects', () => {
    expect(isObject(obj({}))).toBe(true)
    expect(isObject(arr())).toBe(false)
    expect(isObject(str('x'))).toBe(false)
  })
  it('isArray is true only for arrays', () => {
    expect(isArray(arr())).toBe(true)
    expect(isArray(obj({}))).toBe(false)
    expect(isArray(str('x'))).toBe(false)
  })
  it('isScalar is true only for scalars', () => {
    expect(isScalar(str('x'))).toBe(true)
    expect(isScalar(num('1'))).toBe(true)
    expect(isScalar(obj({}))).toBe(false)
    expect(isScalar(arr())).toBe(false)
  })
  it('narrows the type (compile-time guard, exercised at runtime)', () => {
    const v: HoconValue = obj({ k: str('v') })
    if (isObject(v)) {
      expect(v.fields.get('k')).toEqual(str('v'))
    } else {
      throw new Error('expected isObject to narrow')
    }
  })
})

describe('isNull', () => {
  it('is true only for a null scalar', () => {
    expect(isNull(nul())).toBe(true)
    expect(isNull(str('null'))).toBe(false)
    expect(isNull(num('0'))).toBe(false)
    expect(isNull(obj({}))).toBe(false)
    expect(isNull(arr())).toBe(false)
  })
})
