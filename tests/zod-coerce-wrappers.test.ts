// tests/zod-coerce-wrappers.test.ts
//
// #225 — the Zod entry points coerce a string where the schema expects a number
// or a boolean wherever the schema puts it: inside records, tuples, unions,
// pipes and lazy schemas as inside objects and arrays. A value from an
// environment variable is always a string, so without this a section's shape
// decided whether `${?VAR}` could feed a number.

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { getValidated, validate } from '../src/zod.js'

const codesAndPaths = (run: () => unknown) => {
  try {
    run()
  } catch (err) {
    expect(err).toBeInstanceOf(z.ZodError)
    return (err as z.ZodError).issues.map((issue) => [issue.code, issue.path])
  }
  throw new Error('expected a ZodError')
}

describe('#225 coercion inside records, tuples, unions, pipes and lazy schemas', () => {
  it('coerces each value of a record (the issue example)', () => {
    const cfg = parse('limits { api = ${?API_LIMIT}, web = "7" }', { env: { API_LIMIT: '5' } })
    expect(getValidated(cfg, 'limits', z.record(z.string(), z.number()))).toEqual({ api: 5, web: 7 })
  })

  it('keeps record keys as written', () => {
    const cfg = parse('flags { "1" = "true", off = "no" }')
    expect(getValidated(cfg, 'flags', z.record(z.string(), z.boolean()))).toEqual({ 1: true, off: false })
  })

  it('coerces a record of objects', () => {
    const cfg = parse('pools { a { size = "4" }, b { size = "8" } }')
    const schema = z.record(z.string(), z.object({ size: z.number() }))
    expect(getValidated(cfg, 'pools', schema)).toEqual({ a: { size: 4 }, b: { size: 8 } })
  })

  it('coerces tuple items by position, and the rest by the rest schema', () => {
    const cfg = parse('t = [ "1", "true", x, "2", "3" ]')
    const schema = z.tuple([z.number(), z.boolean(), z.string()], z.number())
    expect(getValidated(cfg, 't', schema)).toEqual([1, true, 'x', 2, 3])
  })

  describe('union', () => {
    it('takes the value as it is when an option accepts it', () => {
      // As py.hocon (Pydantic smart union) and rs.hocon (serde untagged enum)
      // read it, and as 1.14.0 did: no value that validated changes.
      const cfg = parse('a = "5", b = on')
      expect(getValidated(cfg, 'a', z.union([z.number(), z.string()]))).toBe('5')
      expect(getValidated(cfg, 'a', z.union([z.string(), z.number()]))).toBe('5')
      expect(getValidated(cfg, 'b', z.union([z.boolean(), z.string()]))).toBe('on')
    })

    it('coerces by the first option that accepts the coerced value otherwise', () => {
      const cfg = parse('a = "5", p = ${?PORT}', { env: { PORT: '8081' } })
      expect(getValidated(cfg, 'a', z.union([z.boolean(), z.number()]))).toBe(5)
      expect(getValidated(cfg, 'p', z.union([z.number(), z.literal('auto')]))).toBe(8081)
    })

    it('coerces inside an object option', () => {
      const cfg = parse('server { port = "8080" }')
      const schema = z.union([z.string(), z.object({ port: z.number() })])
      expect(getValidated(cfg, 'server', schema)).toEqual({ port: 8080 })
    })

    it('hands the value over as it is when no option accepts it', () => {
      const cfg = parse('a = abc')
      expect(codesAndPaths(() => getValidated(cfg, 'a', z.union([z.number(), z.boolean()])))).toEqual([
        ['invalid_union', []],
      ])
    })

    it('coerces through optional and nullable options', () => {
      const cfg = parse('a = "3"')
      expect(getValidated(cfg, 'a', z.union([z.number().optional(), z.literal('x')]))).toBe(3)
    })
  })

  describe('discriminatedUnion', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('http'), port: z.number(), tls: z.boolean() }),
      z.object({ kind: z.literal('unix'), path: z.string() }),
    ])

    it('coerces by the option the discriminator picks', () => {
      const cfg = parse('l { kind = http, port = ${?PORT}, tls = "yes" }', { env: { PORT: '8081' } })
      expect(getValidated(cfg, 'l', schema)).toEqual({ kind: 'http', port: 8081, tls: true })
    })

    it('reports issues about the coerced value when the picked option fails', () => {
      const cfg = parse('l { kind = http, port = "8081", tls = perhaps }')
      expect(codesAndPaths(() => getValidated(cfg, 'l', schema))).toEqual([['invalid_type', ['tls']]])
    })

    it('finds the option of a nested discriminated union', () => {
      const nested = z.discriminatedUnion('type', [
        z.object({ type: z.literal('a'), v: z.string() }),
        z.discriminatedUnion('sub', [
          z.object({ type: z.literal('b'), sub: z.literal('c'), v: z.number() }),
          z.object({ type: z.literal('b'), sub: z.literal('d'), v: z.boolean() }),
        ]),
      ])
      expect(getValidated(parse('x { type = b, sub = c, v = "5" }'), 'x', nested)).toEqual({ type: 'b', sub: 'c', v: 5 })
      expect(getValidated(parse('x { type = b, sub = d, v = "on" }'), 'x', nested)).toEqual({ type: 'b', sub: 'd', v: true })
    })

    it('takes an absent tag for an option whose tag is optional', () => {
      const optionalTag = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('http').optional(), port: z.number() }),
        z.object({ kind: z.literal('unix'), path: z.string() }),
      ])
      expect(getValidated(parse('l { port = "8080" }'), 'l', optionalTag)).toEqual({ port: 8080 })
    })

    it('reads a number or boolean tag from a string', () => {
      const versioned = z.discriminatedUnion('v', [
        z.object({ v: z.literal(1), port: z.number() }),
        z.object({ v: z.literal(true), path: z.string() }),
      ])
      const cfg = parse('l { v = ${?VERSION}, port = ${?PORT} }', { env: { VERSION: '1', PORT: '8080' } })
      expect(getValidated(cfg, 'l', versioned)).toEqual({ v: 1, port: 8080 })
    })

    it('prefers an option whose tag matches as it is over one it coerces to', () => {
      const byNumber = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(1), port: z.number() }),
        z.object({ kind: z.literal('1'), path: z.string() }),
      ])
      expect(getValidated(parse('l { kind = "1", path = /tmp/app.sock }'), 'l', byNumber)).toEqual({
        kind: '1', path: '/tmp/app.sock',
      })
      expect(getValidated(parse('l { kind = 1, port = "80" }'), 'l', byNumber)).toEqual({ kind: 1, port: 80 })

      const byBoolean = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(true), port: z.number() }),
        z.object({ kind: z.literal('true'), path: z.string() }),
      ])
      expect(getValidated(parse('l { kind = "true", path = /tmp/app.sock }'), 'l', byBoolean)).toEqual({
        kind: 'true', path: '/tmp/app.sock',
      })
      expect(getValidated(parse('l { kind = true, port = "80" }'), 'l', byBoolean)).toEqual({ kind: true, port: 80 })
    })

    it('leaves a value with no matching discriminator to the schema', () => {
      const cfg = parse('l { kind = ftp, port = "21" }')
      expect(codesAndPaths(() => getValidated(cfg, 'l', schema))).toEqual([['invalid_union', ['kind']]])
    })
  })

  it('coerces to a number or boolean literal', () => {
    const cfg = parse('a = "5", b = "true", c = "x"')
    expect(getValidated(cfg, 'a', z.literal(5))).toBe(5)
    expect(getValidated(cfg, 'b', z.literal(true))).toBe(true)
    expect(getValidated(cfg, 'c', z.literal(['x', 1]))).toBe('x')
  })

  it('keeps the union option chosen for the coerced value through the final parse', () => {
    // A literal option coerces too, so the option that accepts the coerced
    // value is the one Zod's own first match then takes.
    const cfg = parse('a = "5"')
    const schema = z.union([
      z.literal(5).transform(() => 'literal'),
      z.number().transform(() => 'number'),
    ])
    expect(getValidated(cfg, 'a', schema)).toBe('literal')
    expect(getValidated(parse('a = "6"'), 'a', schema)).toBe('number')
  })

  it('coerces to a numeric enum value', () => {
    enum Level { Low = 1, High = 2 }
    const cfg = parse('a = "1", b = ${?LEVEL}, c = x', { env: { LEVEL: '2' } })
    expect(getValidated(cfg, 'a', z.enum({ A: 1, B: 2 }))).toBe(1)
    expect(getValidated(cfg, 'b', z.nativeEnum(Level))).toBe(Level.High)
    expect(getValidated(cfg, 'c', z.enum(['x', 'y']))).toBe('x')
  })

  it('reads an enum value only as a value Zod accepts', () => {
    enum Level { Low = 1 }
    // A nativeEnum's reverse-mapping name is not a value; an exact string
    // value wins over a number it would coerce to.
    expect(() => getValidated(parse('a = Low'), 'a', z.nativeEnum(Level))).toThrow(z.ZodError)
    expect(getValidated(parse('a = "1"'), 'a', z.enum({ A: 1, B: '1' }))).toBe('1')
  })

  it('coerces a discriminator tag to a numeric enum value', () => {
    const schema = z.discriminatedUnion('k', [
      z.object({ k: z.enum({ A: 1 }), n: z.number() }),
      z.object({ k: z.literal('b'), s: z.string() }),
    ])
    expect(getValidated(parse('x { k = "1", n = "5" }'), 'x', schema)).toEqual({ k: 1, n: 5 })
  })

  it('coerces the keys an object\'s catchall covers', () => {
    const cfg = parse('o { port = "80", x = "5", on = "yes" }')
    const schema = z.object({ port: z.number() }).catchall(z.union([z.number(), z.boolean()]))
    expect(getValidated(cfg, 'o', schema)).toEqual({ port: 80, x: 5, on: true })
    expect(getValidated(cfg, 'o', z.looseObject({ port: z.number() }))).toEqual({ port: 80, x: '5', on: 'yes' })
  })

  it('hands a .catch() in the new positions the coerced value', () => {
    // The one documented value change: the fallback used to take the string.
    const cfg = parse('o { x = "5" }, e = "1"')
    expect(getValidated(cfg, 'o', z.object({}).catchall(z.number().catch(-1)))).toEqual({ x: 5 })
    expect(getValidated(cfg, 'e', z.enum({ A: 1, B: 2 }).catch(2))).toBe(1)
  })

  it('coerces a catchall alongside a refused prototype-named key', () => {
    // `y` is coerced; `x` is not a number; the refusal comes first.
    const cfg = parse('o { "constructor" = 1, x = abc, y = "5" }')
    const err = (() => {
      try {
        getValidated(cfg, 'o', z.object({}).catchall(z.number()))
      } catch (e) {
        return e as z.ZodError
      }
    })()
    expect(err?.issues.map((issue) => [issue.code, issue.path])).toEqual([['custom', []], ['invalid_type', ['x']]])
  })

  it('coerces for both sides of an intersection', () => {
    const cfg = parse('o { port = "80", tls = "true" }')
    const schema = z.intersection(z.object({ port: z.number() }), z.object({ tls: z.boolean() }))
    expect(getValidated(cfg, 'o', schema)).toEqual({ port: 80, tls: true })
    expect(getValidated(cfg, 'o', z.object({ port: z.number() }).and(z.object({ tls: z.boolean() })))).toEqual({
      port: 80, tls: true,
    })
  })

  it('keeps a value an intersection accepts as it is', () => {
    // Coercing for the right side would hand the left side a number.
    const cfg = parse('a = "5", o { x = "5" }')
    expect(getValidated(cfg, 'a', z.intersection(z.string().transform(Number), z.coerce.number()))).toBe(5)
    const objects = z.intersection(
      z.object({ x: z.string().transform(Number) }),
      z.object({ x: z.coerce.number() }),
    )
    expect(getValidated(cfg, 'o', objects)).toEqual({ x: 5 })
  })

  it('coerces for one side of an intersection when that is the form both accept', () => {
    // `x` passes both sides as the string; only `y` needs coercing, for
    // whichever side names it. Coercing `x` for the coercing side too would
    // break the transforming side.
    const cfg = parse('o { x = "5", y = "6" }')
    const leftNeeds = z.intersection(
      z.object({ x: z.string().transform(Number), y: z.number() }),
      z.object({ x: z.coerce.number() }),
    )
    expect(getValidated(cfg, 'o', leftNeeds)).toEqual({ x: 5, y: 6 })
    const rightNeeds = z.intersection(z.object({ x: z.string() }), z.object({ y: z.number() }))
    expect(getValidated(cfg, 'o', rightNeeds)).toEqual({ x: '5', y: 6 })
  })

  it('leaves an intersection whose sides need different forms of one key to Zod', () => {
    // `x` must stay a string for the left and `y` become a number for the
    // right, which coerces `x` too: no single form passes both sides.
    const cfg = parse('o { x = "5", y = "6" }')
    const schema = z.intersection(
      z.object({ x: z.string().transform(Number) }),
      z.object({ x: z.coerce.number(), y: z.number() }),
    )
    expect(() => getValidated(cfg, 'o', schema)).toThrow(z.ZodError)
  })

  it('coerces inside z.success', () => {
    expect(getValidated(parse('a = "5"'), 'a', z.success(z.number()))).toBe(true)
  })

  describe('pipe', () => {
    it('coerces by the input schema', () => {
      const cfg = parse('a = "5"')
      expect(getValidated(cfg, 'a', z.number().pipe(z.number().min(1)))).toBe(5)
      expect(codesAndPaths(() => getValidated(cfg, 'a', z.number().pipe(z.number().min(10))))).toEqual([
        ['too_small', []],
      ])
    })

    it('leaves a string input schema its string', () => {
      const cfg = parse('a = "5", b = yes')
      expect(getValidated(cfg, 'a', z.string().transform((s) => s.length))).toBe(1)
      expect(getValidated(cfg, 'b', z.stringbool())).toBe(true)
    })
  })

  it('coerces through a lazy (recursive) schema', () => {
    type Node = { weight: number; children: Node[] }
    const NodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({ weight: z.number(), children: z.array(NodeSchema) }),
    )
    const cfg = parse('root { weight = "1", children = [ { weight = "2", children = [] } ] }')
    expect(getValidated(cfg, 'root', NodeSchema)).toEqual({ weight: 1, children: [{ weight: 2, children: [] }] })
  })

  it('coerces through prefault and nonoptional', () => {
    const cfg = parse('a = "5", b = "true"')
    const schema = z.object({ a: z.number().prefault(1), b: z.boolean().optional().nonoptional() })
    expect(validate(cfg, schema)).toEqual({ a: 5, b: true })
  })

  it('coerces wrappers nested in each other', () => {
    const cfg = parse('m { a = [ "1", "2" ], b = [ "3" ] }')
    const schema = z.object({ m: z.record(z.string(), z.array(z.union([z.number(), z.boolean()]))) })
    expect(validate(cfg, schema)).toEqual({ m: { a: [1, 2], b: [3] } })
  })
})
