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
    const c = makeConfig({ host: { kind: 'scalar', raw: 'localhost', valueType: 'string' } })
    expect(c.get('host')).toBe('localhost')
  })

  it('get() returns nested value at dot-path', () => {
    const inner = new Map([['host', { kind: 'scalar', raw: 'localhost', valueType: 'string' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    expect(c.get('server.host')).toBe('localhost')
  })

  it('get() returns undefined for missing path', () => {
    const c = makeConfig({})
    expect(c.get('missing')).toBeUndefined()
  })

  it('getString() returns string value', () => {
    const c = makeConfig({ host: { kind: 'scalar', raw: 'localhost', valueType: 'string' } })
    expect(c.getString('host')).toBe('localhost')
  })

  it('getString() returns raw for any valueType (Lightbend compatible)', () => {
    const c = makeConfig({ port: { kind: 'scalar', raw: '8080', valueType: 'number' } })
    expect(c.getString('port')).toBe('8080')
  })

  it('getNumber() returns number value', () => {
    const c = makeConfig({ port: { kind: 'scalar', raw: '8080', valueType: 'number' } })
    expect(c.getNumber('port')).toBe(8080)
  })

  it('getNumber() coerces numeric string to number', () => {
    const c = makeConfig({ port: { kind: 'scalar', raw: '9999', valueType: 'string' } })
    expect(c.getNumber('port')).toBe(9999)
  })

  it('getNumber() throws ConfigError for non-numeric string', () => {
    const c = makeConfig({ host: { kind: 'scalar', raw: 'localhost', valueType: 'string' } })
    expect(() => c.getNumber('host')).toThrow(ConfigError)
  })

  it('getNumber() throws ConfigError for non-number/non-string', () => {
    const c = makeConfig({ flag: { kind: 'scalar', raw: 'true', valueType: 'boolean' } })
    expect(() => c.getNumber('flag')).toThrow(ConfigError)
  })

  it('getNumber() rejects hex strings', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: '0xff', valueType: 'string' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getNumber() rejects Infinity', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'Infinity', valueType: 'string' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getNumber() rejects whitespace-only string', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: '   ', valueType: 'string' } })
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('getBoolean() returns boolean value', () => {
    const c = makeConfig({ debug: { kind: 'scalar', raw: 'true', valueType: 'boolean' } })
    expect(c.getBoolean('debug')).toBe(true)
  })

  it('getBoolean() coerces string "true" to true', () => {
    const c = makeConfig({ debug: { kind: 'scalar', raw: 'true', valueType: 'string' } })
    expect(c.getBoolean('debug')).toBe(true)
  })

  it('getBoolean() coerces string "false" to false', () => {
    const c = makeConfig({ debug: { kind: 'scalar', raw: 'false', valueType: 'string' } })
    expect(c.getBoolean('debug')).toBe(false)
  })

  it('getBoolean() coerces string "yes" to true', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'yes', valueType: 'string' } })
    expect(c.getBoolean('val')).toBe(true)
  })

  it('getBoolean() coerces string "no" to false', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'no', valueType: 'string' } })
    expect(c.getBoolean('val')).toBe(false)
  })

  it('getBoolean() coerces string "on" to true', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'on', valueType: 'string' } })
    expect(c.getBoolean('val')).toBe(true)
  })

  it('getBoolean() coerces string "off" to false', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'off', valueType: 'string' } })
    expect(c.getBoolean('val')).toBe(false)
  })

  it('getBoolean() is case-insensitive', () => {
    const c1 = makeConfig({ val: { kind: 'scalar', raw: 'TRUE', valueType: 'string' } })
    expect(c1.getBoolean('val')).toBe(true)
    const c2 = makeConfig({ val: { kind: 'scalar', raw: 'Yes', valueType: 'string' } })
    expect(c2.getBoolean('val')).toBe(true)
    const c3 = makeConfig({ val: { kind: 'scalar', raw: 'OFF', valueType: 'string' } })
    expect(c3.getBoolean('val')).toBe(false)
  })

  it('getBoolean() throws ConfigError for non-boolean string', () => {
    const c = makeConfig({ val: { kind: 'scalar', raw: 'maybe', valueType: 'string' } })
    expect(() => c.getBoolean('val')).toThrow(ConfigError)
  })

  it('getConfig() returns sub-config', () => {
    const inner = new Map([['host', { kind: 'scalar', raw: 'localhost', valueType: 'string' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    const sub = c.getConfig('server')
    expect(sub).toBeInstanceOf(Config)
    expect(sub.getString('host')).toBe('localhost')
  })

  it('getList() returns array as unknown[]', () => {
    const items: HoconValue[] = [{ kind: 'scalar', raw: '1', valueType: 'number' }, { kind: 'scalar', raw: '2', valueType: 'number' }]
    const c = makeConfig({ list: { kind: 'array', items } })
    expect(c.getList('list')).toEqual([1, 2])
  })

  it('has() returns true for existing key', () => {
    const c = makeConfig({ host: { kind: 'scalar', raw: 'localhost', valueType: 'string' } })
    expect(c.has('host')).toBe(true)
  })

  it('has() returns true for null value', () => {
    const c = makeConfig({ x: { kind: 'scalar', raw: 'null', valueType: 'null' } })
    expect(c.has('x')).toBe(true)
  })

  it('has() returns false for missing key', () => {
    const c = makeConfig({})
    expect(c.has('missing')).toBe(false)
  })

  it('keys() returns top-level keys in order', () => {
    const c = new Config({ kind: 'object', fields: new Map([['b', { kind: 'scalar', raw: '2', valueType: 'number' }], ['a', { kind: 'scalar', raw: '1', valueType: 'number' }]]) })
    expect(c.keys()).toEqual(['b', 'a'])
  })

  it('withFallback() receiver wins', () => {
    const c1 = makeConfig({ host: { kind: 'scalar', raw: 'prod', valueType: 'string' } })
    const c2 = makeConfig({ host: { kind: 'scalar', raw: 'dev', valueType: 'string' }, port: { kind: 'scalar', raw: '8080', valueType: 'number' } })
    const merged = c1.withFallback(c2)
    expect(merged.getString('host')).toBe('prod')
    expect(merged.getNumber('port')).toBe(8080)
  })

  it('toObject() converts to plain JS object recursively', () => {
    const inner = new Map([['host', { kind: 'scalar', raw: 'localhost', valueType: 'string' } satisfies HoconValue]])
    const c = new Config({ kind: 'object', fields: new Map([['server', { kind: 'object', fields: inner }]]) })
    expect(c.toObject()).toEqual({ server: { host: 'localhost' } })
  })
})

describe('Config - scalar type preservation (Lightbend compatible)', () => {
  it('getString() returns raw text for number values', () => {
    const config = parse('port = 8080')
    expect(config.getString('port')).toBe('8080')
  })

  it('getString() returns raw text for boolean values', () => {
    const config = parse('enabled = true')
    expect(config.getString('enabled')).toBe('true')
  })

  it('.33 is preserved as string, not converted to number', () => {
    const config = parse('val = .33')
    expect(config.getString('val')).toBe('.33')
    expect(config.toObject()).toEqual({ val: '.33' })
  })

  it('0100 raw string is preserved via getString', () => {
    const config = parse('val = 0100')
    expect(config.getString('val')).toBe('0100')
    expect(config.getNumber('val')).toBe(100)
  })

  it('toObject() outputs numbers for number-typed values', () => {
    const config = parse('port = 8080\npi = 3.14\nneg = -1')
    expect(config.toObject()).toEqual({ port: 8080, pi: 3.14, neg: -1 })
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

  it('throws on invalid duration', () => {
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

  it('throws on invalid byte size', () => {
    const c = parse('a = 123')
    expect(() => c.getBytes('a')).toThrow(ConfigError)
  })

  it('throws on unknown unit', () => {
    const c = parse('a = "512XB"')
    expect(() => c.getBytes('a')).toThrow(ConfigError)
  })

  it('parses fractional byte sizes', () => {
    const c = parse('size = "1.5GB"')
    expect(c.getBytes('size')).toBe(1_500_000_000)
  })

  it('parses lowercase short units', () => {
    const c = parse('size = "10kb"')
    expect(c.getBytes('size')).toBe(10_000)
  })

  it('parses mixed case units', () => {
    const c = parse('size = "512mb"')
    expect(c.getBytes('size')).toBe(512_000_000)
  })

  it('rounds to integer when output unit is bytes', () => {
    const c = parse('size = "1.1KiB"')
    expect(c.getBytes('size')).toBe(1126) // Math.round(1.1 * 1024) = 1126
  })

  it('does not round when output unit is not bytes', () => {
    const c = parse('size = "1.1KiB"')
    expect(c.getBytes('size', 'KiB')).toBeCloseTo(1.1) // fractional KiB is fine
  })

  // S21.4 — single-letter byte abbreviations map to powers of 2 (java -Xmx convention)
  // Issue #89: these are not yet recognised by parseBytes()
  it.fails('S21.4: parses single-letter K as kibibytes (1024)', () => {
    const c = parse('size = "1K"')
    expect(c.getBytes('size')).toBe(1024)
  })

  it.fails('S21.4: parses single-letter k (lowercase) as kibibytes', () => {
    const c = parse('size = "1k"')
    expect(c.getBytes('size')).toBe(1024)
  })

  it.fails('S21.4: parses single-letter M as mebibytes (1024^2)', () => {
    const c = parse('size = "1M"')
    expect(c.getBytes('size')).toBe(1_048_576)
  })

  it.fails('S21.4: parses single-letter G as gibibytes (1024^3)', () => {
    const c = parse('size = "1G"')
    expect(c.getBytes('size')).toBe(1_073_741_824)
  })

  it.fails('S21.4: parses single-letter T as tebibytes (1024^4)', () => {
    const c = parse('size = "1T"')
    expect(c.getBytes('size')).toBe(1_099_511_627_776)
  })
})

// S15 — Numerically-indexed objects to arrays (HOCON spec L1184–L1219)
// Issue #87: getList() does not perform object-to-array conversion
describe('S15 - numerically-indexed object to array', () => {
  // S15.1: basic conversion when array type is requested
  it.fails('S15.1: getList() converts {"0":"a","1":"b"} to ["a","b"]', () => {
    const c = parse('items = {"0":"a","1":"b"}')
    expect(c.getList('items')).toEqual(['a', 'b'])
  })

  // S15.2: conversion is lazy — object is still accessible as object before type-coercion.
  // Trivially passes today because no conversion exists; once #87 lands, this must
  // continue passing to confirm the implementation is genuinely lazy (does not eagerly
  // convert during parse). Re-validate after #87.
  it('S15.2: get() and getConfig() on numeric-keyed object return object (lazy, not eager)', () => {
    const c = parse('items = {"0":"a","1":"b"}')
    // As a plain get(), it returns the object (no eager conversion)
    expect(c.get('items')).toEqual({ '0': 'a', '1': 'b' })
    // getConfig() also works — object not auto-converted
    expect(c.getConfig('items').getString('0')).toBe('a')
  })

  // S15.3: conversion in concatenation when list expected (spec L1210).
  // Probe (2026-05-13) shows `arr = [a] ${obj}` parses to a 3-element array
  // ["a", " ", {"0":"x","1":"y"}] — whitespace artefact + un-converted object.
  // Spec requires conversion + flatten to ["a","x","y"]. Pin asserts the un-converted
  // last element so a future #87 fix flips it; .fails version asserts the spec shape.
  it('S15.3: [a] ${obj} concat currently includes un-converted object as last element', () => {
    const c = parse('obj = {"0":"x","1":"y"}\narr = [a] ${obj}')
    const items = c.getList('arr') as unknown[]
    expect(items.length).toBe(3)
    // Last element is the un-converted object, not the flattened "x"/"y" strings.
    expect(typeof items[items.length - 1]).toBe('object')
    expect(items[items.length - 1]).not.toBeNull()
  })

  it.fails('S15.3: [a] ${obj} should produce ["a","x","y"] after conversion+flatten (spec L1210, see #87)', () => {
    const c = parse('obj = {"0":"x","1":"y"}\narr = [a] ${obj}')
    expect(c.getList('arr')).toEqual(['a', 'x', 'y'])
  })

  // S15.4: empty object must NOT be converted. Trivially passes today because no
  // conversion exists at all; once #87 lands, this must continue passing to confirm
  // the implementation has an explicit empty-object guard. Re-validate after #87.
  it('S15.4: getList() on empty object still throws (empty object not converted)', () => {
    const c = parse('items = {}')
    expect(() => c.getList('items')).toThrow(ConfigError)
  })

  // S15.5: non-integer keys ignored during conversion
  it.fails('S15.5: getList() ignores non-integer keys when converting {"0":"a","foo":"b","1":"c"}', () => {
    const c = parse('items = {"0":"a","foo":"b","1":"c"}')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // S15.6: missing indices compacted
  it.fails('S15.6: getList() on {"0":"a","2":"c"} compacts missing index → ["a","c"]', () => {
    const c = parse('items = {"0":"a","2":"c"}')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // S15.7: sorted by integer key value
  it.fails('S15.7: getList() on {"1":"b","0":"a"} produces ["a","b"] (sorted by key int)', () => {
    const c = parse('items = {"1":"b","0":"a"}')
    expect(c.getList('items')).toEqual(['a', 'b'])
  })
})

// S17.5 — "null" string → null when null requested (HOCON spec L1244)
// ts.hocon has no dedicated getNull() method; get() already correctly returns string "null"
// for quoted string values and JS null for unquoted null literals.
describe('S17.5 - "null" string vs null literal', () => {
  it('S17.5: quoted "null" value is stored as a string, not as null', () => {
    const c = parse('val = "null"')
    // get() converts based on valueType; quoted strings have valueType 'string'
    expect(c.get('val')).toBe('null')  // JS string, not null
  })

  it('S17.5: unquoted null literal is stored as null type', () => {
    const c = parse('val = null')
    expect(c.get('val')).toBeNull()
  })

  it('S17.5: getString() on quoted "null" returns the string "null"', () => {
    const c = parse('val = "null"')
    expect(c.getString('val')).toBe('null')
  })
})

// S17.6 — null → other type: error (HOCON spec L1252)
describe('S17.6 - null to other type must error', () => {
  // Issue #88: getString() on null-typed value should throw but currently returns "null"
  it.fails('S17.6: getString() on null value should throw ConfigError', () => {
    const c = parse('val = null')
    expect(() => c.getString('val')).toThrow(ConfigError)
  })

  it('S17.6: getNumber() on null value throws ConfigError', () => {
    const c = parse('val = null')
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('S17.6: getBoolean() on null value throws ConfigError', () => {
    const c = parse('val = null')
    expect(() => c.getBoolean('val')).toThrow(ConfigError)
  })

  it('S17.6: getList() on null value throws ConfigError', () => {
    const c = parse('val = null')
    expect(() => c.getList('val')).toThrow(ConfigError)
  })
})

// S17.7 — object → other type: error (HOCON spec L1254)
describe('S17.7 - object to other type must error', () => {
  it('S17.7: getString() on object value throws ConfigError', () => {
    const c = parse('val = {a: 1}')
    expect(() => c.getString('val')).toThrow(ConfigError)
  })

  it('S17.7: getNumber() on object value throws ConfigError', () => {
    const c = parse('val = {a: 1}')
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('S17.7: getBoolean() on object value throws ConfigError', () => {
    const c = parse('val = {a: 1}')
    expect(() => c.getBoolean('val')).toThrow(ConfigError)
  })

  it('S17.7: getList() on object value throws ConfigError', () => {
    const c = parse('val = {a: 1}')
    expect(() => c.getList('val')).toThrow(ConfigError)
  })
})

// S17.8 — array → other (except numeric-indexed): error (HOCON spec L1255)
describe('S17.8 - array to other type must error', () => {
  it('S17.8: getString() on array value throws ConfigError', () => {
    const c = parse('val = [1, 2, 3]')
    expect(() => c.getString('val')).toThrow(ConfigError)
  })

  it('S17.8: getNumber() on array value throws ConfigError', () => {
    const c = parse('val = [1, 2, 3]')
    expect(() => c.getNumber('val')).toThrow(ConfigError)
  })

  it('S17.8: getBoolean() on array value throws ConfigError', () => {
    const c = parse('val = [1, 2, 3]')
    expect(() => c.getBoolean('val')).toThrow(ConfigError)
  })

  it('S17.8: getConfig() on array value throws ConfigError', () => {
    const c = parse('val = [1, 2, 3]')
    expect(() => c.getConfig('val')).toThrow(ConfigError)
  })
})
