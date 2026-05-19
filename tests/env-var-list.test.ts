// tests/env-var-list.test.ts
//
// S13c — env-var list expansion conformance tests against xx.hocon fixtures ev01-ev13.
//
// Fixtures live in tests/lightbend/testdata/hocon/env-var-list/*.{conf,env}.
// Expected JSON in tests/lightbend/testdata/expected/env-var-list/.
// Env-var sidecar parsing: tests/lightbend/env-sidecar.ts.
//
// ev08 passes naturally (ts/rs/go all pass): the `x = ["x"]; x = ${?x} ${?LIST[]}` pattern
// has a clear prior value for `x`, so it does not exercise the S13a.13 "no prior value"
// look-back case (that case is now fixed in cluster 3f, see tests/s13a13-self-ref-lookback.test.ts).
// ev12a/ev12b/ev13 pin S13c.5 and isolated optional-list-direct — these are
// follow-up fixtures shipped via xx.hocon#feature/s13c-env-var-list-followup-fixtures
// (PR pending merge). Until that PR merges to xx.hocon/main, `make testdata` will
// not fetch ev12/ev13 expected JSON; per-fixture skip guards below handle this
// gracefully (skip-when-missing, run-when-present). Once xx merges and a fresh
// `make testdata` runs, the guards will auto-enable.
//
// Test env injection: parse(input, { env }) ONLY — process.env is never mutated.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'
import { ResolveError } from '../src/errors.js'
import { parseEnvSidecar } from './lightbend/env-sidecar.js'

const dataDir = fileURLToPath(new URL('./lightbend/testdata/hocon/env-var-list', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/env-var-list', import.meta.url))

// Per-fixture gate: use it.skip when the *test input* file is missing.
// For success fixtures we additionally need the expected JSON, but for error
// fixtures the only requirement is the `.conf` input (the test asserts
// `.toThrow(ResolveError)` and does NOT consume the expected `.error` sidecar
// — that sidecar exists only for traceability per xx.hocon's
// fixture-conventions.md). Gating error tests on `.error` would unnecessarily
// skip coverage when `make testdata` hasn't run.
//
// Both gates cover:
//   1) Fresh checkout before `make testdata` has been run.
//   2) ev12/ev13 follow-up fixtures that depend on xx.hocon PR merging first.
function gateSuccess(name: string): typeof it | typeof it.skip {
  if (!existsSync(join(dataDir, `${name}.conf`))) return it.skip
  return existsSync(join(expectedDir, `${name}-expected.json`)) ? it : it.skip
}
function gateError(name: string): typeof it | typeof it.skip {
  return existsSync(join(dataDir, `${name}.conf`)) ? it : it.skip
}

// Success fixtures: parse, resolve, compare to expected JSON.
const SUCCESS_FIXTURES = [
  'ev01-basic',
  'ev02-stops-at-gap',
  'ev04-optional-no-elements',
  'ev05-config-defined-wins',
  'ev06-concat-prepend',
  'ev07-concat-append',
  // ev08: x = ["x"]; x = ${?x} ${?LIST[]} — prior value exists, passes naturally. ✅
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


describe('S13c — env-var list expansion conformance (ev01-ev13)', () => {
  for (const name of SUCCESS_FIXTURES) {
    gateSuccess(name)(`${name}: parses and resolves to expected JSON`, () => {
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
    gateError(name)(`${name}: parse/resolve throws ResolveError`, () => {
      const env = parseEnvSidecar(join(dataDir, `${name}.env`))
      const conf = readFileSync(join(dataDir, `${name}.conf`), 'utf-8')
      expect(() => parse(conf, { env })).toThrow(ResolveError)
    })
  }

  // Cache disambiguation regression: `${X}` and `${X[]}` resolve via different
  // code paths and may produce different values. They MUST occupy distinct cache
  // slots — otherwise whichever resolves first poisons the cache for the other.
  // Discovered via multi-agent-review on rs.hocon S13c branch (Codex Critical C1);
  // verified to affect ts.hocon as well. Pinned in both directions.
  it('S13c cache: `${X}` then `${X[]}` produce distinct cached values', () => {  // eslint-disable-line no-template-curly-in-string
    const r = parse('a = ${X}\nb = ${X[]}', {  // eslint-disable-line no-template-curly-in-string
      env: { X: 'scalar-val', X_0: 'a', X_1: 'b' },
    })
    expect(r.toObject()).toEqual({ a: 'scalar-val', b: ['a', 'b'] })
  })

  it('S13c cache: `${X[]}` then `${X}` produce distinct cached values', () => {  // eslint-disable-line no-template-curly-in-string
    const r = parse('a = ${X[]}\nb = ${X}', {  // eslint-disable-line no-template-curly-in-string
      env: { X: 'scalar-val', X_0: 'a', X_1: 'b' },
    })
    expect(r.toObject()).toEqual({ a: ['a', 'b'], b: 'scalar-val' })
  })

})
