// tests/resolver-include-cov.test.ts
//
// Additional coverage for resolver include relativization paths (ts.hocon#49).
// Targets uncovered lines per codecov/patch report on PR #47:
//
//   include-loader.ts: 305-344 (loadPackageAsync), 412 (loadSingleAsync empty-content)
//   structure-builder.ts: 247-249 (relativizeSubstPaths isAppend branch),
//                         259-260 (relativizeSubstPaths HoconValue array branch)
//   substitution-resolver.ts: 286-288 (listSuffix + useSystemEnvironment=false),
//                             399-402 (nonSep.length === 0 in resolveConcat)
//   types.ts: 152 (mergeUnresolved fallback.priorValues carry-through)
//   utils.ts: 30 (lookupPath returning undefined for non-ResObj intermediate)
//
// HOCON syntax uses ${...} substitution placeholders inside regular string literals.
// The no-template-curly-in-string ESLint rule is disabled for this file because all
// ${...} patterns in string literals here are intentional HOCON syntax, not accidental
// template literal omissions.
/* eslint-disable no-template-curly-in-string */

import { describe, expect, it } from 'vitest'
import { ResolveError } from '../src/errors.js'
import type { PackageResolver } from '../src/index.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { buildTree, resolve, resolveAsync, resolveTree } from '../src/internal/resolver/resolver.js'
import { makeResObj, mergeUnresolved, setPrior } from '../src/internal/resolver/types.js'
import { lookupPath } from '../src/internal/resolver/utils.js'
import type { HoconValue } from '../src/value.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveStr(
  input: string,
  env: Record<string, string> = {},
  files: Record<string, string> = {},
): HoconValue {
  const ast = parseTokens(tokenize(input))
  const hasFiles = Object.keys(files).length > 0
  return resolve(ast, {
    env,
    baseDir: hasFiles ? '/' : undefined,
    readFileSync: (p: string) => {
      const content = files[p]
      if (content !== undefined) return content
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
    },
  })
}

async function resolveAsyncStr(
  input: string,
  env: Record<string, string> = {},
  files: Record<string, string> = {},
): Promise<HoconValue> {
  const ast = parseTokens(tokenize(input))
  const hasFiles = Object.keys(files).length > 0
  return resolveAsync(ast, {
    env,
    baseDir: hasFiles ? '/' : undefined,
    readFileSync: (p: string) => {
      const content = files[p]
      if (content !== undefined) return content
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
    },
    readFile: async (p: string) => {
      const content = files[p]
      if (content !== undefined) return content
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
    },
  })
}

function obj(v: HoconValue): Map<string, HoconValue> {
  if (v.kind !== 'object') throw new Error('expected object')
  return v.fields
}

// ---------------------------------------------------------------------------
// include-loader.ts line 172: circular include detection in load() for explicit extensions
//
// The circular check at line 171-172 fires specifically when an include uses an
// explicit extension (.conf, .json, .properties) and the resolved absolute path
// is already in the includeStack. The existing parse.test.ts circular tests use
// bare includes (probed via loadSingle), which exercise line 354 in loadSingle
// rather than line 172 in load(). This section covers the explicit-extension path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// include-loader.ts line 75: validatePackageIdentifier — empty identifier throws
//
// validatePackageIdentifier throws ParseError when identifier is empty string.
// This is exercised via the loadPackage / loadPackageAsync path when the
// include package() directive has an empty identifier argument.
// ---------------------------------------------------------------------------

describe('include-loader validatePackageIdentifier — empty identifier (line 75)', () => {
  it('sync loadPackage: throws ParseError for empty identifier', () => {
    // include package("", "file.conf") → validatePackageIdentifier("") → line 75 throws.
    // Pin the error class + message so an unrelated failure can't satisfy this test.
    expect(() =>
      buildTree(parseTokens(tokenize('include package("", "file.conf")')), {
        env: {},
        baseDir: undefined,
        packageResolver: () => '/fake/path',
        readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      }),
    ).toThrow(/include package: identifier argument must be non-empty/)
  })
})

describe('include-loader load() circular detection — explicit extension (line 172)', () => {
  it('detects circular include when explicit .conf extension is used', () => {
    // a.conf: include "a.conf"  — self-referential with explicit extension.
    // First call: load("a.conf") → absPath=/a.conf not in stack → loadSingle adds it.
    // Inner include "a.conf" → load("a.conf") → absPath=/a.conf IS in stack → line 172.
    const files: Record<string, string> = {
      '/a.conf': 'include "a.conf"\nval = 1',
    }
    expect(() =>
      resolveStr('include "a.conf"', {}, files),
    ).toThrow(ResolveError)
  })

  it('detects circular include in a chain with explicit extensions', () => {
    // a.conf → b.conf → a.conf — three-file cycle, all explicit extensions.
    const files: Record<string, string> = {
      '/a.conf': 'include "b.conf"\na = 1',
      '/b.conf': 'include "a.conf"\nb = 2',
    }
    expect(() =>
      resolveStr('include "a.conf"', {}, files),
    ).toThrow(ResolveError)
  })
})

// ---------------------------------------------------------------------------
// include-loader.ts lines 305-344: loadPackageAsync
//
// loadPackageAsync is the async variant of loadPackage. It is exercised via
// resolveAsync() when the AST contains an include package(...) directive.
// All existing tests use the sync resolve() path; this section adds async coverage.
// ---------------------------------------------------------------------------

describe('loadPackageAsync — include package() via resolveAsync', () => {
  it('loads a package include asynchronously via custom packageResolver', async () => {
    // resolveAsync triggers loadPackageAsync (structure-builder.buildAsync → applyFieldAsync →
    // this.loader.loadPackageAsync). Custom packageResolver returns a fixed path.
    const resolver: PackageResolver = (_id, _file, _includingFile, _baseDir) =>
      '/fake/pkg/ref.conf'
    const files: Record<string, string> = {
      '/fake/pkg/ref.conf': 'from_pkg = "hello"',
    }
    const v = await resolveAsync(parseTokens(tokenize('include package("my-lib", "ref.conf")')), {
      env: {},
      baseDir: undefined,
      packageResolver: resolver,
      readFileSync: (p: string) => {
        const content = files[p]
        if (content !== undefined) return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
    expect(obj(v).get('from_pkg')).toEqual({ kind: 'scalar', raw: 'hello', valueType: 'string' })
  })

  it('loadPackageAsync: empty registered content (zero bytes) contributes {} (ipk08)', async () => {
    // Lines 339: content.length === 0 → return makeResObj()
    const resolver: PackageResolver = () => '/fake/pkg/empty.conf'
    const v = await resolveAsync(parseTokens(tokenize('a = 1\ninclude package("foo", "empty.conf")')), {
      env: {},
      baseDir: undefined,
      packageResolver: resolver,
      readFileSync: (p: string) => {
        if (p === '/fake/pkg/empty.conf') return ''  // zero bytes
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    // empty package file contributes no additional keys
  })

  it('loadPackageAsync: uses readFile when provided (async read path)', async () => {
    // Lines 332-334: const read = readFile ? async (p) => readFile(p) : async (p) => readFileSync(p)
    // This exercises the readFile branch (line 332-333).
    const resolver: PackageResolver = () => '/async/pkg/data.conf'
    const filesAsync: Record<string, string> = {
      '/async/pkg/data.conf': 'pkg_val = 42',
    }
    const v = await resolveAsync(parseTokens(tokenize('include package("async-lib", "data.conf")')), {
      env: {},
      baseDir: undefined,
      packageResolver: resolver,
      readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      readFile: async (p: string) => {
        const content = filesAsync[p]
        if (content !== undefined) return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
    expect(obj(v).get('pkg_val')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
  })

  it('loadPackageAsync: detects circular package include', async () => {
    // Lines 311-316: cycleKey already in includeStack → ResolveError
    const resolver: PackageResolver = () => '/fake/pkg/self.conf'
    const files: Record<string, string> = {
      // self.conf includes itself → cycle
      '/fake/pkg/self.conf': 'include package("my-lib", "self.conf")\nval = 1',
    }
    await expect(
      resolveAsync(parseTokens(tokenize('include package("my-lib", "self.conf")')), {
        env: {},
        baseDir: undefined,
        packageResolver: resolver,
        readFileSync: (p: string) => {
          const content = files[p]
          if (content !== undefined) return content
          throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        },
      }),
    ).rejects.toThrow(ResolveError)
  })

  it('loadPackageAsync: relativizes nested include within package async load', async () => {
    // Lines 344: onBuildResObjAsync is called with updated opts.
    // The package file contains a substitution that should resolve within that file's scope.
    const resolver: PackageResolver = () => '/fake/pkg/nested.conf'
    const files: Record<string, string> = {
      '/fake/pkg/nested.conf': 'x = 10\ny = ${x}',
    }
    const v = await resolveAsync(parseTokens(tokenize('include package("lib", "nested.conf")')), {
      env: {},
      baseDir: undefined,
      packageResolver: resolver,
      readFileSync: (p: string) => {
        const content = files[p]
        if (content !== undefined) return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    expect(obj(v).get('y')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
  })

  it('loadPackage (sync) circular package include detected (line 265)', () => {
    // Set up a real circular package include via mock readFileSync:
    //   top-level: include package("lib", "deep.conf")
    //   /fake/pkg/deep.conf: include package("lib", "deep.conf")  (self-reference)
    // The second loadPackage call sees the cycleKey already in includeStack
    // and throws — verified through observable behavior, not internal
    // cycleKey serialisation (which could change without breaking semantics).
    const resolver: PackageResolver = () => '/fake/pkg/deep.conf'
    const fakeFiles: Record<string, string> = {
      '/fake/pkg/deep.conf': 'include package("lib", "deep.conf")',
    }
    const readFileSync = (path: string): string => {
      const content = fakeFiles[path]
      if (content !== undefined) return content
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    expect(() =>
      buildTree(parseTokens(tokenize('include package("lib", "deep.conf")')), {
        env: {},
        baseDir: undefined,
        packageResolver: resolver,
        readFileSync,
      }),
    ).toThrow(/circular|cycle|already including/i)
  })

  it('loadPackage (sync) depth limit exceeded (line 272)', () => {
    // Pre-seed includeStack with 50 entries to trigger the depth-limit guard
    // in loadPackage() at line 271-272 (includeStack.length >= 50 → throw).
    // The guard runs BEFORE reading the file, so we never need a valid file.
    const resolver: PackageResolver = () => '/fake/pkg/deep.conf'
    const deepStack = Array.from({ length: 50 }, (_, i) => `entry-${i}`)
    expect(() =>
      buildTree(parseTokens(tokenize('include package("lib", "deep.conf")')), {
        env: {},
        baseDir: undefined,
        packageResolver: resolver,
        includeStack: deepStack,
        readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      }),
    ).toThrow(ResolveError)
  })

  it('loadPackageAsync depth limit exceeded (line 319)', async () => {
    // Same as above but for the async variant.
    const resolver: PackageResolver = () => '/fake/pkg/deep.conf'
    const deepStack = Array.from({ length: 50 }, (_, i) => `entry-${i}`)
    await expect(
      resolveAsync(parseTokens(tokenize('include package("lib", "deep.conf")')), {
        env: {},
        baseDir: undefined,
        packageResolver: resolver,
        includeStack: deepStack,
        readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      }),
    ).rejects.toThrow(ResolveError)
  })
})

// ---------------------------------------------------------------------------
// include-loader.ts lines 240 and 245: loadAsync no-extension probing paths
//
// loadAsync probes .properties, .json, .conf extensions when no extension is given.
// Line 240: foundAny = true (set when any extension probe finds a file).
// Line 245: !foundAny && required → throw (required bare include with no file found).
// ---------------------------------------------------------------------------

describe('loadAsync — no-extension probing (lines 240, 245)', () => {
  it('async bare include finds .conf file and sets foundAny=true (line 240)', async () => {
    // 'include "base"' (no extension) → async probe finds /base.conf → foundAny=true (line 240).
    const v = await resolveAsyncStr('include "base"\na = 1', {}, {
      '/base.conf': 'from_base = true',
    })
    expect(obj(v).get('from_base')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('required async bare include not found throws ResolveError (line 245)', async () => {
    // 'include required("missing")' (no extension) → none of .properties/.json/.conf found
    // → foundAny=false, required=true → line 245 throws.
    await expect(
      resolveAsync(parseTokens(tokenize('include required("missing")')), {
        env: {},
        baseDir: '/',
        readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
        readFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      }),
    ).rejects.toThrow(ResolveError)
  })
})

// ---------------------------------------------------------------------------
// include-loader.ts line 412: loadSingleAsync empty-content carve-out
//
// When an async include resolves to a file whose tokens have no content tokens
// (empty, whitespace-only, comment-only), loadSingleAsync returns makeResObj()
// instead of erroring (Lightbend-compat #105). The sync path is covered by
// issue105-empty-include.test.ts; this section adds async coverage.
// ---------------------------------------------------------------------------

describe('loadSingleAsync — empty/comment-only include is no-op (async path, #105)', () => {
  it('whitespace-only async include contributes empty config', async () => {
    const v = await resolveAsyncStr('a = 1\ninclude "empty.conf"', {}, {
      '/empty.conf': '   \n\t  ',
    })
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    // whitespace-only include contributes nothing extra
  })

  it('comment-only async include contributes empty config', async () => {
    const v = await resolveAsyncStr('b = 2\ninclude "comments.conf"', {}, {
      '/comments.conf': '# only a comment\n// another comment\n',
    })
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
  })

  it('empty async include (zero bytes) contributes empty config', async () => {
    const v = await resolveAsyncStr('c = 3\ninclude "empty.conf"', {}, {
      '/empty.conf': '',
    })
    expect(obj(v).get('c')).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
  })

  it('non-empty async include is still parsed normally (regression guard)', async () => {
    const v = await resolveAsyncStr('include "data.conf"\na = 1', {}, {
      '/data.conf': 'b = 99',
    })
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', raw: '99', valueType: 'number' })
  })
})

// ---------------------------------------------------------------------------
// structure-builder.ts lines 247-249: relativizeSubstPaths isAppend branch
//
// When an include directive appears inside a nested scope, the structure builder
// calls relativizeResObj on the included content. If the included file contains
// a `+=` (append placeholder), relativizeSubstPaths must recurse into both
// `val.existing` and `val.elem`. Lines 247-249 handle this branch.
// ---------------------------------------------------------------------------

describe('structure-builder relativizeSubstPaths — isAppend branch (lines 247-249)', () => {
  it('relativizes += (append) inside a nested include', () => {
    // 'items += 5' inside 'outer { include "inner.conf" }' creates an AppendPlaceholder.
    // After loading, relativizeResObj walks the included obj's fields → hits the
    // AppendPlaceholder → exercises the isAppend branch (lines 247-249).
    // 'items' starts from empty array (no prior in the included file itself),
    // and after relativization resolves as outer.items = [5].
    const v = resolveStr('outer { include "inner.conf" }', {}, {
      '/inner.conf': 'items += 5',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    const items = outerVal.fields.get('items')
    expect(items?.kind).toBe('array')
    if (items?.kind === 'array') {
      expect(items.items).toHaveLength(1)
      expect(items.items[0]).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
    }
  })

  it('relativizes += with prior value inside a nested include', () => {
    // The include also sets the base list so the append has a non-empty prior.
    // Both val.existing (the prior ${?items} from desugaring) and val.elem are relativized.
    const v = resolveStr('outer { include "inner.conf" }', {}, {
      '/inner.conf': 'items = [1, 2]\nitems += 3',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    const items = outerVal.fields.get('items')
    expect(items?.kind).toBe('array')
    if (items?.kind === 'array') {
      expect(items.items).toHaveLength(3)
      expect(items.items[0]).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
      expect(items.items[2]).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
    }
  })

  it('relativizes += with substitution in appended element inside nested include (async)', async () => {
    // Exercises the async path: applyFieldAsync → relativizeResObj → isAppend branch.
    const v = await resolveAsyncStr('outer { include "inner.conf" }', {}, {
      '/inner.conf': 'base = 10\nitems += ${base}',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    const items = outerVal.fields.get('items')
    expect(items?.kind).toBe('array')
    if (items?.kind === 'array') {
      expect(items.items).toHaveLength(1)
      expect(items.items[0]).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    }
  })
})

// ---------------------------------------------------------------------------
// structure-builder.ts lines 259-260: relativizeSubstPaths HoconValue array branch
//
// Per the comment in the source, "HoconValue arrays may contain substitutions
// inside items (shouldn't happen in practice since arrays are built from
// astToResolverValue, but be safe)". The safety guard walks array items.
// This is exercised when a relativized ResObj contains an array-typed field
// whose items are substitution placeholders — which can happen when an array
// is set to a concat containing a substitution.
//
// NOTE: The comment "shouldn't happen in practice" is accurate: astToResolverValue
// wraps array items as HoconValues directly, so subst items would only appear
// through unusual construction. The path is a defensive guard. Testing it via the
// public API is not straightforward without internal setup. The section below
// exercises the reachable public-facing behaviour (array with subst items inside
// a nested include) to drive coverage through the guard.
// ---------------------------------------------------------------------------

describe('structure-builder relativizeSubstPaths — HoconValue array branch (lines 259-260)', () => {
  it('array in nested include with substitution element resolves correctly', () => {
    // An array whose items contain a substitution reference. Inside a nested include,
    // relativizeResObj walks the ResObj fields; an array-valued field triggers the
    // HoconValue array branch in relativizeSubstPaths (lines 258-262).
    // The substitution ${x} inside the array list concat will be relativized to outer.x.
    const v = resolveStr('outer { include "inner.conf" }', {}, {
      '/inner.conf': 'x = 99\nlist = [${x}]',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outerVal.fields.get('x')).toEqual({ kind: 'scalar', raw: '99', valueType: 'number' })
    const list = outerVal.fields.get('list')
    expect(list?.kind).toBe('array')
    if (list?.kind === 'array') {
      expect(list.items[0]).toEqual({ kind: 'scalar', raw: '99', valueType: 'number' })
    }
  })

  it('multi-level include: inner file includes another file in nested scope', () => {
    // Multi-level includes: outer includes mid.conf which includes inner.conf.
    // Substitutions in inner.conf are relativized through two nesting levels.
    const v = resolveStr('top { include "mid.conf" }', {}, {
      '/mid.conf': 'mid_val = 7\ninclude "inner.conf"',
      '/inner.conf': 'inner_val = ${mid_val}',
    })
    const topVal = obj(v).get('top')
    if (topVal?.kind !== 'object') throw new Error('expected top to be object')
    // mid_val defined in mid.conf, inner_val references it from inner.conf
    expect(topVal.fields.get('mid_val')).toEqual({ kind: 'scalar', raw: '7', valueType: 'number' })
    expect(topVal.fields.get('inner_val')).toEqual({ kind: 'scalar', raw: '7', valueType: 'number' })
  })
})

// ---------------------------------------------------------------------------
// Async include path relativization
// ---------------------------------------------------------------------------

describe('async include path relativization', () => {
  it('relativizes substitution paths in nested async include', async () => {
    const v = await resolveAsyncStr('outer { include "inner.conf" }', {}, {
      '/inner.conf': 'x = 1\ny = ${x}',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outerVal.fields.get('x')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    expect(outerVal.fields.get('y')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('relativizes env var fallback in async include (bare path, with prefix stripping)', async () => {
    // ${MY_VAR} inside 'outer { include "inner.conf" }' → relativized to outer.MY_VAR;
    // env lookup tries fully-qualified "outer.MY_VAR" first, then bare "MY_VAR".
    // Test: bare key present in env → resolved via prefix-stripped fallback.
    const v = await resolveAsyncStr('outer { include "inner.conf" }', { MY_VAR: 'from-env' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outerVal.fields.get('val')).toEqual({ kind: 'scalar', raw: 'from-env', valueType: 'string' })
  })

  it('relativizes env var fallback in async include (fully-qualified key wins)', async () => {
    // When both 'outer.MY_VAR' and 'MY_VAR' are in env, the fully-qualified key wins.
    const v = await resolveAsyncStr('outer { include "inner.conf" }', {
      'outer.MY_VAR': 'qualified',
      MY_VAR: 'bare',
    }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outerVal.fields.get('val')).toEqual({ kind: 'scalar', raw: 'qualified', valueType: 'string' })
  })

  it('multi-level async includes: file includes another file in nested scope', async () => {
    const v = await resolveAsyncStr('top { include "mid.conf" }', {}, {
      '/mid.conf': 'base = 5\ninclude "leaf.conf"',
      '/leaf.conf': 'derived = ${base}',
    })
    const topVal = obj(v).get('top')
    if (topVal?.kind !== 'object') throw new Error('expected top to be object')
    expect(topVal.fields.get('base')).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
    expect(topVal.fields.get('derived')).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
  })
})

// ---------------------------------------------------------------------------
// substitution-resolver.ts lines 286-288:
// listSuffix + useSystemEnvironment=false optional/allowUnresolved paths
//
// When useSystemEnvironment is false and the substitution has listSuffix=true,
// the resolver skips env lookup and hits the else-if branch:
//   286: if (s.optional) return undefined
//   287: if (this.opts.allowUnresolved) return s as unknown as HoconValue
//   288: throw ResolveError(...)
//
// These lines are exercised via buildTree + resolveTree with explicit opts.
// ---------------------------------------------------------------------------

describe('substitution-resolver listSuffix + useSystemEnvironment=false (lines 286-288)', () => {
  it('optional listSuffix subst resolves to undefined (omitted) when env disabled (line 286)', () => {
    // ${?MY_LIST[]} with useSystemEnvironment=false → optional → field omitted.
    const ast = parseTokens(tokenize('x = ${?MY_LIST[]}'))
    const tree = buildTree(ast, {
      env: {},
      baseDir: undefined,
      readFileSync: () => { throw new Error('no fs') },
    })
    const result = resolveTree(tree, {
      env: {},
      baseDir: undefined,
      readFileSync: () => { throw new Error('no fs') },
      useSystemEnvironment: false,
    })
    // optional → resolves to undefined → field absent
    expect(obj(result).has('x')).toBe(false)
  })

  it('required listSuffix subst throws when env disabled (line 288)', () => {
    // ${MY_LIST[]} with useSystemEnvironment=false → required → ResolveError
    const ast = parseTokens(tokenize('x = ${MY_LIST[]}'))
    const tree = buildTree(ast, {
      env: {},
      baseDir: undefined,
      readFileSync: () => { throw new Error('no fs') },
    })
    expect(() =>
      resolveTree(tree, {
        env: {},
        baseDir: undefined,
        readFileSync: () => { throw new Error('no fs') },
        useSystemEnvironment: false,
      }),
    ).toThrow(ResolveError)
  })

  it('required listSuffix subst with allowUnresolved returns placeholder (line 287)', () => {
    // ${MY_LIST[]} with useSystemEnvironment=false + allowUnresolved=true → SubstPlaceholder as HoconValue
    const ast = parseTokens(tokenize('x = ${MY_LIST[]}'))
    const tree = buildTree(ast, {
      env: {},
      baseDir: undefined,
      readFileSync: () => { throw new Error('no fs') },
    })
    const result = resolveTree(tree, {
      env: {},
      baseDir: undefined,
      readFileSync: () => { throw new Error('no fs') },
      useSystemEnvironment: false,
      allowUnresolved: true,
    })
    // Under allowUnresolved the field exists (placeholder returned), not absent
    expect(obj(result).has('x')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// substitution-resolver.ts lines 399-402:
// nonSep.length === 0 in resolveConcat
//
// When a concat node contains multiple optional substitutions all resolving to
// undefined, `resolved` contains only the parser-inserted separator scalars.
// `nonSep` (resolved filtered by separatorValues) is therefore empty. The code
// concatenates the raw separator scalars and returns a string scalar.
//
// Minimal reproducer: 'x = ${?a} ${?b} ${?c}' where a, b, c are all absent.
// Parser produces: [subst_a, space_sep_1, subst_b, space_sep_2, subst_c].
// After resolution: subst_a → undefined, subst_b → undefined, subst_c → undefined.
// resolved = [space_sep_1, space_sep_2], nonSep = [].
// resolved.length === 2 > 1, so early-return (line 389) is not taken.
// Lines 399-402 concatenate to ' ' (two spaces become "  " after join('') on
// two single-space separator raws, but depending on raw values they join as ' ').
// ---------------------------------------------------------------------------

describe('resolveConcat — all-separator resolved list (lines 399-402)', () => {
  it('three-way optional-unset concat reduces to separator scalar', () => {
    // All three optional substitutions are absent → only separator scalars remain.
    // nonSep.length === 0 → lines 399-402 fire → string concat of separator raws.
    const v = resolveStr('x = ${?a} ${?b} ${?c}')
    // The result is a scalar (the concatenated separator whitespace, not undefined),
    // because resolved.length === 2 (two space separators) so the "return undefined"
    // at line 388 is NOT taken. This is consistent with Lightbend behaviour where
    // "concat of only whitespace-separators" yields the whitespace string.
    const x = obj(v).get('x')
    expect(x?.kind).toBe('scalar')
    if (x?.kind === 'scalar') {
      expect(x.valueType).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// types.ts line 152: mergeUnresolved — fallback.priorValues carry-through
//
// mergeUnresolved iterates fallback.priorValues (line 151-153) to seed the
// result's priorValues. This branch is only exercised when the fallback ResObj
// itself has priorValues — i.e. the fallback was already produced by a merge
// that captured priors. The existing tests in resolver-merge-unresolved.test.ts
// do not place priorValues on the fallback (they use setPrior on the receiver).
// ---------------------------------------------------------------------------

describe('mergeUnresolved — fallback.priorValues carry-through (types.ts line 152)', () => {
  it('priorValues from fallback are seeded into result when not overridden by receiver', () => {
    // fallback has a priorValue at 'a'; receiver does not touch 'a'.
    // After mergeUnresolved, result.priorValues should include fallback's 'a' prior.
    const fallback = makeResObj()
    fallback.fields.set('a', { kind: 'scalar', raw: 'fallback-current', valueType: 'string' })
    setPrior(fallback, 'a', { kind: 'scalar', raw: 'fallback-prior', valueType: 'string' })

    const receiver = makeResObj()
    receiver.fields.set('b', { kind: 'scalar', raw: 'receiver-only', valueType: 'string' })

    const merged = mergeUnresolved(receiver, fallback)

    // 'a' comes from fallback (receiver doesn't override it)
    expect((merged.fields.get('a') as HoconValue | undefined)?.kind).toBe('scalar')
    // fallback's prior for 'a' is carried into result
    const priorA = merged.priorValues.get('a')
    expect(priorA).toBeDefined()
    expect((priorA as HoconValue | undefined)?.kind).toBe('scalar')
    if (priorA && (priorA as HoconValue).kind === 'scalar') {
      expect((priorA as HoconValue & { kind: 'scalar' }).raw).toBe('fallback-prior')
    }
  })

  it('fallback priorValues do not override receiver priorValues for same key', () => {
    // Both have priorValues at 'a'; receiver's should win (step 3 of mergeUnresolved).
    const fallback = makeResObj()
    fallback.fields.set('a', { kind: 'scalar', raw: 'fb-current', valueType: 'string' })
    setPrior(fallback, 'a', { kind: 'scalar', raw: 'fb-prior', valueType: 'string' })

    const receiver = makeResObj()
    receiver.fields.set('a', { kind: 'scalar', raw: 'recv-current', valueType: 'string' })
    setPrior(receiver, 'a', { kind: 'scalar', raw: 'recv-prior', valueType: 'string' })

    const merged = mergeUnresolved(receiver, fallback)

    // receiver wins the current value
    expect((merged.fields.get('a') as HoconValue | undefined)?.kind).toBe('scalar')
    const priorA = merged.priorValues.get('a')
    // receiver's prior wins over fallback's prior
    if (priorA && (priorA as HoconValue).kind === 'scalar') {
      expect((priorA as HoconValue & { kind: 'scalar' }).raw).toBe('recv-prior')
    }
  })
})

// ---------------------------------------------------------------------------
// utils.ts line 30: lookupPath returning undefined for non-ResObj intermediate
//
// lookupPath returns undefined when the path has remaining segments but the
// current value is not a ResObj (i.e. a scalar or array is in the path).
// Line 29: if (isResObj(val)) return lookupPath(val, tail)
// Line 30: return undefined   ← this fires when val is NOT a ResObj
// ---------------------------------------------------------------------------

describe('lookupPath — non-ResObj intermediate returns undefined (utils.ts line 30)', () => {
  it('returns undefined when intermediate path segment is a scalar, not an object', () => {
    // Build a ResObj where 'a' maps to a scalar, then look up 'a.b'.
    // lookupPath finds val=scalar for 'a', then has tail=['b'] remaining,
    // isResObj(scalar) is false → line 30 fires → returns undefined.
    const root = makeResObj()
    root.fields.set('a', { kind: 'scalar', raw: '42', valueType: 'number' })

    const segments = [
      { text: 'a', line: 0, col: 0 },
      { text: 'b', line: 0, col: 0 },
    ]
    const result = lookupPath(root, segments)
    expect(result).toBeUndefined()
  })

  it('returns undefined when intermediate path segment is an array', () => {
    // Similarly, an array-typed value is not a ResObj.
    const root = makeResObj()
    root.fields.set('list', { kind: 'array', items: [{ kind: 'scalar', raw: '1', valueType: 'number' }] })

    const segments = [
      { text: 'list', line: 0, col: 0 },
      { text: '0', line: 0, col: 0 },
    ]
    const result = lookupPath(root, segments)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Edge cases: empty prefix and single-segment prefix in env var fallback
// ---------------------------------------------------------------------------

describe('env var fallback with empty or single-segment prefix (relativized path)', () => {
  it('single-segment prefix: bare env key resolved via prefix stripping', () => {
    // 'x { include "inner.conf" }': inner.conf has ${MY_VAR}.
    // Relativized: segments = ['x', 'MY_VAR'], prefixLen=1.
    // Env lookup: 'x.MY_VAR' (not present) → bare 'MY_VAR' (present) → found.
    const v = resolveStr('x { include "inner.conf" }', { MY_VAR: 'stripped' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const xVal = obj(v).get('x')
    if (xVal?.kind !== 'object') throw new Error('expected x to be object')
    expect(xVal.fields.get('val')).toEqual({ kind: 'scalar', raw: 'stripped', valueType: 'string' })
  })

  it('single-segment prefix: fully-qualified env key takes precedence over bare key', () => {
    // 'outer.MY_VAR' is set — should win over bare 'MY_VAR'.
    const v = resolveStr('outer { include "inner.conf" }', {
      'outer.MY_VAR': 'qualified-wins',
      MY_VAR: 'bare-loses',
    }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outerVal.fields.get('val')).toEqual({ kind: 'scalar', raw: 'qualified-wins', valueType: 'string' })
  })

  it('two-segment prefix: bare env key resolved via prefix stripping', () => {
    // 'a { b { include "inner.conf" } }': inner has ${MY_VAR}.
    // Relativized: segments = ['a', 'b', 'MY_VAR'], prefixLen=2.
    // Env lookup: 'a.b.MY_VAR' (absent) → bare 'MY_VAR' (present) → found.
    const v = resolveStr('a { b { include "inner.conf" } }', { MY_VAR: 'deep-stripped' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const aVal = obj(v).get('a')
    if (aVal?.kind !== 'object') throw new Error('expected a to be object')
    const bVal = aVal.fields.get('b')
    if (bVal?.kind !== 'object') throw new Error('expected b to be object')
    expect(bVal.fields.get('val')).toEqual({ kind: 'scalar', raw: 'deep-stripped', valueType: 'string' })
  })

  it('no-prefix (top-level include): env var fallback uses bare key only', () => {
    // include at top-level means no relativization; ${MY_VAR} stays as-is.
    const v = resolveStr('include "inner.conf"', { MY_VAR: 'top-level' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    expect(obj(v).get('val')).toEqual({ kind: 'scalar', raw: 'top-level', valueType: 'string' })
  })
})
