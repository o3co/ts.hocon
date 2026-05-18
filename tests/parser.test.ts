// tests/parser.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { ParseError } from '../src/errors.js'
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

// -----------------------------------------------------------------------------
// Spec compliance Phase 2 (issue #82): concatenation, paths, and +=
// See tests/resolver.test.ts for items that require resolution-time checks.
// Convention: it.fails(...) pins known violations; plain it(...) for ✅ items.
// -----------------------------------------------------------------------------

describe('spec compliance Phase 2 — concatenation, paths, and +=', () => {
  // --- S3.2: root non-object/non-array is invalid --------------------------
  it('S3.2: root bare string is rejected', () => {
    expect(() => parse('"hello"')).toThrow()
  })

  it('S3.2: root bare number is rejected', () => {
    expect(() => parse('42')).toThrow()
  })

  // --- S10.7: concatenation does not span a newline ------------------------
  it('S10.7: same-line concat produces a single concat node (spec L335)', () => {
    const node = parse('x = foo bar')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields).toHaveLength(1)
    expect(node.fields[0]!.value.kind).toBe('concat')
  })

  it('S10.7: tokens on next line are parsed as a new field, not concat (spec L335)', () => {
    const node = parse('x = foo\nbar = 1')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields).toHaveLength(2)
    expect(node.fields[0]!.key).toEqual(['x'])
    expect(node.fields[1]!.key).toEqual(['bar'])
  })

  // --- S10.8: string concat allowed in field keys --------------------------
  // VIOLATION: parser rejects unquoted-space-unquoted as a key.
  it.fails('S10.8: unquoted string concat is allowed in field keys (spec L317)', () => {
    const node = parse('foo bar = 1')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields[0]!.key).toEqual(['foo bar'])
  })

  // --- S11.4: 10.0foo → path [10, 0foo] ------------------------------------
  it('S11.4: 10.0foo is parsed as two-element path [10, 0foo] (spec L496)', () => {
    const node = parse('10.0foo = 2')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields[0]!.key).toEqual(['10', '0foo'])
  })

  // --- S11.5: foo10.0 → path [foo10, 0] ------------------------------------
  it('S11.5: foo10.0 is parsed as two-element path [foo10, 0] (spec L498)', () => {
    const node = parse('foo10.0 = 1')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields[0]!.key).toEqual(['foo10', '0'])
  })

  // --- S11.8: path expression always stringifies ---------------------------
  it('S11.8: unquoted true as a key stringifies to the string "true" (spec L504)', () => {
    const node = parse('true = 1')
    if (node.kind !== 'object') throw new Error('expected object')
    expect(node.fields[0]!.key).toEqual(['true'])
  })

  // --- S11.9: substitutions not allowed inside path expressions ------------
  it('S11.9: subst-only key is rejected (substitution cannot begin a key) (spec L479)', () => {
    expect(() => parse('${x} = 1')).toThrow()
  })

  it('S11.9: subst embedded in path key is rejected (spec L479)', () => {
    expect(() => parse('a.${x}.b = 1')).toThrow()
  })

  // --- S12.5: include may NOT begin a key path ----------------------------
  it('S12.5: include.foo = 1 is rejected because include may not begin a key path (spec L570)', () => {
    expect(() => parse('include.foo = 1')).toThrow()
  })

  it('S12.5: include.foo.bar = 1 is rejected (spec L570)', () => {
    expect(() => parse('include.foo.bar = 1')).toThrow()
  })

  // --- S12.5 Unit A: regression anchor + RED tests -----------------------
  // Regression anchor: quoted "include" = 1 must NOT throw (passes today).
  it('S12.5 Unit A: "include" = 1 should NOT throw (quoted bypasses reservation)', () => {
    expect(() => parse('"include" = 1')).not.toThrow()
  })

  // --- S12.5 Unit B: bare include + separator forms → ParseError("reserved") -
  it('S12.5 Unit B: include = 1 throws ParseError with "reserved" message', () => {
    expect(() => parse('include = 1')).toThrow(ParseError)
    expect(() => parse('include = 1')).toThrow(/reserved/i)
  })

  it('S12.5 Unit B: include : 1 throws ParseError with "reserved" message', () => {
    expect(() => parse('include : 1')).toThrow(ParseError)
    expect(() => parse('include : 1')).toThrow(/reserved/i)
  })

  it('S12.5 Unit B: include += [1] throws ParseError with "reserved" message', () => {
    expect(() => parse('include += [1]')).toThrow(ParseError)
    expect(() => parse('include += [1]')).toThrow(/reserved/i)
  })

  it('S12.5 Unit B: include { x = 1 } throws ParseError with "reserved" message', () => {
    expect(() => parse('include { x = 1 }')).toThrow(ParseError)
    expect(() => parse('include { x = 1 }')).toThrow(/reserved/i)
  })

  // --- S12.5 Unit C: post-PathParser guard for dotted include key paths ------
  it('S12.5 Unit C: include.foo = 1 throws ParseError with "reserved" message', () => {
    expect(() => parse('include.foo = 1')).toThrow(ParseError)
    expect(() => parse('include.foo = 1')).toThrow(/reserved/i)
  })

  it('S12.5 Unit C: include.foo.bar = 1 throws ParseError with "reserved" message', () => {
    expect(() => parse('include.foo.bar = 1')).toThrow(ParseError)
    expect(() => parse('include.foo.bar = 1')).toThrow(/reserved/i)
  })

  it('S12.5 Unit C: a = { include.bar = 1 } throws ParseError (nested object body)', () => {
    expect(() => parse('a = { include.bar = 1 }')).toThrow(ParseError)
    expect(() => parse('a = { include.bar = 1 }')).toThrow(/reserved/i)
  })

  // --- S12.5 Unit D: valid cases that MUST NOT throw -----------------------
  it('S12.5 Unit D: "include" = 1 should NOT throw (quoted first segment bypasses reservation)', () => {
    expect(() => parse('"include" = 1')).not.toThrow()
  })

  it('S12.5 Unit D: "include".foo = 1 should NOT throw (quoted dotted form)', () => {
    expect(() => parse('"include".foo = 1')).not.toThrow()
  })

  it('S12.5 Unit D: foo.include = 1 should NOT throw (non-initial position)', () => {
    expect(() => parse('foo.include = 1')).not.toThrow()
  })

  it('S12.5 Unit D: a = include should NOT throw (value position, not key)', () => {
    expect(() => parse('a = include')).not.toThrow()
  })
})

// Spec compliance Phase 3 (tracking issue #70): substitution & include (parser-level)
// Convention: it.fails(...) pins known violations; plain it(...) for ✅ items.
// -----------------------------------------------------------------------------

describe('spec compliance Phase 3 — substitution & include (parser-level)', () => {
  // --- S13.16: substitutions only in field values / array elements -----------
  it('S13.16: substitution in key position is rejected (spec L644)', () => {
    expect(() => parse('${foo} = 1')).toThrow()
  })

  // --- S14a.6: unquoted `include` at non-start-of-key is literal ------------
  it('S14a.6: x.include = 1 is parsed successfully with key x.include (spec L962)', () => {
    const node = parse('x.include = 1')
    if (node.kind !== 'object') throw new Error('expected object')
    // key path is ["x", "include"] — include is a literal when not at key start
    expect(node.fields[0]!.key).toEqual(['x', 'include'])
  })

  // --- S14a.8: no value concatenation on include argument -------------------
  it('S14a.8: include "a.conf" "b.conf" is a parse error (spec L957)', () => {
    // The parser consumes one quoted argument and treats the second as a stray
    // token, so the throw is structural rather than a dedicated "no concat" check.
    // The spec rule ("no value concatenation on include argument") is upheld
    // because concatenation is never attempted.
    expect(() => parse('include "a.conf" "b.conf"')).toThrow()
  })

  // --- S14a.9: no substitutions in include argument -------------------------
  it('S14a.9: include ${path} is a parse error (spec L959)', () => {
    expect(() => parse('include ${path}')).toThrow()
  })

  // ---- S13c: listSuffix propagation through AST (Unit B) -------------------

  it('S13c: subst node has listSuffix=true for list-suffix substitution', () => {
    // Use String.fromCharCode(36) = '$' to avoid IDE template-string lint warning
    const dollar = String.fromCharCode(36)
    const node = parse('x = ' + dollar + '{MY_LIST[]}')
    if (node.kind !== 'object') throw new Error('expected object')
    const field = node.fields[0]
    if (field === undefined) throw new Error('expected field')
    const value = field.value
    if (value.kind !== 'subst') throw new Error('expected subst')
    expect(value.listSuffix).toBe(true)
    expect(value.optional).toBe(false)
  })

  it('S13c: subst node has listSuffix=false for regular substitution', () => {
    const dollar = String.fromCharCode(36)
    const node = parse('x = ' + dollar + '{MY_LIST}')
    if (node.kind !== 'object') throw new Error('expected object')
    const field = node.fields[0]
    if (field === undefined) throw new Error('expected field')
    const value = field.value
    if (value.kind !== 'subst') throw new Error('expected subst')
    expect(value.listSuffix).toBe(false)
  })

  it('S13c: optional list-suffix subst node has both optional and listSuffix flags', () => {
    const dollar = String.fromCharCode(36)
    const node = parse('x = ' + dollar + '{?MY_LIST[]}')
    if (node.kind !== 'object') throw new Error('expected object')
    const field = node.fields[0]
    if (field === undefined) throw new Error('expected field')
    const value = field.value
    if (value.kind !== 'subst') throw new Error('expected subst')
    expect(value.listSuffix).toBe(true)
    expect(value.optional).toBe(true)
  })

  // --- S12.5 Unit E: substitution path ${include} is NOT reserved ----------
  it('S12.5 Unit E: ${include} substitution path is not reserved (spec: reservation only applies to key positions)', () => {
    const dollar = String.fromCharCode(36)
    // Parsing should succeed — substitution paths bypass parseKey() entirely.
    const node = parse('"include" = "v"\na = ' + dollar + '{include}')
    expect(node.kind).toBe('object')
  })
})
