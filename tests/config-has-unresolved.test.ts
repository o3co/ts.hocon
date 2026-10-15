// tests/config-has-unresolved.test.ts
// has(path) on a path whose value is an unresolved substitution answers true —
// the path is there — and does not throw; reading it (get, getValue, the typed
// getters) still throws NotResolvedError. Cross-implementation decision
// (2026-10-16, go.hocon's behaviour; Lightbend throws NotResolved).
import { describe, expect, it } from 'vitest'
import { NotResolvedError, parse } from '../src/index.js'

describe('has() on an unresolved Config', () => {
  const cfg = () => parse('a = ${missing}\nb { x = ${m}, y = 1 }\nc = [1, ${n}]\nd = ${?opt}', { resolveSubstitutions: false })

  it('answers true for a path whose value is a substitution', () => {
    const c = cfg()
    expect(c.has('a')).toBe(true)
    expect(c.has('b.x')).toBe(true)
    expect(c.has('c')).toBe(true)
    expect(c.has('d')).toBe(true)
  })

  it('answers as before for resolved and missing paths', () => {
    const c = cfg()
    expect(c.has('b')).toBe(true)
    expect(c.has('b.y')).toBe(true)
    expect(c.has('nope')).toBe(false)
    expect(c.has('b.nope')).toBe(false)
  })

  it('does not claim a path under a value that is still a substitution', () => {
    // Whether `a.z` exists depends on what ${missing} resolves to.
    expect(cfg().has('a.z')).toBe(false)
  })

  it('still throws NotResolvedError on reading the value', () => {
    const c = cfg()
    expect(() => c.getValue('a')).toThrow(NotResolvedError)
    expect(() => c.getString('b.x')).toThrow(NotResolvedError)
  })

  it('answers true after a partial resolve that left the value', () => {
    const c = parse('u = ${missing}\nv = 1\nw = ${v}', { resolveSubstitutions: false })
      .resolve({ allowUnresolved: true, useSystemEnvironment: false })
    expect(c.has('u')).toBe(true)
    expect(c.has('w')).toBe(true)
  })

  it('is unchanged on a resolved Config', () => {
    const c = parse('a = ${?missing}\nb = 1')
    expect(c.has('a')).toBe(false)
    expect(c.has('b')).toBe(true)
  })
})
