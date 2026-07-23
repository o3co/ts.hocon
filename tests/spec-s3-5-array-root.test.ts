// tests/spec-s3-5-array-root.test.ts
//
// S3.5 — An array-root document (`[1,2]`) is syntactically valid HOCON
// (HOCON.md L989-991: "both JSON and HOCON allow arrays as root values in a
// document"), but the object-rooted Config API rejects it with a TYPE error
// at the Config boundary, produced after a successful syntax parse.
// Reference: Lightbend parses the document, then Parseable.forceParsedToObject
// throws ConfigException.WrongType "has type LIST rather than object at file
// root". The former behavior — ParseError "expected key, got lbracket" from
// the parser — was the right net outcome (reject) as the wrong kind of error
// at the wrong layer.
//
// S14b.1 (HOCON.md L993-994): an INCLUDED file with an array root is invalid;
// the error names the included file (Lightbend applies the same WrongType via
// the include loader).
//
// Fixtures: xx.hocon array-root/ar01-ar03 with .error sidecars (see
// tests/conformance/array-root.test.ts for the fixture loop).

import { describe, expect, it } from 'vitest'
import { ConfigError, ParseError, ResolveError, parse, parseAsync } from '../src/index.js'

describe('S3.5 — array-root document rejected with a type error (HOCON.md L989-991)', () => {
  // --- Top-level: type error (ConfigError), not a syntax error ---

  it('parse("[1,2]") throws ConfigError naming array-at-file-root', () => {
    expect(() => parse('[1,2]')).toThrow(ConfigError)
    expect(() => parse('[1,2]')).toThrow(/array rather than object at file root/i)
  })

  it('type error carries the origin and the opening bracket position', () => {
    expect(() => parse('[1,2]')).toThrow(/input: 1:1/)
    expect(() => parse('\n  [1,2]', { originDescription: 'my-source' })).toThrow(/my-source: 2:3/)
  })

  it('deferred parse (resolveSubstitutions: false) also rejects with ConfigError', () => {
    expect(() => parse('[1,2]', { resolveSubstitutions: false })).toThrow(ConfigError)
  })

  it('parse("[1,2]") does NOT throw ParseError (document is valid syntax)', () => {
    let caught: unknown
    try {
      parse('[1,2]')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    expect(caught).not.toBeInstanceOf(ParseError)
  })

  it('multiline array of objects also rejects with ConfigError', () => {
    const src = '[\n  { a : 1 },\n  { b : 2 }\n]\n'
    expect(() => parse(src)).toThrow(ConfigError)
    expect(() => parse(src)).toThrow(/array rather than object at file root/i)
  })

  it('empty array root also rejects with ConfigError', () => {
    expect(() => parse('[]')).toThrow(ConfigError)
  })

  it('async parse of array root rejects with ConfigError', async () => {
    await expect(parseAsync('[1,2]')).rejects.toThrow(ConfigError)
  })

  // --- Malformed arrays remain syntax errors ---

  it('unterminated array root stays a ParseError (syntax)', () => {
    expect(() => parse('[1,2')).toThrow(ParseError)
  })

  it('trailing content after root array stays a ParseError (syntax)', () => {
    expect(() => parse('[1,2]\na = 1')).toThrow(ParseError)
  })

  // --- S14b.1: included file with array root (L993-994) ---

  const fileReader = (files: Record<string, string>) => (p: string) => {
    const v = files[p.split('/').pop()!]
    if (v === undefined) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return v
  }

  it('include of array-root file throws ResolveError naming the included file', () => {
    const files = { 'arr.conf': '[1,2]' }
    const run = () => parse('include "arr.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(run).toThrow(ResolveError)
    expect(run).toThrow(/array at file root/i)
    expect(run).toThrow(/arr\.conf/)
  })

  it('include of array-root file (async) throws ResolveError — loadSingleAsync guard', async () => {
    const files: Record<string, string> = { 'arr.conf': '[1,2]' }
    const run = parseAsync('include "arr.conf"\na = 1', {
      readFile: async (p: string) => {
        const v = files[p.split('/').pop()!]
        if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return v
      },
    })
    await expect(run).rejects.toThrow(ResolveError)
    await expect(run).rejects.toThrow(/array at file root/i)
  })

  it('include package of array-root content (async) throws ResolveError — loadPackageAsync guard', async () => {
    const run = parseAsync('include package("my-lib", "ref.conf")\na = 1', {
      packageResolver: () => '/fake/pkg/ref.conf',
      readFile: async (p: string) => {
        if (p === '/fake/pkg/ref.conf') return '[1,2]'
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
    await expect(run).rejects.toThrow(ResolveError)
    await expect(run).rejects.toThrow(/array at file root/i)
  })

  it('include package of array-root content throws ResolveError naming the resolved path', () => {
    const run = () =>
      parse('include package("my-lib", "ref.conf")\na = 1', {
        packageResolver: () => '/fake/pkg/ref.conf',
        readFileSync: (p: string) => {
          if (p === '/fake/pkg/ref.conf') return '[1,2]'
          throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        },
      })
    expect(run).toThrow(ResolveError)
    expect(run).toThrow(/array at file root/i)
  })

  // --- Non-root arrays are unaffected (regression guards) ---

  it('array as a field value still parses', () => {
    expect(parse('a = [1,2]').get('a')).toEqual([1, 2])
  })

  it('braced root with array field still parses', () => {
    expect(parse('{ a = [1,2] }').get('a')).toEqual([1, 2])
  })
})
