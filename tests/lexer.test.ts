import { describe, it, expect } from 'vitest'
import { ParseError } from '../src/errors.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parse } from '../src/parse.js'

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

  it('throws on \\uZZZZ (invalid hex digits)', () => {
    expect(() => tokenize('"\\uZZZZ"')).toThrow(ParseError)
  })

  it('throws on \\u41 (too few hex digits)', () => {
    expect(() => tokenize('"\\u41"')).toThrow(ParseError)
  })

  it('throws on \\u at end of string (no hex digits)', () => {
    expect(() => tokenize('"\\u"')).toThrow(ParseError)
  })

  it('throws on unknown escape sequence \\q', () => {
    expect(() => tokenize('"hello\\qworld"')).toThrow(/unknown escape/i)
  })

  it('throws on unknown escape sequence \\a', () => {
    expect(() => tokenize('"\\a"')).toThrow(/unknown escape/i)
  })

  it('should error on trailing backslash in quoted string', () => {
    expect(() => tokenize('"hello\\\\')).toThrow(ParseError)
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
    expect(t.subst?.segments.map(s => s.text)).toEqual(['server', 'host'])
  })

  it('tokenizes optional substitutions', () => {
    const [t] = tokenize('${?foo}')
    expect(t.kind).toBe('subst')
    expect(t.subst?.optional).toBe(true)
    expect(t.subst?.segments[0]?.text).toBe('foo')
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
    expect(tokens[1].subst?.segments[0]?.text).toBe('bar')
    expect(tokens[1].precedingSpace).toBe(false)
  })

  it('throws ParseError on unterminated string', () => {
    expect(() => tokenize('"unterminated')).toThrow(ParseError)
  })

  it('throws ParseError on unterminated substitution', () => {
    expect(() => tokenize('${foo')).toThrow(ParseError)
  })

  it('should error on unterminated triple-quoted string', () => {
    expect(() => tokenize('a = """unterminated')).toThrow(/unterminated/)
  })

  it('should error on unterminated triple-quoted string with newlines', () => {
    expect(() => tokenize('a = """line1\nline2')).toThrow(/unterminated/)
  })

  it('should not include forbidden characters in unquoted strings', () => {
    for (const ch of ['?', '!', '@', '*', '&', '^', '\\']) {
      expect(
        () => tokenize(`a = hello${ch}world`),
        `char '${ch}' should not be allowed in unquoted string`,
      ).toThrow(ParseError)
    }
  })
})

function substSegments(input: string) {
  const tokens = tokenize(input)
  const t = tokens.find(x => x.kind === 'subst')
  if (!t?.subst) throw new Error('no subst token found')
  return t.subst.segments
}

describe('Segment positions', () => {
  it('unquoted path records position at first ident char', () => {
    // dollar-brace foo.bar: '$' at col 1, '{' at col 2, 'f' at col 3
    const segs = substSegments('${foo.bar}')
    expect(segs[0]).toMatchObject({ text: 'foo', line: 1, col: 3 })
    expect(segs[1]).toMatchObject({ text: 'bar', line: 1, col: 7 })
  })

  it('quoted segments record position at opening quote', () => {
    // dollar-brace "a"."b": first quote at col 3, second at col 7
    const segs = substSegments('${"a"."b"}')
    expect(segs[0]).toMatchObject({ text: 'a', col: 3 })
    expect(segs[1]).toMatchObject({ text: 'b', col: 7 })
  })

  it('substitution on second line records correct line number', () => {
    // x=1 newline y=dollar-brace foo: subst at line 2 col 3, 'f' at col 5
    const segs = substSegments('x=1\ny=${foo}')
    expect(segs[0]).toMatchObject({ text: 'foo', line: 2, col: 5 })
  })

  it('whitespace-concat segments are merged into one segment', () => {
    // dollar-brace "a" "b": WS between quoted strings merges into single segment
    const segs = substSegments('${"a" "b"}')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ text: 'a b', col: 3 })
  })

  it('empty quoted key has valid position', () => {
    // dollar-brace "": opening quote at col 3
    const segs = substSegments('${""}')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ text: '', col: 3 })
  })

  it('invalid escape error points inside subst body (Goal 2)', () => {
    // bad escape inside subst body — ParseError.line should be 1 (same line as the substitution)
    let caught: unknown
    try { parse('x=\x24{"a\\xb"}') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ParseError)
    expect((caught as ParseError).line).toBe(1)
  })

  it('empty path error points at subst open', () => {
    // empty substitution path — ParseError.line should be 1
    let caught: unknown
    try { parse('x=\x24{}') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ParseError)
    expect((caught as ParseError).line).toBe(1)
  })
})
