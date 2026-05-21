// tests/unquoted-parens.test.ts
//
// Paren-in-unquoted-string conformance (xx.hocon#34/#35) — up01-up06 fixtures.
// Fixture inputs:  tests/lightbend/testdata/hocon/unquoted-parens/*.conf
// Expected outputs: tests/lightbend/testdata/expected/unquoted-parens/
//
// HOCON.md L274 lists the forbidden set for unquoted strings.  Parentheses
// `(` and `)` are NOT in that set, so they must be accepted verbatim in
// unquoted value position.  All 6 fixtures are success fixtures — they have
// only `-expected.json` sidecars, no `.error` sidecars.
//
// ts.hocon is already spec-compliant for this rule (verified against 8 edge
// cases prior to this wire-up).  This file exists solely to lock in
// regression coverage against the Lightbend typesafe-config 1.4.3 ground
// truth shipped in xx.hocon#35 (commit 5b9c1ba).
//
// Background: external report xx.hocon#34 from @cgordon; go.hocon is the
// only outlier and gets a separate impl PR (o3co/go.hocon#100).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/hocon/unquoted-parens', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/unquoted-parens', import.meta.url))

// All 6 fixtures are success fixtures (no .error sidecars).
const SUCCESS_FIXTURES = [
  'up01-paren-mid-token',      // a = hello (world)          → "hello (world)"
  'up02-paren-leading',        // a = (internal)              → "(internal)"
  'up03-paren-real-world',     // description = Build API … (internal) → prose string
  'up04-paren-nested',         // a = ((nested))              → "((nested))"
  'up05-paren-unbalanced-open', // a = (foo                   → "(foo"
  'up06-paren-unbalanced-close', // a = foo)                  → "foo)"
]

describe('unquoted-parens — up01-up06 fixture conformance (xx.hocon#34)', () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name}: parses and resolves to expected JSON`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'),
      )
      expect(parse(conf).toObject()).toEqual(expected)
    })
  }
})
