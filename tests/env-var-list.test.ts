// tests/env-var-list.test.ts
//
// S13c — env-var list expansion conformance tests against xx.hocon fixtures ev01-ev13.
//
// Fixtures live in tests/lightbend/testdata/hocon/env-var-list/*.{conf,env}.
// Expected JSON in tests/lightbend/testdata/expected/env-var-list/.
// Env-var sidecar parsing: tests/lightbend/env-sidecar.ts.
//
// ev08 is behind it.fails() — self-ref-lookback (S13a.13) is broken across all
// three impls; will auto-flip to ✅ when cluster 3f (Phase 6 #3f) lands.
// ev12a/ev12b/ev13 pin S13c.5 and optional-list-direct (ground truth from xx.hocon).
//
// Test env injection: parse(input, { env }) ONLY — process.env is never mutated.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ResolveError } from '../src/errors.js'
import { parseEnvSidecar } from './lightbend/env-sidecar.js'

const dataDir = fileURLToPath(new URL('./lightbend/testdata/hocon/env-var-list', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/env-var-list', import.meta.url))

// Success fixtures: parse, resolve, compare to expected JSON.
const SUCCESS_FIXTURES = [
  'ev01-basic',
  'ev02-stops-at-gap',
  'ev04-optional-no-elements',
  'ev05-config-defined-wins',
  'ev06-concat-prepend',
  'ev07-concat-append',
  // ev08: self-ref-lookback (S13a.13). The plan called for it.fails() tripwire,
  // but ts.hocon's existing priorValues-based self-ref resolution correctly handles
  // the 'x = ["x"]; x = ${?x} ${?LIST[]}' pattern — ev08 passes as-is. ✅
  'ev08-self-append',
  'ev09-whitespace-before-suffix',
  'ev10-empty-string-element',
  'ev11-include-context',
  'ev12b-list-suffix-suppresses-scalar-fallback-optional',
  'ev13-optional-list-direct',
]

// Error fixtures: parse/resolve must throw ResolveError.
const ERROR_FIXTURES = [
  'ev03-required-no-elements',
  'ev12a-list-suffix-suppresses-scalar-fallback-required',
]

// No tripwire fixtures: ev08 passes with the existing self-ref-lookback implementation.
// If S13a.13 cluster 3f reveals a deeper correctness issue with ev08, revisit then.
const TRIPWIRE_FIXTURES: string[] = []

describe('S13c — env-var list expansion conformance (ev01-ev13)', () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name}: parses and resolves to expected JSON`, () => {
      const env = parseEnvSidecar(join(dataDir, `${name}.env`))
      const conf = readFileSync(join(dataDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'))
      // ev11 uses include — baseDir must point to the fixture directory
      const config = parse(conf, {
        env,
        baseDir: dataDir,
      })
      expect(config.toObject()).toEqual(expected)
    })
  }

  for (const name of ERROR_FIXTURES) {
    it(`${name}: parse/resolve throws ResolveError`, () => {
      const env = parseEnvSidecar(join(dataDir, `${name}.env`))
      const conf = readFileSync(join(dataDir, `${name}.conf`), 'utf-8')
      expect(() => parse(conf, { env })).toThrow(ResolveError)
    })
  }

  for (const name of TRIPWIRE_FIXTURES) {
    // it.fails — this test currently FAILS (self-ref-lookback broken, S13a.13).
    // Vitest reports it as passing. When cluster 3f fixes S13a.13, the test will
    // start passing on its own, and it.fails will then FAIL — surfacing the flip
    // in CI so we can remove the tripwire and mark ev08 as ✅.
    it.fails(`${name}: tripwire for S13a.13 self-ref-lookback (cluster 3f); auto-flips when 3f lands`, () => {
      const env = parseEnvSidecar(join(dataDir, `${name}.env`))
      const conf = readFileSync(join(dataDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'))
      const config = parse(conf, { env })
      expect(config.toObject()).toEqual(expected)
    })
  }
})
