// tests/zod-prototype-keys.test.ts
// ts.hocon#201 — the Zod entry points refuse a key that names an object's
// prototype (`__proto__`, `constructor`, `prototype`) wherever it appears in
// the value handed to the schema. Zod drops `__proto__` from a record without
// an error; the other two are refused alike so that the rule does not depend on
// what a schema position happens to do with them.
//
// The issue sits at the object that holds the key (the key is in the message
// and in params.key), because a path containing such a key makes Zod's own
// error formatters throw or write to Object.prototype.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { NotResolvedError } from '../src/errors.js'
import { getValidated, parseFileWithSchema, parseWithSchema, validate } from '../src/zod.js'

const message = (key: string) => `key "${key}" names an object's prototype`

/** The ZodError `run` throws. */
function zodErrorOf(run: () => unknown): z.ZodError {
  try {
    run()
  } catch (err) {
    expect(err).toBeInstanceOf(z.ZodError)
    return err as z.ZodError
  }
  throw new Error('expected a ZodError')
}

/** The path and the refused key of each issue. */
function refused(run: () => unknown): { path: PropertyKey[]; key: string }[] {
  return zodErrorOf(run).issues.map((issue) => {
    expect(issue).toMatchObject({ code: 'custom', message: message((issue as z.core.$ZodIssueCustom).params?.key) })
    return { path: issue.path, key: (issue as z.core.$ZodIssueCustom).params?.key }
  })
}

describe('prototype-named keys', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    it(`refuses "${key}" in a record, at the object that holds it`, () => {
      const cfg = parse(`limits { "${key}" = 5, ok = 1 }`)
      const schema = z.object({ limits: z.record(z.string(), z.number()) })
      expect(refused(() => validate(cfg, schema))).toEqual([{ path: ['limits'], key }])
    })
  }

  it('refuses the key in the issue example instead of dropping it', () => {
    const cfg = parse('limits { "__proto__" = 5, ok = 1 }')
    const err = zodErrorOf(() => getValidated(cfg, 'limits', z.record(z.string(), z.number())))
    expect(err.issues).toEqual([
      { code: 'custom', path: [], message: 'key "__proto__" names an object\'s prototype', params: { key: '__proto__' } },
    ])
  })

  it('refuses it whatever the schema does at that position', () => {
    const cfg = parse('a { "constructor" = 1 }')
    for (const schema of [
      z.object({ a: z.object({}) }),
      z.object({ a: z.looseObject({}) }),
      z.object({ a: z.unknown() }),
      z.object({ a: z.union([z.string(), z.record(z.string(), z.number())]) }),
      z.object({}),
      z.any(),
    ]) {
      expect(refused(() => validate(cfg, schema))).toEqual([{ path: ['a'], key: 'constructor' }])
    }
  })

  it('finds it in array elements and nested objects', () => {
    const cfg = parse('servers = [ { name = a }, { name = b, "prototype" { x = 1 } } ]\ndeep.er { "__proto__" = 1 }')
    expect(refused(() => validate(cfg, z.any()))).toEqual([
      { path: ['servers', 1], key: 'prototype' },
      { path: ['deep', 'er'], key: '__proto__' },
    ])
  })

  // Not descending keeps every issue path free of these keys (see zod.ts).
  it('reports every such key, and does not look inside a refused one', () => {
    const cfg = parse('"__proto__" { "constructor" = 1 }\nb { "prototype" = 2, "constructor" = 3 }')
    expect(refused(() => validate(cfg, z.any()))).toEqual([
      { path: [], key: '__proto__' },
      { path: ['b'], key: 'prototype' },
      { path: ['b'], key: 'constructor' },
    ])
  })

  it('gives paths relative to the value getValidated hands the schema', () => {
    const cfg = parse('app.limits { "__proto__" = 5 }')
    expect(refused(() => getValidated(cfg, 'app', z.any()))).toEqual([{ path: ['limits'], key: '__proto__' }])
  })

  it('checks only the value handed to the schema', () => {
    const cfg = parse('limits { "__proto__" = 5, "constructor" { ok = 1 } }')
    expect(getValidated(cfg, 'limits."__proto__"', z.number())).toBe(5)
    expect(getValidated(cfg, 'limits."constructor"', z.object({ ok: z.number() }))).toEqual({ ok: 1 })
  })

  it('applies to parseWithSchema and parseFileWithSchema', () => {
    const schema = z.record(z.string(), z.number())
    expect(refused(() => parseWithSchema('"__proto__" = 1', schema))).toEqual([{ path: [], key: '__proto__' }])
    const file = join(dir, 'app.conf')
    writeFileSync(file, '"prototype" = 1\n')
    expect(refused(() => parseFileWithSchema(file, schema))).toEqual([{ path: [], key: 'prototype' }])
  })

  it('reports an unresolved value first, as NotResolvedError (#210)', () => {
    const cfg = parse('a { "constructor" = ${missing}, ok = 1 }', { resolveSubstitutions: false })
    expect(() => validate(cfg, z.object({ a: z.object({ ok: z.number() }) }))).toThrow(NotResolvedError)
  })

  it('leaves keys that only resemble them alone', () => {
    const cfg = parse('"__proto__x" = 1, Constructor = 2, prototypes = 3, "proto" = 4, "__proto" = 5')
    expect(validate(cfg, z.record(z.string(), z.number()))).toEqual({
      __proto__x: 1, Constructor: 2, prototypes: 3, proto: 4, __proto: 5,
    })
  })

  it('accepts them as values, not keys', () => {
    const cfg = parse('names = [ "__proto__", "constructor" ], kind = prototype')
    expect(validate(cfg, z.object({ names: z.array(z.string()), kind: z.string() }))).toEqual({
      names: ['__proto__', 'constructor'], kind: 'prototype',
    })
  })

  it('leaves the plain getters reading such a key by name', () => {
    const cfg = parse('limits { "__proto__" = 5, "constructor" = 6 }')
    expect(cfg.getNumber('limits."__proto__"')).toBe(5)
    expect(cfg.getNumber('limits."constructor"')).toBe(6)
  })

  it('gives an error every Zod formatter can render, without the refused value', () => {
    const cfg = parse('"constructor" = 1\ndb { "__proto__" { password = "s3cret" } }')
    const err = zodErrorOf(() => validate(cfg, z.any()))
    for (const render of [
      () => z.prettifyError(err),
      () => JSON.stringify(z.treeifyError(err)),
      () => JSON.stringify(err.format()),
      () => JSON.stringify(z.flattenError(err)),
      () => err.message,
    ]) {
      expect(render()).not.toContain('s3cret')
    }
    expect(z.prettifyError(err)).toContain('key "__proto__" names an object\'s prototype\n  → at db')
    expect(err.issues.every((issue) => !('input' in issue))).toBe(true)
    expect(Object.prototype).not.toHaveProperty('properties')
  })
})

// #227 — the refusal does not stop the schema: it validates the value without
// the refused keys, and its issues come in the same ZodError, after the
// refusals, so one run lists everything wrong.
describe('prototype-named keys with the schema\'s other issues', () => {
  it('reports the schema\'s issues together with the refusal', () => {
    const cfg = parse('limits { "__proto__" = 5, ok = 1 }\nport = abc\ndebug = maybe')
    const schema = z.object({
      limits: z.record(z.string(), z.number()),
      port: z.number(),
      debug: z.boolean(),
    })
    const issues = zodErrorOf(() => validate(cfg, schema)).issues
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['custom', ['limits']],
      ['invalid_type', ['port']],
      ['invalid_type', ['debug']],
    ])
  })

  it('reports issues below the object that held the refused key', () => {
    const cfg = parse('limits { "constructor" = 5, api = slow }')
    const issues = zodErrorOf(() => getValidated(cfg, 'limits', z.record(z.string(), z.number()))).issues
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['custom', []],
      ['invalid_type', ['api']],
    ])
  })

  it('still coerces the rest of the value for the schema', () => {
    const cfg = parse('a { "prototype" = 1 }\nport = "8080"\nname = 5')
    const schema = z.object({ a: z.object({}), port: z.number(), name: z.string() })
    const issues = zodErrorOf(() => validate(cfg, schema)).issues
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['custom', ['a']],
      ['invalid_type', ['name']],
    ])
  })

  it('leaves out the schema\'s issue at the refused key, so every formatter renders', () => {
    // The schema wants a field the value no longer holds; that issue is the
    // refusal again, and a `constructor` path segment breaks Zod's formatters.
    const cfg = parse('"constructor" = 1\nport = abc')
    const schema = z.object({ constructor: z.number(), port: z.number() })
    const err = zodErrorOf(() => validate(cfg, schema))
    expect(err.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['custom', []],
      ['invalid_type', ['port']],
    ])
    expect(() => z.treeifyError(err)).not.toThrow()
    expect(() => err.format()).not.toThrow()
    expect(() => z.flattenError(err)).not.toThrow()
  })

  it('leaves such issues out inside a union\'s per-option issues too', () => {
    const cfg = parse('"constructor" = 1\ns { x {} }')
    const schema = z.object({
      s: z.union([z.string(), z.object({ constructor: z.number(), x: z.object({ ['__proto__']: z.number() }) })]),
    })
    const err = zodErrorOf(() => validate(cfg, schema))
    expect(err.issues[0]).toMatchObject({ code: 'custom', path: [] })
    expect(err.issues[1]).toMatchObject({ code: 'invalid_union', path: ['s'] })
    const optionPaths = (err.issues[1] as z.core.$ZodIssueInvalidUnion).errors.flat().map((issue) => issue.path)
    expect(optionPaths.flat()).not.toContain('constructor')
    expect(optionPaths.flat()).not.toContain('__proto__')
    expect(() => z.treeifyError(err)).not.toThrow()
    expect(() => err.format()).not.toThrow()
    expect(Object.prototype).not.toHaveProperty('properties')
  })

  it('leaves out an issue at such a key elsewhere in the value as well', () => {
    // No value can satisfy it through these entry points, which refuse the key.
    const cfg = parse('a { "constructor" = 1 }\nb {}')
    const schema = z.object({ a: z.object({}), b: z.object({ constructor: z.number() }) })
    expect(zodErrorOf(() => validate(cfg, schema)).issues.map((issue) => issue.path)).toEqual([['a']])
  })

  it('still reports the refusal when the schema cannot run synchronously', () => {
    const cfg = parse('"__proto__" = 1\nok = 2')
    const schema = z.record(z.string(), z.number()).refine(async () => true)
    expect(refused(() => validate(cfg, schema))).toEqual([{ path: [], key: '__proto__' }])
  })

  it('lets an error the schema throws reach the caller', () => {
    const cfg = parse('a { "constructor" = 1 }\nn = 5')
    const schema = z
      .object({ a: z.looseObject({}), n: z.number() })
      .refine((v) => (v as unknown as { missing: { deep: boolean } }).missing.deep)
    expect(() => validate(cfg, schema)).toThrow(TypeError)
  })

  it('does not hand the schema the refused key or its value', () => {
    const seen: unknown[] = []
    const cfg = parse('db { "__proto__" { password = "s3cret" }, host = h }')
    const schema = z.object({ db: z.looseObject({}).refine((v) => { seen.push(v); return true }) })
    zodErrorOf(() => validate(cfg, schema))
    expect(seen).toEqual([{ host: 'h' }])
  })
})

const dir = mkdtempSync(join(tmpdir(), 'ts-hocon-proto-keys-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
