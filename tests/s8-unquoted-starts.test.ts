// tests/s8-unquoted-starts.test.ts
//
// S8.6 — Unquoted strings MUST NOT begin with `-` (unless followed by a digit
// forming a number) or any digit `0-9` (per HOCON.md L270-276).
// Issue #73: https://github.com/o3co/ts.hocon/issues/73
//
// Fixture-driven conformance tests against xx.hocon ground truth at
// tests/lightbend/testdata/unquoted-starts/ and corresponding
// tests/lightbend/testdata/expected/unquoted-starts/.
//
// ts.hocon implements S8.6 via a lex-time check in isUnquotedStart rather
// than via a separate number token kind (which the lexer does not have).
// See docs/spec-compliance.md §S8.6 for the architectural rationale and the
// Lightbend-quirk gaps (us13, us15) that remain out of scope for this PR.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/unquoted-starts', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/unquoted-starts', import.meta.url))

// Success fixtures: parse, resolve, and compare to xx.hocon expected JSON.
const SUCCESS_FIXTURES = [
  'us01-digit-prefix-with-tail',
  'us04-hyphen-with-digit',
  'us05-number-then-comment',
  'us06-embedded-digits',
  'us07-embedded-hyphen',
  'us08-numeric-key-positive',
  'us09-dotted-number-key',
  'us10-greedy-backtrack-exp',
  'us11-greedy-backtrack-frac',
  'us12-hex-prefix',
  'us14-multi-dot-version',
  'us16-negative-with-tail',
]

// Error fixtures: parse must throw (lex or parse error).
// us02, us03: `-` not followed by a digit → lex error (the rule this PR enforces).
// us13: `01` leading zero. Strict HOCON forbids unquoted strings starting
//   with a digit; this case is a Lightbend silent-accept quirk (xx.hocon
//   omits expected ground truth — see E8 in xx.hocon docs/extra-spec-conventions.md).
//   For ts.hocon's unquoted-only token model the natural enforcement is at
//   the same lex layer. See spec-compliance.md for scope notes.
// us15: `1e+x` carries an `.error` sidecar from Lightbend (Reserved character
//   `+` outside quotes). Lightbend's error is at the value-parser layer; our
//   lexer currently accepts `+` mid-unquoted, so this fixture's error
//   assertion is documented as a known gap (not enforced by this PR).
const ERROR_FIXTURES = [
  'us02-hyphen-no-digit',
  'us03-hyphen-alone',
]

// us13, us15 — known gaps, parked here for future tightening.
const KNOWN_GAP_FIXTURES = [
  'us13-leading-zero',
  'us15-incomplete-exp',
]

describe('S8.6 — unquoted-starts conformance', () => {
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
    it(`${name}: parse throws (lex or parse error)`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(content)).toThrow()
    })
  }

  for (const name of KNOWN_GAP_FIXTURES) {
    // it.fails — currently this assertion FAILS (parse does not throw), and
    // that failure is the expected state. When the gap closes (i.e. parse
    // begins throwing as the strict spec requires), this `.fails` will
    // *itself* fail, surfacing the change in CI without any source edit.
    // Tracking: ts.hocon#73 (architectural change: introduce `number` token).
    it.fails(`${name}: known gap (ts.hocon#73) — strict enforcement deferred`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(content)).toThrow()
    })
  }

  // S8.6 also applies inside substitution paths: an unquoted segment beginning
  // with '-' (not followed by a digit) is a lex error. See parseSubstBody.
  it('S8.6 in substitution path: ${-foo} is rejected (path element rule)', () => {
    expect(() => parse('x = ${-foo}')).toThrow()
  })
})
