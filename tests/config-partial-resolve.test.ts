// tests/config-partial-resolve.test.ts
// A Config from resolve({ allowUnresolved: true }) / resolveWith(…, { allowUnresolved: true })
// answers "is this unresolved?" from what is still unresolved after that
// resolve, not from the tree it started from:
// - a subtree whose substitutions were resolved reads normally;
// - a substitution left inside an array keeps the array unresolved (it read
//   as null, with isResolved() true).
import { describe, expect, it } from 'vitest'
import { NotResolvedError, fromMap, parse } from '../src/index.js'

const partial = (text: string) =>
  parse(text, { resolveSubstitutions: false }).resolve({ allowUnresolved: true, useSystemEnvironment: false })

describe('resolve({ allowUnresolved: true })', () => {
  it('reads a subtree whose substitutions were resolved', () => {
    const cfg = partial('a { x = ${v} }\nv = 1\nu = ${missing}')
    expect(cfg.isResolved()).toBe(false)
    expect(cfg.getConfig('a').toObject()).toEqual({ x: 1 })
    expect(cfg.getValue('a')).toBeDefined()
    expect(cfg.getNumber('a.x')).toBe(1)
    expect(() => cfg.getString('u')).toThrow(NotResolvedError)
  })

  it('reads an array whose substitutions were resolved', () => {
    const cfg = partial('v = 1\narr = [${v}, 2]\nu = ${missing}')
    expect(cfg.getList('arr')).toEqual([1, 2])
    expect(cfg.getValue('arr')).toBeDefined()
  })

  it('keeps an array with a substitution left in it unresolved', () => {
    for (const text of ['arr = [1, ${y}]', 'arr = [[1, ${y}]]', 'arr = [{ p = ${y} }]']) {
      const cfg = partial(text)
      expect([text, cfg.isResolved()]).toEqual([text, false])
      expect(() => cfg.getList('arr')).toThrow(NotResolvedError)
      expect(() => cfg.getValue('arr')).toThrow(NotResolvedError)
      expect(cfg.toObject()).toEqual({})
    }
  })

  it('still resolves the rest later, with a fallback', () => {
    const cfg = partial('a { x = ${v} }\nv = 1\nu = ${missing}\narr = [1, ${y}]')
    const done = cfg.withFallback(fromMap({ missing: 'm', y: 2 })).resolve({ useSystemEnvironment: false })
    expect(done.isResolved()).toBe(true)
    expect(done.toObject()).toEqual({ a: { x: 1 }, v: 1, u: 'm', arr: [1, 2], missing: 'm', y: 2 })
  })

  it('is fully resolved when nothing is left', () => {
    const cfg = partial('v = 1\na { x = ${v} }\narr = [${v}]')
    expect(cfg.isResolved()).toBe(true)
    expect(cfg.toObject()).toEqual({ v: 1, a: { x: 1 }, arr: [1] })
  })
})

describe('resolveWith(…, { allowUnresolved: true })', () => {
  it('reads a subtree the source resolved, and keeps the rest unresolved', () => {
    const receiver = parse('a { x = ${v} }\nu = ${missing}\narr = [1, ${y}]', { resolveSubstitutions: false })
    const cfg = receiver.resolveWith(fromMap({ v: 1 }), { allowUnresolved: true, useSystemEnvironment: false })
    expect(cfg.isResolved()).toBe(false)
    expect(cfg.getConfig('a').toObject()).toEqual({ x: 1 })
    expect(() => cfg.getString('u')).toThrow(NotResolvedError)
    expect(() => cfg.getList('arr')).toThrow(NotResolvedError)
  })
})
