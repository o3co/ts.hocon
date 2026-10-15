// tests/zod-prototype-keys.test.ts
// ts.hocon#201 — the Zod entry points refuse a key that names an object's
// prototype (`__proto__`, `constructor`, `prototype`) wherever it appears in
// the value handed to the schema, with the key's path. Zod drops `__proto__`
// from a record without an error; the other two are refused alike so that the
// rule does not depend on what a schema position happens to do with them.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { getValidated, parseFileWithSchema, parseWithSchema, validate } from '../src/zod.js'

const MESSAGE = "a key that names an object's prototype"

/** The issues of the ZodError `run` throws. */
function issuesOf(run: () => unknown): z.core.$ZodIssue[] {
  try {
    run()
  } catch (err) {
    expect(err).toBeInstanceOf(z.ZodError)
    return (err as z.ZodError).issues
  }
  throw new Error('expected a ZodError')
}

/** Just the path and message of each issue. */
function pathsOf(run: () => unknown): { path: PropertyKey[]; message: string }[] {
  return issuesOf(run).map(({ path, message }) => ({ path, message }))
}

describe('prototype-named keys', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    it(`refuses "${key}" in a record, with the key's path`, () => {
      const cfg = parse(`limits { "${key}" = 5, ok = 1 }`)
      const schema = z.object({ limits: z.record(z.string(), z.number()) })
      expect(pathsOf(() => validate(cfg, schema))).toEqual([{ path: ['limits', key], message: MESSAGE }])
    })
  }

  it('refuses the key in the issue example instead of dropping it', () => {
    const cfg = parse('limits { "__proto__" = 5, ok = 1 }')
    const issues = issuesOf(() => getValidated(cfg, 'limits', z.record(z.string(), z.number())))
    expect(issues).toEqual([{ code: 'custom', path: ['__proto__'], message: MESSAGE, input: 5 }])
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
      expect(pathsOf(() => validate(cfg, schema))).toEqual([{ path: ['a', 'constructor'], message: MESSAGE }])
    }
  })

  it('finds it in array elements and nested objects', () => {
    const cfg = parse('servers = [ { name = a }, { name = b, "prototype" { x = 1 } } ]\ndeep.er { "__proto__" = 1 }')
    expect(pathsOf(() => validate(cfg, z.any()))).toEqual([
      { path: ['servers', 1, 'prototype'], message: MESSAGE },
      { path: ['deep', 'er', '__proto__'], message: MESSAGE },
    ])
  })

  it('reports every such key, and does not look inside a refused one', () => {
    const cfg = parse('"__proto__" { "constructor" = 1 }\nb { "prototype" = 2, "constructor" = 3 }')
    expect(pathsOf(() => validate(cfg, z.any()))).toEqual([
      { path: ['__proto__'], message: MESSAGE },
      { path: ['b', 'prototype'], message: MESSAGE },
      { path: ['b', 'constructor'], message: MESSAGE },
    ])
  })

  it('gives paths relative to the value getValidated hands the schema', () => {
    const cfg = parse('app.limits { "__proto__" = 5 }')
    expect(pathsOf(() => getValidated(cfg, 'app', z.any()))).toEqual([
      { path: ['limits', '__proto__'], message: MESSAGE },
    ])
  })

  it('applies to parseWithSchema and parseFileWithSchema', () => {
    const schema = z.record(z.string(), z.number())
    expect(pathsOf(() => parseWithSchema('"__proto__" = 1', schema))).toEqual([
      { path: ['__proto__'], message: MESSAGE },
    ])
    const file = join(dir, 'app.conf')
    writeFileSync(file, '"prototype" = 1\n')
    expect(pathsOf(() => parseFileWithSchema(file, schema))).toEqual([
      { path: ['prototype'], message: MESSAGE },
    ])
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
})

const dir = mkdtempSync(join(tmpdir(), 'ts-hocon-proto-keys-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
