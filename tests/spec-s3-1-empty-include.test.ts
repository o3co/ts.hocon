// tests/spec-s3-1-empty-include.test.ts
//
// S3.1 — Empty included file is an invalid HOCON document (HOCON.md L130)
// Verifies that the assertNonEmptyDocument guard fires on the include-loader
// path, not only on the top-level parse path.

import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

describe('S3.1 — empty included file is invalid (HOCON.md L130)', () => {
  // --- Error cases ---

  it('S3.1 include: rejects completely empty included file', () => {
    const files: Record<string, string> = { 'empty.conf': '' }
    expect(() =>
      parse('include "empty.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).toThrow(ParseError)
  })

  it('S3.1 include: error message mentions "empty file"', () => {
    const files: Record<string, string> = { 'empty.conf': '' }
    expect(() =>
      parse('include "empty.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).toThrow(/empty file/i)
  })

  it('S3.1 include: rejects whitespace-only included file', () => {
    const files: Record<string, string> = { 'ws.conf': '   \n  \t  ' }
    expect(() =>
      parse('include "ws.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).toThrow(ParseError)
  })

  it('S3.1 include: rejects comment-only included file', () => {
    const files: Record<string, string> = { 'comments.conf': '# only a comment\n// another comment\n' }
    expect(() =>
      parse('include "comments.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).toThrow(ParseError)
  })

  it('S3.1 include: rejects BOM-only included file', () => {
    const files: Record<string, string> = { 'bom.conf': '﻿' }
    expect(() =>
      parse('include "bom.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).toThrow(ParseError)
  })

  // --- Positive guard (must NOT throw) ---

  it('S3.1 include positive: include of non-empty file succeeds', () => {
    const files: Record<string, string> = { 'non-empty.conf': 'a = 1' }
    expect(() =>
      parse('include "non-empty.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).not.toThrow()
  })

  it('S3.1 include positive: include of file with comment then field succeeds', () => {
    const files: Record<string, string> = { 'with-comment.conf': '# header\nb = 2' }
    expect(() =>
      parse('include "with-comment.conf"', {
        readFileSync: (p) => files[p.split('/').pop()!] ?? (() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })(),
      })
    ).not.toThrow()
  })
})
