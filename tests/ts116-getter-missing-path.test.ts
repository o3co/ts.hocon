import { describe, it, expect } from 'vitest'
import { parseStringWithOptions } from '../src/index.js'
import { ConfigError, NotResolvedError } from '../src/errors.js'

describe('ts#116 — unresolved getter: missing-path without placeholder', () => {
  it('throws ConfigError (not NotResolvedError) when path does not exist and is unrelated to any placeholder', () => {
    const c = parseStringWithOptions('a { x = 1 }\nb = ${missing}', { resolveSubstitutions: false })
    // a.y doesn't exist and isn't related to any placeholder
    let err: unknown
    try { c.getString('a.y') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).not.toBeInstanceOf(NotResolvedError)
  })

  it('throws NotResolvedError when path holds a placeholder', () => {
    const c = parseStringWithOptions('a { x = 1 }\nb = ${missing}', { resolveSubstitutions: false })
    expect(() => c.getString('b')).toThrow(NotResolvedError)
  })

  it('returns resolved scalar when path holds a real value (no error)', () => {
    const c = parseStringWithOptions('a { x = 1 }\nb = ${missing}', { resolveSubstitutions: false })
    expect(c.getNumber('a.x')).toBe(1)
  })
})
