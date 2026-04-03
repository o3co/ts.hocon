// tests/config.test.ts
import { describe, it, expect } from 'vitest'
import { Config } from '../src/config.js'
import type { HoconValue } from '../src/value.js'
import { ConfigError } from '../src/errors.js'
import { parse } from '../src/index.js'

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

  it('getNumber() coerces numeric string to number', () => {
    const c = makeConfig({ port: { kind: 'scalar', value: '9999' } })
    expect(c.getNumber('port')).toBe(9999)
  })

  it('getNumber() throws ConfigError for non-numeric string', () => {
    const c = makeConfig({ host: { kind: 'scalar', value: 'localhost' } })
    expect(() => c.getNumber('host')).toThrow(ConfigError)
  })

  it('getNumber() throws ConfigError for non-number/non-string', () => {
    const c = makeConfig({ flag: { kind: 'scalar', value: true } })
    expect(() => c.getNumber('flag')).toThrow(ConfigError)
  })

  it('getNumber() rejects hex strings', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: '0xff' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getNumber() rejects Infinity', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'Infinity' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getNumber() rejects whitespace-only string', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: '   ' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getBoolean() returns boolean value', () => {
    const c = makeConfig({ debug: { kind: 'scalar', value: true } })
    expect(c.getBoolean('debug')).toBe(true)
  })

  it('getBoolean() coerces string "true" to true', () => {
    const c = makeConfig({ debug: { kind: 'scalar', value: 'true' } })
    expect(c.getBoolean('debug')).toBe(true)
  })

  it('getBoolean() coerces string "false" to false', () => {
    const c = makeConfig({ debug: { kind: 'scalar', value: 'false' } })
    expect(c.getBoolean('debug')).toBe(false)
  })

  it('getBoolean() coerces string "yes" to true', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'yes' } })
    expect(c.getBoolean('val')).toBe(true)
  })

  it('getBoolean() coerces string "no" to false', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'no' } })
    expect(c.getBoolean('val')).toBe(false)
  })

  it('getBoolean() coerces string "on" to true', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'on' } })
    expect(c.getBoolean('val')).toBe(true)
  })

  it('getBoolean() coerces string "off" to false', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'off' } })
    expect(c.getBoolean('val')).toBe(false)
  })

  it('getBoolean() is case-insensitive', () => {
    const c1 = makeConfig({ val: { kind: 'scalar', value: 'TRUE' } })
    expect(c1.getBoolean('val')).toBe(true)
    const c2 = makeConfig({ val: { kind: 'scalar', value: 'Yes' } })
    expect(c2.getBoolean('val')).toBe(true)
    const c3 = makeConfig({ val: { kind: 'scalar', value: 'OFF' } })
    expect(c3.getBoolean('val')).toBe(false)
  })

  it('getBoolean() throws ConfigError for non-boolean string', () => {
    const c = makeConfig({ val: { kind: 'scalar', value: 'maybe' } })
    expect(() => c.getBoolean('val')).toThrow(ConfigError)
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

describe('Config - quoted path segments', () => {
  it('should access keys containing dots via quoted path', () => {
    const cfg = parse('"a.b" = 1')
    expect(cfg.has('"a.b"')).toBe(true)
    expect(cfg.getNumber('"a.b"')).toBe(1)
  })

  it('should access nested keys with quoted segments', () => {
    const cfg = parse('server { "web.api" { port = 8080 } }')
    expect(cfg.getNumber('server."web.api".port')).toBe(8080)
  })

  it('should still work with normal dotted paths', () => {
    const cfg = parse('a { b { c = 1 } }')
    expect(cfg.getNumber('a.b.c')).toBe(1)
  })

  it('should access keys containing escaped quotes via quoted path', () => {
    // HOCON: "a\"b" = 1  — lexer unescapes to key a"b
    // path arg: '"a\\"b"' — which is the 7-char string: "a\"b"
    const cfg = parse('"a\\"b" = 1')
    expect(cfg.getNumber('"a\\"b"')).toBe(1)
  })

  it('should access keys containing backslash via quoted path', () => {
    // HOCON: "a\\b" = 2  — lexer unescapes to key a\b
    // path arg: '"a\\\\b"' — which is the 7-char string: "a\\b"
    const cfg = parse('"a\\\\b" = 2')
    expect(cfg.getNumber('"a\\\\b"')).toBe(2)
  })

  it('should throw on unterminated quoted path segment', () => {
    const cfg = parse('a = 1')
    expect(() => cfg.has('"unterminated')).toThrow(/unterminated/)
  })
})

describe('getDuration', () => {
  it('parses seconds to ms', () => {
    const c = parse('timeout = "30s"')
    expect(c.getDuration('timeout')).toBe(30_000)
  })

  it('parses minutes to ms', () => {
    const c = parse('ttl = "5m"')
    expect(c.getDuration('ttl')).toBe(300_000)
  })

  it('parses hours to ms', () => {
    const c = parse('expiry = "2h"')
    expect(c.getDuration('expiry')).toBe(7_200_000)
  })

  it('parses days to ms', () => {
    const c = parse('retention = "7d"')
    expect(c.getDuration('retention')).toBe(604_800_000)
  })

  it('parses milliseconds', () => {
    const c = parse('delay = "100ms"')
    expect(c.getDuration('delay')).toBe(100)
  })

  it('parses nanoseconds to ms', () => {
    const c = parse('tick = "5000000ns"')
    expect(c.getDuration('tick')).toBe(5)
  })

  it('parses microseconds to ms', () => {
    const c = parse('tick = "5000us"')
    expect(c.getDuration('tick')).toBe(5)
  })

  it('supports long unit names', () => {
    const c = parse('timeout = "30 seconds"')
    expect(c.getDuration('timeout')).toBe(30_000)
  })

  it('supports fractional values', () => {
    const c = parse('timeout = "1.5s"')
    expect(c.getDuration('timeout')).toBe(1_500)
  })

  it('returns in requested unit', () => {
    const c = parse('timeout = "30s"')
    expect(c.getDuration('timeout', 's')).toBe(30)
    expect(c.getDuration('timeout', 'm')).toBeCloseTo(0.5)
  })

  it('throws on missing path', () => {
    const c = parse('a = 1')
    expect(() => c.getDuration('missing')).toThrow(ConfigError)
  })

  it('throws on non-string value', () => {
    const c = parse('a = 123')
    expect(() => c.getDuration('a')).toThrow(ConfigError)
  })

  it('throws on unknown unit', () => {
    const c = parse('a = "30x"')
    expect(() => c.getDuration('a')).toThrow(ConfigError)
  })

  it('throws on no number', () => {
    const c = parse('a = "seconds"')
    expect(() => c.getDuration('a')).toThrow(ConfigError)
  })
})

describe('getBytes', () => {
  it('parses plain bytes', () => {
    const c = parse('size = "1024B"')
    expect(c.getBytes('size')).toBe(1024)
  })

  it('parses kilobytes (SI)', () => {
    const c = parse('size = "10KB"')
    expect(c.getBytes('size')).toBe(10_000)
  })

  it('parses kibibytes (IEC)', () => {
    const c = parse('size = "10KiB"')
    expect(c.getBytes('size')).toBe(10_240)
  })

  it('parses megabytes', () => {
    const c = parse('size = "512MB"')
    expect(c.getBytes('size')).toBe(512_000_000)
  })

  it('parses mebibytes', () => {
    const c = parse('size = "512MiB"')
    expect(c.getBytes('size')).toBe(536_870_912)
  })

  it('parses gigabytes', () => {
    const c = parse('size = "2GB"')
    expect(c.getBytes('size')).toBe(2_000_000_000)
  })

  it('parses gibibytes', () => {
    const c = parse('size = "1GiB"')
    expect(c.getBytes('size')).toBe(1_073_741_824)
  })

  it('parses terabytes', () => {
    const c = parse('size = "1TB"')
    expect(c.getBytes('size')).toBe(1_000_000_000_000)
  })

  it('parses tebibytes', () => {
    const c = parse('size = "1TiB"')
    expect(c.getBytes('size')).toBe(1_099_511_627_776)
  })

  it('supports long unit names', () => {
    const c = parse('size = "512 megabytes"')
    expect(c.getBytes('size')).toBe(512_000_000)
  })

  it('returns in requested unit', () => {
    const c = parse('size = "1GiB"')
    expect(c.getBytes('size', 'MiB')).toBe(1024)
    expect(c.getBytes('size', 'MB')).toBeCloseTo(1073.741824)
  })

  it('throws on missing path', () => {
    const c = parse('a = 1')
    expect(() => c.getBytes('missing')).toThrow(ConfigError)
  })

  it('throws on non-string value', () => {
    const c = parse('a = 123')
    expect(() => c.getBytes('a')).toThrow(ConfigError)
  })

  it('throws on unknown unit', () => {
    const c = parse('a = "512XB"')
    expect(() => c.getBytes('a')).toThrow(ConfigError)
  })
})
