// tests/s13a13-self-ref-lookback.test.ts
//
// S13a.13 — Optional self-ref in value concatenation look-back.
// Fixture-driven conformance against xx.hocon/testdata/hocon/self-ref-lookback/.
//
// Core fix: a = ${?a}foo → "foo" (no prior a) — spec L841.
// Positive regressions: with-prior cases continue to work.
// Boundary: required self-ref with no prior → ResolveError.
// Array variant: a = ${?a} [2] → [2] (no prior).
// Nested path: foo.a = ${?foo.a}bar → foo.a = "bar".
// Mutual-ref regression: sr11 (non-self-ref forward-ref) unaffected.
//
// Fixture path: tests/lightbend/testdata/hocon/self-ref-lookback/
// Expected JSON: tests/lightbend/testdata/expected/self-ref-lookback/
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ResolveError } from '../src/errors.js'

const confDir = fileURLToPath(
  new URL('./lightbend/testdata/hocon/self-ref-lookback', import.meta.url),
)
const expectedDir = fileURLToPath(
  new URL('./lightbend/testdata/expected/self-ref-lookback', import.meta.url),
)

// Success fixtures: parse, resolve, compare to xx.hocon expected JSON.
const SUCCESS_FIXTURES = [
  'sr01-optional-no-prior',       // core fix: a = ${?a}foo → "foo"
  'sr02-optional-no-prior-leading', // a = bar${?a} → "bar"
  'sr03-optional-no-prior-both-sides', // a = bar${?a}foo → "barfoo"
  'sr04-optional-with-prior',     // regression: a = "x"; a = ${?a}foo → "xfoo"
  'sr06-required-with-prior',     // regression: a = "x"; a = ${a}foo → "xfoo"
  'sr07-array-optional-no-prior', // array variant: a = ${?a} [2] → [2]
  'sr08-array-optional-with-prior', // regression: a = [1]; a = ${?a} [2] → [1, 2]
  'sr09-nested-no-prior',         // nested: foo.a = ${?foo.a}bar → foo.a = "bar"
  'sr10-nested-with-prior',       // regression: nested with prior
  'sr11-mutual-ref-forward',      // regression: mutual forward-ref (not self-ref)
]

// Error fixtures: parse/resolve must throw ResolveError.
const ERROR_FIXTURES = [
  'sr05-required-no-prior',       // a = ${a}foo (required, no prior) → error
]

describe('S13a.13 — self-ref look-back conformance (sr01-sr11)', () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name}: parses and resolves to expected JSON`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'),
      )
      const config = parse(content)
      expect(config.toObject()).toEqual(expected)
    })
  }

  for (const name of ERROR_FIXTURES) {
    it(`${name}: parse/resolve throws ResolveError`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(content)).toThrow(ResolveError)
    })
  }
})
