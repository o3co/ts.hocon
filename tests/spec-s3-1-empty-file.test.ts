// tests/spec-s3-1-empty-file.test.ts
//
// S3.1 — Empty file is an invalid HOCON document (HOCON.md L130)
// RED tests — must FAIL before the fix is applied to src/parse.ts.
//
// Spec: "Empty files are invalid documents, as are files containing only a
// non-array non-object value such as a string."
//
// Fix location: src/parse.ts buildResolveContext() — check token stream for
// non-skip content after tokenize(); throw ParseError if none found.

import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

describe('S3.1 — empty file is invalid (HOCON.md L130)', () => {
  // --- Error cases (must throw ParseError) ---

  it('S3.1: parse("") throws ParseError — completely empty input', () => {
    expect(() => parse('')).toThrow(ParseError)
  })

  it('S3.1: parse("   \\n  ") throws ParseError — whitespace-only', () => {
    expect(() => parse('   \n  ')).toThrow(ParseError)
  })

  it('S3.1: parse("\\n\\n\\n") throws ParseError — newlines only', () => {
    expect(() => parse('\n\n\n')).toThrow(ParseError)
  })

  it('S3.1: parse("# only a comment\\n") throws ParseError — comment-only', () => {
    expect(() => parse('# only a comment\n')).toThrow(ParseError)
  })

  it('S3.1: parse("\\uFEFF") throws ParseError — BOM only', () => {
    // U+FEFF is the BOM character — consumed by lexer as whitespace, leaves empty stream
    expect(() => parse('﻿')).toThrow(ParseError)
  })

  it('S3.1: parse("  # x \\n  \\n") throws ParseError — mixed whitespace + comment', () => {
    expect(() => parse('  # x \n  \n')).toThrow(ParseError)
  })

  it('S3.1: error message mentions empty file / HOCON.md L130', () => {
    expect(() => parse('')).toThrow(/empty file/i)
  })

  // --- Success cases (must NOT throw — regression guard) ---

  it('S3.1 positive: parse("{}") succeeds — explicit empty object is valid', () => {
    expect(() => parse('{}')).not.toThrow()
  })

  it('S3.1 positive: parse("a = 1") succeeds — single field', () => {
    expect(() => parse('a = 1')).not.toThrow()
  })

  it('S3.1 positive: parse("# comment\\na = 1") succeeds — comment then field', () => {
    expect(() => parse('# comment\na = 1')).not.toThrow()
  })
})
