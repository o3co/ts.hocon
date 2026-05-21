// tests/e11-parser-package.test.ts
//
// E11 parser-level tests for `include package(...)` qualifier.
// Tests the AST shape produced by the parser and parser-level rejection of invalid forms.

import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { ParseError } from '../src/errors.js'
import type { AstNode } from '../src/internal/parser/ast.js'

function parse(input: string): AstNode {
  return parseTokens(tokenize(input))
}

describe('E11 parser — include package() AST', () => {
  it('parses two-arg package() into include node with qualifier.kind=package', () => {
    const ast = parse('include package("github.com/example/lib", "reference.conf")')
    expect(ast.kind).toBe('object')
    if (ast.kind !== 'object') return
    expect(ast.fields).toHaveLength(1)
    const field = ast.fields[0]!
    expect(field.key).toHaveLength(0)
    const inc = field.value
    expect(inc.kind).toBe('include')
    if (inc.kind !== 'include') return
    expect(inc.qualifier).toEqual({ kind: 'package', identifier: 'github.com/example/lib' })
    expect(inc.path).toBe('reference.conf')
    expect(inc.required).toBe(false)
  })

  it('parses required(package(...)) with required=true', () => {
    const ast = parse('include required(package("foo", "bar.conf"))')
    if (ast.kind !== 'object') return
    const inc = ast.fields[0]!.value
    expect(inc.kind).toBe('include')
    if (inc.kind !== 'include') return
    expect(inc.required).toBe(true)
    expect(inc.qualifier).toEqual({ kind: 'package', identifier: 'foo' })
    expect(inc.path).toBe('bar.conf')
  })

  it('rejects one-arg form package("id/file") with ParseError', () => {
    expect(() => parse('include package("github.com/example/lib/reference.conf")')).toThrow(ParseError)
  })

  it('parses bare include "path" into qualifier.kind=bare', () => {
    const ast = parse('include "foo.conf"')
    if (ast.kind !== 'object') return
    const inc = ast.fields[0]!.value
    expect(inc.kind).toBe('include')
    if (inc.kind !== 'include') return
    expect(inc.qualifier).toEqual({ kind: 'bare' })
  })

  it('parses file() include into qualifier.kind=file', () => {
    const ast = parse('include file("foo.conf")')
    if (ast.kind !== 'object') return
    const inc = ast.fields[0]!.value
    expect(inc.kind).toBe('include')
    if (inc.kind !== 'include') return
    expect(inc.qualifier).toEqual({ kind: 'file' })
  })
})
