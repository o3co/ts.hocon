/**
 * xx.hocon#68 — two spec-compliance gaps found by probing all four sibling
 * implementations against Lightbend typesafe-config 1.4.3.
 *
 * S11.7 (HOCON.md L515-519): "If a path element is an empty string, it must
 * always be quoted. That is, `a."".b` is a valid path with three elements, and
 * the middle element is an empty string. But `a..b` is invalid and should
 * generate an error. Following the same rule, a path that starts or ends with
 * a `.` is invalid and should generate an error."
 * ts.hocon already rejected the trailing-dot form and every substitution-path
 * form; only the KEY-position parser silently collapsed the empty segments.
 *
 * S8.1 (HOCON.md L245-247): the forbidden set for unquoted strings is
 * `$ " { } [ ] : = , + # ` ^ ? ! @ * & \`. Backtick was the only member of
 * that set the ts.hocon lexer let through. Backtick inside a QUOTED string
 * stays ordinary content.
 *
 * Fixtures (xx.hocon, fetched by `make testdata`):
 *   tests/lightbend/testdata/hocon/path-empty-segment/pe01-pe08
 *   tests/lightbend/testdata/hocon/unquoted-forbidden/uf01-uf04
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'

const peDir = fileURLToPath(new URL('./lightbend/testdata/hocon/path-empty-segment', import.meta.url))
const ufDir = fileURLToPath(new URL('./lightbend/testdata/hocon/unquoted-forbidden', import.meta.url))
const peExpectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/path-empty-segment', import.meta.url))
const ufExpectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/unquoted-forbidden', import.meta.url))

const readConf = (dir: string, name: string) => readFileSync(join(dir, `${name}.conf`), 'utf-8')
const readExpected = (dir: string, name: string) =>
  JSON.parse(readFileSync(join(dir, `${name}-expected.json`), 'utf-8'))

describe('S11.7 — empty path segments in key position (xx.hocon#68)', () => {
  it('a..b: adjacent dots are an error, not a collapsed two-element path', () => {
    // Was parsing to {"a":{"b":3}} — the empty middle element was dropped.
    expect(() => parse('a..b: 3')).toThrow(/empty key segment/)
  })

  it('.a: a leading dot is an error, not a one-element path', () => {
    // Was parsing to {"a":3}.
    expect(() => parse('.a: 3')).toThrow(/empty key segment/)
  })

  it('a...c: three dots are an error', () => {
    // Was parsing to {"a":{"c":4}}.
    expect(() => parse('a...c: 4')).toThrow(/empty key segment/)
  })

  it('a..b nested inside an object is an error too', () => {
    expect(() => parse('o { a..b: 3 }')).toThrow(/empty key segment/)
  })

  it('a...c."": a quoted empty tail does not excuse the unquoted empties', () => {
    // Was parsing to {"a":{"c":{"":4}}}.
    expect(() => parse('a...c."": 4')).toThrow(/empty key segment/)
  })

  it('"a"..b: an empty segment after a quoted segment is an error', () => {
    expect(() => parse('"a"..b: 3')).toThrow(/empty key segment/)
  })

  it('a."".b: a QUOTED empty segment is still legal (S11.6)', () => {
    expect(parse('a."".b: 3').toObject()).toEqual({ a: { '': { b: 3 } } })
  })

  it('a.: a trailing dot still errors (regression guard — already correct)', () => {
    expect(() => parse('a.: 3')).toThrow(/trailing period/)
  })

  it('substitution paths still reject empty segments (regression guard)', () => {
    expect(() => parse('x = 1\ny = ${?a..b}')).toThrow(/empty segment in path/)
    expect(() => parse('x = 1\ny = ${?.a}')).toThrow(/empty segment in path/)
    expect(() => parse('x = 1\ny = ${?a.}')).toThrow(/empty segment in path/)
  })

  it('E13 path-expression whitespace around dots still parses (regression guard)', () => {
    // A dot next to whitespace is a separator, not an empty segment — the
    // whitespace itself becomes segment text. See tests/path-expr-whitespace.
    expect(parse('a .b = 1').toObject()).toEqual({ 'a ': { b: 1 } })
    expect(parse('a . b = 1').toObject()).toEqual({ 'a ': { ' b': 1 } })
    expect(parse('a. .b = 1').toObject()).toEqual({ a: { ' ': { b: 1 } } })
  })
})

describe('S8.1 — backtick is forbidden in unquoted strings (xx.hocon#68)', () => {
  it('backtick in value position is an error', () => {
    // Was parsing to {"a":"`t`"}.
    expect(() => parse('a = `t`')).toThrow()
  })

  it('backtick in key position is an error', () => {
    // Was parsing to {"`k`":1}.
    expect(() => parse('`k` = 1')).toThrow()
  })

  it('backtick mid-token is an error', () => {
    // Was parsing to {"a":"x`y"}.
    expect(() => parse('a = x`y')).toThrow()
  })

  it('backtick inside a quoted string is ordinary content', () => {
    expect(parse('a = "x`y"').toObject()).toEqual({ a: 'x`y' })
    expect(parse('"`k`" = 1').toObject()).toEqual({ '`k`': 1 })
  })

  it('parentheses are still NOT forbidden (xx.hocon#34 regression guard)', () => {
    expect(parse('a = (internal)').toObject()).toEqual({ a: '(internal)' })
  })
})

describe('xx.hocon#68 fixture conformance (pe01-pe08, uf01-uf04)', () => {
  // Auto-discovered from the fetched corpus rather than hardcoded, so a new
  // pe*/uf* fixture in xx.hocon starts running here as soon as `make testdata`
  // pulls it. A fixture is an error case iff it has a `.error` sidecar.
  const ERROR_FIXTURES: ReadonlyArray<readonly [string, string]> = (
    [[peDir, peExpectedDir], [ufDir, ufExpectedDir]] as const
  ).flatMap(([dir, expectedDir]) =>
    readdirSync(dir)
      .filter(f => f.endsWith('.conf'))
      .map(f => f.slice(0, -'.conf'.length))
      .filter(name => existsSync(join(expectedDir, `${name}.error`)))
      .sort()
      .map(name => [dir, name] as const),
  )

  it('discovered the expected number of error fixtures', () => {
    expect(ERROR_FIXTURES.length).toBe(10)
  })

  for (const [dir, name] of ERROR_FIXTURES) {
    it(`${name}: rejected (.error sidecar)`, () => {
      expect(() => parse(readConf(dir, name))).toThrow()
    })
  }

  const SUCCESS_FIXTURES: ReadonlyArray<readonly [string, string, string]> = [
    [peDir, peExpectedDir, 'pe07-quoted-empty-segment-ok'],
    [ufDir, ufExpectedDir, 'uf04-backtick-quoted-ok'],
  ]

  for (const [dir, expectedDir, name] of SUCCESS_FIXTURES) {
    it(`${name}: parses to expected JSON`, () => {
      expect(parse(readConf(dir, name)).toObject()).toEqual(readExpected(expectedDir, name))
    })
  }
})
