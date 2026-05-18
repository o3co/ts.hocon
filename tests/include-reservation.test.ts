// tests/include-reservation.test.ts
//
// S12.5 include-key reservation conformance (Phase 6 #3e) — ir01-ir14 fixtures.
// Fixture inputs: tests/lightbend/testdata/hocon/include-reservation/*.conf
// Expected outputs: tests/lightbend/testdata/expected/include-reservation/
//
// Per-impl override: ts.hocon enforces S12.5 strictly for ir03/ir04 even though
// xx.hocon expected set has no .error sidecar for them (Lightbend silently accepts
// include.foo=1 and a={include.bar=1}; ts.hocon follows strict HOCON.md L570).
//
// Fixture classification:
//   <name>.error present OR name is in IMPL_OVERRIDE_ERRORS → error fixture
//   <name>-expected.json present → success fixture
//   neither → skip

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/hocon/include-reservation', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/include-reservation', import.meta.url))

// Per-impl override: ts.hocon enforces S12.5 strictly for these E9 fixtures.
// Lightbend silently accepts include.foo=1 so xx.hocon expected set has no .error
// sidecar — we override here to assert ParseError per strict HOCON.md L570.
const IMPL_OVERRIDE_ERRORS = [
  'ir03-include-dot-foo-equals',
  'ir04-include-nested-object',
]

type Gate = typeof it | typeof it.skip

function gateError(name: string): Gate {
  if (!existsSync(join(confDir, `${name}.conf`))) return it.skip
  if (IMPL_OVERRIDE_ERRORS.includes(name)) return it
  return existsSync(join(expectedDir, `${name}.error`)) ? it : it.skip
}

function gateSuccess(name: string): Gate {
  if (!existsSync(join(confDir, `${name}.conf`))) return it.skip
  return existsSync(join(expectedDir, `${name}-expected.json`)) ? it : it.skip
}

const ERROR_FIXTURES = [
  'ir01-include-equals',
  'ir02-include-colon',
  'ir03-include-dot-foo-equals',
  'ir04-include-nested-object',
  'ir10-include-plus-equals',
  'ir12-include-newline-arg',
  'ir13-include-object-body',
]

const SUCCESS_FIXTURES = [
  'ir05-include-statement',
  'ir06-quoted-include',
  'ir07-include-non-initial',
  'ir08-include-as-value',
  'ir09-include-file-form',
  'ir11-quoted-include-dotted',
  'ir14-substitution-include-path',
]

describe('S12.5 include-reservation — ir01-ir14 fixture conformance', () => {
  for (const name of ERROR_FIXTURES) {
    gateError(name)(`${name}: parse throws ParseError`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(conf)).toThrow(ParseError)
    })
  }

  for (const name of SUCCESS_FIXTURES) {
    gateSuccess(name)(`${name}: resolves to expected JSON`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'),
      )
      expect(parse(conf, { baseDir: confDir }).toObject()).toEqual(expected)
    })
  }
})
