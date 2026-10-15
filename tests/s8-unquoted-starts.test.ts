// tests/s8-unquoted-starts.test.ts
//
// S8.6 — Unquoted strings at value-position MAY begin with `-` (treated as
// unquoted text when not followed by a digit) or with digits (greedy Java
// numeric semantics, fall back to unquoted on parse failure). Concat-
// continuation positions (after ${...}, "...", a prior unquoted run, etc.)
// accept any unquoted-permissible character except `+` as a continuation of
// the existing unquoted run.
//
// This reading was established by the E8 amendment in
// xx.hocon/docs/extra-spec-conventions.md (rewritten 2026-05-20 as
// xx.hocon#32 / commit dd102e8, driven by external issue xx.hocon#31). It
// adopts Lightbend's pragmatic reading of HOCON.md L270-276 — "begin" =
// value-position begin (first component of a concatenation), not
// token-position begin at any lexer offset.
//
// Subst-body path expressions (${-foo}) and key-path segments (a.-foo = 1)
// keep their existing strict checks — those rules are about path-element
// composition, not value-position unquoted strings, and remain out of E8
// scope.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/unquoted-starts', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/unquoted-starts', import.meta.url))

// Success fixtures: parse, resolve, and compare to xx.hocon expected JSON.
// us02/us03/us13 joined this list as part of the E8 amendment (previously in
// ERROR_FIXTURES / KNOWN_GAP_FIXTURES under the strict reading).
// us17-us30 are new concat-continuation fixtures from probe groups A/B/D/E.
const SUCCESS_FIXTURES = [
  'us01-digit-prefix-with-tail',
  'us02-hyphen-no-digit',
  'us03-hyphen-alone',
  'us04-hyphen-with-digit',
  'us05-number-then-comment',
  'us06-embedded-digits',
  'us07-embedded-hyphen',
  'us08-numeric-key-positive',
  'us09-dotted-number-key',
  'us10-greedy-backtrack-exp',
  'us11-greedy-backtrack-frac',
  'us12-hex-prefix',
  'us13-leading-zero',
  'us14-multi-dot-version',
  'us16-negative-with-tail',
  'us17-concat-subst-dash-text',
  'us18-concat-subst-dash-only',
  'us19-concat-subst-double-dash',
  'us20-concat-subst-dash-digit',
  'us21-concat-subst-digit-text',
  'us22-concat-subst-dot-text',
  'us23-concat-subst-underscore',
  'us24-concat-quoted-dash-text',
  'us25-concat-quoted-dot-text',
  'us26-concat-quoted-digit-text',
  'us27-concat-subst-dash-subst',
  'us28-concat-subst-dash-subst-other',
  'us29-concat-unquoted-dash-subst',
  'us30-concat-quoted-dash-subst',
]

// Error fixtures: us15 (`a = 1e+x`) carries an `.error` sidecar from Lightbend
// (Reserved character `+` outside quotes). E8 step 4: a number-lex run that
// contains `+` and does not parse as a number is a reserved-character error,
// with no fallback to an unquoted string.
const ERROR_FIXTURES = [
  'us15-incomplete-exp',
]

describe('S8.6 — unquoted-starts conformance (post-E8 amendment)', () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name}: parses and resolves to expected JSON`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expectedContent = readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8')
      const expected = JSON.parse(expectedContent)
      const config = parse(content)
      expect(config.toObject()).toEqual(expected)
    })
  }

  for (const name of ERROR_FIXTURES) {
    it(`${name}: rejected — '+' is reserved (E8 step 4)`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(content)).toThrow(ParseError)
      expect(() => parse(content)).toThrow(/reserved character '\+'/)
    })
  }

  // E8 step 4 beyond the fixture: the value-start number-lex run is the
  // maximal [0-9.eE+-] run from a digit (or `-` + digit); a `+` in a run that
  // is not a number is an error wherever an unquoted token starts that way.
  it.each([
    'a = 1e+x',
    'a = 1+2',
    'a = 1.2.3+build',
    'a = -1+x',
    'a = 1e+',
    'a = 1+',
    'a = [1, 2e+x]',
    'b = 1, a = ${b}1e+x',
    '1e+x = 1',
  ])('rejects %j', (text) => {
    expect(() => parse(text)).toThrow(/reserved character '\+'/)
  })

  it.each([
    ['a = 1e+5', 100000],
    ['a = 1.5e+2', 150],
    ['a = -2e+1', -20],
  ])('reads %j as a number', (text, value) => {
    expect(parse(text).getNumber('a')).toBe(value)
  })

  it('keeps a valid exponent run and the text after it as one value', () => {
    expect(parse('a = 1e+5x').getString('a')).toBe('1e+5x')
  })

  it('accepts the same text quoted', () => {
    expect(parse('a = "1e+x"').getString('a')).toBe('1e+x')
    expect(parse('a = "1+2"').getString('a')).toBe('1+2')
  })

  // --- Out-of-E8-scope strict checks (unchanged) ---------------------------
  //
  // The following rules apply to path-element composition (substitution body
  // paths and dotted key segments), not to value-position unquoted strings.
  // E8 amendment did not touch these — the strict rule is preserved.

  // Substitution-body path-element rule: an unquoted segment beginning with
  // '-' (not followed by a digit) inside ${...} is still a lex error.
  it('S8.6 in substitution path: ${-foo} is rejected (path element rule)', () => {
    expect(() => parse('x = ${-foo}')).toThrow(ParseError)
  })

  // E13 amendment (xx.hocon#42): S8.6 is NOT enforced on key path segments.
  // The rule is value-position lexer-disambiguation; key paths are governed by
  // path-element parsing rules. Lightbend accepts `a.-foo = 1` verbatim per the
  // kh07 fixture (xx.hocon path-expr-whitespace/key-hyphen-position/).
  it('E13: S8.6 in key path: a.-foo = 1 is accepted (was rejected pre-E13)', () => {
    expect(parse('a.-foo = 1').toObject()).toEqual({ a: { '-foo': 1 } })
  })

  // Regression guard: parseSubstBody S8.6 check must fire only at segment
  // start (gated on !curStarted). Quoted+unquoted concat within a segment —
  // e.g. ${"a"-foo} building key "a-foo" — must remain accepted.
  it('S8.6 in substitution: ${"a"-foo} (quoted+unquoted concat) is accepted', () => {
    const input = '"a-foo" = 1\nx = ${"a"-foo}'
    expect(() => parse(input)).not.toThrow()
  })

  // --- E8 amendment explicit value-position tests --------------------------

  it('E8: a = -foo lexes as unquoted "-foo" (was lex error)', () => {
    expect(parse('a = -foo').toObject()).toEqual({ a: '-foo' })
  })

  it('E8: a = - lexes as unquoted "-" (was lex error)', () => {
    expect(parse('a = -').toObject()).toEqual({ a: '-' })
  })

  it('E8 BREAKING (F3): a = 01 resolves to number 1 (was string "01" or unquoted)', () => {
    expect(parse('a = 01').toObject()).toEqual({ a: 1 })
  })

  it('E8: a = +foo still rejected (HOCON += operator reservation)', () => {
    expect(() => parse('a = +foo')).toThrow()
  })

  // --- E8 concat-continuation explicit tests -------------------------------
  // HOCON's `${X}` substitution syntax overlaps with JS template literal
  // placeholders, so single-quote string literals below trigger eslint's
  // no-template-curly-in-string rule. Silenced for this block — these
  // strings are HOCON source, not JS templates.
  /* eslint-disable no-template-curly-in-string */

  it('E8 concat-continuation: b = ${a}-bar resolves to "foo-bar"', () => {
    expect(parse('a = foo\nb = ${a}-bar').toObject()).toEqual({ a: 'foo', b: 'foo-bar' })
  })

  it('E8 concat-continuation: b = "foo"-bar resolves to "foo-bar"', () => {
    expect(parse('b = "foo"-bar').toObject()).toEqual({ b: 'foo-bar' })
  })

  it('E8 concat-continuation: b = ${a}1bar resolves to "foo1bar"', () => {
    expect(parse('a = foo\nb = ${a}1bar').toObject()).toEqual({ a: 'foo', b: 'foo1bar' })
  })

  it('E8 concat-continuation: b = ${a}.bar resolves to "foo.bar"', () => {
    expect(parse('a = foo\nb = ${a}.bar').toObject()).toEqual({ a: 'foo', b: 'foo.bar' })
  })

  it('E8 concat-continuation: b = ${a}+bar still rejected (+ reservation in concat too)', () => {
    expect(() => parse('a = foo\nb = ${a}+bar')).toThrow()
  })

  /* eslint-enable no-template-curly-in-string */
})
