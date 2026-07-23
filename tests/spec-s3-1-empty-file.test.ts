// tests/spec-s3-1-empty-file.test.ts
//
// S3.1 — An empty document is valid HOCON and parses to the empty object {}
// (HOCON.md §Omit root braces L130-136).
//
// L130-132 ("Empty files are invalid documents") is the *JSON baseline*
// description; the HOCON-normative sentence is L134-136: a file that does not
// begin with `[` or `{` is parsed as if enclosed in `{}` — an empty document
// vacuously qualifies. Confirmed by the reference implementation:
// ConfigDocumentParser throws "Empty document" only in the ConfigSyntax.JSON
// branch, and ConfigFactory.parseString("") is a valid empty config.
//
// History: cluster 3h (2026-05-19) added an assertNonEmptyDocument guard that
// rejected these inputs, misreading the JSON baseline as HOCON-normative — a
// behavior regression vs. pre-1.3.0 releases. The posture was revoked
// 2026-07-23 (xx.hocon E10); these tests pin the corrected behavior.

import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

describe('S3.1 — empty document parses to {} (HOCON.md L134-136)', () => {
  // --- Empty variants (must parse to the empty object) ---

  const emptyVariants: Array<[string, string]> = [
    ['completely empty input', ''],
    ['whitespace-only', '   \n  '],
    ['newlines only', '\n\n\n'],
    ['comment-only (#)', '# only a comment\n'],
    ['comment-only (//)', '// only a comment\n'],
    ['BOM only', '﻿'],
    ['mixed whitespace + comment', '  # x \n  \n'],
  ]

  for (const [label, input] of emptyVariants) {
    it(`S3.1: parse(${JSON.stringify(input)}) — ${label} — returns empty config`, () => {
      const cfg = parse(input)
      expect(cfg.keys()).toEqual([])
    })
  }

  it('S3.1: empty document root is an object node with no fields', () => {
    const root = parse('').getValue('')
    expect(root.kind).toBe('object')
  })

  it('S3.1: empty document equals explicit {} parse', () => {
    expect(parse('').keys()).toEqual(parse('{}').keys())
  })

  // --- Non-empty controls (regression guard) ---

  it('S3.1 positive: parse("{}") succeeds — explicit empty object is valid', () => {
    expect(parse('{}').keys()).toEqual([])
  })

  it('S3.1 positive: parse("a = 1") succeeds — single field', () => {
    expect(parse('a = 1').getNumber('a')).toBe(1)
  })

  it('S3.1 positive: parse("# comment\\na = 1") succeeds — comment then field', () => {
    expect(parse('# comment\na = 1').getNumber('a')).toBe(1)
  })
})
