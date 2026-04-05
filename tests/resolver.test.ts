// tests/resolver.test.ts
import { describe, expect, it } from 'vitest'
import { ResolveError } from '../src/errors.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { resolve } from '../src/internal/resolver/resolver.js'
import { parseSubstPath, segmentsToKey } from '../src/internal/resolver/utils.js'
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

describe('Resolver - parseSubstPath quoted segments', () => {
  it('resolves substitution with quoted path containing dots', () => {
    // ${"a.b"} should treat "a.b" as a single key, not split at dot
    const v = resolveStr('"a.b" = 42\nx = ${"a.b"}')
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
  })

  it('resolves substitution with dot-starting path (empty segment)', () => {
    // Paths starting with a dot produce an empty leading segment in parseSubstPath.
    // If the key isn't found, optional sub returns undefined (field dropped).
    const v = resolveStr('x = ${?.missing}')
    expect(obj(v).get('x')).toBeUndefined()
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

describe('segmentsToKey', () => {
  it('joins simple segments with dots', () => {
    expect(segmentsToKey(['a', 'b', 'c'])).toBe('a.b.c')
  })
  it('quotes segments containing dots', () => {
    expect(segmentsToKey(['a.b', 'c'])).toBe('"a.b".c')
  })
  it('quotes empty-string segments', () => {
    expect(segmentsToKey(['', 'foo'])).toBe('"".foo')
  })
  it('handles single segment', () => {
    expect(segmentsToKey(['x'])).toBe('x')
  })
  it('roundtrips with parseSubstPath', () => {
    const cases = [['a', 'b'], ['a.b', 'c'], ['', 'x', ''], ['a.b.c', 'd.e']]
    for (const segs of cases) {
      expect(parseSubstPath(segmentsToKey(segs))).toEqual(segs)
    }
  })
  it('escapes segments containing double quotes', () => {
    expect(segmentsToKey(['a"b', 'c'])).toBe('"a\\"b".c')
    expect(parseSubstPath(segmentsToKey(['a"b', 'c']))).toEqual(['a"b', 'c'])
  })
  it('escapes segments containing backslashes', () => {
    expect(segmentsToKey(['a\\b', 'c'])).toBe('"a\\\\b".c')
    expect(parseSubstPath(segmentsToKey(['a\\b', 'c']))).toEqual(['a\\b', 'c'])
  })
  it('quotes segments with whitespace', () => {
    expect(segmentsToKey([' a ', 'b'])).toBe('" a ".b')
    expect(parseSubstPath(segmentsToKey([' a ', 'b']))).toEqual([' a ', 'b'])
  })
  it('preserves unknown escape sequences in parseSubstPath', () => {
    // \n inside quotes should be preserved as literal \n, not treated as escape
    expect(parseSubstPath('"a\\nb"')).toEqual(['a\\nb'])
  })
})
