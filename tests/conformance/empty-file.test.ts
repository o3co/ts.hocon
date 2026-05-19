// tests/conformance/empty-file.test.ts
//
// S3.1 conformance — xx.hocon fixture loop for empty-file variants.
// Each of ef01-ef06 is an empty/whitespace/comment-only document.
// Per spec HOCON.md L130, these are INVALID documents; parse() must throw.
//
// Per-impl override: this impl asserts error; Lightbend silently returns {}
// (Lightbend quirk, not spec-compliant per HOCON.md L130).
//
// Fixtures from: tests/lightbend/testdata/hocon/empty-file/ef01-ef06.conf
// (copied from xx.hocon via local fixture sync)

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../../src/index.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/empty-file', import.meta.url)
)

describe('S3.1 conformance — empty-file fixtures (ef01-ef06) must error', () => {
  const entries = readdirSync(fixtureDir).sort().filter(f => f.endsWith('.conf'))

  for (const entry of entries) {
    it(`${entry} — empty/whitespace/comment-only document must throw`, () => {
      const content = readFileSync(join(fixtureDir, entry))
      // Read as Buffer to handle binary content (BOM-only ef05)
      const text = content.toString('utf-8')
      expect(() => parse(text)).toThrow()
    })
  }
})
