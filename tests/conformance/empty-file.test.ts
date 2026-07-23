// tests/conformance/empty-file.test.ts
//
// S3.1 conformance — xx.hocon fixture loop for empty-file variants.
// Each of ef01-ef06 is an empty/whitespace/comment-only document.
// Per spec HOCON.md §Omit root braces (L134-136), a file that does not begin
// with `[` or `{` is parsed as if enclosed in `{}` — an empty document
// therefore parses to the empty object. (L130-132 is the JSON baseline, not
// HOCON-normative; the former reject-posture was revoked — see xx.hocon E10.)
//
// The `{}` -expected.json sidecars in xx.hocon are normative as-is; no
// per-impl override applies.
//
// Fixtures from: tests/lightbend/testdata/hocon/empty-file/ef01-ef06.conf
// (copied from xx.hocon via local fixture sync)

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../../src/index.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/empty-file', import.meta.url)
)

describe('S3.1 conformance — empty-file fixtures (ef01-ef06) parse to {}', () => {
  const entries = readdirSync(fixtureDir).sort().filter(f => f.endsWith('.conf'))

  for (const entry of entries) {
    it(`${entry} — empty/whitespace/comment-only document parses to {}`, () => {
      const content = readFileSync(join(fixtureDir, entry))
      // Read as Buffer to handle binary content (BOM-only ef05)
      const text = content.toString('utf-8')
      const cfg = parse(text)
      expect(cfg.keys()).toEqual([])
    })
  }
})
