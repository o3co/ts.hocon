// tests/resolver.test.ts
import * as nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { ParseError, ResolveError } from '../src/errors.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { resolve } from '../src/internal/resolver/resolver.js'
import { segmentsToKey } from '../src/internal/resolver/utils.js'
import type { HoconValue } from '../src/value.js'

function resolveStr(input: string, env: Record<string, string> = {}, files: Record<string, string> = {}): HoconValue {
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

function obj(v: HoconValue): Map<string, HoconValue> {
  if (v.kind !== 'object') throw new Error('expected object')
  return v.fields
}

describe('Resolver - Pass 1 (structure)', () => {
  it('resolves simple string value', () => {
    const v = resolveStr('host = "localhost"')
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', raw: 'localhost', valueType: 'string' })
  })

  it('resolves number value', () => {
    const v = resolveStr('port = 8080')
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', raw: '8080', valueType: 'number' })
  })

  it('resolves nested objects', () => {
    const v = resolveStr('server { host = "localhost" }')
    const server = obj(v).get('server')
    expect(server?.kind).toBe('object')
  })

  it('merges duplicate object keys', () => {
    const v = resolveStr('server { host = "a" }\nserver { port = 8080 }')
    const server = obj(v).get('server')
    if (server?.kind === 'object') {
      expect(server.fields.has('host')).toBe(true)
      expect(server.fields.has('port')).toBe(true)
    }
  })

  it('last value wins for scalar keys', () => {
    const v = resolveStr('x = 1\nx = 2')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
  })

  it('resolves arrays', () => {
    const v = resolveStr('list = [1, 2, 3]')
    const arr = obj(v).get('list')
    expect(arr?.kind).toBe('array')
    if (arr?.kind === 'array') expect(arr.items).toHaveLength(3)
  })

  it('handles += on existing array', () => {
    const v = resolveStr('list = [1, 2]\nlist += 3')
    const arr = obj(v).get('list')
    if (arr?.kind === 'array') expect(arr.items).toHaveLength(3)
  })

  it('handles += on missing key (starts from empty array)', () => {
    const v = resolveStr('list += 1')
    const arr = obj(v).get('list')
    if (arr?.kind === 'array') expect(arr.items).toHaveLength(1)
  })

  it('preserves Map insertion order', () => {
    const v = resolveStr('c = 3\na = 1\nb = 2')
    const keys = [...obj(v).keys()]
    expect(keys).toEqual(['c', 'a', 'b'])
  })
})

describe('Resolver - Pass 2 (substitutions)', () => {
  it('resolves ${path} substitution', () => {
    const v = resolveStr('host = "localhost"\nurl = ${host}')
    expect(obj(v).get('url')).toEqual({ kind: 'scalar', raw: 'localhost', valueType: 'string' })
  })

  it('resolves nested path substitution', () => {
    const v = resolveStr('server { host = "x" }\nhost = ${server.host}')
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', raw: 'x', valueType: 'string' })
  })

  it('resolves ${?path} optional substitution (path exists)', () => {
    const v = resolveStr('a = 1\nb = ${?a}')
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('drops field for ${?path} optional substitution (path missing)', () => {
    const v = resolveStr('b = ${?missing}')
    expect(obj(v).get('b')).toBeUndefined()
  })

  it('falls back to prior value when ${?path} is unresolved', () => {
    const v = resolveStr('port = 50051\nport = ${?GRPC_PORT}')
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', raw: '50051', valueType: 'number' })
  })

  it('uses env var when ${?path} resolves', () => {
    const v = resolveStr('port = 50051\nport = ${?GRPC_PORT}', { GRPC_PORT: '9090' })
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', raw: '9090', valueType: 'string' })
  })

  it('falls back to prior value for nested ${?path}', () => {
    const v = resolveStr('server { port = 8080 }\nserver { port = ${?SERVER_PORT} }')
    const server = obj(v).get('server')
    if (server?.kind === 'object') {
      expect(server.fields.get('port')).toEqual({ kind: 'scalar', raw: '8080', valueType: 'number' })
    }
  })

  it('throws ResolveError for unresolved mandatory substitution', () => {
    expect(() => resolveStr('b = ${missing}')).toThrow(ResolveError)
  })

  it('falls back to env for unresolved substitution', () => {
    const v = resolveStr('b = ${MY_VAR}', { MY_VAR: 'hello' })
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', raw: 'hello', valueType: 'string' })
  })

  it('resolves self-referential substitution', () => {
    const v = resolveStr('path = "/usr"\npath = ${path}:/extra')
    // concat resolves: "/usr" + ":/extra" = "/usr:/extra"
    const result = obj(v).get('path')
    if (result?.kind === 'scalar') expect(result.raw).toContain('/usr')
  })

  it('resolves string concat with substitution', () => {
    const v = resolveStr('host = "localhost"\nurl = "http://"${host}')
    const result = obj(v).get('url')
    expect(result?.kind === 'scalar' && result.raw).toBe('http://localhost')
  })

  it('throws ResolveError on circular substitution', () => {
    expect(() => resolveStr('a = ${b}\nb = ${a}')).toThrow(ResolveError)
  })

  it('resolves forward-reference substitution', () => {
    const v = resolveStr('url = $' + '{host}\nhost = "localhost"')
    expect(obj(v).get('url')).toEqual({ kind: 'scalar', raw: 'localhost', valueType: 'string' })
  })
})

describe('Resolver - object concatenation deep merge', () => {
  it('should deep-merge concatenated objects', () => {
    const v = resolveStr('a = {x: {y: 1}} {x: {z: 2}}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    const x = a.fields.get('x')
    if (x?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...x.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.raw : v]))
    expect(entries).toEqual({ y: '1', z: '2' })
  })

  it('should recursively deep-merge nested objects', () => {
    const v = resolveStr('a = {x: {y: {deep: 1}}} {x: {y: {other: 2}}}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    const x = a.fields.get('x')
    if (x?.kind !== 'object') throw new Error('expected object')
    const y = x.fields.get('y')
    if (y?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...y.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.raw : v]))
    expect(entries).toEqual({ deep: '1', other: '2' })
  })

  // NOTE: '{x:1} "" {y:2}' and '{x:1} " " {y:2}' previously pinned silent object+scalar
  // string-coercion, which is now spec-correctly an error (S10.13). Those tests were
  // wrong-pinning and are removed as part of Phase 6 #3b (S10 type-check tightening).

  it('should deep-merge multiple concatenated objects', () => {
    const v = resolveStr('a = {x: 1, nested: {a: 1}} {y: 2, nested: {b: 2}} {z: 3, nested: {c: 3}}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    const x = a.fields.get('x')
    expect(x).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    const y = a.fields.get('y')
    expect(y).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
    const z = a.fields.get('z')
    expect(z).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
    const nested = a.fields.get('nested')
    if (nested?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...nested.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.raw : v]))
    expect(entries).toEqual({ a: '1', b: '2', c: '3' })
  })
})

describe('Resolver - delayed merge', () => {
  it('delayed merge: object with substitution merges fields', () => {
    const v = resolveStr('x={q:10}\na=${x}\na={c:3}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    expect(a.fields.get('q')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    expect(a.fields.get('c')).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
  })

  it('last assignment wins for non-self-referential substitution', () => {
    const v = resolveStr('x={q:10}\ny=5\nb=${x}\nb=${y}')
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
  })

  it('delayed merge with nested reference (c.e=${a})', () => {
    const v = resolveStr('x={q:10}\ny=5\na=${x}\na={c:3}\nc=${x}\nc={d:600, e:${a}, f:${b}}\nb=${x}\nb=${y}')
    const c = obj(v).get('c')
    if (c?.kind !== 'object') throw new Error('expected object')
    expect(c.fields.get('q')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    expect(c.fields.get('d')).toEqual({ kind: 'scalar', raw: '600', valueType: 'number' })
    const e = c.fields.get('e')
    if (e?.kind !== 'object') throw new Error('expected object for c.e')
    expect(e.fields.get('q')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    expect(e.fields.get('c')).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
    expect(c.fields.get('f')).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
  })
})

describe('Resolver - include', () => {
  function resolveWithFs(input: string, files: Record<string, string>): HoconValue {
    const ast = parseTokens(tokenize(input))
    return resolve(ast, {
      env: {},
      baseDir: '/fake',
      readFileSync: (p: string) => {
        const key = p.replace('/fake/', '')
        if (!(key in files)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        return files[key] ?? ''
      },
    })
  }

  it('merges included file into current object', () => {
    const v = resolveWithFs('include "other.conf"\nport = 8080', {
      'other.conf': 'host = "localhost"',
    })
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', raw: 'localhost', valueType: 'string' })
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', raw: '8080', valueType: 'number' })
  })

  it('throws ResolveError on circular include', () => {
    expect(() =>
      resolveWithFs('include "a.conf"', {
        'a.conf': 'include "b.conf"',
        'b.conf': 'include "a.conf"',
      })
    ).toThrow(ResolveError)
  })
})

describe('Resolver - resolveConcat edge cases', () => {
  it('returns null scalar when concat resolves to zero elements (all optional missing)', () => {
    // a concat of two missing optional substitutions → both resolve to undefined → empty
    // resolveConcat returns null scalar for empty resolved list
    const v = resolveStr('x = ${?missing1}${?missing2}')
    const x = obj(v).get('x')
    expect(x).toEqual({ kind: 'scalar', raw: 'null', valueType: 'null' })
  })

  it('concatenates arrays from substitution in concat context', () => {
    // arr is resolved array; concat of arr subst + scalar item produces array concat
    const v = resolveStr('arr = [1, 2]\nresult = ${arr}[3]')
    const result = obj(v).get('result')
    // array concat: [1,2] + [3] merged or string fallback — at minimum should not throw
    expect(result).toBeDefined()
  })
})

describe('Resolver - circular substitution without prior value', () => {
  it('throws ResolveError for optional circular substitution with no prior', () => {
    // ${?a} that cycles and has no prior value — should return undefined (field dropped)
    const v = resolveStr('a = ${?a}')
    // 'a' has no prior, so the optional circular sub resolves to undefined → field dropped
    expect(obj(v).get('a')).toBeUndefined()
  })
})

describe('Resolver - quoted-segment substitution paths', () => {
  it('resolves substitution with quoted path containing dots', () => {
    // ${"a.b"} should treat "a.b" as a single key, not split at dot
    const v = resolveStr('"a.b" = 42\nx = ${"a.b"}')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
  })

  it('rejects substitution with dot-starting path (leading dot is now a lex error)', () => {
    // parseSubstBody now correctly rejects substitutions with a leading dot (empty segment in path)
    expect(() => resolveStr('x = ${?.missing}')).toThrow(ParseError)
    expect(() => resolveStr('x = ${?.missing}')).toThrow(/empty segment in path/)
  })
})

describe('Resolver - include .conf extension probing (sync)', () => {
  it('probes .conf extension when include name has no extension', () => {
    const v = resolveStr('include "base"\nlocal = 1', {}, {
      '/base.conf': 'probed = true',
    })
    expect(obj(v).get('probed')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(obj(v).get('local')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('silently ignores include when no candidates found', () => {
    const v = resolveStr('include "ghost"\nlocal = 7', {}, {})
    expect(obj(v).get('local')).toEqual({ kind: 'scalar', raw: '7', valueType: 'number' })
    expect(obj(v).get('ghost')).toBeUndefined()
  })
})

describe('Resolver - include required()', () => {
  function resolveWithFs(input: string, files: Record<string, string>): HoconValue {
    const ast = parseTokens(tokenize(input))
    return resolve(ast, {
      env: {},
      baseDir: '/fake',
      readFileSync: (p: string) => {
        const key = p.replace('/fake/', '')
        if (!(key in files)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        return files[key] ?? ''
      },
    })
  }

  it('throws error containing "required" when required include file is missing', () => {
    expect(() =>
      resolveWithFs('include required("nonexistent.conf")\na = 1', {})
    ).toThrow(/required/)
  })

  it('silently ignores missing non-required include and preserves other keys', () => {
    const v = resolveWithFs('include "nonexistent.conf"\na = 1', {})
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })
})

describe('Resolver - ENOENT narrowing in loadInclude', () => {
  it('re-throws non-ENOENT errors from readFileSync (sync)', () => {
    const ast = parseTokens(tokenize('include "boom.conf"\na = 1'))
    const permError = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    expect(() =>
      resolve(ast, {
        env: {},
        baseDir: '/fake',
        readFileSync: () => { throw permError },
      })
    ).toThrow('Permission denied')
  })

  it('silently ignores ENOENT errors from readFileSync (sync)', () => {
    const ast = parseTokens(tokenize('include "missing.conf"\na = 1'))
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const v = resolve(ast, {
      env: {},
      baseDir: '/fake',
      readFileSync: () => { throw enoent },
    })
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })
})

describe('Resolver - include depth limit', () => {
  it('throws on include depth limit exceeded', () => {
    // Create a chain of 51 include files
    const files: Record<string, string> = {}
    for (let i = 0; i <= 51; i++) {
      files[`/depth/file${i}.conf`] = i < 51 ? `include "file${i + 1}.conf"\nkey${i} = ${i}` : `key51 = 51`
    }
    const ast = parseTokens(tokenize('include "file0.conf"'))
    expect(() => resolve(ast, {
      env: {},
      baseDir: '/depth',
      readFileSync: (p: string) => {
        const name = p.split('/').pop()!
        const content = files[`/depth/${name}`]
        if (content === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        return content
      },
    })).toThrow(/depth limit/)
  })
})

describe('Resolver - include substitution relativization', () => {
  it('relativizes substitution paths in nested include', () => {
    const v = resolveStr('bar { nested { include "inner.conf" } }', {}, {
      '/inner.conf': 'x = { q: 10 }\ny = 5\na = ${x}\na = { c: 3 }',
    })
    const bar = obj(v).get('bar')
    if (bar?.kind !== 'object') throw new Error('expected bar to be object')
    const nested = bar.fields.get('nested')
    if (nested?.kind !== 'object') throw new Error('expected nested to be object')
    // x should resolve locally within bar.nested scope
    expect(nested.fields.get('x')).toEqual({ kind: 'object', fields: new Map([['q', { kind: 'scalar', raw: '10', valueType: 'number' }]]) })
    expect(nested.fields.get('y')).toEqual({ kind: 'scalar', raw: '5', valueType: 'number' })
    // a = ${x} then a = { c: 3 } → delayed merge: {q:10, c:3}
    const a = nested.fields.get('a')
    if (a?.kind !== 'object') throw new Error('expected a to be object')
    expect(a.fields.get('q')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
    expect(a.fields.get('c')).toEqual({ kind: 'scalar', raw: '3', valueType: 'number' })
  })

  it('relativizes env var fallback with original path', () => {
    const v = resolveStr('outer { include "inner.conf" }', { MY_VAR: 'hello' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const outer = obj(v).get('outer')
    if (outer?.kind !== 'object') throw new Error('expected outer to be object')
    expect(outer.fields.get('val')).toEqual({ kind: 'scalar', raw: 'hello', valueType: 'string' })
  })

  it('relativizes substitution paths at single nesting level', () => {
    const v = resolveStr('foo { include "inner.conf" }', {}, {
      '/inner.conf': 'x = 1\ny = ${x}',
    })
    const foo = obj(v).get('foo')
    if (foo?.kind !== 'object') throw new Error('expected foo to be object')
    expect(foo.fields.get('y')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('relativizes substitution paths with quoted keys containing dots', () => {
    const v = resolveStr('"a.b" { include "inner.conf" }', {}, {
      '/inner.conf': 'x = 1\ny = ${x}',
    })
    const ab = obj(v).get('a.b')
    if (ab?.kind !== 'object') throw new Error('expected "a.b" to be object')
    expect(ab.fields.get('x')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    expect(ab.fields.get('y')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('env var fallback with quoted-key prefix', () => {
    const v = resolveStr('"a.b" { include "inner.conf" }', { MY_VAR: 'ok' }, {
      '/inner.conf': 'val = ${MY_VAR}',
    })
    const ab = obj(v).get('a.b')
    if (ab?.kind !== 'object') throw new Error('expected "a.b" to be object')
    expect(ab.fields.get('val')).toEqual({ kind: 'scalar', raw: 'ok', valueType: 'string' })
  })
})

describe('include merge-all probing', () => {
  it('merges all found extensions when path has no extension', () => {
    const files: Record<string, string> = {
      '/merge-probe.json': '{"from_json": true, "shared": "json"}',
      '/merge-probe.conf': 'from_conf = true\nshared = "conf"',
    }
    const v = resolveStr('include "merge-probe"', {}, files)
    const fields = obj(v)
    expect(fields.get('from_json')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(fields.get('from_conf')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    // .conf is loaded last (probe order: .properties, .json, .conf) so it wins
    expect(fields.get('shared')).toEqual({ kind: 'scalar', raw: 'conf', valueType: 'string' })
  })

  it('merges .properties, .json, and .conf in correct order', () => {
    const files: Record<string, string> = {
      '/all-three.properties': 'from_props = propval\nshared = props',
      '/all-three.json': '{"from_json": true, "shared": "json"}',
      '/all-three.conf': 'from_conf = true\nshared = "conf"',
    }
    const v = resolveStr('include "all-three"', {}, files)
    const fields = obj(v)
    expect(fields.get('from_props')).toEqual({ kind: 'scalar', raw: 'propval', valueType: 'string' })
    expect(fields.get('from_json')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(fields.get('from_conf')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(fields.get('shared')).toEqual({ kind: 'scalar', raw: 'conf', valueType: 'string' })
  })

  it('still loads single explicit extension without merging', () => {
    const files: Record<string, string> = {
      '/single.json': '{"only_json": true}',
      '/single.conf': 'only_conf = true',
    }
    // Explicit .json extension — should only load that file
    const v = resolveStr('include "single.json"', {}, files)
    const fields = obj(v)
    expect(fields.get('only_json')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(fields.has('only_conf')).toBe(false)
  })
})

// Helper: build a minimal Segment array from text strings (position unused in these tests)
function segs(...texts: string[]) {
  return texts.map(text => ({ text, line: 1, col: 1 }))
}

describe('segmentsToKey', () => {
  it('joins simple segments with dots', () => {
    expect(segmentsToKey(segs('a', 'b', 'c'))).toBe('a.b.c')
  })
  it('quotes segments containing dots', () => {
    expect(segmentsToKey(segs('a.b', 'c'))).toBe('"a.b".c')
  })
  it('quotes empty-string segments', () => {
    expect(segmentsToKey(segs('', 'foo'))).toBe('"".foo')
  })
  it('handles single segment', () => {
    expect(segmentsToKey(segs('x'))).toBe('x')
  })
  it('escapes segments containing double quotes', () => {
    expect(segmentsToKey(segs('a"b', 'c'))).toBe('"a\\"b".c')
  })
  it('escapes segments containing backslashes', () => {
    expect(segmentsToKey(segs('a\\b', 'c'))).toBe('"a\\\\b".c')
  })
  it('quotes segments with whitespace', () => {
    expect(segmentsToKey(segs(' a ', 'b'))).toBe('" a ".b')
  })
})

describe('include file() resolution', () => {
  // file() includes resolve relative to CWD (via nodePath.resolve), not the including file's dir.
  // Bare includes resolve relative to the including file's dir (baseDir).
  function resolveWithBaseDir(input: string, baseDir: string, files: Record<string, string>): HoconValue {
    const ast = parseTokens(tokenize(input))
    return resolve(ast, {
      env: {},
      baseDir,
      readFileSync: (p: string) => {
        const content = files[p]
        if (content !== undefined) return content
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })
  }

  it('include file() resolves relative to CWD, not including file dir', () => {
    // CWD-resolved absolute paths for file() includes.
    // nodePath.resolve('bar-file.conf') => <CWD>/bar-file.conf
    const cwd = process.cwd()
    const files: Record<string, string> = {
      '/root/sub/foo.conf': 'foo=42\ninclude "bar.conf"\ninclude file("bar-file.conf")',
      '/root/sub/bar.conf': 'bar=43',
      '/root/sub/bar-file.conf': 'bar-file=44',
      // file("bar-file.conf") resolves to CWD/bar-file.conf
      [nodePath.resolve(cwd, 'bar-file.conf')]: 'bar-file-cwd=99',
    }
    const input = 'base=41\ninclude "sub/foo.conf"'
    const v = resolveWithBaseDir(input, '/root', files)
    const fields = obj(v)
    // file() resolved to CWD/bar-file.conf
    expect(fields.get('bar-file-cwd')).toEqual({ kind: 'scalar', raw: '99', valueType: 'number' })
    // sub/bar-file.conf should NOT be loaded (that would be the old broken behavior)
    expect(fields.has('bar-file')).toBe(false)
    expect(fields.get('base')).toEqual({ kind: 'scalar', raw: '41', valueType: 'number' })
    expect(fields.get('foo')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
    expect(fields.get('bar')).toEqual({ kind: 'scalar', raw: '43', valueType: 'number' })
  })

  it('include file() with absolute path resolves as-is', () => {
    const files: Record<string, string> = {
      '/absolute/target.conf': 'abs=100',
    }
    const input = 'base=1\ninclude file("/absolute/target.conf")'
    const v = resolveWithBaseDir(input, '/root', files)
    const fields = obj(v)
    expect(fields.get('abs')).toEqual({ kind: 'scalar', raw: '100', valueType: 'number' })
  })

  it('include file() silently skips missing files (non-required)', () => {
    const files: Record<string, string> = {
      '/root/sub/foo.conf': 'foo=42\ninclude file("nonexistent.conf")',
    }
    const input = 'base=41\ninclude "sub/foo.conf"'
    const v = resolveWithBaseDir(input, '/root', files)
    const fields = obj(v)
    expect(fields.get('base')).toEqual({ kind: 'scalar', raw: '41', valueType: 'number' })
    expect(fields.get('foo')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
  })

  it('include required(file()) errors when file does not exist', () => {
    const files: Record<string, string> = {}
    const input = 'include required(file("missing.conf"))'
    expect(() => resolveWithBaseDir(input, '/root', files)).toThrow(/required include file not found/)
  })

  it('include required(file()) succeeds when file exists', () => {
    const cwd = process.cwd()
    const files: Record<string, string> = {
      [nodePath.resolve(cwd, 'exists.conf')]: 'found=true',
    }
    const input = 'include required(file("exists.conf"))'
    const v = resolveWithBaseDir(input, '/root', files)
    const fields = obj(v)
    expect(fields.get('found')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
  })

  it('bare include still resolves relative to including file dir', () => {
    const files: Record<string, string> = {
      '/root/sub/foo.conf': 'foo=42\ninclude "bar.conf"',
      '/root/sub/bar.conf': 'bar=43',
    }
    const input = 'include "sub/foo.conf"'
    const v = resolveWithBaseDir(input, '/root', files)
    const fields = obj(v)
    expect(fields.get('foo')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
    expect(fields.get('bar')).toEqual({ kind: 'scalar', raw: '43', valueType: 'number' })
  })
})

// -----------------------------------------------------------------------------
// Spec compliance Phase 2 (issue #82): concatenation and += (resolver-level)
// Convention: it.fails(...) pins known violations; plain it(...) for ✅ items.
// -----------------------------------------------------------------------------

describe('spec compliance Phase 2 — concatenation and += (resolver-level)', () => {
  // --- S10.4: mixing arrays + objects in concat is an error ----------------
  it('S10.4: array then object literal in concat is an error (spec L385)', () => {
    expect(() => resolveStr('x = [1,2] { a=1 }')).toThrow(ResolveError)
  })

  it('S10.4: object literal then array in concat is an error (spec L385)', () => {
    expect(() => resolveStr('x = { a=1 } [1,2]')).toThrow(ResolveError)
  })

  // --- S10.13: array/object appearing in string concat is an error ---------
  it('S10.13: quoted string followed by array literal is an error (spec L373)', () => {
    expect(() => resolveStr('x = "hello" [1,2]')).toThrow(ResolveError)
  })

  it('S10.13: array literal followed by quoted string is an error (spec L373)', () => {
    expect(() => resolveStr('x = [1,2] "hello"')).toThrow(ResolveError)
  })

  it('S10.13: quoted string followed by object literal is an error (spec L373)', () => {
    expect(() => resolveStr('x = "hello" { a=1 }')).toThrow(ResolveError)
  })

  // --- S10.14: whitespace around obj/array substitutions is ignored --------
  // Note: s() builds "${name}" without a literal ${ in source to avoid linter warnings.
  // Fixed alongside S15 concat work: resolveConcat now filters parser-inserted separator
  // whitespace from the array-concat path (matching the existing object-concat filter).
  it('S10.14: unquoted whitespace between two array substitutions is ignored (spec L440)', () => {
    // subst(a) subst(b) where both resolve to arrays → array concat, whitespace stripped
    const s = (name: string) => '$' + '{' + name + '}'
    const input = 'a=[1]\nb=[2]\nx = ' + s('a') + ' ' + s('b')
    const v = resolveStr(input)
    const fields = obj(v)
    const xVal = fields.get('x')
    expect(xVal?.kind).toBe('array')
    if (xVal?.kind === 'array') {
      expect(xVal.items).toHaveLength(2)
    }
  })

  it('S10.14: unquoted whitespace between two object substitutions is ignored (spec L440)', () => {
    // subst(a) subst(b) where both resolve to objects → object merge, whitespace stripped
    const s = (name: string) => '$' + '{' + name + '}'
    const input = 'a={p=1}\nb={q=2}\nx = ' + s('a') + ' ' + s('b')
    const v = resolveStr(input)
    const fields = obj(v)
    const xVal = fields.get('x')
    expect(xVal?.kind).toBe('object')
    if (xVal?.kind === 'object') {
      expect(xVal.fields.has('p')).toBe(true)
      expect(xVal.fields.has('q')).toBe(true)
    }
  })

  // --- S10.19: substitution-resolved object + literal array → error --------
  it('S10.19: subst resolving to object concatenated with literal array is an error (spec L385-389)', () => {
    const r = (name: string) => `\${${name}}`
    const input = `y = { a = 1 }\nx = ${r('y')} [1,2]`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  it('S10.19: subst resolving to array concatenated with object literal is an error (spec L385-389)', () => {
    const r = (name: string) => `\${${name}}`
    const input = `y = [1,2]\nx = ${r('y')} { a=1 }`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  // --- S13b.2: += on non-array prior value → error -------------------------
  // VIOLATION: resolver wraps the scalar as a single-element array instead of erroring.
  it.fails('S13b.2: += when prior value is a number scalar is an error (spec L732)', () => {
    expect(() => resolveStr('x = 1\nx += [2]')).toThrow()
  })

  it.fails('S13b.2: += when prior value is a string scalar is an error (spec L732)', () => {
    expect(() => resolveStr('x = "hello"\nx += [2]')).toThrow()
  })

  it.fails('S13b.2: += when prior value is an object is an error (spec L732)', () => {
    expect(() => resolveStr('x = { a = 1 }\nx += [2]')).toThrow()
  })
})

// Spec compliance Phase 3 (tracking issue #70): substitution & include (resolver-level)
// Convention: it.fails(...) pins known violations; plain it(...) for ✅ items.
// -----------------------------------------------------------------------------

describe('spec compliance Phase 3 — substitution & include (resolver-level)', () => {
  // --- S13.3: ${? is exactly 3 chars — no whitespace before ? ---------------
  it('S13.3: whitespace before ? is not treated as optional substitution (spec L584)', () => {
    // ${ ?foo} must NOT be treated as optional ${?foo}; lexer/parser must reject or differ.
    // Probe both env states: with foo undefined AND with foo defined. The former
    // could throw because the optional path has no value (wrong reason); the latter
    // distinguishes "rejected as malformed" from "silently re-parsed as required ${foo}".
    expect(() => resolveStr('x = ${ ?foo}')).toThrow()
    expect(() => resolveStr('foo = 1\nx = ${ ?foo}')).toThrow()
  })

  // --- S13.5: substitutions are NOT parsed inside quoted strings -------------
  it('S13.5: ${foo} inside double-quoted string is a literal (spec L593)', () => {
    const r = resolveStr('x = "${foo}"')
    const x = obj(r).get('x')
    expect(x).toEqual({ kind: 'scalar', raw: '${foo}', valueType: 'string' })
  })

  // --- S13.9: null in config blocks env var lookup ---------------------------
  // Spec L618 specifies env-var suppression when a key is null in config; the
  // required-vs-optional distinction for "null as resolved value vs missing" is
  // ambiguous in the spec, so we test only the unambiguous optional case here.
  it('S13.9: config null for a key blocks env var lookup for optional subst (spec L618)', () => {
    // HOME=null in config means ${?HOME} sees null, not the env value
    const r = resolveStr('HOME = null\nresult = ${?HOME}', { HOME: '/x/y' })
    const result = obj(r).get('result')
    // null config value takes precedence over env var; result resolves to null
    expect(result).toEqual({ kind: 'scalar', raw: 'null', valueType: 'null' })
  })

  // --- S13.13: optional undefined in string concat → empty string ------------
  it('S13.13: optional missing subst in string concat contributes empty string (spec L636)', () => {
    const r = resolveStr('x = "pre"${?missing}"post"')
    const x = obj(r).get('x')
    expect(x).toEqual({ kind: 'scalar', raw: 'prepost', valueType: 'string' })
  })

  // --- S13.14: optional undefined in array concat → no extra elements --------
  // Fixed alongside S15 concat work: array-concat now filters separator whitespace, so the
  // missing optional substitution no longer leaves a whitespace artefact in the result.
  it('S13.14: optional missing subst in array concat produces clean 2-element array (spec L637, see #83)', () => {
    const r = resolveStr('x = [1] ${?missing} [2]')
    const x = obj(r).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toHaveLength(2)
      expect(x.items[0]).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
      expect(x.items[1]).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
    }
  })

  it('S13.14: optional missing subst in object concat merges adjacent objects (spec L637)', () => {
    const r = resolveStr('x = {a:1} ${?missing} {b:2}')
    const x = obj(r).get('x')
    expect(x?.kind).toBe('object')
    if (x?.kind === 'object') {
      expect(x.fields.has('a')).toBe(true)
      expect(x.fields.has('b')).toBe(true)
    }
  })

  // --- S13a.10: substitution memoized by instance, not by path ---------------
  // Internal resolver implementation detail — not externally observable from a
  // black-box API perspective. No test added.
  // # not externally observable — internal memoization semantics

  // --- S13a.13: a = ${?a}foo resolves to "foo" when a not previously set -----
  it('S13a.13: a = ${?a}foo resolves to "foo" when a not previously assigned (spec L841, see #84)', () => {
    const r = resolveStr('a = ${?a}foo')
    const a = obj(r).get('a')
    expect(a).toEqual({ kind: 'scalar', raw: 'foo', valueType: 'string' })
  })

  // --- S14b.1: included root must be an object; array root → error -----------
  it('S14b.1: including a file whose root is an array is an error (spec L993)', () => {
    expect(() =>
      resolveStr('include "arr.conf"', {}, { '/arr.conf': '[1, 2, 3]' })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Phase 5 spec debt tests
// ---------------------------------------------------------------------------

// S6.5 — "newline" means specifically 0x000A (LF) (HOCON spec L183)
// Probe (2026-05-13): 'x = 1\ry = 2' → x = "1\ry = 2" (CR absorbed into unquoted value).
// CR (0x0D) is not treated as the field separator; only LF (0x0A) is.
describe('S6.5 - "newline" means 0x000A (LF) only (HOCON spec L183)', () => {
  it('S6.5: CR alone (0x0D) does not act as a field separator', () => {
    // If CR were treated as newline, "x = 1\ry = 2" would produce two fields.
    // Spec: newline = LF only, so CR is whitespace absorbed into x's unquoted value
    // and the entire `1\ry = 2` becomes a single string value (with CR normalized
    // to a space per unquoted-string whitespace rules).
    const v = resolveStr('x = 1\ry = 2')
    const fields = obj(v)
    // Only one field 'x'; 'y' is not a separate top-level key.
    expect(fields.has('y')).toBe(false)
    // And x's value is the absorbed-into-one-line string, proving CR was treated
    // as whitespace rather than dropped or causing truncation. This guards against
    // a false positive where 'y' could be absent for an unrelated reason.
    expect(fields.get('x')).toEqual({ kind: 'scalar', raw: '1 y = 2', valueType: 'string' })
  })

  it('S6.5: LF (0x0A) acts as the field separator', () => {
    const v = resolveStr('x = 1\ny = 2')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
    expect(obj(v).get('y')).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
  })
})

// S7.6 — intermediate non-object value breaks merge with later object (HOCON spec L207)
// Probe (2026-05-13): foo={a:42}, foo=null, foo={b:43} → result has only b=43 ✅
describe('S7.6 - intermediate non-object breaks object merge (HOCON spec L207)', () => {
  it('S7.6: intermediate null prevents merge; final object stands alone', () => {
    // Spec L207-238 example:
    //   foo : { "a" : 42 }
    //   foo : null          ← non-object interrupts chain
    //   foo : { "b" : 43 }
    // Result: { foo: { b: 43 } } — the two objects never merge.
    const v = resolveStr('foo = { a: 42 }\nfoo = null\nfoo = { b: 43 }')
    const foo = obj(v).get('foo')
    if (foo?.kind !== 'object') throw new Error('expected object')
    expect(foo.fields.has('a')).toBe(false)
    expect(foo.fields.get('b')).toEqual({ kind: 'scalar', raw: '43', valueType: 'number' })
  })

  it('S7.6: intermediate non-null scalar also prevents merge', () => {
    const v = resolveStr('foo = { a: 42 }\nfoo = 99\nfoo = { b: 43 }')
    const foo = obj(v).get('foo')
    if (foo?.kind !== 'object') throw new Error('expected object')
    expect(foo.fields.has('a')).toBe(false)
    expect(foo.fields.get('b')).toEqual({ kind: 'scalar', raw: '43', valueType: 'number' })
  })
})

// S10.9 — true/false stringify to "true"/"false" in concat (HOCON spec L363)
// Probe (2026-05-13): 'x = true foo' → "true foo" ✅
describe('S10.9 - true/false stringify in value concat (HOCON spec L363)', () => {
  it('S10.9: "true" keyword stringifies to "true" in concatenation', () => {
    const v = resolveStr('x = true foo')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: 'true foo', valueType: 'string' })
  })

  it('S10.9: "false" keyword stringifies to "false" in concatenation', () => {
    const v = resolveStr('x = false bar')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: 'false bar', valueType: 'string' })
  })
})

// S10.10 — null stringifies to "null" in concat (HOCON spec L364)
// Probe (2026-05-13): 'x = null foo' → "null foo" ✅
describe('S10.10 - null stringifies to "null" in value concat (HOCON spec L364)', () => {
  it('S10.10: "null" keyword stringifies to "null" in concatenation', () => {
    const v = resolveStr('x = null foo')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: 'null foo', valueType: 'string' })
  })

  it('S10.10: "null" alone is not stringified (type preserved as null)', () => {
    // Single non-string value is NOT converted (spec L376)
    const v = resolveStr('x = null')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: 'null', valueType: 'null' })
  })
})

// S10.16 — non-newline whitespace in arrays produces concat, not separate elements (HOCON spec L447)
// Probe (2026-05-13): '[ 1 2 3 4 ]' → ["1 2 3 4"] (one string element) ✅
describe('S10.16 - non-newline whitespace in arrays makes concat, not elements (HOCON spec L447)', () => {
  it('S10.16: [1 2 3 4] is one concatenated string element, not four integers', () => {
    const v = resolveStr('a = [ 1 2 3 4 ]')
    const a = obj(v).get('a')
    if (a?.kind !== 'array') throw new Error('expected array')
    // spec: "this is an array with one element, the string '1 2 3 4'"
    expect(a.items).toHaveLength(1)
    expect(a.items[0]).toEqual({ kind: 'scalar', raw: '1 2 3 4', valueType: 'string' })
  })

  it('S10.16: elements separated by newlines are distinct', () => {
    const v = resolveStr('a = [\n1\n2\n3\n4\n]')
    const a = obj(v).get('a')
    if (a?.kind !== 'array') throw new Error('expected array')
    expect(a.items).toHaveLength(4)
  })
})

// S14a.7 — whitespace (including newlines) allowed between `include` and resource name
// (HOCON spec L952)
// Probe (2026-05-13): include\n"file.conf" parses and resolves correctly ✅
describe('S14a.7 - whitespace/newlines allowed between include and resource name (HOCON spec L952)', () => {
  it('S14a.7: newline between include keyword and quoted filename is accepted', () => {
    const v = resolveStr('include\n"inc.conf"', {}, { '/inc.conf': 'x = 42' })
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
  })

  it('S14a.7: multiple spaces between include keyword and quoted filename is accepted', () => {
    const v = resolveStr('include   "inc.conf"', {}, { '/inc.conf': 'y = 7' })
    expect(obj(v).get('y')).toEqual({ kind: 'scalar', raw: '7', valueType: 'number' })
  })
})

// S13a.10 — substitution memoized by instance, not by path (HOCON spec L885)
// This is an internal resolver implementation detail. Two ${b} substitutions at
// different positions in the file resolve using the same lookup document (the final
// merged config), so both naturally see the same result. No externally observable
// difference exists between "memoized by instance" and "resolved independently" when
// the config is non-self-referential. Status: ➖ (not externally observable via the
// black-box public API; structural reason: the spec rule constrains resolver internals,
// not the observable output for any valid input program).

// S13a.3 — self-ref before any prior value → error (HOCON spec L767)
// Probe (2026-05-13): resolveStr('a = ${a}') throws ResolveError "circular substitution: a".
// Spec L767-773: error should be treated as "undefined" (missing subst) rather than
// "intractable cycle". Both lead to an error, but the error message differs.
// Classification: ⚠️ — error is raised (correct), but as a cycle error rather than a
// missing-substitution error; the spec wants "undefined" semantics for this case.
describe('S13a.3 - self-ref with no prior value → error (HOCON spec L767)', () => {
  it('S13a.3: a = ${a} with no prior value for a raises an error', () => {
    // Spec: treated as "undefined" — same outcome as required substitution not found.
    // Impl raises ResolveError("circular substitution: a") instead of a missing-path error,
    // but an error IS raised either way. ⚠️ wrong error message, correct behavior.
    expect(() => resolveStr('a = ${a}')).toThrow(ResolveError)
  })

  it('S13a.3: a = ${a} is distinct from a two-step cycle (both error, but different cause)', () => {
    // Two-step cycle — also an error, per S13a.8
    expect(() => resolveStr('a = ${b}\nb = ${a}')).toThrow(ResolveError)
  })
})

// ---- S13c: env-var list expansion — resolver unit tests (Unit C) -----------
//
// These tests use resolveStr(input, env) with explicit env injection.
// process.env is never mutated. All inputs use String.fromCharCode(36)
// concatenation to avoid IDE template-string lint warnings on ${...} literals.

describe('S13c — env-var list expansion (resolver)', () => {
  const D = String.fromCharCode(36) // '$' — avoids IDE template-string lint on ${...}

  it('S13c.1/S13c.2: basic list expansion stops at first missing index', () => {
    // LIST_0=a, LIST_1=b, LIST_2 absent → ["a","b"]
    const v = resolveStr('x = ' + D + '{LIST[]}', { LIST_0: 'a', LIST_1: 'b' })
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toEqual([
        { kind: 'scalar', raw: 'a', valueType: 'string' },
        { kind: 'scalar', raw: 'b', valueType: 'string' },
      ])
    }
  })

  it('S13c.2: stops at gap (LIST_0=a, LIST_2=c, no LIST_1) → ["a"]', () => {
    const v = resolveStr('x = ' + D + '{LIST[]}', { LIST_0: 'a', LIST_2: 'c' })
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toHaveLength(1)
      expect(x.items[0]).toEqual({ kind: 'scalar', raw: 'a', valueType: 'string' })
    }
  })

  it('S13c.3: required list with no _0 → ResolveError', () => {
    // Scalar LIST=scalar set but no LIST_0 → S13c.5: must NOT fall back to scalar
    expect(() => resolveStr('x = ' + D + '{LIST[]}', { LIST: 'scalar' })).toThrow(ResolveError)
  })

  it('S13c.4: optional list with no _0 → key removed (undefined)', () => {
    const v = resolveStr('x = ' + D + '{?LIST[]}', { LIST: 'scalar' })
    expect(obj(v).get('x')).toBeUndefined()
  })

  it('S13c.5: listSuffix=true suppresses scalar env fallback (required)', () => {
    // LIST=scalar is set but LIST_0 is absent.
    // Resolver MUST NOT return "scalar"; must throw ResolveError.
    expect(() => resolveStr('x = ' + D + '{LIST[]}', { LIST: 'scalar' })).toThrow(ResolveError)
  })

  it('S13c.5: listSuffix=true suppresses scalar env fallback (optional)', () => {
    // LIST=scalar is set but LIST_0 is absent.
    // Resolver MUST NOT return "scalar"; must drop the key.
    const v = resolveStr('x = ' + D + '{?LIST[]}', { LIST: 'scalar' })
    expect(obj(v).get('x')).toBeUndefined()
  })

  it('E6: config-defined value wins over env-var list expansion', () => {
    // Config defines MY_LIST = "config-val"; env has MY_LIST_0=env-val.
    // The resolver returns the config value and never consults env.
    const v = resolveStr('MY_LIST = "config-val"\nx = ' + D + '{MY_LIST[]}', { MY_LIST_0: 'env-val' })
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: 'config-val', valueType: 'string' })
  })

  it('empty-string element is preserved (ev10 — stop is key-absent, not empty-string)', () => {
    // LIST_0="" (present, empty), LIST_1=b, LIST_2 absent → ["", "b"]
    const v = resolveStr('x = ' + D + '{LIST[]}', { LIST_0: '', LIST_1: 'b' })
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toEqual([
        { kind: 'scalar', raw: '', valueType: 'string' },
        { kind: 'scalar', raw: 'b', valueType: 'string' },
      ])
    }
  })

  it('relativized fallback: no cross-base merging (fully-qualified wins)', () => {
    // Inside an include prefixed at "outer", ${MY_LIST[]} relativizes to
    // outer.MY_LIST_*. Since outer.MY_LIST_0 is present, the bare MY_LIST_* keys
    // must NOT be appended. Result: ["from-outer"] only.
    const inner = 'mylist = ' + D + '{MY_LIST[]}'
    const v = resolveStr(
      'outer {\n  include "inner.conf"\n}',
      { 'outer.MY_LIST_0': 'from-outer', MY_LIST_0: 'from-bare', MY_LIST_1: 'extra' },
      { '/inner.conf': inner },
    )
    const outerVal = obj(v).get('outer')
    if (outerVal?.kind !== 'object') throw new Error('expected outer object')
    const mylist = outerVal.fields.get('mylist')
    expect(mylist?.kind).toBe('array')
    if (mylist?.kind === 'array') {
      expect(mylist.items).toEqual([{ kind: 'scalar', raw: 'from-outer', valueType: 'string' }])
    }
  })
})

// ---------------------------------------------------------------------------
// S10 concat type-check tightening (Phase 6 #3b — ts#75, ts#77, ts#79)
// joinPair must raise ResolveError for spec-disallowed type pairs.
// ---------------------------------------------------------------------------
describe('S10 concat type-check — joinPair throws on disallowed type pairs', () => {
  // Builds a HOCON substitution reference without embedding ${ in the source,
  // which avoids the no-template-curly-in-string lint rule.
  const ref = (name: string) => `\${${name}}`

  // --- Unit A: Array+Object / Object+Array when numericObjectToArray returns null ---
  it('A1: array literal + non-numeric-keyed object literal throws ResolveError (S10.4)', () => {
    expect(() => resolveStr('x = [1] { b: 2 }')).toThrow(ResolveError)
  })

  it('A2: non-numeric-keyed object literal + array literal throws ResolveError (S10.4)', () => {
    expect(() => resolveStr('x = { b: 2 } [1]')).toThrow(ResolveError)
  })

  it('A3: array literal + subst resolving to non-numeric-keyed object throws ResolveError (S10.19)', () => {
    const input = `obj = { b: 2 }\nx = [1] ${ref('obj')}`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  it('A4: subst resolving to array + non-numeric-keyed object literal throws ResolveError (S10.19)', () => {
    const input = `arr = [1]\nx = ${ref('arr')} { b: 2 }`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  it('A-REG: array + numeric-keyed object still converts via S15 (regression guard)', () => {
    // S15 bridge must remain intact; only the non-convertible path should error.
    const input = `obj = {"0":"x","1":"y"}\nx = [1] ${ref('obj')}`
    const v = resolveStr(input)
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toHaveLength(3)
    }
  })

  // --- Unit B: Array+Scalar / Scalar+Array throws ResolveError (S10.13) ---
  it('B1: array literal + scalar throws ResolveError (S10.13)', () => {
    expect(() => resolveStr('x = [1, 2] 3')).toThrow(ResolveError)
  })

  it('B2: scalar + array literal throws ResolveError (S10.13)', () => {
    expect(() => resolveStr('x = 3 [1, 2]')).toThrow(ResolveError)
  })

  it('B-REG: array + array still concatenates (regression guard)', () => {
    const v = resolveStr('x = [1] [2]')
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toHaveLength(2)
    }
  })

  // --- Unit C: Object+Scalar / Scalar+Object throws ResolveError (S10.13) ---
  it('C1: object literal + unquoted scalar throws ResolveError (S10.13)', () => {
    expect(() => resolveStr('x = { b: 1 } foo')).toThrow(ResolveError)
  })

  it('C2: unquoted scalar + object literal throws ResolveError (S10.13)', () => {
    expect(() => resolveStr('x = foo { b: 1 }')).toThrow(ResolveError)
  })

  it('C3: string scalar + subst resolving to object throws ResolveError (S10.13)', () => {
    const input = `obj = { b: 1 }\nx = foo ${ref('obj')}`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  // --- Unit D: Optional substitution omission interaction ---
  it('D1: optional-missing mid-concat throws ResolveError (S10.4 fires after omission)', () => {
    // [1] <omitted-optional> {b:2} → post-omission fold is [1]+{b:2} → error
    expect(() => resolveStr('x = [1] ${?missing} { b: 2 }')).toThrow(ResolveError)
  })

  it('D2: optional-missing at end resolves to [1] (single piece after omission, no error)', () => {
    // [1] <omitted-optional> → single piece after omission → no joinPair call
    const v = resolveStr('x = [1] ${?missing}')
    const x = obj(v).get('x')
    expect(x?.kind).toBe('array')
    if (x?.kind === 'array') {
      expect(x.items).toHaveLength(1)
    }
  })

  // --- S10.15: quoted whitespace between subst-resolved containers (HOCON.md L442) ---
  // S10.15 is structurally a special case of S10.13 (array/object + scalar in concat),
  // but the spec calls it out explicitly because the typical user idiom is `${a} " " ${b}`
  // where the `" "` looks like inter-substitution padding. Per L442 this must error
  // regardless of whether the operands are literal or substitution-resolved.
  it('S10.15: quoted whitespace between subst-resolved arrays throws (spec L442)', () => {
    const input = `a = [1]\nb = [2]\nx = ${ref('a')} " " ${ref('b')}`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })

  it('S10.15: quoted whitespace between subst-resolved objects throws (spec L442)', () => {
    const input = `a = { p: 1 }\nb = { q: 2 }\nx = ${ref('a')} " " ${ref('b')}`
    expect(() => resolveStr(input)).toThrow(ResolveError)
  })
})

// ---------------------------------------------------------------------------
// S13a.13: self-ref look-back short-circuit (no-prior cases)
// spec L841: a = ${?a}foo → "foo" (no prior a)
// ---------------------------------------------------------------------------
describe('S13a.13: self-ref look-back no-prior short-circuit (spec L841, #84)', () => {
  // --- no-prior optional cases (the fix) ---
  it('a = ${?a}foo (no prior) → "foo"', () => {
    const r = resolveStr('a = ${?a}foo')
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'foo', valueType: 'string' })
  })

  it('a = bar${?a} (no prior, leading literal) → "bar"', () => {
    const r = resolveStr('a = bar${?a}')
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'bar', valueType: 'string' })
  })

  it('a = bar${?a}foo (no prior, both sides) → "barfoo"', () => {
    const r = resolveStr('a = bar${?a}foo')
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'barfoo', valueType: 'string' })
  })

  // --- with-prior regressions ---
  it('a = "x"; a = ${?a}foo (with prior) → "xfoo"', () => {
    const r = resolveStr('a = "x"\na = ${?a}foo')
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'xfoo', valueType: 'string' })
  })

  // --- required self-ref cases ---
  it('a = ${a}foo (required, no prior) → ResolveError', () => {
    expect(() => resolveStr('a = ${a}foo')).toThrow(ResolveError)
  })

  it('a = "x"; a = ${a}foo (required, with prior) → "xfoo"', () => {
    const r = resolveStr('a = "x"\na = ${a}foo')
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'xfoo', valueType: 'string' })
  })

  // --- array variants ---
  it('a = ${?a} [2] (no prior, array) → [2]', () => {
    const r = resolveStr('a = ${?a} [2]')
    const a = obj(r).get('a')
    expect(a?.kind).toBe('array')
    if (a?.kind === 'array') {
      expect(a.items).toHaveLength(1)
      expect(a.items[0]).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
    }
  })

  it('a = [1]; a = ${?a} [2] (with prior, array) → [1, 2]', () => {
    const r = resolveStr('a = [1]\na = ${?a} [2]')
    const a = obj(r).get('a')
    expect(a?.kind).toBe('array')
    if (a?.kind === 'array') {
      expect(a.items).toHaveLength(2)
      expect(a.items[0]).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
      expect(a.items[1]).toEqual({ kind: 'scalar', raw: '2', valueType: 'number' })
    }
  })

  // --- nested path variants ---
  it('foo.a = ${?foo.a}bar (no prior, nested) → foo.a = "bar"', () => {
    const r = resolveStr('foo.a = ${?foo.a}bar')
    const foo = obj(r).get('foo')
    if (foo?.kind === 'object') {
      expect(foo.fields.get('a')).toEqual({ kind: 'scalar', raw: 'bar', valueType: 'string' })
    } else {
      throw new Error('expected foo to be an object')
    }
  })

  it('foo.a = "x"; foo.a = ${?foo.a}bar (with prior, nested) → foo.a = "xbar"', () => {
    const r = resolveStr('foo.a = "x"\nfoo.a = ${?foo.a}bar')
    const foo = obj(r).get('foo')
    if (foo?.kind === 'object') {
      expect(foo.fields.get('a')).toEqual({ kind: 'scalar', raw: 'xbar', valueType: 'string' })
    } else {
      throw new Error('expected foo to be an object')
    }
  })

  // --- external-ref regression guard (multi-reviewer convergence P1) ---
  // go.hocon and rs.hocon independently flagged: a = ${?a}foo; b = ${a}
  // isSelfRef detection must NOT fire when resolving ${a} from b's RHS,
  // even though a's stored value is a concat containing ${?a}.
  it('S13a.13: b = ${a} resolves correctly when a = ${?a}foo (no prior a)', () => {  // eslint-disable-line no-template-curly-in-string
    const r = resolveStr('a = ${?a}foo\nb = ${a}')  // eslint-disable-line no-template-curly-in-string
    expect(obj(r).get('a')).toEqual({ kind: 'scalar', raw: 'foo', valueType: 'string' })
    expect(obj(r).get('b')).toEqual({ kind: 'scalar', raw: 'foo', valueType: 'string' })
  })
})
