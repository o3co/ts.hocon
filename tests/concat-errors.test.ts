// tests/concat-errors.test.ts
//
// S10 concat type-check conformance (Phase 6 #3b) — ce01-ce15 fixtures.
// Fixture inputs: tests/lightbend/testdata/hocon/concat-errors/*.conf
// Expected outputs: tests/lightbend/testdata/expected/concat-errors/
//
// Fixture classification per xx.hocon sidecar convention:
//   <name>.error present → error fixture: assert parse/resolve throws ResolveError
//   <name>-expected.json present → success fixture: assert toObject() matches JSON
//   neither present → skip (fixture not yet synced or sidecar missing)
//
// ce05-object-plus-scalar has no sidecar in the current xx.hocon expected set
// (Lightbend WrongType, but sidecar not yet generated); it is skipped until added.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ResolveError } from '../src/errors.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/hocon/concat-errors', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/concat-errors', import.meta.url))

type Gate = typeof it | typeof it.skip

function gateError(name: string): Gate {
  if (!existsSync(join(confDir, `${name}.conf`))) return it.skip
  return existsSync(join(expectedDir, `${name}.error`)) ? it : it.skip
}

function gateSuccess(name: string): Gate {
  if (!existsSync(join(confDir, `${name}.conf`))) return it.skip
  return existsSync(join(expectedDir, `${name}-expected.json`)) ? it : it.skip
}

// Error fixtures — parse/resolve must throw ResolveError.
const ERROR_FIXTURES = [
  'ce01-array-plus-object',
  'ce02-object-plus-array',
  'ce03-array-plus-scalar',
  'ce04-scalar-plus-array',
  'ce05-object-plus-scalar',  // no sidecar yet — gateError will skip
  'ce06-scalar-plus-object',
  'ce07-subst-obj-plus-array',
  'ce08-subst-array-plus-obj',
  'ce10-empty-array-plus-object',
  'ce11-array-plus-empty-object',
  'ce12-string-concat-resolved-array',
  'ce13-string-concat-resolved-object',
  'ce14-optional-missing-mid-concat',
]

// Success fixtures — parse/resolve must produce the expected JSON value.
const SUCCESS_FIXTURES = [
  'ce09-numeric-obj-still-works',  // S15 bridge preserved
  'ce15-optional-missing-suppresses-pair',  // single piece after optional omission
]

describe('S10 concat type-check — ce01-ce15 fixture conformance', () => {
  for (const name of ERROR_FIXTURES) {
    gateError(name)(`${name}: parse/resolve throws ResolveError`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      expect(() => parse(conf)).toThrow(ResolveError)
    })
  }

  for (const name of SUCCESS_FIXTURES) {
    gateSuccess(name)(`${name}: resolves to expected JSON`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'),
      )
      expect(parse(conf).toObject()).toEqual(expected)
    })
  }
})

// ---- Fix #3b: concat type-mismatch errors must carry non-zero line/col ----
describe('S10 concat type-mismatch errors carry source position', () => {
  it('ce01 array+object error has non-zero line/col', () => {
    // ce01-array-plus-object.conf: `a = [1] { b: 2 }` — concat on line 1, col 5
    const conf = readFileSync(join(confDir, 'ce01-array-plus-object.conf'), 'utf-8')
    let caught: unknown
    try { parse(conf) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ResolveError)
    const err = caught as ResolveError
    expect(err.line).toBeGreaterThan(0)
    expect(err.col).toBeGreaterThan(0)
  })

  it('ce06 scalar+object error has non-zero line/col', () => {
    // ce06-scalar-plus-object.conf: `a = x { b: 1 }` — concat on line 1, col 5
    const conf = readFileSync(join(confDir, 'ce06-scalar-plus-object.conf'), 'utf-8')
    let caught: unknown
    try { parse(conf) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ResolveError)
    const err = caught as ResolveError
    expect(err.line).toBeGreaterThan(0)
    expect(err.col).toBeGreaterThan(0)
  })
})
