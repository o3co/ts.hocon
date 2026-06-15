// tests/config-getvalue.test.ts
import { describe, expect, it } from 'vitest'
import { parseString, parseStringWithOptions } from '../src/parse.js'
import { NotResolvedError } from '../src/errors.js'
import { asObject, asString, isObject } from '../src/value.js'

describe('Config.getValue — raw HoconValue node access', () => {
  const c = parseString('a = 1\nb { c = 2 }\nd = [10, 20]\ns = "hi"')

  it('returns a scalar node for a scalar path', () => {
    const v = c.getValue('a')
    expect(v).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('returns a string scalar node verbatim', () => {
    const v = c.getValue('s')
    expect(v).toEqual({ kind: 'scalar', raw: 'hi', valueType: 'string' })
  })

  it('returns an object node for an object path', () => {
    const v = c.getValue('b')
    expect(v?.kind).toBe('object')
    if (v && isObject(v)) {
      expect([...v.fields.keys()]).toEqual(['c'])
    } else {
      throw new Error('expected object node')
    }
  })

  it('returns a nested scalar via dotted path', () => {
    expect(c.getValue('b.c')).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
  })

  it('returns an array node for an array path', () => {
    const v = c.getValue('d')
    expect(v?.kind).toBe('array')
    if (v?.kind === 'array') {
      expect(v.items).toHaveLength(2)
    }
  })

  it('returns undefined for a genuinely missing path', () => {
    expect(c.getValue('nope')).toBeUndefined()
    expect(c.getValue('b.nope')).toBeUndefined()
  })

  // Documented behaviour: getValue('') returns the root object node.
  it("getValue('') returns the root node", () => {
    const root = c.getValue('')
    expect(root?.kind).toBe('object')
    if (root && isObject(root)) {
      expect([...root.fields.keys()]).toEqual(['a', 'b', 'd', 's'])
    } else {
      throw new Error('expected root object node')
    }
  })

  it('composes with the value accessors', () => {
    const b = c.getValue('b')
    const fields = b ? asObject(b) : undefined
    const cNode = fields?.get('c')
    expect(cNode).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
    expect(asString(c.getValue('s')!)).toBe('hi')
  })
})

describe('Config.getValue — unresolved paths throw NotResolvedError', () => {
  it('throws on a direct unresolved substitution', () => {
    const c = parseStringWithOptions('a = ${x}', { resolveSubstitutions: false })
    expect(() => c.getValue('a')).toThrow(NotResolvedError)
  })

  it('throws on an object subtree containing an unresolved placeholder', () => {
    const c = parseStringWithOptions('a { x = ${b} }', { resolveSubstitutions: false })
    expect(() => c.getValue('a')).toThrow(NotResolvedError)
  })

  it('throws on an array containing an unresolved placeholder', () => {
    const c = parseStringWithOptions('items = [${a}, 2]', { resolveSubstitutions: false })
    expect(() => c.getValue('items')).toThrow(NotResolvedError)
  })

  it('returns a literal (non-placeholder) node on an otherwise-unresolved config', () => {
    const c = parseStringWithOptions('lit = "value"\nsub = ${KEY}', { resolveSubstitutions: false })
    expect(c.getValue('lit')).toEqual({ kind: 'scalar', raw: 'value', valueType: 'string' })
  })

  // A scalar that was a substitution but is now resolved must NOT throw just
  // because a *different* path is still unresolved (allowUnresolved mode). It is
  // a concrete value — getValue must agree with getString, which returns it.
  it('returns a now-resolved scalar even when other paths stay unresolved (allowUnresolved)', () => {
    const c = parseStringWithOptions(
      'a = ${avail}\nb = ${missing}\navail = "hello"',
      { resolveSubstitutions: false },
    )
    const r = c.resolve({ allowUnresolved: true, useSystemEnvironment: false })
    expect(r.isResolved()).toBe(false)
    expect(r.getString('a')).toBe('hello')
    expect(r.getValue('a')).toEqual({ kind: 'scalar', raw: 'hello', valueType: 'string' })
    // the genuinely-unresolved sibling still throws
    expect(() => r.getValue('b')).toThrow(NotResolvedError)
  })
})
