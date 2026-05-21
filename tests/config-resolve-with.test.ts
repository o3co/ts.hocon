// tests/config-resolve-with.test.ts
import { describe, expect, it } from 'vitest'
import { parse, parseStringWithOptions } from '../src/parse.js'
import { NotResolvedError } from '../src/errors.js'

describe('Config.resolveWith — basic', () => {
  it('resolves receiver substitution using source', () => {
    const r = parseStringWithOptions('r = ${value}', { resolveSubstitutions: false })
    const src = parse('value = "found"')
    const out = r.resolveWith(src)
    expect(out.getString('r')).toBe('found')
  })

  it('source keys absent from result', () => {
    const r = parseStringWithOptions('r = ${value}', { resolveSubstitutions: false })
    const src = parse('value = "found"')
    const out = r.resolveWith(src)
    expect(out.has('value')).toBe(false)
  })

  it('already-resolved receiver is a no-op (source keys not included)', () => {
    const r = parse('r = 5')
    const src = parse('unused = 99')
    const out = r.resolveWith(src)
    expect(out.getNumber('r')).toBe(5)
    expect(out.has('unused')).toBe(false)
  })
})

describe('Config.resolveWith — precondition: source must be resolved', () => {
  it('throws NotResolvedError when source is unresolved', () => {
    const r = parseStringWithOptions('r = ${value}', { resolveSubstitutions: false })
    const src = parseStringWithOptions('value = ${still_unresolved}', { resolveSubstitutions: false })
    expect(() => r.resolveWith(src)).toThrow(NotResolvedError)
  })
})

describe('Config.resolveWith — nested-key filter (critical regression)', () => {
  it('does NOT leak nested source keys under shared top-level key', () => {
    // Receiver: { a: { x: ${y} } }
    // Source:   { a: { z: 99 }, y: "ok" }
    // Expected: { a: { x: "ok" } }  — NOT { a: { x: "ok", z: 99 } }
    const r = parseStringWithOptions('a { x = ${y} }', { resolveSubstitutions: false })
    const src = parse('a { z = 99 }\ny = "ok"')
    const out = r.resolveWith(src)
    expect(out.getConfig('a').has('x')).toBe(true)
    expect(out.getConfig('a').getString('x')).toBe('ok')
    // The critical check: source's nested key must not leak
    expect(out.getConfig('a').has('z')).toBe(false)
    expect(out.has('y')).toBe(false)
  })
})
