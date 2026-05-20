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

// Known gap: us15 (`a = 1e+x`) carries an `.error` sidecar from Lightbend
// (Reserved character `+` outside quotes). Lightbend's error fires at its
// value-parser layer; the `+` reservation is enforced in both value-start
// and concat-continuation positions per E8.
const KNOWN_GAP_FIXTURES = [
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

  for (const name of KNOWN_GAP_FIXTURES) {
    // it.fails — currently this assertion FAILS (parse does not throw), and
    // that failure is the expected state. When the gap closes (i.e. parse
    // begins throwing as Lightbend does on the `+` reservation), this
    // `.fails` will itself fail, surfacing the change in CI without source
    // edit. Tracking: ts.hocon#73 (the `+` reservation gap for `1e+x`).
    it.fails(`${name}: known gap (ts.hocon#73) — '+' reservation enforcement deferred`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(content)).toThrow()
    })
  }

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

  // Dotted key path segment rule: lexer sees `a.-foo` as a single unquoted
  // token; parseKey splits on `.` and validates each segment.
  it('S8.6 in key path: a.-foo = 1 is rejected (segment-level rule)', () => {
    expect(() => parse('a.-foo = 1')).toThrow(ParseError)
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
