// tests/e11-must-fixes-regression.test.ts
//
// Regression tests for the four must-fix items surfaced by multi-agent-review
// of the initial E11 ts.hocon implementation. Each test pins post-review behavior
// to prevent future drift.
//
// Must-fix items (cross-review, all critical):
//   (1) parser: missing comma between args was silently accepted
//   (2) loader: includingFile passed to packageResolver was a synthesised "_placeholder" path
//   (3) loader: whitespace-only registered content was treated as empty (S3.1 short-circuit)
//   (4) loader: loadSingle / loadSingleAsync rebuilt ResolveOptions and dropped packageResolver/resolveFrom

import { describe, expect, it } from 'vitest'
import { ParseError, parse } from '../src/index.js'
import type { PackageResolver } from '../src/index.js'

describe('E11 must-fix #1 — parser requires comma between package() args', () => {
  it('rejects package("id" "file") with no comma (ParseError)', () => {
    expect(() => parse('include package("foo" "bar.conf")')).toThrow(ParseError)
  })

  // One-arg form rejection is already covered by tests/e11-parser-package.test.ts;
  // this regression file targets only the missing-comma branch that previously fell through.
})

describe('E11 must-fix #2 — packageResolver receives undefined for includingFile', () => {
  it('does not pass a synthesised "_placeholder" path', () => {
    let receivedIncludingFile: string | undefined | symbol = Symbol('unset')
    const resolver: PackageResolver = (_id, _file, includingFile) => {
      receivedIncludingFile = includingFile
      return '/fake/registry/foo/bar.conf'
    }
    const readFileSync = (_p: string) => 'a = 1'
    parse('include package("foo", "bar.conf")', { packageResolver: resolver, readFileSync })
    expect(receivedIncludingFile).toBeUndefined()
    // Concretely: must not contain the substring "_placeholder" or any synthesised tail.
    expect(typeof receivedIncludingFile).toBe('undefined')
  })
})

describe('E11 must-fix #3 — empty and whitespace-only registered content contribute {}', () => {
  // S3.1 (corrected, xx.hocon E10): an empty document parses to {} on every
  // path — zero-byte, whitespace-only, and comment-only registered content all
  // contribute {} uniformly (the former zero-byte-only distinction is gone).
  it('zero-byte registered content is valid (contributes {})', () => {
    const resolver: PackageResolver = () => '/fake/registry/foo/empty.conf'
    const readFileSync = (_p: string) => '' // zero bytes
    const cfg = parse(
      'a = 1\ninclude package("foo", "empty.conf")',
      { packageResolver: resolver, readFileSync },
    )
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('whitespace-only registered content contributes {}', () => {
    const resolver: PackageResolver = () => '/fake/registry/foo/ws.conf'
    const readFileSync = (_p: string) => '   \n\n  ' // whitespace only — NOT zero bytes
    const cfg = parse(
      'a = 1\ninclude package("foo", "ws.conf")',
      { packageResolver: resolver, readFileSync },
    )
    expect(cfg.getNumber('a')).toBe(1)
  })

  it('comment-only registered content contributes {}', () => {
    const resolver: PackageResolver = () => '/fake/registry/foo/comment.conf'
    const readFileSync = (_p: string) => '# only a comment\n'
    const cfg = parse(
      'a = 1\ninclude package("foo", "comment.conf")',
      { packageResolver: resolver, readFileSync },
    )
    expect(cfg.getNumber('a')).toBe(1)
  })
})

describe('E11 must-fix #4 — packageResolver/resolveFrom preserved across nested includes', () => {
  it('an outer include "..." chain that reaches an inner include package(...) still uses the caller-provided packageResolver', () => {
    // Bug being pinned: loadSingle rebuilt ResolveOptions with only {env, baseDir, readFileSync, includeStack}
    // — packageResolver was dropped. Inner include package(...) then errored "not configured".
    // Post-fix: loadSingle spreads ...this.opts, preserving packageResolver/resolveFrom/readFile.

    let packageResolverCalled = false
    let resolverReceivedId = ''
    let resolverReceivedFile = ''
    const resolver: PackageResolver = (id, file, _includingFile) => {
      packageResolverCalled = true
      resolverReceivedId = id
      resolverReceivedFile = file
      return '/fake/registry/foo/bar.conf'
    }

    const files = new Map<string, string>([
      ['/virtual/a.conf', 'include package("foo", "bar.conf")\nlocal = "from_a"'],
      ['/fake/registry/foo/bar.conf', 'x = 42'],
    ])
    const readFileSync = (p: string) => {
      const content = files.get(p)
      if (content === undefined) {
        throw Object.assign(new Error(`enoent: ${p}`), { code: 'ENOENT' })
      }
      return content
    }

    const cfg = parse(
      'include "/virtual/a.conf"',
      { packageResolver: resolver, readFileSync },
    )

    expect(packageResolverCalled).toBe(true)
    expect(resolverReceivedId).toBe('foo')
    expect(resolverReceivedFile).toBe('bar.conf')
    expect(cfg.getNumber('x')).toBe(42)
    expect(cfg.getString('local')).toBe('from_a')
  })
})
