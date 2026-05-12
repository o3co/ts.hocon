// tests/parser.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import type { AstNode } from '../src/internal/parser/ast.js'

function parse(input: string): AstNode {
  return parseTokens(tokenize(input))
}

describe('parseTokens', () => {
  it('parses empty input as empty object', () => {
    const node = parse('')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') expect(node.fields).toHaveLength(0)
  })

  it('parses key = value', () => {
    const node = parse('host = "localhost"')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['host'])
      expect(node.fields[0]!.value.kind).toBe('scalar')
    }
  })

  it('parses key: value (colon syntax)', () => {
    const node = parse('port: 8080')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['port'])
    }
  })

  it('parses dot-notation keys', () => {
    const node = parse('server.host = "localhost"')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['server', 'host'])
    }
  })

  it('does not split quoted keys at dots', () => {
    const node = parse('"a.b" = 1')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['a.b'])
    }
  })

  it('parses nested objects (brace syntax)', () => {
    const node = parse('server { host = "localhost" }')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['server'])
      expect(node.fields[0]!.value.kind).toBe('object')
    }
  })

  it('parses arrays', () => {
    const node = parse('list = [1, 2, 3]')
    if (node.kind === 'object') {
      const arr = node.fields[0]!.value
      expect(arr.kind).toBe('array')
      if (arr.kind === 'array') expect(arr.items).toHaveLength(3)
    }
  })

  it('parses boolean and null scalars', () => {
    const node = parse('a = true\nb = false\nc = null')
    if (node.kind === 'object') {
      const vals = node.fields.map(f => f.value)
      expect(vals[0]!.kind === 'scalar' && vals[0]!.raw).toBe('true')
      expect(vals[0]!.kind === 'scalar' && vals[0]!.valueType).toBe('boolean')
      expect(vals[1]!.kind === 'scalar' && vals[1]!.raw).toBe('false')
      expect(vals[1]!.kind === 'scalar' && vals[1]!.valueType).toBe('boolean')
      expect(vals[2]!.kind === 'scalar' && vals[2]!.raw).toBe('null')
      expect(vals[2]!.kind === 'scalar' && vals[2]!.valueType).toBe('null')
    }
  })

  it('parses integer scalars', () => {
    const node = parse('port = 8080')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind === 'scalar' && val.raw).toBe('8080')
      expect(val.kind === 'scalar' && val.valueType).toBe('number')
    }
  })

  it('parses float scalars', () => {
    const node = parse('ratio = 1.5')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind === 'scalar' && val.raw).toBe('1.5')
      expect(val.kind === 'scalar' && val.valueType).toBe('number')
    }
  })

  it('parses substitutions', () => {
    const node = parse('host = ${server.host}')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind).toBe('subst')
      if (val.kind === 'subst') {
        expect(val.segments.map(s => s.text)).toEqual(['server', 'host'])
        expect(val.optional).toBe(false)
      }
    }
  })

  it('parses optional substitutions', () => {
    const node = parse('host = ${?server.host}')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      if (val.kind === 'subst') expect(val.optional).toBe(true)
    }
  })

  it('parses concat (adjacent tokens on same line, no space)', () => {
    const node = parse('url = "http://"${host}":8080"')
    if (node.kind === 'object') {
      expect(node.fields[0]!.value.kind).toBe('concat')
    }
  })

  it('parses += append operator', () => {
    const node = parse('list += 1')
    if (node.kind === 'object') {
      expect(node.fields[0]!.append).toBe(true)
    }
  })

  it('parses include directive', () => {
    const node = parse('include "other.conf"')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toHaveLength(0)
      expect(node.fields[0]!.value.kind).toBe('include')
    }
  })

  it('parses include file(...) syntax', () => {
    const node = parse('include file("other.conf")')
    if (node.kind === 'object') {
      expect(node.fields[0]!.value.kind).toBe('include')
    }
  })

  it('parses include required("base.conf") with required: true', () => {
    const node = parse('include required("base.conf")')
    if (node.kind !== 'object') return
    const field = node.fields[0]
    if (!field) return
    const inc = field.value
    expect(inc.kind).toBe('include')
    if (inc.kind === 'include') {
      expect(inc.path).toBe('base.conf')
      expect(inc.required).toBe(true)
    }
  })

  it('parses include required(file("base.conf")) with required: true', () => {
    const node = parse('include required(file("base.conf"))')
    if (node.kind !== 'object') return
    const field = node.fields[0]
    if (!field) return
    const inc = field.value
    expect(inc.kind).toBe('include')
    if (inc.kind === 'include') {
      expect(inc.path).toBe('base.conf')
      expect(inc.required).toBe(true)
    }
  })

  it('regular include "base.conf" has required: false', () => {
    const node = parse('include "base.conf"')
    if (node.kind !== 'object') return
    const field = node.fields[0]
    if (!field) return
    const inc = field.value
    expect(inc.kind).toBe('include')
    if (inc.kind === 'include') {
      expect(inc.required).toBe(false)
    }
  })

  it('chains two quoted key segments with a dot', () => {
    const node = parse('"a"."b" = 1')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['a', 'b'])
    }
  })

  it('chains three quoted key segments with dots', () => {
    const node = parse('"a"."b"."c" = 1')
    if (node.kind === 'object') {
      expect(node.fields[0]!.key).toEqual(['a', 'b', 'c'])
    }
  })

  it('should accept trailing comments after braced root', () => {
    // Comments after root should be OK (lexer strips them)
    expect(() => parse('{ a = 1 } // comment')).not.toThrow()
    expect(() => parse('{ a = 1 } # comment')).not.toThrow()
  })

  it('should allow trailing key-value pairs after braced root', () => {
    // Per HOCON spec, root is always an object; content after } merges into root
    const node = parse('{ a = 1 } b = 2')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') {
      const keys = node.fields.map(f => f.key)
      expect(keys).toEqual([['a'], ['b']])
    }
  })

  it('should allow object concatenation at root level', () => {
    const node = parse('{ a = 1 } { b = 2 }')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') {
      const keys = node.fields.map(f => f.key)
      expect(keys).toEqual([['a'], ['b']])
    }
  })

  it('should treat unquoted trailing word as key in braced root', () => {
    // "garbage" becomes a key that needs a value — this should either parse
    // or throw a "expected value" error, NOT "unexpected token after closing brace"
    const node = parse('{ a = 1 }\ngarbage = 2')
    expect(node.kind).toBe('object')
    if (node.kind === 'object') {
      const keys = node.fields.map(f => f.key)
      expect(keys).toEqual([['a'], ['garbage']])
    }
  })

  it('should error on stray } after braced root', () => {
    expect(() => parseTokens(tokenize('{ a = 1 } }'))).toThrow()
  })

  it('should error on include url() with "not supported" message', () => {
    expect(() => parseTokens(tokenize('include url("http://example.com")'))).toThrow(/not supported/)
  })

  it('should error on include classpath() with "not supported" message', () => {
    expect(() => parseTokens(tokenize('include classpath("reference.conf")'))).toThrow(/not supported/)
  })

  it('should error on include required(url()) with "not supported" message', () => {
    expect(() => parseTokens(tokenize('include required(url("http://example.com"))'))).toThrow(/not supported/)
  })

  it('should error on include required(classpath()) with "not supported" message', () => {
    expect(() => parseTokens(tokenize('include required(classpath("reference.conf"))'))).toThrow(/not supported/)
  })

  // Fix 1: required without ( must error
  it('should error on include required "file.conf" (missing parens)', () => {
    expect(() => parseTokens(tokenize('include required "file.conf"'))).toThrow()
  })

  // Fix 2: skip loops stop on comma
  it('parses include file(...) followed by comma-separated field', () => {
    const node = parseTokens(tokenize('{ include file("base.conf"), a = 1 }'))
    if (node.kind !== 'object') throw new Error('expected object')
    // The 'a' field must not be swallowed by the skip loop
    const aField = node.fields.find(f => f.key[0] === 'a')
    expect(aField).toBeDefined()
  })

  it('parses include "..." followed by comma-separated field', () => {
    const node = parseTokens(tokenize('{ include "base.conf", a = 1 }'))
    if (node.kind !== 'object') throw new Error('expected object')
    const aField = node.fields.find(f => f.key[0] === 'a')
    expect(aField).toBeDefined()
  })

  it('parses include required(...) followed by comma-separated field', () => {
    const node = parseTokens(tokenize('{ include required("base.conf"), a = 1 }'))
    if (node.kind !== 'object') throw new Error('expected object')
    const aField = node.fields.find(f => f.key[0] === 'a')
    expect(aField).toBeDefined()
  })

  it('should error on include with invalid token (catch-all)', () => {
    // A number token after include should hit the catch-all error path
    expect(() => parseTokens(tokenize('include 12345'))).toThrow()
  })

  it('should error on include required(url()) when url is space-separated from required(', () => {
    // Tests the case where required( and url are separate tokens
    expect(() => parseTokens(tokenize('include required( url("http://example.com") )'))).toThrow(/not supported/)
  })

  it('should error on include required(classpath()) when classpath is space-separated', () => {
    expect(() => parseTokens(tokenize('include required( classpath("reference.conf") )'))).toThrow(/not supported/)
  })
})

// -----------------------------------------------------------------------------
// Spec compliance Phase 1 (issue #70): parser-level comma rules.
// See lexer.test.ts for the full convention.
// -----------------------------------------------------------------------------

describe('spec compliance Phase 1 — comma rules', () => {
  // --- S5.2: single trailing comma is allowed and ignored ------------------
  it('S5.2: single trailing comma in array is allowed', () => {
    const node = parse('list = [1, 2, 3,]')
    if (node.kind !== 'object') throw new Error('expected object')
    const arr = node.fields[0]!.value
    expect(arr.kind).toBe('array')
    if (arr.kind === 'array') expect(arr.items).toHaveLength(3)
  })

  it('S5.2: single trailing comma in object is allowed', () => {
    const node = parse('{ a = 1, b = 2, }')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields).toHaveLength(2)
  })

  // --- S5.3: two trailing commas invalid -----------------------------------
  it('S5.3: two trailing commas in array is rejected ([1,2,3,,])', () => {
    expect(() => parse('list = [1, 2, 3,,]')).toThrow()
  })

  it('S5.3: two trailing commas in object is rejected', () => {
    expect(() => parse('{ a = 1, b = 2,, }')).toThrow()
  })

  // --- S5.4: leading comma invalid -----------------------------------------
  it('S5.4: leading comma in array is rejected ([,1,2,3])', () => {
    expect(() => parse('list = [,1, 2, 3]')).toThrow()
  })

  it('S5.4: leading comma in object is rejected', () => {
    expect(() => parse('{ , a = 1 }')).toThrow()
  })

  // --- S5.5: two consecutive commas invalid --------------------------------
  it('S5.5: two consecutive commas in array is rejected ([1,,2,3])', () => {
    expect(() => parse('list = [1,, 2, 3]')).toThrow()
  })

  // --- S5.6: same comma rules apply to object fields -----------------------
  it('S5.6: two consecutive commas between object fields is rejected', () => {
    expect(() => parse('{ a = 1,, b = 2 }')).toThrow()
  })
})
