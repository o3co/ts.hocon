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

// F0.5: integers reach the value model losslessly, bounded by int64. A bigint
// is how an adapter carries an integer literal that a JS number cannot hold
// exactly, so its digits must survive verbatim into the scalar's raw text.
describe('fromMap — bigint (F0.5 lossless integer ingest)', () => {
  it('keeps a bigint past the safe range as exact raw text', () => {
    const c = fromMap({ big: 9007199254740993n })
    expect(c.getString('big')).toBe('9007199254740993')
    // The JS number model still rounds at the getter, exactly as the core
    // parser does for the same literal written in HOCON text.
    expect(c.getNumber('big')).toBe(9007199254740992)
    expect(parse('big = 9007199254740993').getString('big')).toBe('9007199254740993')
  })

  it('accepts the int64 bounds themselves', () => {
    expect(fromMap({ n: 9223372036854775807n }).getString('n')).toBe('9223372036854775807')
    expect(fromMap({ n: -9223372036854775808n }).getString('n')).toBe('-9223372036854775808')
  })

  it('keeps a small bigint as a plain number scalar', () => {
    const c = fromMap({ n: 42n })
    expect(c.getNumber('n')).toBe(42)
    expect(c.getString('n')).toBe('42')
  })

  it('refuses a bigint outside int64 (F0.5 overflow = error)', () => {
    expect(() => fromMap({ n: 9223372036854775808n })).toThrow(/int64/)
    expect(() => fromMap({ n: -9223372036854775809n })).toThrow(/int64/)
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
