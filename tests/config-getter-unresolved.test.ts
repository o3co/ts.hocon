// tests/config-getter-unresolved.test.ts
import { describe, expect, it } from 'vitest'
import { parseStringWithOptions } from '../src/parse.js'
import { NotResolvedError, ConfigError } from '../src/errors.js'

describe('Config getters on unresolved paths', () => {
  it('getString on unresolved substitution throws NotResolvedError', () => {
    const c = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    expect(() => c.getString('a')).toThrow(NotResolvedError)
    expect(() => c.getString('a')).toThrow(ConfigError)
  })

  it('getString on literal (non-placeholder) key succeeds', () => {
    const c = parseStringWithOptions('lit = "value"\nsub = ${KEY}', { resolveSubstitutions: false })
    expect(c.getString('lit')).toBe('value')
  })

  it('getNumber on unresolved path throws NotResolvedError', () => {
    const c = parseStringWithOptions('n = ${missing}', { resolveSubstitutions: false })
    expect(() => c.getNumber('n')).toThrow(NotResolvedError)
  })

  it('getBoolean on unresolved path throws NotResolvedError', () => {
    const c = parseStringWithOptions('b = ${flag}', { resolveSubstitutions: false })
    expect(() => c.getBoolean('b')).toThrow(NotResolvedError)
  })

  it('error message contains the path', () => {
    const c = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    try {
      c.getString('a')
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(NotResolvedError)
      expect((e as NotResolvedError).path).toBe('a')
    }
  })

  // T1: array placeholder leak — field with array containing placeholder elements
  // must be omitted from partial root so getList throws NotResolvedError rather
  // than silently converting placeholder elements to undefined.
  it('getList on array containing placeholder throws NotResolvedError', () => {
    const c = parseStringWithOptions('items = [${a}, 2]', { resolveSubstitutions: false })
    expect(() => c.getList('items')).toThrow(NotResolvedError)
  })

  // T2: getConfig on object subtree containing unresolved placeholders throws NotResolvedError.
  it('getConfig on object subtree with unresolved placeholder throws NotResolvedError', () => {
    const c = parseStringWithOptions('a { x = ${b} }', { resolveSubstitutions: false })
    expect(() => c.getConfig('a')).toThrow(NotResolvedError)
  })
})
