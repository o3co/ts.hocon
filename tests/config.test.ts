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

  it('S18.1: bare number is treated as milliseconds (not an error)', () => {
    // Previously expected to throw; fixed by S18.1 — bare numbers are ms per HOCON L1279.
    const c = parse('a = 123')
    expect(c.getDuration('a')).toBe(123)
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

  it('S18.1: bare number is treated as bytes (not an error)', () => {
    // Previously expected to throw; fixed by S18.1 — bare numbers are bytes per HOCON L1341.
    const c = parse('a = 123')
    expect(c.getBytes('a')).toBe(123)
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
  it('S15.1: getList() converts {"0":"a","1":"b"} to ["a","b"]', () => {
    const c = parse('items = {"0":"a","1":"b"}')
    expect(c.getList('items')).toEqual(['a', 'b'])
  })

  // S15.2: conversion is lazy — object is still accessible as object via untyped/object accessors.
  // Explicit guard that get/getConfig do NOT trigger conversion.
  it('S15.2: get() and getConfig() on numeric-keyed object return object (lazy, not eager)', () => {
    const c = parse('items = {"0":"a","1":"b"}')
    expect(c.get('items')).toEqual({ '0': 'a', '1': 'b' })
    expect(c.getConfig('items').getString('0')).toBe('a')
  })

  // S15.3: conversion in concatenation when list expected (spec L1210).
  it('S15.3: [a] ${obj} produces ["a","x","y"] after conversion+flatten', () => {
    const c = parse('obj = {"0":"x","1":"y"}\narr = [a] ${obj}')
    expect(c.getList('arr')).toEqual(['a', 'x', 'y'])
  })

  // S15.4: empty object must NOT be converted. Explicit empty-object guard.
  it('S15.4: getList() on empty object throws (empty object not converted)', () => {
    const c = parse('items = {}')
    expect(() => c.getList('items')).toThrow(ConfigError)
  })

  // S15.5: non-integer keys ignored during conversion
  it('S15.5: getList() ignores non-integer keys when converting {"0":"a","foo":"b","1":"c"}', () => {
    const c = parse('items = {"0":"a","foo":"b","1":"c"}')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // S15.6: missing indices compacted
  it('S15.6: getList() on {"0":"a","2":"c"} compacts missing index → ["a","c"]', () => {
    const c = parse('items = {"0":"a","2":"c"}')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // S15.7: sorted by integer key value
  it('S15.7: getList() on {"1":"b","0":"a"} produces ["a","b"] (sorted by key int)', () => {
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

// ---------------------------------------------------------------------------
// Phase 5 spec debt tests
// ---------------------------------------------------------------------------

// S1.1 — files must be valid UTF-8 (HOCON spec L117)
// The parse() API takes a JS string, which is already a decoded Unicode sequence
// (Node.js decodes bytes to strings at the I/O boundary). The parser therefore
// cannot observe raw byte sequences and has no mechanism to detect or reject
// invalid UTF-8. parseFile() uses fs.readFileSync(path, 'utf-8'), and Node's
// default UTF-8 decoder is non-fatal: invalid byte sequences are silently
// replaced with U+FFFD (REPLACEMENT CHARACTER), not thrown. Strict UTF-8
// rejection would require a custom decoder (e.g. TextDecoder with
// {fatal: true}) at the I/O layer. The parser layer cannot enforce S1.1 by
// design — what reaches it is always a valid JS string. Status: ➖
// Sanity check: multi-byte UTF-8 characters in values and keys parse correctly.
describe('S1.1 - UTF-8 handling (HOCON spec L117)', () => {
  it('S1.1: multi-byte UTF-8 characters are accepted in string values', () => {
    const c = parse('key = "héllo wörld"')
    expect(c.getString('key')).toBe('héllo wörld')
  })

  it('S1.1: multi-byte UTF-8 characters are accepted in unquoted values', () => {
    // Japanese characters in an unquoted string
    const c = parse('lang = こんにちは')
    expect(c.getString('lang')).toBe('こんにちは')
  })
})

// S3.1 — empty file is invalid (HOCON spec L130)
// Probe (2026-05-13): parse('') returns an empty Config without throwing.
// Spec L130: "Empty files are invalid documents."
describe('S3.1 - empty file is invalid (HOCON spec L130)', () => {
  it.fails('S3.1: parse("") should throw — empty file is invalid per spec L130', () => {
    // Currently returns an empty Config; spec requires an error.
    expect(() => parse('')).toThrow()
  })

  it.fails('S3.1: parse("   \\n  ") (whitespace-only) should throw — same rule', () => {
    // Whitespace-only file has no root value, same as empty.
    expect(() => parse('   \n  ')).toThrow()
  })
})

// S14a.11 — quoted "include" is just a normal key (HOCON spec L977)
describe('S14a.11 - quoted "include" is a normal key (HOCON spec L977)', () => {
  it('S14a.11: "include" = 42 creates a regular key named include', () => {
    const c = parse('"include" = 42')
    expect(c.getNumber('include')).toBe(42)
  })

  it('S14a.11: quoted "include" in an object does not trigger include semantics', () => {
    const c = parse('{ "include" = "hello" }')
    expect(c.getString('include')).toBe('hello')
  })
})

// S18.1 — number value taken as default unit (HOCON spec L1279)
// Probe (2026-05-13): getDuration on a number-typed value throws "invalid duration".
// parseDuration extracts digits → unit="" → DURATION_UNITS[""] is undefined → NaN → error.
// Spec L1279: "if the value is a number, it is taken to be a number in the default unit."
describe('S18.1 - bare number is in default unit (HOCON spec L1279)', () => {
  it('S18.1: getDuration() on a bare number treats it as milliseconds (default unit)', () => {
    const c = parse('timeout = 5000')
    // 5000 bare number → 5000 ms
    expect(c.getDuration('timeout')).toBe(5000)
  })

  it('S18.1: getDuration() on a bare number with explicit "ms" output unit', () => {
    const c = parse('timeout = 5000')
    expect(c.getDuration('timeout', 'ms')).toBe(5000)
  })

  it('S18.1: getDuration() on a bare number with "s" output unit gives seconds', () => {
    const c = parse('timeout = 5000')
    // 5000 ms → 5 s
    expect(c.getDuration('timeout', 's')).toBe(5)
  })
})

// S18.1/S18.4 — HOCON_WS trimming (Unit A: trimHoconWs helper)
// getDuration on value with ASCII whitespace already worked via stdlib trim.
// getDuration("500") is RED — no-unit fallthrough missing.
describe('S18.1/S18.4 - HOCON_WS trimming', () => {
  it('trimHoconWs: getDuration on " 500 ms " (ASCII leading+trailing WS) works', () => {
    const c = parse('a = " 500 ms "')
    expect(c.getDuration('a')).toBe(500)
  })
})

// S18.3 — unit name consists only of letters (Unicode L* / Java isLetter) (HOCON spec L1287)
// Probe (2026-05-13): "5 ms" → 5 (OK); "5 ms2" throws; "5 m-s" throws.
// Effectively passing because parseDuration does a map lookup — unknown unit = NaN = error.
describe('S18.3 - unit name must be letters-only (HOCON spec L1287)', () => {
  it('S18.3: "5 ms" is accepted (valid letter-only unit)', () => {
    const c = parse('a = "5 ms"')
    expect(c.getDuration('a')).toBe(5)
  })

  it('S18.3: "5 ms2" is rejected (digit in unit name)', () => {
    const c = parse('b = "5 ms2"')
    expect(() => c.getDuration('b')).toThrow(ConfigError)
  })

  it('S18.3: "5 m-s" is rejected (hyphen in unit name)', () => {
    const c = parse('c = "5 m-s"')
    expect(() => c.getDuration('c')).toThrow(ConfigError)
  })
})

// S18.4 — string with no unit uses default unit (HOCON spec L1290)
// Probe (2026-05-13): getDuration on "5000" (string, no unit) throws "invalid duration".
// parseDuration: unit="" → DURATION_UNITS[""] undefined → NaN → error.
// Spec L1290: "If a string value has no unit name, then it should be interpreted with the
// default unit, as if it were a number."
describe('S18.4 - string with no unit uses default unit (HOCON spec L1290)', () => {
  it('S18.4: getDuration() on string "5000" (no unit) treats it as milliseconds', () => {
    const c = parse('timeout = "5000"')
    expect(c.getDuration('timeout')).toBe(5000)
  })

  it('S18.4: getDuration() on string "30" (no unit) with "s" output gives 0.03', () => {
    const c = parse('delay = "30"')
    // 30 ms → 0.03 s
    expect(c.getDuration('delay', 's')).toBeCloseTo(0.03)
  })

  it('S18.4: getDuration() on string "5000" with explicit "ms" output unit', () => {
    const c = parse('a = "5000"')
    expect(c.getDuration('a', 'ms')).toBe(5000)
  })

  it('S18.4: getBytes() on string "1024" (no unit) returns 1024 bytes', () => {
    const c = parse('b = "1024"')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('S18.4: getBytes() on bare number 1024 returns 1024 bytes', () => {
    const c = parse('b = 1024')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('S18.4: getDuration() on string with leading+trailing WS "  5000  " → 5000 ms', () => {
    const c = parse('a = "  5000  "')
    expect(c.getDuration('a')).toBe(5000)
  })
})

// S19.8 — duration unit names are case sensitive, lowercase only (HOCON spec L1304)
// Probe (2026-05-13): "5 MS" → 5, "5 Seconds" → 5000, "5 DAYS" → 432000000.
// parseDuration applies .toLowerCase() to the unit before lookup, making it case-insensitive.
// Spec L1304: "The supported unit strings for duration are case sensitive and must be lowercase."
describe('S19.8 - duration unit names are case-sensitive lowercase (HOCON spec L1304)', () => {
  it.fails('S19.8: "5 MS" should be rejected — uppercase unit is invalid per spec', () => {
    // Currently parseDuration lowercases → "ms" → 5 ms. Should reject.
    const c = parse('a = "5 MS"')
    expect(() => c.getDuration('a')).toThrow(ConfigError)
  })

  it.fails('S19.8: "5 Seconds" should be rejected — mixed-case unit is invalid per spec', () => {
    const c = parse('b = "5 Seconds"')
    expect(() => c.getDuration('b')).toThrow(ConfigError)
  })

  it.fails('S19.8: "5 DAYS" should be rejected — uppercase unit is invalid per spec', () => {
    const c = parse('c = "5 DAYS"')
    expect(() => c.getDuration('c')).toThrow(ConfigError)
  })

  it('S19.8: "5 ms" (lowercase) is accepted', () => {
    const c = parse('a = "5 ms"')
    expect(c.getDuration('a')).toBe(5)
  })

  it('S19.8: "5 seconds" (lowercase) is accepted', () => {
    const c = parse('b = "5 seconds"')
    expect(c.getDuration('b')).toBe(5000)
  })
})

// S22.2 — intermediate non-object value hides earlier object across files/merges (HOCON spec L1406)
// Probe (2026-05-13): c1({a:{x:1}}).withFallback(c2({a:42})).withFallback(c3({a:{y:2}}))
// → {"a":{"x":1,"y":2}}. Expected per spec: {"a":{"x":1}}.
// deepMergeHocon always merges objects regardless of intermediate non-object values.
describe('S22.2 - intermediate non-object hides earlier object in merge (HOCON spec L1406)', () => {
  it.fails('S22.2: non-object in middle of fallback chain prevents object merge (spec L1406)', () => {
    // Spec example (L1410-1417):
    //   first priority: { a: { x: 1 } }
    //   fallback:       { a: 42 }       ← non-object "breaks" the chain
    //   another fallback: { a: { y: 2 } }
    // Pair (fallback, another-fallback): 42 vs {y:2} → 42 wins (non-obj beats obj)
    // Pair (first, fallback-result=42): {x:1} vs 42 → {x:1} wins (obj over scalar, no merge)
    // Result: { a: { x: 1 } }
    const c1 = parse('a { x = 1 }')
    const c2 = parse('a = 42')
    const c3 = parse('a { y = 2 }')
    // Currently produces {"a":{"x":1,"y":2}} — incorrectly merges all three.
    expect(c1.withFallback(c2).withFallback(c3).toObject()).toEqual({ a: { x: 1 } })
  })

  it('S22.2: two adjacent objects do merge correctly', () => {
    // Control: without a non-object interruption, two objects should merge.
    const c1 = parse('a { x = 1 }')
    const c2 = parse('a { y = 2 }')
    expect(c1.withFallback(c2).toObject()).toEqual({ a: { x: 1, y: 2 } })
  })

  it('S22.2: non-object higher-priority wins over lower-priority object', () => {
    // c1 wins (scalar 42 > object fallback) — this sub-rule already works
    const c1 = parse('a = 42')
    const c2 = parse('a { x = 1 }')
    expect(c1.withFallback(c2).toObject()).toEqual({ a: 42 })
  })
})

// S22.3 — setting key to null clears earlier object value (HOCON spec L1436)
// Probe (2026-05-13): parse('a=null').withFallback(parse('a{x:1}')) → a=null ✅
describe('S22.3 - null clears earlier object value in fallback (HOCON spec L1436)', () => {
  it('S22.3: null in higher-priority config clears object in fallback', () => {
    const c1 = parse('a = null')
    const c2 = parse('a { x = 1 }')
    // null (c1) has higher priority; it wins over the object in the fallback (c2).
    expect(c1.withFallback(c2).get('a')).toBeNull()
  })

  it('S22.3: object in higher-priority config wins over null fallback', () => {
    const c1 = parse('a { x = 1 }')
    const c2 = parse('a = null')
    // Object (c1) has higher priority; null fallback is just ignored.
    expect(c1.withFallback(c2).toObject()).toEqual({ a: { x: 1 } })
  })
})

// S26.2 — empty env var preserved as empty string (HOCON spec L1558)
// Probe (2026-05-13): resolveStr('a = ${EMPTY_VAR}', { EMPTY_VAR: '' }) →
// { kind: 'scalar', raw: '', valueType: 'string' } ✅
describe('S26.2 - empty env var preserved as empty string (HOCON spec L1558)', () => {
  it('S26.2: empty-string env var resolves to empty string, not undefined', () => {
    const c = parse('a = ${EMPTY_VAR}', { env: { EMPTY_VAR: '' } })
    expect(c.getString('a')).toBe('')
  })

  it('S26.2: empty-string env var does not cause required substitution error', () => {
    // An empty string is a valid value — the field must exist after resolution.
    const c = parse('a = ${EMPTY_VAR}', { env: { EMPTY_VAR: '' } })
    expect(c.has('a')).toBe(true)
  })
})
