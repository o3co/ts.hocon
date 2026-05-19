// tests/conformance/properties-conflict.test.ts
//
// S23.4 conformance — xx.hocon fixture loop for .properties object-wins rule.
// Reads .properties via parseProperties() directly and asserts the resolved
// nested object matches the -expected.json sidecar (HOCON.md L1485).
//
// Fixtures:
//   pc01-forward.properties    → { a: { b: "world" } }  (a=hello;a.b=world)
//   pc02-reverse.properties    → { a: { b: "world" } }  (a.b=world;a=hello — same after sort)
//   pc03-deep-forward.properties → { a: { b: { c: "v1" } } }
//   pc04-deep-reverse.properties → { a: { b: { c: "v2" } } }
//
// Note: parseProperties() returns Record<string, unknown>, not a Config object.
// We compare directly against the parsed expected JSON sidecar.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProperties } from '../../src/internal/properties/properties.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/properties-conflict', import.meta.url)
)
const expectedDir = fileURLToPath(
  new URL('../lightbend/testdata/expected/properties-conflict', import.meta.url)
)

describe('S23.4 conformance — properties-conflict fixtures (pc01-pc04)', () => {
  const entries = readdirSync(fixtureDir)
    .sort()
    .filter(f => f.endsWith('.properties'))

  for (const entry of entries) {
    const base = entry.replace('.properties', '')
    const expectedFile = join(expectedDir, `${base}-expected.json`)

    it(`${entry} — object wins, matches expected JSON`, () => {
      const propsContent = readFileSync(join(fixtureDir, entry), 'utf-8')
      const result = parseProperties(propsContent)

      const expected = JSON.parse(readFileSync(expectedFile, 'utf-8'))
      expect(result).toEqual(expected)
    })
  }
})
