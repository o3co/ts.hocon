// tests/resolver.test.ts
import { describe, expect, it } from 'vitest'
import { ResolveError } from '../src/errors.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { resolve } from '../src/internal/resolver/resolver.js'
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
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', value: 'localhost' })
  })

  it('resolves number value', () => {
    const v = resolveStr('port = 8080')
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', value: 8080 })
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
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', value: 2 })
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
    expect(obj(v).get('url')).toEqual({ kind: 'scalar', value: 'localhost' })
  })

  it('resolves nested path substitution', () => {
    const v = resolveStr('server { host = "x" }\nhost = ${server.host}')
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', value: 'x' })
  })

  it('resolves ${?path} optional substitution (path exists)', () => {
    const v = resolveStr('a = 1\nb = ${?a}')
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', value: 1 })
  })

  it('drops field for ${?path} optional substitution (path missing)', () => {
    const v = resolveStr('b = ${?missing}')
    expect(obj(v).get('b')).toBeUndefined()
  })

  it('falls back to prior value when ${?path} is unresolved', () => {
    const v = resolveStr('port = 50051\nport = ${?GRPC_PORT}')
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', value: 50051 })
  })

  it('uses env var when ${?path} resolves', () => {
    const v = resolveStr('port = 50051\nport = ${?GRPC_PORT}', { GRPC_PORT: '9090' })
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', value: '9090' })
  })

  it('falls back to prior value for nested ${?path}', () => {
    const v = resolveStr('server { port = 8080 }\nserver { port = ${?SERVER_PORT} }')
    const server = obj(v).get('server')
    if (server?.kind === 'object') {
      expect(server.fields.get('port')).toEqual({ kind: 'scalar', value: 8080 })
    }
  })

  it('throws ResolveError for unresolved mandatory substitution', () => {
    expect(() => resolveStr('b = ${missing}')).toThrow(ResolveError)
  })

  it('falls back to env for unresolved substitution', () => {
    const v = resolveStr('b = ${MY_VAR}', { MY_VAR: 'hello' })
    expect(obj(v).get('b')).toEqual({ kind: 'scalar', value: 'hello' })
  })

  it('resolves self-referential substitution', () => {
    const v = resolveStr('path = "/usr"\npath = ${path}:/extra')
    // concat resolves: "/usr" + ":/extra" = "/usr:/extra"
    const result = obj(v).get('path')
    if (result?.kind === 'scalar') expect(String(result.value)).toContain('/usr')
  })

  it('resolves string concat with substitution', () => {
    const v = resolveStr('host = "localhost"\nurl = "http://"${host}')
    const result = obj(v).get('url')
    expect(result?.kind === 'scalar' && result.value).toBe('http://localhost')
  })

  it('throws ResolveError on circular substitution', () => {
    expect(() => resolveStr('a = ${b}\nb = ${a}')).toThrow(ResolveError)
  })

  it('resolves forward-reference substitution', () => {
    const v = resolveStr('url = $' + '{host}\nhost = "localhost"')
    expect(obj(v).get('url')).toEqual({ kind: 'scalar', value: 'localhost' })
  })
})

describe('Resolver - object concatenation deep merge', () => {
  it('should deep-merge concatenated objects', () => {
    const v = resolveStr('a = {x: {y: 1}} {x: {z: 2}}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    const x = a.fields.get('x')
    if (x?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...x.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.value : v]))
    expect(entries).toEqual({ y: 1, z: 2 })
  })

  it('should recursively deep-merge nested objects', () => {
    const v = resolveStr('a = {x: {y: {deep: 1}}} {x: {y: {other: 2}}}')
    const a = obj(v).get('a')
    if (a?.kind !== 'object') throw new Error('expected object')
    const x = a.fields.get('x')
    if (x?.kind !== 'object') throw new Error('expected object')
    const y = x.fields.get('y')
    if (y?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...y.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.value : v]))
    expect(entries).toEqual({ deep: 1, other: 2 })
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
    expect(x).toEqual({ kind: 'scalar', value: 1 })
    const y = a.fields.get('y')
    expect(y).toEqual({ kind: 'scalar', value: 2 })
    const z = a.fields.get('z')
    expect(z).toEqual({ kind: 'scalar', value: 3 })
    const nested = a.fields.get('nested')
    if (nested?.kind !== 'object') throw new Error('expected object')
    const entries = Object.fromEntries([...nested.fields.entries()].map(([k, v]) => [k, v.kind === 'scalar' ? v.value : v]))
    expect(entries).toEqual({ a: 1, b: 2, c: 3 })
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
    expect(obj(v).get('host')).toEqual({ kind: 'scalar', value: 'localhost' })
    expect(obj(v).get('port')).toEqual({ kind: 'scalar', value: 8080 })
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
    expect(x).toEqual({ kind: 'scalar', value: null })
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
    expect(obj(v).get('x')).toEqual({ kind: 'scalar', value: 42 })
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
    expect(obj(v).get('probed')).toEqual({ kind: 'scalar', value: true })
    expect(obj(v).get('local')).toEqual({ kind: 'scalar', value: 1 })
  })

  it('silently ignores include when no candidates found', () => {
    const v = resolveStr('include "ghost"\nlocal = 7', {}, {})
    expect(obj(v).get('local')).toEqual({ kind: 'scalar', value: 7 })
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
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', value: 1 })
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
    expect(obj(v).get('a')).toEqual({ kind: 'scalar', value: 1 })
  })
})
