// tests/config.test.ts
import { describe, it, expect } from 'vitest'
import { Config } from '../src/config.js'
import type { HoconValue } from '../src/value.js'
import { ConfigError } from '../src/errors.js'

function makeConfig(obj: Record<string, HoconValue>): Config {
  return new Config({ kind: 'object', fields: new Map(Object.entries(obj)) })
}

describe('Config', () => {
  it('get() returns value at path', () => {
    const c = makeConfig({ host: { kind: 'scalar', value: 'localhost' } })
    expect(c.get('host')).toBe('localhost')
  })

  it('get() returns nested value at dot-path', () => {
    const inner = new Map([['host', { kind: 'scalar', value: 'localhost' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    expect(c.get('server.host')).toBe('localhost')
  })

  it('get() returns undefined for missing path', () => {
    const c = makeConfig({})
    expect(c.get('missing')).toBeUndefined()
  })

  it('getString() returns string value', () => {
    const c = makeConfig({ host: { kind: 'scalar', value: 'localhost' } })
    expect(c.getString('host')).toBe('localhost')
  })

  it('getString() throws ConfigError for non-string', () => {
    const c = makeConfig({ port: { kind: 'scalar', value: 8080 } })
    expect(() => c.getString('port')).toThrow(ConfigError)
  })

  it('getNumber() returns number value', () => {
    const c = makeConfig({ port: { kind: 'scalar', value: 8080 } })
    expect(c.getNumber('port')).toBe(8080)
  })

  it('getNumber() throws ConfigError for non-number', () => {
    const c = makeConfig({ host: { kind: 'scalar', value: 'localhost' } })
    expect(() => c.getNumber('host')).toThrow(ConfigError)
  })

  it('getBoolean() returns boolean value', () => {
    const c = makeConfig({ debug: { kind: 'scalar', value: true } })
    expect(c.getBoolean('debug')).toBe(true)
  })

  it('getConfig() returns sub-config', () => {
    const inner = new Map([['host', { kind: 'scalar', value: 'localhost' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    const sub = c.getConfig('server')
    expect(sub).toBeInstanceOf(Config)
    expect(sub.getString('host')).toBe('localhost')
  })

  it('getList() returns array as unknown[]', () => {
    const items: HoconValue[] = [{ kind: 'scalar', value: 1 }, { kind: 'scalar', value: 2 }]
    const c = makeConfig({ list: { kind: 'array', items } })
    expect(c.getList('list')).toEqual([1, 2])
  })

  it('has() returns true for existing key', () => {
    const c = makeConfig({ host: { kind: 'scalar', value: 'localhost' } })
    expect(c.has('host')).toBe(true)
  })

  it('has() returns true for null value', () => {
    const c = makeConfig({ x: { kind: 'scalar', value: null } })
    expect(c.has('x')).toBe(true)
  })

  it('has() returns false for missing key', () => {
    const c = makeConfig({})
    expect(c.has('missing')).toBe(false)
  })

  it('keys() returns top-level keys in order', () => {
    const c = new Config({ kind: 'object', fields: new Map([['b', { kind: 'scalar', value: 2 }], ['a', { kind: 'scalar', value: 1 }]]) })
    expect(c.keys()).toEqual(['b', 'a'])
  })

  it('withFallback() receiver wins', () => {
    const c1 = makeConfig({ host: { kind: 'scalar', value: 'prod' } })
    const c2 = makeConfig({ host: { kind: 'scalar', value: 'dev' }, port: { kind: 'scalar', value: 8080 } })
    const merged = c1.withFallback(c2)
    expect(merged.getString('host')).toBe('prod')
    expect(merged.getNumber('port')).toBe(8080)
  })

  it('toObject() converts to plain JS object recursively', () => {
    const inner = new Map([['host', { kind: 'scalar', value: 'localhost' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    expect(c.toObject()).toEqual({ server: { host: 'localhost' } })
  })
})
