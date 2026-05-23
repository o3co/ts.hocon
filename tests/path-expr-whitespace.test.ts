// tests/path-expr-whitespace.test.ts
//
// Path-expression whitespace preservation (xx.hocon#42, E13) — pw01-pw07.
// Fixture inputs:  tests/lightbend/testdata/hocon/path-expr-whitespace/*.conf
// Expected outputs: tests/lightbend/testdata/expected/path-expr-whitespace/
//
// Lightbend preserves literal whitespace adjacent to dots in path expressions:
//   a b. c = 1   →  {"a b":{" c":1}}     // leading space on " c" preserved
//   a b.\tc = 1  →  {"a b":{"\tc":1}}    // tab preserved (HOCON_WS includes tab)
// ts.hocon previously stripped leading whitespace from post-dot segments.
// See docs/extra-spec-conventions.md E13 (xx.hocon).
//
// 6 success fixtures + 1 error fixture (pw06: trailing-dot still BadPath —
// loosening does NOT cascade into empty path segments).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/hocon/path-expr-whitespace', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/path-expr-whitespace', import.meta.url))

const SUCCESS_FIXTURES = [
  'pw01-space-after-dot',                // a b. c = 1     → {"a b":{" c":1}}
  'pw02-space-both-sides-of-dot',        // a . b = 1      → {"a ":{" b":1}}
  'pw03-space-before-dot',               // a .b = 1       → {"a ":{"b":1}}
  'pw04-space-concat-both-segments',     // a b.c d = 1    → {"a b":{"c d":1}}    (combined-regression guard — no WS adj dot)
  'pw05-multi-whitespace-both-sides',    // a b . c = 1    → {"a b ":{" c":1}}
  'pw07-tab-after-dot',                  // a b.\tc = 1    → {"a b":{"\tc":1}}    (HOCON_WS tab variant)
]

const ERROR_FIXTURES = [
  'pw06-trailing-dot-before-separator',  // a b. = 1       → BadPath (loosening boundary guard)
]

describe('path-expr-whitespace — success fixtures (xx.hocon#42, E13)', () => {
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

describe('path-expr-whitespace — error fixtures (xx.hocon#42, E13)', () => {
  for (const name of ERROR_FIXTURES) {
    it(`${name}: parse raises error (per .error sidecar)`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      // Sidecar existence is the signal; message content is not asserted.
      expect(existsSync(join(expectedDir, `${name}.error`))).toBe(true)
      expect(() => parse(conf)).toThrow()
    })
  }
})
