import { describe, it, expect } from 'vitest'
import { parseProperties } from '../src/internal/properties/properties.js'

describe('parseProperties', () => {
  it('parses simple key=value pairs', () => {
    const result = parseProperties('host=localhost\nport=8080')
    expect(result).toEqual({ host: 'localhost', port: '8080' })
  })

  it('parses key:value with colon separator', () => {
    const result = parseProperties('host:localhost')
    expect(result).toEqual({ host: 'localhost' })
  })

  it('trims whitespace around key and value', () => {
    const result = parseProperties('  host  =  localhost  ')
    expect(result).toEqual({ host: 'localhost' })
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

  it('should not pollute prototype via __proto__ key', () => {
    parseProperties('__proto__.polluted=true')
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

  it.fails('S23.4: dotted key followed by string key → object must still win (spec L1485)', () => {
    // a.b=world creates { a: { b: 'world' } }, then a=hello overwrites a with a string.
    // Spec L1485: "the object must always win in this case."
    // Currently: { a: 'hello' } — string wins. Bug: setNested does not protect existing objects.
    const result = parseProperties('a.b=world\na=hello')
    expect(result).toEqual({ a: { b: 'world' } })
  })
})
