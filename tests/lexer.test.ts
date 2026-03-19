import { describe, it, expect } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { ParseError } from '../src/errors.js'

describe('tokenize', () => {
  it('tokenizes empty string', () => {
    const tokens = tokenize('')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].kind).toBe('eof')
  })

  it('tokenizes braces and brackets', () => {
    const tokens = tokenize('{}[]')
    expect(tokens.map(t => t.kind)).toEqual(['lbrace', 'rbrace', 'lbracket', 'rbracket', 'eof'])
  })

  it('tokenizes = and +=', () => {
    const tokens = tokenize('=+=')
    expect(tokens[0].kind).toBe('equals')
    expect(tokens[1].kind).toBe('plus_equals')
  })

  it('tokenizes : and ,', () => {
    const tokens = tokenize(':,')
    expect(tokens.map(t => t.kind)).toEqual(['colon', 'comma', 'eof'])
  })

  it('skips // comments, keeps newline', () => {
    const tokens = tokenize('// comment\nfoo')
    expect(tokens[0].kind).toBe('newline')
    expect(tokens[1].kind).toBe('unquoted')
    expect(tokens[1].value).toBe('foo')
  })

  it('skips # comments', () => {
    const tokens = tokenize('# comment\nfoo')
    expect(tokens[0].kind).toBe('newline')
    expect(tokens[1].value).toBe('foo')
  })

  it('tokenizes quoted strings', () => {
    const [t] = tokenize('"hello world"')
    expect(t.kind).toBe('string')
    expect(t.value).toBe('hello world')
    expect(t.isQuoted).toBe(true)
  })

  it('handles escape sequences', () => {
    const [t] = tokenize('"a\\nb\\tc"')
    expect(t.value).toBe('a\nb\tc')
  })

  it('handles \\u unicode escapes', () => {
    const [t] = tokenize('"\\u0041"')
    expect(t.value).toBe('A')
  })

  it('tokenizes triple-quoted strings', () => {
    const [t] = tokenize('"""hello\nworld"""')
    expect(t.kind).toBe('triple_string')
    expect(t.value).toBe('hello\nworld')
    expect(t.isQuoted).toBe(true)
  })

  it('strips leading newline from triple-quoted strings', () => {
    const [t] = tokenize('"""\nhello"""')
    expect(t.value).toBe('hello')
  })

  it('tokenizes unquoted strings', () => {
    const [t] = tokenize('localhost')
    expect(t.kind).toBe('unquoted')
    expect(t.value).toBe('localhost')
    expect(t.isQuoted).toBe(false)
  })

  it('tokenizes numbers as unquoted', () => {
    const [t] = tokenize('8080')
    expect(t.kind).toBe('unquoted')
    expect(t.value).toBe('8080')
  })

  it('tokenizes substitutions', () => {
    const [t] = tokenize('${server.host}')
    expect(t.kind).toBe('subst')
    expect(t.value).toBe('server.host')
  })

  it('tokenizes optional substitutions', () => {
    const [t] = tokenize('${?foo}')
    expect(t.kind).toBe('opt_subst')
    expect(t.value).toBe('foo')
  })

  it('tokenizes newlines', () => {
    const tokens = tokenize('a\nb')
    expect(tokens[1].kind).toBe('newline')
  })

  it('deduplicates consecutive newlines', () => {
    const tokens = tokenize('a\n\n\nb')
    const newlines = tokens.filter(t => t.kind === 'newline')
    expect(newlines).toHaveLength(1)
  })

  it('tracks line and col', () => {
    const tokens = tokenize('a\nb')
    expect(tokens[0].line).toBe(1)
    expect(tokens[0].col).toBe(1)
    expect(tokens[2].line).toBe(2)
    expect(tokens[2].col).toBe(1)
  })

  it('sets precedingSpace on token after whitespace', () => {
    const tokens = tokenize('a b')
    expect(tokens[1].precedingSpace).toBe(true)
    expect(tokens[0].precedingSpace).toBe(false)
  })

  it('strips UTF-8 BOM', () => {
    const tokens = tokenize('\uFEFFfoo')
    expect(tokens[0].value).toBe('foo')
  })

  it('stops unquoted scan at $ for concat', () => {
    const tokens = tokenize('foo${bar}')
    expect(tokens[0].kind).toBe('unquoted')
    expect(tokens[0].value).toBe('foo')
    expect(tokens[1].kind).toBe('subst')
    expect(tokens[1].value).toBe('bar')
    expect(tokens[1].precedingSpace).toBe(false)
  })

  it('throws ParseError on unterminated string', () => {
    expect(() => tokenize('"unterminated')).toThrow(ParseError)
  })

  it('throws ParseError on unterminated substitution', () => {
    expect(() => tokenize('${foo')).toThrow(ParseError)
  })
})
