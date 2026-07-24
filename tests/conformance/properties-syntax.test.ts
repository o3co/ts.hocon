// tests/conformance/properties-syntax.test.ts
//
// S23.5 / S23.6 conformance — xx.hocon fixture loop for the full
// java.util.Properties syntax. Both items were globally out-of-scope until
// 2026-07-24; the expectations are generated from Lightbend, which reads an
// included .properties file with java.util.Properties.
//
// Fixtures:
//   ps01-continuation       backslash continuations, and the ones that aren't
//   ps02-escapes            \t \n \r \f, unicode, unknown escape, literal backslash
//   ps03-separators         = : and whitespace; escaped separators stay in the key
//   ps04-value-whitespace   a value keeps its trailing whitespace
//   ps05-astral             a surrogate pair and a directly written astral char
//
// parseProperties() returns Record<string, unknown>, so the parsed result is
// compared straight against the sidecar.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProperties } from '../../src/internal/properties/properties.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/properties-syntax', import.meta.url),
)
const expectedDir = fileURLToPath(
  new URL('../lightbend/testdata/expected/properties-syntax', import.meta.url),
)

describe('S23.5/S23.6 conformance — properties-syntax fixtures (ps01-ps05)', () => {
  // expected/ is fetched, not vendored; skip in a fresh checkout rather than
  // surfacing fs errors. Same guard as properties-conflict.test.ts.
  if (!existsSync(fixtureDir) || !existsSync(expectedDir)) {
    it.skip('fixtures unavailable — run `make testdata`', () => {})
    return
  }

  const entries = readdirSync(fixtureDir)
    .sort()
    .filter(f => f.endsWith('.properties'))

  for (const entry of entries) {
    const base = entry.replace('.properties', '')

    it(`${entry} — matches the Lightbend oracle`, () => {
      const result = parseProperties(readFileSync(join(fixtureDir, entry), 'utf-8'))
      const expected = JSON.parse(readFileSync(join(expectedDir, `${base}-expected.json`), 'utf-8'))
      expect(result).toEqual(expected)
    })
  }
})
