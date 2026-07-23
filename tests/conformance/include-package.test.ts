// tests/conformance/include-package.test.ts
//
// E11 conformance — xx.hocon fixture loop for include-package/ (ipk01-ipk14).
//
// Design: ts.hocon has no explicit registry — it delegates to Node require.resolve.
// For conformance testing we inject a custom packageResolver that acts as an
// in-memory registry, keyed by JSON.stringify([identifier, file]).
//
// Per-impl override:
//   ipk03 (collision): NOT APPLICABLE for ts.hocon (no explicit registry).
//   ipk07 (file case):  require.resolve on macOS/Linux may behave differently;
//                       the basename case-check in defaultPackageResolver handles it,
//                       but the custom resolver in tests enforces strict equality directly.
//
// Fixture source: xx.hocon worktree (read-only reference)
// Package content: xx.hocon testdata/hocon/include-package/_packages/

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PackageResolver } from '../../src/index.js'
import { PackageLookupError, ParseError, ResolveError, parse } from '../../src/index.js'

// ---- Paths ----------------------------------------------------------------

// The xx.hocon worktree is a sibling of this worktree under .claude/worktrees/.
// Vitest sets process.cwd() to the project root (worktree root), so we navigate
// from there: ../incl-pkg-xx/... resolves sibling worktree.
const XX_FIXTURE_DIR = join(
  process.cwd(),
  '../incl-pkg-xx/testdata/hocon/include-package',
)
const FIXTURE_DIR = XX_FIXTURE_DIR
const PACKAGES_DIR = join(XX_FIXTURE_DIR, '_packages')

// ---- Registry builder -----------------------------------------------------

type Registry = Map<string, string>

function registryKey(identifier: string, file: string): string {
  return JSON.stringify([identifier, file])
}

function makeResolver(registry: Registry): PackageResolver {
  return (identifier: string, file: string) => {
    const key = registryKey(identifier, file)
    if (!registry.has(key)) {
      throw new PackageLookupError(
        `include package("${identifier}", "${file}"): not found in test registry`,
        identifier,
        file,
        0,
        0,
      )
    }
    // Return a fake absolute path; content is supplied via readFileSync override
    return `/test-registry/${identifier}/${file}`
  }
}

function makeReadFileSync(registry: Registry): (p: string) => string {
  return (p: string) => {
    // Decode the fake path back to (identifier, file)
    const prefix = '/test-registry/'
    if (p.startsWith(prefix)) {
      const rest = p.slice(prefix.length)
      // identifier may contain '/' — file is always the last path segment (no sub-dirs in test data)
      // We need to find the split point. The registry key tells us.
      for (const [key, content] of registry) {
        const [id, f] = JSON.parse(key) as [string, string]
        if (rest === `${id}/${f}`) return content
      }
      throw Object.assign(new Error(`test registry miss: ${p}`), { code: 'ENOENT' })
    }
    // Fall through to real fs for non-registry paths
    return readFileSync(p, 'utf-8')
  }
}

// ---- Test-package content (from xx.hocon _packages/) ----------------------

function readPackage(relPath: string): string {
  return readFileSync(join(PACKAGES_DIR, relPath), 'utf-8')
}

// ---- Per-impl override: ipk03 is N/A for ts.hocon -------------------------
// ts.hocon has no explicit registry; host require.resolve does not detect
// two registrations of the same (id, file) with different content.
// ipk03 is skipped via it.skip below.

// ---- Helpers ---------------------------------------------------------------

function fixtureContent(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.conf`), 'utf-8')
}

function parseFixture(name: string, registry: Registry): ReturnType<typeof parse> {
  return parse(fixtureContent(name), {
    packageResolver: makeResolver(registry),
    readFileSync: makeReadFileSync(registry),
  })
}

// ---- Tests -----------------------------------------------------------------

describe('E11 conformance — include-package fixtures (ipk01-ipk14)', () => {

  // The xx.hocon sibling worktree must be present. Skip the suite in clean
  // checkouts (no sibling worktree) so missing fixtures produce an actionable
  // skip message rather than confusing ENOENT errors.
  // Same skip-guard pattern as tests/conformance/properties-conflict.test.ts.
  if (!existsSync(FIXTURE_DIR) || !existsSync(PACKAGES_DIR)) {
    it.skip('fixtures unavailable — xx.hocon sibling worktree (incl-pkg-xx) not present', () => {})
    return
  }

  // ipk01: happy path — basic package include
  it('ipk01-basic: success, merged config', () => {
    const registry: Registry = new Map([
      [registryKey('github.com/example/lib', 'reference.conf'),
       readPackage('github.com_example_lib/reference.conf')],
    ])
    const config = parseFixture('ipk01-basic', registry)
    expect(config.get('host')).toBe('example.com')
    expect(config.get('port')).toBe(8080)
    expect(config.get('app.name')).toBe('lib')
  })

  // ipk02: one-arg form must be rejected at parse time
  it('ipk02-one-arg-rejected: ParseError on one-arg form', () => {
    expect(() => parse(fixtureContent('ipk02-one-arg-rejected'), {}))
      .toThrow(ParseError)
  })

  // ipk03: N/A for ts.hocon (no explicit registry, no collision detection)
  it.skip('ipk03-collision: N/A for ts.hocon (no explicit registry)', () => {
    // ts.hocon delegates to require.resolve; host filesystem doesn't detect
    // two different byte-content registrations for the same (id, file) pair.
    // Per-impl override: IMPL_OVERRIDE_NA.
  })

  // ipk04: registry miss (empty registry) — lookup failure
  it('ipk04-lookup-miss: PackageLookupError on registry miss', () => {
    const registry: Registry = new Map()
    expect(() => parseFixture('ipk04-lookup-miss', registry))
      .toThrow(PackageLookupError)
  })

  // ipk05: required(package(...)) + miss
  it('ipk05-required-miss: PackageLookupError on required + miss', () => {
    const registry: Registry = new Map()
    expect(() => parseFixture('ipk05-required-miss', registry))
      .toThrow(PackageLookupError)
  })

  // ipk06: case-sensitive identifier — "foo/bar" != "Foo/Bar"
  it('ipk06-byte-exact-id-case: PackageLookupError on case-mismatch identifier', () => {
    // Registry has ("Foo/Bar", "x.conf"); fixture uses ("foo/bar", "x.conf")
    const registry: Registry = new Map([
      [registryKey('Foo/Bar', 'x.conf'),
       readPackage('github.com_example_lib_byte/Foo_Bar_x.conf')],
    ])
    expect(() => parseFixture('ipk06-byte-exact-id-case', registry))
      .toThrow(PackageLookupError)
  })

  // ipk07: case-sensitive file — "reference.conf" != "Reference.conf"
  it('ipk07-byte-exact-file-case: PackageLookupError on case-mismatch file', () => {
    // Registry has ("github.com/example/lib", "Reference.conf"); fixture uses lowercase
    const registry: Registry = new Map([
      [registryKey('github.com/example/lib', 'Reference.conf'),
       readPackage('github.com_example_lib_byte/github.com_example_lib_Reference.conf')],
    ])
    expect(() => parseFixture('ipk07-byte-exact-file-case', registry))
      .toThrow(PackageLookupError)
  })

  // ipk08: empty registered content is NOT a lookup failure; contributes {}
  it('ipk08-empty-content: success, empty include contributes {}', () => {
    const registry: Registry = new Map([
      [registryKey('github.com/example/lib', 'empty.conf'), ''],
    ])
    const config = parseFixture('ipk08-empty-content', registry)
    expect(config.get('app')).toBe('host')
  })

  // ipk08 variant: whitespace-only / comment-only registered content also
  // contributes {} — same S3.1 rule as zero-byte (an empty document parses to
  // the empty object; corrected 2026-07-23, xx.hocon E10). Regression guard:
  // the package path used to reject non-zero-byte empty documents.
  it('ipk08 variant: whitespace-only registered content contributes {}', () => {
    const registry: Registry = new Map([
      [registryKey('github.com/example/lib', 'empty.conf'), '   \n\t\n'],
    ])
    const config = parseFixture('ipk08-empty-content', registry)
    expect(config.get('app')).toBe('host')
  })

  it('ipk08 variant: comment-only registered content contributes {}', () => {
    const registry: Registry = new Map([
      [registryKey('github.com/example/lib', 'empty.conf'), '# nothing here\n'],
    ])
    const config = parseFixture('ipk08-empty-content', registry)
    expect(config.get('app')).toBe('host')
  })

  // ipk09: empty string file argument — ParseError (E11 decision 6)
  it('ipk09-file-empty: ParseError on empty file argument', () => {
    expect(() => parse(fixtureContent('ipk09-file-empty'), {}))
      .toThrow(ParseError)
  })

  // ipk10: absolute path file argument — ParseError (E11 decision 6)
  it('ipk10-file-absolute: ParseError on absolute path file argument', () => {
    expect(() => parse(fixtureContent('ipk10-file-absolute'), {}))
      .toThrow(ParseError)
  })

  // ipk11: .. traversal in file argument — ParseError (E11 decision 6)
  it('ipk11-file-traversal: ParseError on .. in file argument', () => {
    expect(() => parse(fixtureContent('ipk11-file-traversal'), {}))
      .toThrow(ParseError)
  })

  // ipk12: backslash in file argument (after HOCON unescape: literal \) — ParseError (E11 decision 6)
  it('ipk12-file-backslash: ParseError on backslash in file argument', () => {
    // The fixture contains package("foo", "x\\y.conf"); after HOCON unescape → "x\y.conf"
    // Validation must run on the unescaped string and reject the literal backslash.
    expect(() => parse(fixtureContent('ipk12-file-backslash'), {}))
      .toThrow(ParseError)
  })

  // ipk13: self-include cycle
  it('ipk13-cycle-self: ResolveError on self-include cycle', () => {
    const selfContent = readPackage('_cycle/ipk13-self.conf')
    const registry: Registry = new Map([
      [registryKey('foo', 'self.conf'), selfContent],
    ])
    expect(() => parseFixture('ipk13-cycle-self', registry))
      .toThrow(ResolveError)
  })

  // ipk14: mutual-include cycle
  it('ipk14-cycle-mutual: ResolveError on mutual-include cycle', () => {
    const registry: Registry = new Map([
      [registryKey('foo', 'a.conf'), readPackage('_cycle/ipk14-a.conf')],
      [registryKey('foo', 'b.conf'), readPackage('_cycle/ipk14-b.conf')],
    ])
    expect(() => parseFixture('ipk14-cycle-mutual', registry))
      .toThrow(ResolveError)
  })

})
