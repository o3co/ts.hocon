/**
 * Cross-impl regression tests for go.hocon#128 — include-child
 * `${?ENV_VAR}` env-with-default pattern silently erases the prior
 * duplicate-key assignment when the env var is unset.
 *
 * Pattern under test (canonical Lightbend reference.conf idiom):
 *
 *   registry {
 *     instance-id = "localhost"
 *     instance-id = ${?REGISTRY_INSTANCE_ID}
 *   }
 *
 * Spec basis: S7.1 (later non-object overrides earlier) +
 * S13.2/S13.11 (optional substitution undefined → field not created,
 * i.e. the second assignment "disappears", leaving the prior) +
 * S14b.2 (included keys merge per duplicate-key rules — include
 * boundary is invisible to the merge semantics).
 *
 * go.hocon v1.4.1–v1.5.2 lost the include-child's `priorValues` across
 * a separate lenient-resolve pass; ts.hocon merges include content into
 * the parent's tree at structure-build time (`deepMergeResObjInto`
 * preserves both fields and priorValues), so a single substitution-
 * resolve pass over the merged tree never strips the prior. These tests
 * pin that behaviour so a future refactor to a multi-pass shape can't
 * silently regress.
 *
 * Hermeticity: env is injected via `ParseOptions.env`; `process.env` is
 * never read or mutated. Matches the convention documented in
 * `tests/env-var-list.test.ts` ("parse(input, { env }) ONLY").
 */
import { describe, expect, it } from 'vitest'
import { parse, parseStringWithOptions, defaultParseOptions } from '../src/index.js'
import type { PackageResolver } from '../src/index.js'

describe('go.hocon#128 cross-impl — include-child env-with-default preserves prior', () => {
  const buildParseWithFiles = (files: Map<string, string>, env: Record<string, string>) => {
    const readFileSync = (p: string) => {
      const content = files.get(p)
      if (content === undefined) {
        throw Object.assign(new Error(`enoent: ${p}`), { code: 'ENOENT' })
      }
      return content
    }
    return (input: string) => parse(input, { readFileSync, env })
  }

  it('include "file": env unset → prior in-source default is retained', () => {
    const files = new Map<string, string>([
      [
        '/virtual/child.conf',
        'registry {\n  instance-id = "localhost"\n  instance-id = ${?GH128_TS_FILE_UNSET}\n}\n',
      ],
    ])
    const cfg = buildParseWithFiles(files, {})('include "/virtual/child.conf"\n')
    expect(cfg.getString('registry.instance-id')).toBe('localhost')
  })

  it('include "file": env set → env value overrides prior default', () => {
    const files = new Map<string, string>([
      [
        '/virtual/child.conf',
        'registry {\n  instance-id = "localhost"\n  instance-id = ${?GH128_TS_FILE_SET}\n}\n',
      ],
    ])
    const cfg = buildParseWithFiles(files, { GH128_TS_FILE_SET: 'from-env' })(
      'include "/virtual/child.conf"\n',
    )
    expect(cfg.getString('registry.instance-id')).toBe('from-env')
  })

  it('include package(...): env unset → prior in-source default is retained', () => {
    const resolver: PackageResolver = () => '/fake/registry/issue128/reference.conf'
    const readFileSync = (_p: string) =>
      'registry {\n  instance-id = "localhost"\n  instance-id = ${?GH128_TS_PKG_UNSET}\n}\n'
    const cfg = parse(
      'include package("github.com/o3co/ts.hocon/test/issue128-unset", "reference.conf")\n',
      { packageResolver: resolver, readFileSync, env: {} },
    )
    expect(cfg.getString('registry.instance-id')).toBe('localhost')
  })

  it('include package(...): env set → env value overrides prior default', () => {
    const resolver: PackageResolver = () => '/fake/registry/issue128/reference.conf'
    const readFileSync = (_p: string) =>
      'registry {\n  instance-id = "localhost"\n  instance-id = ${?GH128_TS_PKG_SET}\n}\n'
    const cfg = parse(
      'include package("github.com/o3co/ts.hocon/test/issue128-set", "reference.conf")\n',
      { packageResolver: resolver, readFileSync, env: { GH128_TS_PKG_SET: 'from-pkg-env' } },
    )
    expect(cfg.getString('registry.instance-id')).toBe('from-pkg-env')
  })

  it('include package(...): deferred resolve path also retains prior when env unset', () => {
    const resolver: PackageResolver = () => '/fake/registry/issue128/reference.conf'
    const readFileSync = (_p: string) =>
      'registry {\n  instance-id = "localhost"\n  instance-id = ${?GH128_TS_PKG_DEFERRED}\n}\n'
    const opts = {
      ...defaultParseOptions(),
      packageResolver: resolver,
      readFileSync,
      env: {},
      resolveSubstitutions: false,
    }
    const unresolved = parseStringWithOptions(
      'include package("github.com/o3co/ts.hocon/test/issue128-deferred", "reference.conf")\n',
      opts,
    )
    const cfg = unresolved.resolve()
    expect(cfg.getString('registry.instance-id')).toBe('localhost')
  })
})
