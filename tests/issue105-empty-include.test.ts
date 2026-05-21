/**
 * go.hocon#105 cross-impl fix: empty / whitespace-only / comment-only
 * included files should contribute an empty config instead of erroring
 * with the S3.1 top-level rejection. Narrow scope — file-include only;
 * top-level empty parses still error.
 */
import { describe, expect, it } from 'vitest'
import { parse, ParseError } from '../src/index.js'

describe('go.hocon#105 cross-impl — empty/comment-only include is no-op', () => {
  const buildParseWithFiles = (files: Map<string, string>) => {
    const readFileSync = (p: string) => {
      const content = files.get(p)
      if (content === undefined) {
        throw Object.assign(new Error(`enoent: ${p}`), { code: 'ENOENT' })
      }
      return content
    }
    return (input: string) => parse(input, { readFileSync })
  }

  it('zero-byte include contributes an empty config', () => {
    const files = new Map<string, string>([
      ['/virtual/empty.conf', ''],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/empty.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('hash-comment-only include is a no-op', () => {
    const files = new Map<string, string>([
      ['/virtual/c.conf', '# only a comment\n# another\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/c.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('slash-comment-only include is a no-op', () => {
    const files = new Map<string, string>([
      ['/virtual/c.conf', '// only a comment\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/c.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('whitespace-only include is a no-op', () => {
    const files = new Map<string, string>([
      ['/virtual/ws.conf', '   \n\t\n\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/ws.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('Unicode-whitespace-only include is a no-op (NBSP, en-quad, line sep)', () => {
    const files = new Map<string, string>([
      ['/virtual/uws.conf', '\u00A0\u2000\u2028\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/uws.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('BOM-only include is a no-op', () => {
    const files = new Map<string, string>([
      ['/virtual/bom.conf', '\uFEFF\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/bom.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('top-level empty parses still error (S3.1 scope intact)', () => {
    expect(() => parse('')).toThrow(ParseError)
    expect(() => parse('# only a comment\n')).toThrow(ParseError)
    expect(() => parse('// only a comment\n')).toThrow(ParseError)
    expect(() => parse('   \n  ')).toThrow(ParseError)
  })

  it('non-empty include still parses normally (regression guard)', () => {
    const files = new Map<string, string>([
      ['/virtual/c.conf', '# leading\nb = 2\n# trailing\n'],
    ])
    const cfg = buildParseWithFiles(files)('include "/virtual/c.conf"\na = 1\n')
    expect(cfg.getNumber('a')).toBe(1)
    expect(cfg.getNumber('b')).toBe(2)
  })
})
