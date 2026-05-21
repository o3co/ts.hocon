// tests/config-with-fallback-unresolved.test.ts
import { describe, expect, it } from 'vitest'
import { parse, parseStringWithOptions } from '../src/parse.js'

describe('Config.withFallback (unresolved-aware)', () => {
  it('both resolved — preserves existing semantics', () => {
    const a = parse('a = 1\nb = 2')
    const b = parse('b = 99\nc = 3')
    const m = a.withFallback(b)
    expect(m.isResolved()).toBe(true)
    expect(m.getNumber('a')).toBe(1)
    expect(m.getNumber('b')).toBe(2)
    expect(m.getNumber('c')).toBe(3)
  })

  it('receiver unresolved + resolved fallback → result unresolved', () => {
    const r = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    const f = parse('b = 7')
    const m = r.withFallback(f)
    expect(m.isResolved()).toBe(false)
  })

  it('both unresolved but no placeholders → result resolved', () => {
    const a = parseStringWithOptions('a { x = 1 }', { resolveSubstitutions: false })
    const b = parseStringWithOptions('a { y = 2 }', { resolveSubstitutions: false })
    const m = a.withFallback(b)
    // No substitutions in either → merged result has no placeholders → resolved
    expect(m.isResolved()).toBe(true)
    expect(m.getNumber('a.x')).toBe(1)
    expect(m.getNumber('a.y')).toBe(2)
  })

  it('nil/undefined fallback returns receiver', () => {
    const c = parse('a = 1')
    // @ts-expect-error testing undefined
    expect(c.withFallback(undefined)).toBe(c)
  })

  it('object deep-merge recursive (unresolved operands)', () => {
    const a = parseStringWithOptions('a { x = 1 }', { resolveSubstitutions: false })
    const b = parseStringWithOptions('a { y = 2 }', { resolveSubstitutions: false })
    const m = a.withFallback(b)
    expect(m.getNumber('a.x')).toBe(1)
    expect(m.getNumber('a.y')).toBe(2)
  })
})
