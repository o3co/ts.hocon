// tests/conformance/array-root.test.ts
//
// S3.5 conformance — xx.hocon fixture loop for array-root variants
// (ar01-ar03). Each fixture ships a Lightbend-generated .error sidecar
// (ConfigException$WrongType "has type LIST rather than object at file root");
// per the .error-sidecar convention the conformance assertion is "an error is
// raised" — the class pin (type error, not syntax error) lives in
// tests/spec-s3-5-array-root.test.ts.
//
// ar03-inner.conf is a sibling include-target, not a standalone fixture
// (see xx.hocon fixture-conventions §Sibling include-target files).
//
// Fixtures from: tests/lightbend/testdata/hocon/array-root/ (synced via
// `make testdata`; the suite skips when the group is not yet synced).

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseFile } from '../../src/index.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/array-root', import.meta.url)
)

describe('S3.5 conformance — array-root fixtures (ar01-ar03) must error', () => {
  if (!existsSync(fixtureDir)) {
    it.skip('fixtures unavailable — array-root group not synced (run `make testdata`)', () => {})
    return
  }

  const entries = readdirSync(fixtureDir)
    .sort()
    .filter(f => f.endsWith('.conf') && !f.endsWith('-inner.conf'))

  for (const entry of entries) {
    it(`${entry} — array-at-file-root document errors (type error, not syntax)`, () => {
      const run = () => parseFile(join(fixtureDir, entry))
      expect(run).toThrow(/array (at|rather than object at) file root/i)
    })
  }
})
