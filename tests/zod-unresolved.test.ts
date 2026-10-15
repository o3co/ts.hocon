// tests/zod-unresolved.test.ts
// ts.hocon#210 — the Zod entry points throw NotResolvedError when the value
// they would validate contains an unresolved substitution, as the typed getters
// do, instead of handing the schema a tree with those keys left out.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ConfigError, NotResolvedError, fromMap, parse } from '../src/index.js'
import { getValidated, parseWithSchema, validate } from '../src/zod.js'

const unresolved = () =>
  parse('a { x = ${missing}, y = 1 }\nb { z = 2 }\ns = ${nope}', { resolveSubstitutions: false })

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (err) {
    return err
  }
  throw new Error('expected a throw')
}

describe('Zod entry points on an unresolved Config', () => {
  it('validate throws NotResolvedError (a ConfigError, not a ZodError)', () => {
    const err = thrown(() => validate(unresolved(), z.any()))
    expect(err).toBeInstanceOf(NotResolvedError)
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).not.toBeInstanceOf(z.ZodError)
  })

  it('validate throws even when the schema would not read the unresolved key', () => {
    // Before #210 this passed: the schema saw `a` without `x` and `s` absent.
    const schema = z.object({ a: z.object({ y: z.number() }), b: z.object({ z: z.number() }) })
    expect(() => validate(unresolved(), schema)).toThrow(NotResolvedError)
    expect(() => validate(unresolved(), z.object({ s: z.string().optional() }))).toThrow(NotResolvedError)
    expect(() => validate(unresolved(), z.object({ s: z.string().default('d') }))).toThrow(NotResolvedError)
  })

  it('getValidated throws for an unresolved subtree or value, with its path', () => {
    expect(thrown(() => getValidated(unresolved(), 'a', z.any()))).toMatchObject({ name: 'NotResolvedError', path: 'a' })
    expect(thrown(() => getValidated(unresolved(), 'a.x', z.any()))).toMatchObject({ name: 'NotResolvedError', path: 'a.x' })
    expect(thrown(() => getValidated(unresolved(), 's', z.any()))).toMatchObject({ name: 'NotResolvedError', path: 's' })
  })

  it('getValidated still validates a resolved subtree of an unresolved config', () => {
    expect(getValidated(unresolved(), 'b', z.object({ z: z.number() }))).toEqual({ z: 2 })
    expect(getValidated(unresolved(), 'a.y', z.number())).toBe(1)
    expect(getValidated(unresolved(), 'no.such.path', z.undefined())).toBeUndefined()
  })

  it('parseWithSchema with resolveSubstitutions: false throws too', () => {
    expect(() => parseWithSchema('a = ${b}', z.any(), { resolveSubstitutions: false })).toThrow(NotResolvedError)
  })

  it('an unresolved fallback stack throws until resolve()', () => {
    const stack = parse('port = ${PORT}', { resolveSubstitutions: false }).withFallback(fromMap({ PORT: 8080 }))
    expect(() => validate(stack, z.object({ port: z.number() }))).toThrow(NotResolvedError)
    expect(validate(stack.resolve({ useSystemEnvironment: false }), z.object({ port: z.number() }))).toMatchObject({ port: 8080 })
  })

  it('covers arrays, concatenation, += and paths under a substitution', () => {
    const cfg = parse('arr = [1, ${x}]\ns = ${x}"-tail"\nlist = [1]\nlist += ${x}\na = ${x}', { resolveSubstitutions: false })
    for (const path of ['arr', 's', 'list', 'a', 'a.b']) {
      expect(thrown(() => getValidated(cfg, path, z.any()))).toMatchObject({ name: 'NotResolvedError', path })
    }
  })

  it('a deferred parse without substitutions validates as before', () => {
    expect(validate(parse('a = 1', { resolveSubstitutions: false }), z.object({ a: z.number() }))).toEqual({ a: 1 })
  })
})
