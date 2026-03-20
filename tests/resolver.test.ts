// tests/resolver.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { resolve } from '../src/internal/resolver/resolver.js'
import type { HoconValue } from '../src/value.js'
import { ResolveError } from '../src/errors.js'

function resolveStr(input: string, env: Record<string, string> = {}): HoconValue {
  const ast = parseTokens(tokenize(input))
  return resolve(ast, { env, baseDir: undefined, readFileSync: () => { throw new Error('no fs') } })
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

describe('Resolver - include', () => {
  function resolveWithFs(input: string, files: Record<string, string>): HoconValue {
    const ast = parseTokens(tokenize(input))
    return resolve(ast, {
      env: {},
      baseDir: '/fake',
      readFileSync: (p: string) => {
        const key = p.replace('/fake/', '')
        if (!(key in files)) throw new Error(`file not found: ${p}`)
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
