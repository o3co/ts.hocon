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
      expect(vals[0]!.kind === 'scalar' && vals[0]!.value).toBe(true)
      expect(vals[1]!.kind === 'scalar' && vals[1]!.value).toBe(false)
      expect(vals[2]!.kind === 'scalar' && vals[2]!.value).toBe(null)
    }
  })

  it('parses integer scalars', () => {
    const node = parse('port = 8080')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind === 'scalar' && val.value).toBe(8080)
    }
  })

  it('parses float scalars', () => {
    const node = parse('ratio = 1.5')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind === 'scalar' && val.value).toBe(1.5)
    }
  })

  it('parses substitutions', () => {
    const node = parse('host = ${server.host}')
    if (node.kind === 'object') {
      const val = node.fields[0]!.value
      expect(val.kind).toBe('subst')
      if (val.kind === 'subst') {
        expect(val.path).toBe('server.host')
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
})
