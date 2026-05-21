// Copyright 2026 1o1 Co. Ltd.
// SPDX-License-Identifier: Apache-2.0
//
// tests/deferred-resolution-fixtures.test.ts
// Layer-2 YAML scenario runner for E12 deferred-resolution fixtures.
// Reads YAML scenarios from tests/lightbend/testdata/hocon/deferred-resolution/
// and runs them against the ts.hocon public API.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { Scenario, Source, BuildOp, GetterAssert } from './_helpers/yaml-scenario.js'
import { empty, fromMap } from '../src/value-factory.js'
import { parse, parseStringWithOptions } from '../src/parse.js'
import { NotResolvedError, ResolveError, ConfigError } from '../src/errors.js'
import type { Config } from '../src/config.js'

// ── Paths ─────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = new URL(
  './lightbend/testdata/hocon/deferred-resolution',
  import.meta.url
).pathname

// ── Per-impl skip list ────────────────────────────────────────────────────────
// dr17: E11 package-include — E11 IS shipped in v1.3.0 and is covered by the
// programmatic Layer-1 tests in tests/deferred-resolution.test.ts and
// tests/e11-parser-package.test.ts. The YAML scenario runner cannot register
// packages programmatically (Parser::register_package is not a YAML construct
// per the C4 plan), so this fixture is skipped in the YAML runner only.

const SKIP: Set<string> = new Set([
  'dr17-e11-package-include-deferred.yaml',
])

// ── Source builder ────────────────────────────────────────────────────────────

function buildSource(src: Source): Config {
  if ('parseString' in src) {
    const opts = src.parseOptions ?? {}
    if (opts.resolveSubstitutions === false) {
      return parseStringWithOptions(src.parseString, {
        resolveSubstitutions: false,
        originDescription: opts.originDescription,
      })
    }
    return parse(src.parseString)
  }
  // fromMap
  return fromMap(src.fromMap)
}

// ── Op executor ───────────────────────────────────────────────────────────────

function executeOps(
  build: BuildOp[],
  sources: Record<string, Source>,
): { result: Config; errorAt: number | null; error: unknown } {
  const env: Map<string, Config> = new Map()

  // Pre-build sources (step -1: parseString / fromMap).
  // errorAt for source build failures uses -1 (not in build ops range).
  for (const [alias, src] of Object.entries(sources)) {
    try {
      env.set(alias, buildSource(src))
    } catch (e) {
      return { result: empty(), errorAt: -1, error: e }
    }
  }

  for (let i = 0; i < build.length; i++) {
    const op = build[i]
    try {
      if (op.op === 'take') {
        const s = env.get(op.source)
        if (s === undefined) throw new Error(`Unknown source alias: ${op.source}`)
        env.set(op.as, s)
      } else if (op.op === 'withFallback') {
        const receiver = env.get(op.this)
        const fallback = env.get(op.other)
        if (receiver === undefined) throw new Error(`Unknown alias: ${op.this}`)
        if (fallback === undefined) throw new Error(`Unknown alias: ${op.other}`)
        env.set(op.as, receiver.withFallback(fallback))
      } else if (op.op === 'resolve') {
        const target = env.get(op.this)
        if (target === undefined) throw new Error(`Unknown alias: ${op.this}`)
        const resolved = target.resolve({
          allowUnresolved: op.allowUnresolved ?? false,
          useSystemEnvironment: op.useSystemEnvironment ?? true,
        })
        env.set(op.as, resolved)
      } else if (op.op === 'resolveWith') {
        const receiver = env.get(op.this)
        const srcConfig = env.get(op.source)
        if (receiver === undefined) throw new Error(`Unknown alias: ${op.this}`)
        if (srcConfig === undefined) throw new Error(`Unknown alias: ${op.source}`)
        const resolved = receiver.resolveWith(srcConfig, {
          allowUnresolved: op.allowUnresolved ?? false,
          useSystemEnvironment: op.useSystemEnvironment ?? true,
        })
        env.set(op.as, resolved)
      } else if (op.op === 'extract') {
        const target = env.get(op.this)
        if (target === undefined) throw new Error(`Unknown alias: ${op.this}`)
        const extracted = target.getConfig(op.path)
        env.set(op.as, extracted)
      }
    } catch (e) {
      return { result: empty(), errorAt: i, error: e }
    }
  }

  const result = env.get('result')
  if (result === undefined) throw new Error('Build ops did not produce a "result" alias')
  return { result, errorAt: null, error: null }
}

// ── Getter assertion runner ───────────────────────────────────────────────────

function runGetterAssert(config: Config, ga: GetterAssert): void {
  if (ga.expectError !== undefined) {
    if (ga.expectError === 'NotResolved') {
      expect(() => config.getString(ga.path)).toThrow(NotResolvedError)
    } else if (ga.expectError === 'Missing') {
      expect(config.has(ga.path)).toBe(false)
    } else if (ga.expectError === 'WrongType') {
      expect(() => config.getString(ga.path)).toThrow()
    }
    return
  }

  if (ga.expectString !== undefined) {
    expect(config.getString(ga.path)).toBe(ga.expectString)
  }
  if (ga.expectInt !== undefined) {
    expect(config.getNumber(ga.path)).toBe(ga.expectInt)
  }
  if (ga.expectFloat !== undefined) {
    expect(config.getNumber(ga.path)).toBeCloseTo(ga.expectFloat)
  }
  if (ga.expectBoolean !== undefined) {
    expect(config.getBoolean(ga.path)).toBe(ga.expectBoolean)
  }
  if (ga.expectNull !== undefined) {
    const obj = config.toObject()
    const val = ga.path.split('.').reduce((o: unknown, k) => {
      if (o !== null && typeof o === 'object') return (o as Record<string, unknown>)[k]
      return undefined
    }, obj as unknown)
    expect(val).toBeNull()
  }
  if (ga.expectArray !== undefined) {
    expect(config.getList(ga.path)).toEqual(ga.expectArray)
  }
}

// ── Error category matcher ────────────────────────────────────────────────────

function matchesCategory(err: unknown, category: string): boolean {
  if (category === 'ResolveError') return err instanceof ResolveError
  // ts.hocon maps CycleError to ResolveError (no separate CycleError class).
  if (category === 'CycleError') return err instanceof ResolveError
  if (category === 'NotResolved') return err instanceof NotResolvedError
  if (category === 'TypeError' || category === 'ParseError') return err instanceof ConfigError || err instanceof Error
  return err instanceof Error
}

// ── Main fixture runner ───────────────────────────────────────────────────────

if (!existsSync(FIXTURE_DIR)) {
  describe('deferred-resolution YAML fixtures', () => {
    it.skip('fixture dir not found — run `make testdata` first', () => {})
  })
} else {
  const entries = readdirSync(FIXTURE_DIR).sort().filter(f => f.endsWith('.yaml'))

  describe('deferred-resolution YAML fixtures', () => {
    for (const filename of entries) {
      const filePath = join(FIXTURE_DIR, filename)
      const raw = readFileSync(filePath, 'utf-8')
      const scenario = loadYaml(raw) as Scenario | null

      if (scenario === null) continue

      const testName = `${filename}: ${scenario.description}`

      if (SKIP.has(filename)) {
        it.skip(`${testName} (ts.hocon: E11 not yet implemented)`, () => {})
        continue
      }

      it(testName, () => {
        const { result, errorAt, error } = executeOps(scenario.build, scenario.sources)

        if (scenario.expect.outcome === 'error') {
          // Must have errored somewhere
          expect(error, `Expected an error but succeeded`).not.toBeNull()

          if (scenario.expect.errorCategory !== undefined) {
            expect(
              matchesCategory(error, scenario.expect.errorCategory),
              `Expected error category ${scenario.expect.errorCategory}, got ${String(error)}`
            ).toBe(true)
          }

          if (scenario.expect.errorAt !== undefined) {
            expect(errorAt).toBe(scenario.expect.errorAt)
          }

          if (scenario.expect.errorContains !== undefined) {
            const msg = error instanceof Error ? error.message : String(error)
            expect(msg).toContain(scenario.expect.errorContains)
          }
          return
        }

        // outcome === 'success'
        expect(error, `Unexpected error: ${String(error)}`).toBeNull()

        if (scenario.expect.isResolved !== undefined) {
          expect(result.isResolved()).toBe(scenario.expect.isResolved)
        }

        if (scenario.expect.json !== undefined) {
          const expectedObj = JSON.parse(scenario.expect.json)
          const gotStr = result._renderJSONForTest()
          const gotObj = JSON.parse(gotStr)
          expect(gotObj).toEqual(expectedObj)
        }

        if (scenario.expect.getter !== undefined) {
          for (const ga of scenario.expect.getter) {
            runGetterAssert(result, ga)
          }
        }
      })
    }
  })
}
