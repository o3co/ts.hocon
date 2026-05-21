// tests/config-resolve.test.ts
import { describe, expect, it } from 'vitest'
import { parse, parseStringWithOptions, defaultResolveOptions } from '../src/parse.js'
import { NotResolvedError } from '../src/errors.js'

describe('Config.resolve — idempotent on already-resolved', () => {
  it('fused parse() → resolve() is idempotent', () => {
    const c = parse('a = 1')
    const r = c.resolve()
    expect(r.isResolved()).toBe(true)
    expect(r.getNumber('a')).toBe(1)
  })

  it('double resolve does not drift', () => {
    const c = parse('a = 1')
    const r1 = c.resolve()
    const r2 = r1.resolve()
    expect(r2.getNumber('a')).toBe(1)
  })
})

describe('Config.resolve — deferred path', () => {
  it('resolves unresolved Config', () => {
    const c = parseStringWithOptions('a = ${b}\nb = 1', { resolveSubstitutions: false })
    expect(c.isResolved()).toBe(false)
    const r = c.resolve()
    expect(r.isResolved()).toBe(true)
    expect(r.getNumber('a')).toBe(1)
  })

  it('allowUnresolved=true keeps placeholders without throwing', () => {
    const c = parseStringWithOptions('a = ${avail}\nb = ${unavail}\navail = "hello"', { resolveSubstitutions: false })
    const r = c.resolve({ ...defaultResolveOptions(), allowUnresolved: true, useSystemEnvironment: false })
    // avail was resolved; b still has placeholder
    expect(r.isResolved()).toBe(false)
    expect(r.getString('a')).toBe('hello')
    // Getter on unresolved path throws NotResolvedError
    expect(() => r.getString('b')).toThrow(NotResolvedError)
  })

  it('useSystemEnvironment=false — env var not consulted', () => {
    const c = parseStringWithOptions('a = ${SHOULD_NOT_BE_READ}', { resolveSubstitutions: false })
    expect(() => c.resolve({ ...defaultResolveOptions(), useSystemEnvironment: false })).toThrow()
  })
})
