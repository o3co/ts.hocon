// tests/include-package-default-resolver.test.ts
//
// The default `include package(...)` resolver, and the require-selection logic
// behind it.
//
// Every other include-package test injects a custom `packageResolver`, so the
// real one — and the bundler-shape guard it depends on — had no unit coverage at
// all. That is the code that broke in 1.10.0 (CJS entrypoints threw at load) and
// again in its first fix (ESM package includes stopped resolving), so it gets
// tests here as well as in the built-artifact smoke gate.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { parse, parseAsync } from '../src/parse.js'
import { pickRequire } from '../src/internal/resolver/include-loader.js'
import { PackageLookupError } from '../src/errors.js'

let dir: string

beforeAll(() => {
  // A real node_modules layout, so resolution runs through require.resolve
  // exactly as a consumer's would.
  dir = mkdtempSync(join(tmpdir(), 'hocon-pkg-'))
  const pkg = join(dir, 'node_modules', 'fixture-pkg')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '1.0.0' }))
  writeFileSync(join(pkg, 'reference.conf'), 'included = from-package\nnested { a = 1 }\n')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('include package(...) via the default resolver', () => {
  it('resolves and merges a package file', () => {
    const cfg = parse('include package("fixture-pkg", "reference.conf")\nlocal = ${included}\n', { baseDir: dir })
    expect(cfg.getString('included')).toBe('from-package')
    expect(cfg.getNumber('nested.a')).toBe(1)
    expect(cfg.getString('local')).toBe('from-package')
  })

  it('resolves the same way on the async path', async () => {
    const cfg = await parseAsync('include package("fixture-pkg", "reference.conf")\n', { baseDir: dir })
    expect(cfg.getString('included')).toBe('from-package')
  })

  it('reports a miss as PackageLookupError, naming where it looked', () => {
    let thrown: unknown
    try {
      parse('include package("no-such-pkg", "reference.conf")\n', { baseDir: dir })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(PackageLookupError)
    expect(String((thrown as Error).message)).toContain(dir)
  })
})

describe('pickRequire — the bundler-shape guard', () => {
  it('takes a real require, which has .resolve', () => {
    const real = { resolve: (id: string) => `resolved:${id}` } as unknown as NodeRequire
    expect(pickRequire(real, import.meta.url)).toBe(real)
  })

  // The ESM regression: esbuild rewrites a bare `require` into a Proxy over a
  // function. `typeof` says "function", so a typeof guard picked it, and every
  // package include then failed on `undefined.resolve`.
  it('rejects the esbuild ESM shim, whose typeof is function but has no .resolve', () => {
    const esbuildShim = new Proxy(function () {}, {
      get: (target, prop) => (prop === 'resolve' ? undefined : Reflect.get(target, prop)),
    })
    expect(typeof esbuildShim).toBe('function')

    const picked = pickRequire(esbuildShim, import.meta.url)
    expect(picked).not.toBe(esbuildShim)
    expect(typeof picked.resolve).toBe('function')
  })

  it('falls back to a cwd anchor when import.meta.url is absent', () => {
    // The CJS bundle rewrites `import.meta` to `{}`. Passing that url straight
    // to createRequire is what threw ERR_INVALID_ARG_VALUE at load in 1.10.0.
    const picked = pickRequire(undefined, undefined)
    expect(typeof picked.resolve).toBe('function')
    // Still resolves, because callers always pass explicit `paths`.
    expect(picked.resolve('fixture-pkg/reference.conf', { paths: [dir] })).toContain('reference.conf')
  })

  it('uses the given module url as the anchor when there is one', () => {
    const picked = pickRequire(undefined, pathToFileURL(join(dir, 'anchor.js')).href)
    expect(picked.resolve('fixture-pkg/reference.conf')).toContain('reference.conf')
  })
})
