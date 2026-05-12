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

  it('accepts surrogate pair \\uD83D\\uDE00 (= 😀, Java/Lightbend semantics)', () => {
    // TypeScript strings are UTF-16, just like Java/Lightbend HOCON.
    // A surrogate pair is two valid \uXXXX escapes; the resulting string contains the emoji.
    const [t] = tokenize('"\\uD83D\\uDE00"')
    expect(t.value).toBe('\uD83D\uDE00')   // same string as '😀' in JS
    expect([...t.value][0]).toBe('😀')      // iterated as code point = emoji
  })

  it('accepts lone surrogate \\uD800 without error (Java/Lightbend semantics)', () => {
    // A lone surrogate is ill-formed Unicode but valid in Java strings and TS strings.
    // ts.hocon must accept it; rs.hocon rejects it due to Rust char constraints (deliberate divergence).
    const [t] = tokenize('"\\uD800"')
    expect(t.value).toBe('\uD800')
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

// -----------------------------------------------------------------------------
// Spec compliance Phase 1 (issue #70): lexer-level rules.
//
// Each test is annotated with its xx.hocon spec checklist ID (S<n>.<m>).
// Where the current implementation diverges from spec, the test uses
// it.fails(...) to pin the spec-correct assertion: CI stays green while
// the implementation is buggy, and the test will FLIP to red once a fix
// lands. At that point remove the it.fails wrapper and promote the
// docs/spec-compliance.md status from this row to a plain it(...).
// -----------------------------------------------------------------------------

describe('spec compliance Phase 1 — lexer-level', () => {
  // --- S2.3: comment markers inside quoted strings are literal -------------
  it('S2.3: // and # inside a quoted string are kept verbatim', () => {
    const [t1] = tokenize('"http://example.com"')
    expect(t1.kind).toBe('string')
    expect(t1.value).toBe('http://example.com')

    const [t2] = tokenize('"# not a comment"')
    expect(t2.kind).toBe('string')
    expect(t2.value).toBe('# not a comment')
  })

  // --- S6.1: Unicode Zs / Zl / Zp category characters are whitespace -------
  // Spec L170: lexer must treat any Unicode whitespace (Zs/Zl/Zp categories)
  // as separator. ts.hocon currently only handles ASCII space + tab + CR.
  it.fails('S6.1: em space (U+2003, Zs) separates two unquoted tokens', () => {
    const tokens = tokenize('a b').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
    expect(tokens[1].value).toBe('b')
  })

  it.fails('S6.1: line separator (U+2028, Zl) separates two unquoted tokens', () => {
    const tokens = tokenize('a b').filter(t => t.kind !== 'eof')
    // Spec says U+2028 (Zl) is whitespace and should separate tokens.
    // Currently ts.hocon folds it into the unquoted run, producing a single
    // token "a<U+2028>b". When fixed via #72, expect the lexer to emit two
    // unquoted tokens with values "a" and "b".
    //
    // NOTE on it.fails wrong-reason risk: a hypothetical fix that REJECTS
    // U+2028 with a throw would also flip this test (it.fails counts a throw
    // as "expected failure"). That fix would be spec-incorrect — see #72 for
    // the spec-correct expectation. Reviewers of any #72 fix should verify
    // the impl matches spec intent (whitespace) rather than just satisfying
    // this pin.
    expect(tokens.map(t => t.value)).toEqual(['a', 'b'])
  })

  // --- S6.2: non-breaking spaces are whitespace ----------------------------
  it.fails('S6.2: NBSP (U+00A0) separates tokens', () => {
    const tokens = tokenize('a b').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
    expect(tokens[1].value).toBe('b')
  })

  it.fails('S6.2: figure space (U+2007) separates tokens', () => {
    const tokens = tokenize('a b').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
  })

  it.fails('S6.2: narrow no-break space (U+202F) separates tokens', () => {
    const tokens = tokenize('a b').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
  })

  // --- S6.4: ASCII control whitespace --------------------------------------
  // Spec L174 lists: tab (\t = 0x09), vertical tab (\v = 0x0B), form feed
  // (\f = 0x0C), carriage return (\r = 0x0D), file separator (0x1C), group
  // separator (0x1D), record separator (0x1E), unit separator (0x1F).
  it('S6.4 (partial): tab (0x09) is whitespace', () => {
    const tokens = tokenize('a\tb').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[1].precedingSpace).toBe(true)
  })

  it('S6.4 (partial): carriage return (0x0D) is whitespace', () => {
    const tokens = tokenize('a\rb').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
  })

  it.fails('S6.4: vertical tab (0x0B) is whitespace', () => {
    const tokens = tokenize('a\x0Bb').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
  })

  it.fails('S6.4: form feed (0x0C) is whitespace', () => {
    const tokens = tokenize('a\x0Cb').filter(t => t.kind !== 'eof')
    expect(tokens.map(t => t.kind)).toEqual(['unquoted', 'unquoted'])
    expect(tokens[0].value).toBe('a')
  })

  it.fails('S6.4: file/group/record/unit separators (0x1C-0x1F) are whitespace', () => {
    for (const ch of ['\x1C', '\x1D', '\x1E', '\x1F']) {
      const tokens = tokenize(`a${ch}b`).filter(t => t.kind !== 'eof')
      expect(tokens.map(t => t.kind), `for char U+00${ch.charCodeAt(0).toString(16).toUpperCase()}`)
        .toEqual(['unquoted', 'unquoted'])
    }
  })

  // --- S8.6: unquoted string cannot begin with 0-9 or - --------------------
  // Spec L270. Already-known violation tracked in docs/spec-compliance.md.
  // Tests go through full parse(), not just tokenize(), so a fix at either
  // the lexer (isUnquotedStart) OR the parser (scalarValueType rejection of
  // non-number digit/hyphen tokens) layer will flip these to red.
  it.fails('S8.6: digit-starting unquoted string is rejected (e.g. 123abc)', () => {
    expect(() => parse('x = 123abc')).toThrow(ParseError)
  })

  it.fails('S8.6: hyphen-starting unquoted string is rejected (e.g. -foo)', () => {
    // -123 is a valid number literal; -foo is not, and per spec L270 the
    // unquoted form should be rejected end-to-end at parse time.
    expect(() => parse('x = -foo')).toThrow(ParseError)
  })

  // --- S8.7: no escape sequences in unquoted strings -----------------------
  // Spec L253. tokenize('a\\n') consumes 'a' as an unquoted token (the
  // backslash terminates the unquoted run via isUnquotedContinue), then the
  // main loop hits the bare '\\' and throws via the catch-all "unexpected
  // character" branch. End-to-end behavior matches spec: backslash escapes
  // are NOT decoded inside unquoted strings.
  it('S8.7: backslash is rejected in unquoted strings (no \\n decoding)', () => {
    expect(() => tokenize('a\\n')).toThrow(ParseError)
  })

  // --- S8.8: unquoted strings allow control characters except forbidden ----
  // Spec L280. Forbidden set per L245: $"{}[]:=,+#`^?!@*&\
  // Other control chars (e.g. SOH 0x01, BEL 0x07) should be permitted.
  it('S8.8: SOH (0x01) is allowed inside unquoted string', () => {
    const tokens = tokenize('foo\x01bar').filter(t => t.kind !== 'eof')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].kind).toBe('unquoted')
    expect(tokens[0].value).toBe('foo\x01bar')
  })

  it('S8.8: BEL (0x07) is allowed inside unquoted string', () => {
    const tokens = tokenize('foo\x07bar').filter(t => t.kind !== 'eof')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].value).toBe('foo\x07bar')
  })
})
