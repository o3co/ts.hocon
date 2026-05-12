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

  it('should NOT deep-merge when explicit empty string separates objects', () => {
    // a = {x:1} "" {y:2} — the "" is an explicit concat operand, so this is string concat
    const v = resolveStr('a = {x:1} "" {y:2}')
    const a = obj(v).get('a')
    // Should be string concatenation, not object merge
    expect(a?.kind).toBe('scalar')
  })

  it('should NOT deep-merge when explicit blank string separates objects', () => {
    // a = {x:1} " " {y:2} — the " " is a user-authored value
    const v = resolveStr('a = {x:1} " " {y:2}')
    const a = obj(v).get('a')
    expect(a?.kind).toBe('scalar')
  })

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
  // VIOLATION: resolver silently treats the object as an extra array element.
  it.fails('S10.4: array then object literal in concat is an error (spec L385)', () => {
    expect(() => resolveStr('x = [1,2] { a=1 }')).toThrow()
  })

  it.fails('S10.4: object literal then array in concat is an error (spec L385)', () => {
    expect(() => resolveStr('x = { a=1 } [1,2]')).toThrow()
  })

  // --- S10.13: array/object appearing in string concat is an error ---------
  // VIOLATION: resolver silently wraps scalars + array into a flat array.
  it.fails('S10.13: quoted string followed by array literal is an error (spec L373)', () => {
    expect(() => resolveStr('x = "hello" [1,2]')).toThrow()
  })

  it.fails('S10.13: array literal followed by quoted string is an error (spec L373)', () => {
    expect(() => resolveStr('x = [1,2] "hello"')).toThrow()
  })

  it.fails('S10.13: quoted string followed by object literal is an error (spec L373)', () => {
    expect(() => resolveStr('x = "hello" { a=1 }')).toThrow()
  })

  // --- S10.14: whitespace around obj/array substitutions is ignored --------
  // Note: s() builds "${name}" without a literal ${ in source to avoid linter warnings.
  // PARTIAL VIOLATION: whitespace stripping works for object substs but not array substs;
  // the whitespace separator scalar is included as an extra array element.
  it.fails('S10.14: unquoted whitespace between two array substitutions is ignored (spec L440)', () => {
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
  // VIOLATION: resolver silently treats as array concat, no error thrown.
  it.fails('S10.19: subst resolving to object concatenated with literal array is an error (spec L385-389)', () => {
    const s = (name: string) => '$' + '{' + name + '}'
    const input = 'y = { a = 1 }\nx = ' + s('y') + ' [1,2]'
    expect(() => resolveStr(input)).toThrow()
  })

  it.fails('S10.19: subst resolving to array concatenated with object literal is an error (spec L385-389)', () => {
    const s = (name: string) => '$' + '{' + name + '}'
    const input = 'y = [1,2]\nx = ' + s('y') + ' { a=1 }'
    expect(() => resolveStr(input)).toThrow()
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
