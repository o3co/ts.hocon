import { describe, it, expect } from 'vitest'
import { coerceBoolean, coerceNumber } from '../src/coerce.js'

describe('coerceBoolean', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['yes', true],
    ['no', false],
    ['on', true],
    ['off', false],
    ['True', true],
    ['FALSE', false],
    ['Yes', true],
    ['NO', false],
    ['ON', true],
    ['Off', false],
  ])('coerces %s to %s', (input, expected) => {
    expect(coerceBoolean(input)).toBe(expected)
  })

  it('returns undefined for non-boolean string', () => {
    expect(coerceBoolean('maybe')).toBeUndefined()
    expect(coerceBoolean('1')).toBeUndefined()
    expect(coerceBoolean('')).toBeUndefined()
  })
})

describe('coerceNumber', () => {
  it.each([
    ['8080', 8080],
    ['3.14', 3.14],
    ['0', 0],
    ['-1', -1],
    ['1e3', 1000],
  ])('coerces %s to %s', (input, expected) => {
    expect(coerceNumber(input)).toBe(expected)
  })

  it('returns undefined for non-numeric string', () => {
    expect(coerceNumber('abc')).toBeUndefined()
    expect(coerceNumber('')).toBeUndefined()
    expect(coerceNumber('NaN')).toBeUndefined()
  })

  it('returns undefined for whitespace-only string', () => {
    expect(coerceNumber('   ')).toBeUndefined()
  })

  it('returns undefined for Infinity', () => {
    expect(coerceNumber('Infinity')).toBeUndefined()
    expect(coerceNumber('-Infinity')).toBeUndefined()
  })

  it('returns undefined for hex literals', () => {
    expect(coerceNumber('0xff')).toBeUndefined()
    expect(coerceNumber('0xFF')).toBeUndefined()
  })
})
