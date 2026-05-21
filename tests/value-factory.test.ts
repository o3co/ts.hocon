// tests/value-factory.test.ts
import { describe, expect, it } from 'vitest'
import { fromMap, empty } from '../src/value-factory.js'
import { parse } from '../src/parse.js'

describe('fromMap — primitive types', () => {
  it('round-trips string', () => {
    const c = fromMap({ label: 'hello' })
    expect(c.getString('label')).toBe('hello')
    expect(c.isResolved()).toBe(true)
  })

  it('round-trips integer number', () => {
    const c = fromMap({ count: 42 })
    expect(c.getNumber('count')).toBe(42)
  })

  it('round-trips float number', () => {
    const c = fromMap({ ratio: 3.14 })
    expect(c.getNumber('ratio')).toBeCloseTo(3.14)
  })

  it('round-trips boolean', () => {
    const c = fromMap({ flag: true })
    expect(c.getBoolean('flag')).toBe(true)
  })

  it('round-trips null', () => {
    const c = fromMap({ nothing: null })
    expect(c.toObject()).toEqual({ nothing: null })
  })
})

describe('fromMap — nested and array', () => {
  it('round-trips nested object', () => {
    const c = fromMap({ nested: { inner: 'deep' } })
    expect(c.getString('nested.inner')).toBe('deep')
  })

  it('round-trips array of numbers', () => {
    const c = fromMap({ items: [1, 2, 3] })
    const list = c.getList('items') as number[]
    expect(list).toEqual([1, 2, 3])
  })

  it('round-trips mixed array', () => {
    const c = fromMap({ mix: ['a', 1, true, null] })
    expect(c.toObject()).toEqual({ mix: ['a', 1, true, null] })
  })
})

describe('fromMap — error cases', () => {
  it('throws ConfigError on NaN', () => {
    expect(() => fromMap({ n: NaN })).toThrow()
  })

  it('throws ConfigError on Infinity', () => {
    expect(() => fromMap({ n: Infinity })).toThrow()
  })

  it('throws ConfigError on function', () => {
    expect(() => fromMap({ fn: () => {} })).toThrow()
  })

  it('throws ConfigError on undefined', () => {
    expect(() => fromMap({ u: undefined })).toThrow()
  })
})

describe('fromMap — empty / nil', () => {
  it('fromMap({}) returns empty resolved Config', () => {
    const c = fromMap({})
    expect(c.isResolved()).toBe(true)
    expect(c.keys()).toHaveLength(0)
  })
})

describe('empty', () => {
  it('is resolved with no keys', () => {
    const c = empty()
    expect(c.isResolved()).toBe(true)
    expect(c.keys()).toHaveLength(0)
  })

  it('withFallback(empty()) is no-op', () => {
    const c = parse('a = 1')
    const m = c.withFallback(empty())
    expect(m.getNumber('a')).toBe(1)
  })

  it('empty().withFallback(c) exposes c keys', () => {
    const c = parse('a = 1\nb = 2')
    const m = empty().withFallback(c)
    expect(m.getNumber('a')).toBe(1)
    expect(m.getNumber('b')).toBe(2)
  })

  it('empty().resolve() is no-op', () => {
    const r = empty().resolve()
    expect(r.isResolved()).toBe(true)
    expect(r.keys()).toHaveLength(0)
  })

  it('accepts optional originDescription', () => {
    const c = empty('my-source')
    expect(c._originDescription).toBe('my-source')
  })
})
