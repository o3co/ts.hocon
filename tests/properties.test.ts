import { describe, it, expect } from 'vitest'
import { parseProperties } from '../src/internal/properties/properties.js'
import { parsePropertiesConfig } from '../src/adapters/properties.js'

describe('parseProperties', () => {
  it('parses simple key=value pairs', () => {
    const result = parseProperties('host=localhost\nport=8080')
    expect(result).toEqual({ host: 'localhost', port: '8080' })
  })

  it('parses key:value with colon separator', () => {
    const result = parseProperties('host:localhost')
    expect(result).toEqual({ host: 'localhost' })
  })

  // Java skips whitespace before a value but never after it, so the trailing
  // run survives. Pinned by the ps04 fixture against the Lightbend oracle; this
  // test asserted the opposite until S23.5/S23.6 came in scope on 2026-07-24.
  it('skips whitespace around the separator but keeps it after the value', () => {
    const result = parseProperties('  host  =  localhost  ')
    expect(result).toEqual({ host: 'localhost  ' })
  })

  it('accepts whitespace alone as the separator (S23.5)', () => {
    expect(parseProperties('host localhost')).toEqual({ host: 'localhost' })
    expect(parseProperties('f value = 3')).toEqual({ f: 'value = 3' })
  })

  it('joins backslash continuations (S23.5)', () => {
    expect(parseProperties('a = one\\\ntwo')).toEqual({ a: 'onetwo' })
    expect(parseProperties('a = one\\\n      two')).toEqual({ a: 'onetwo' })
  })

  it('an even run of trailing backslashes is not a continuation (S23.5)', () => {
    expect(parseProperties('a = end\\\\\nb = 2')).toEqual({ a: 'end\\', b: '2' })
  })

  it('a continuation line starting with # is value text, not a comment (S23.5)', () => {
    expect(parseProperties('a = one\\\n#two')).toEqual({ a: 'one#two' })
  })

  it('applies the escape set, dropping the backslash of an unknown escape (S23.6)', () => {
    expect(parseProperties('a = x\\ty')).toEqual({ a: 'x\ty' })
    expect(parseProperties('a = \\u00e9')).toEqual({ a: '\u00e9' })
    expect(parseProperties('a = q\\zr')).toEqual({ a: 'qzr' })
  })

  it('an escaped separator belongs to the key (S23.6)', () => {
    expect(parseProperties('b\\:c = 2')).toEqual({ 'b:c': '2' })
    expect(parseProperties('a\\ b = 1')).toEqual({ 'a b': '1' })
  })

  // JS strings are UTF-16, as Java's are, so an adjacent surrogate pair forms
  // its astral character on its own and a lone surrogate is representable.
  // go.hocon and rs.hocon have to reject a lone surrogate (S1.2.6).
  it('combines a surrogate pair, and tolerates a lone surrogate (S23.6)', () => {
    expect(parseProperties('a = \\ud83d\\ude00')).toEqual({ a: '\u{1F600}' })
    expect(parseProperties('a = \\ud83d')).toEqual({ a: '\ud83d' })
  })

  it('rejects a malformed unicode escape (S23.6)', () => {
    expect(() => parseProperties('a = \\u12')).toThrow(/malformed/)
    expect(() => parseProperties('a = \\uZZZZ')).toThrow(/malformed/)
  })

  it('skips comment lines (# and !)', () => {
    const result = parseProperties('# comment\n! also comment\nkey=val')
    expect(result).toEqual({ key: 'val' })
  })

  it('skips empty lines', () => {
    const result = parseProperties('\n\nkey=val\n\n')
    expect(result).toEqual({ key: 'val' })
  })

  it('expands dotted keys into nested objects', () => {
    const result = parseProperties('server.host=localhost\nserver.port=8080')
    expect(result).toEqual({
      server: { host: 'localhost', port: '8080' }
    })
  })

  it('all values are strings (no type coercion)', () => {
    const result = parseProperties('num=42\nbool=true\nnull=null')
    expect(result).toEqual({ num: '42', bool: 'true', null: 'null' })
  })

  // F2.9 (2026-07-25): these were silently dropped by a key denylist, which is
  // data loss — a `.properties` file may legitimately carry them, and the file
  // is another program's. Pollution safety comes from the carrier being a
  // null-prototype object, so the keys are preserved *and* nothing leaks onto
  // Object.prototype. (Previously this test only asserted the second half.)
  it('preserves __proto__ as an ordinary key without polluting Object.prototype (F2.9)', () => {
    const result = parseProperties('__proto__.polluted=true')

    const desc = Object.getOwnPropertyDescriptor(result, '__proto__')
    expect(desc).toBeDefined()
    expect(desc?.value).toEqual({ polluted: 'true' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(result)).toBe(null)
  })

  it('preserves constructor and prototype keys, with no phantom empty parents (F2.9)', () => {
    const result = parseProperties('constructor.name=x\nprototype=y\nsafe.a=1')
    expect(result).toEqual({ constructor: { name: 'x' }, prototype: 'y', safe: { a: '1' } })
    // The old denylist bailed out mid-path, leaving the parent it had already
    // created behind as an empty object.
    expect(Object.keys(result).sort()).toEqual(['constructor', 'prototype', 'safe'])
  })

  it('surfaces those keys through the Config API too (F2.9 + toObject)', () => {
    const cfg = parsePropertiesConfig('__proto__.polluted=true\nconstructor=c\n')
    expect(cfg.getString('__proto__.polluted')).toBe('true')
    expect(cfg.getString('constructor')).toBe('c')
    const obj = cfg.toObject() as Record<string, unknown>
    expect(Object.getOwnPropertyDescriptor(obj, '__proto__')?.value).toEqual({ polluted: 'true' })
    expect(Object.getPrototypeOf(obj)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Phase 5 spec debt tests
// ---------------------------------------------------------------------------

// S23.2 — empty path elements (leading/trailing dot) preserved (HOCON spec L1456)
// Probe (2026-05-13):
//   "a."  → { a: { '': 'hello' } }  ✅  trailing empty segment preserved
//   "."   → { '': { '': 'hello' } } ✅  both segments empty
//   ".a"  → { '': { a: 'hello' } }  ✅  leading empty segment preserved
describe('S23.2 - empty path elements preserved in properties (HOCON spec L1456)', () => {
  it('S23.2: trailing dot in key creates an empty last path segment', () => {
    // spec L1457: a. is a path with two elements, "a" and empty string
    const result = parseProperties('a.=hello')
    expect(result).toEqual({ a: { '': 'hello' } })
  })

  it('S23.2: a single dot is a path with two empty elements', () => {
    // spec L1457: "." is a path with two elements, both empty string
    const result = parseProperties('.=hello')
    expect(result).toEqual({ '': { '': 'hello' } })
  })

  it('S23.2: leading dot in key creates an empty first path segment', () => {
    const result = parseProperties('.a=hello')
    expect(result).toEqual({ '': { a: 'hello' } })
  })
})

// S23.4 — object wins over string on conflicting key (HOCON spec L1485)
// Probe (2026-05-13):
//   "a=hello\na.b=world" → { a: { b: 'world' } }  ✅ (string overwritten by object expansion)
//   "a.b=world\na=hello" → { a: 'hello' }          ❌ (string overwrites object — spec: object must win)
describe('S23.4 - object wins over string on conflicting key in properties (HOCON spec L1485)', () => {
  it('S23.4: string key followed by dotted key → object wins (string overwritten)', () => {
    // a=hello, then a.b=world: setNested sees a is a string, replaces it with object
    const result = parseProperties('a=hello\na.b=world')
    expect(result).toEqual({ a: { b: 'world' } })
  })

  it('S23.4: dotted key followed by string key → object must still win (spec L1485)', () => {
    // Fixed in Phase 6 #3h: sort + last-segment object guard in setNested.
    // a.b=world creates { a: { b: 'world' } }, then a=hello is discarded (object wins).
    const result = parseProperties('a.b=world\na=hello')
    expect(result).toEqual({ a: { b: 'world' } })
  })
})
