// tests/spec-s3-1-empty-include.test.ts
//
// Lightbend-compat carve-out for go.hocon#105 — empty / whitespace-only /
// comment-only / BOM-only INCLUDED files contribute an empty config
// instead of erroring with S3.1.
//
// S3.1 (HOCON.md L130) "empty files are invalid documents" remains
// enforced for TOP-LEVEL parses (parse(""), parseFile on empty as root) —
// see tests/spec-s3-1-empty-top-level.test.ts. This file pins the
// narrower include-path carve-out and serves as a regression guard
// against the previous strict-reject behaviour returning.

import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

const fileReader = (files: Record<string, string>) => (p: string) => {
  const v = files[p.split('/').pop()!]
  if (v === undefined) {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }
  return v
}

describe('S3.1 — included file is empty/comment-only (Lightbend-compat carve-out #105)', () => {
  // --- Carve-out cases: must NOT throw, contribute empty ---

  it('include: completely empty included file is no-op', () => {
    const files = { 'empty.conf': '' }
    const cfg = parse('include "empty.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('include: whitespace-only included file is no-op', () => {
    const files = { 'ws.conf': '   \n  \t  ' }
    const cfg = parse('include "ws.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('include: hash-comment-only included file is no-op', () => {
    const files = { 'comments.conf': '# only a comment\n# another\n' }
    const cfg = parse('include "comments.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('include: slash-comment-only included file is no-op', () => {
    const files = { 'comments.conf': '// only a comment\n' }
    const cfg = parse('include "comments.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('include: BOM-only included file is no-op', () => {
    const files = { 'bom.conf': '\uFEFF' }
    const cfg = parse('include "bom.conf"\na = 1', { readFileSync: fileReader(files) })
    expect(cfg.getNumber('a')).toBe(1)
  })

  // --- Non-empty controls (regression guard) ---

  it('include positive: non-empty file still parses', () => {
    const files = { 'non-empty.conf': 'a = 1' }
    expect(() =>
      parse('include "non-empty.conf"', { readFileSync: fileReader(files) }),
    ).not.toThrow()
  })

  it('include positive: comment + field still parses', () => {
    const files = { 'with-comment.conf': '# header\nb = 2' }
    expect(() =>
      parse('include "with-comment.conf"', { readFileSync: fileReader(files) }),
    ).not.toThrow()
  })

  // --- Top-level scope preserved ---

  it('top-level parse("") still rejects per S3.1', () => {
    expect(() => parse('')).toThrow(ParseError)
  })

  it('top-level whitespace-only still rejects per S3.1', () => {
    expect(() => parse('   \n\t')).toThrow(ParseError)
  })

  it('top-level comment-only still rejects per S3.1', () => {
    expect(() => parse('# only a comment\n')).toThrow(ParseError)
  })
})
