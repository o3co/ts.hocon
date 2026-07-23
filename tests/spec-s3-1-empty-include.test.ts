// tests/spec-s3-1-empty-include.test.ts
//
// S3.1 — empty / whitespace-only / comment-only / BOM-only INCLUDED files
// contribute an empty config. Originally shipped as a narrow Lightbend-compat
// carve-out for go.hocon#105 while top-level parses still rejected; since the
// S3.1 correction (xx.hocon E10, revoked 2026-07-23) this is simply the rule —
// an empty document parses to {} everywhere, top-level and include path alike
// (HOCON.md §Omit root braces L134-136). This file pins the include path and
// serves as a regression guard against any strict-reject behaviour returning.

import { describe, expect, it } from 'vitest'
import { parse, parseAsync } from '../src/index.js'

const fileReader = (files: Record<string, string>) => (p: string) => {
  const v = files[p.split('/').pop()!]
  if (v === undefined) {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }
  return v
}

describe('S3.1 — included file is empty/comment-only contributes {} (#105)', () => {
  // --- Empty-include cases: must NOT throw, contribute empty ---

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

  // --- Package-include path: same rule (regression guard for the former
  //     whitespace-only reject on loadPackage/loadPackageAsync) ---

  const pkgParse = (content: string) =>
    parse('include package("my-lib", "ref.conf")\na = 1', {
      packageResolver: () => '/fake/pkg/ref.conf',
      readFileSync: (p: string) => {
        if (p === '/fake/pkg/ref.conf') return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })

  it('include package: zero-byte registered content contributes {}', () => {
    expect(pkgParse('').getNumber('a')).toBe(1)
  })

  it('include package: whitespace-only registered content contributes {}', () => {
    expect(pkgParse('   \n\t\n').getNumber('a')).toBe(1)
  })

  it('include package: comment-only registered content contributes {}', () => {
    expect(pkgParse('# nothing here\n').getNumber('a')).toBe(1)
  })

  // Async variant pins loadPackageAsync (the async path previously carried its
  // own assertNonEmptyDocument guard — a sync-only pin would not catch it
  // regressing independently).
  const pkgParseAsync = (content: string) =>
    parseAsync('include package("my-lib", "ref.conf")\na = 1', {
      packageResolver: () => '/fake/pkg/ref.conf',
      readFile: async (p: string) => {
        if (p === '/fake/pkg/ref.conf') return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })

  it('include package (async): whitespace-only registered content contributes {}', async () => {
    expect((await pkgParseAsync('   \n\t\n')).getNumber('a')).toBe(1)
  })

  it('include package (async): comment-only registered content contributes {}', async () => {
    expect((await pkgParseAsync('# nothing here\n')).getNumber('a')).toBe(1)
  })

  // --- Top-level parity: same rule applies outside includes ---

  it('top-level parse("") parses to {} per corrected S3.1', () => {
    expect(parse('').keys()).toEqual([])
  })

  it('top-level whitespace-only parses to {} per corrected S3.1', () => {
    expect(parse('   \n\t').keys()).toEqual([])
  })

  it('top-level comment-only parses to {} per corrected S3.1', () => {
    expect(parse('# only a comment\n').keys()).toEqual([])
  })
})
