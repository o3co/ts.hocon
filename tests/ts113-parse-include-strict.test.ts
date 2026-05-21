import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { ParseError } from '../src/errors.js'

describe('ts#113 — parseInclude must not silently swallow real fields', () => {
  it('rejects empty file() followed by comma + statement (silent drop)', () => {
    expect(() => parse('include file() , b = "x"')).toThrow(ParseError)
  })

  it('rejects file() with non-string argument', () => {
    expect(() => parse('include file(42) b = "x"')).toThrow(ParseError)
  })

  it('rejects empty required() followed by statement', () => {
    expect(() => parse('include required() b = "x"')).toThrow(ParseError)
  })
})

describe('ts#113 — required(fileX(...)) false-match resistance', () => {
  it('rejects unknown qualifier name fileX inside required()', () => {
    expect(() => parse('include required(fileX("a.conf"))')).toThrow(ParseError)
  })

  it('rejects unknown qualifier name urlencode inside required()', () => {
    expect(() => parse('include required(urlencode("a.conf"))')).toThrow(ParseError)
  })

  it('rejects unknown qualifier name packagex inside required()', () => {
    expect(() => parse('include required(packagex("a","b"))')).toThrow(ParseError)
  })
})

describe('ts#113 — parseQuotedPathSkipWrapper must not skip arbitrary tokens', () => {
  it('rejects file (42) — non-string inside file()', () => {
    expect(() => parse('include file (42)\n')).toThrow(ParseError)
  })

  it('rejects file () b = "x" — empty space form + statement', () => {
    expect(() => parse('include file () b = "x"')).toThrow(ParseError)
  })

  it('accepts file ("path") , b = "x" — comma after string ends the include', () => {
    // Trailing comma + b = "x" is valid HOCON: the include statement ends at the
    // comma, and `b = "x"` is the next field. The path-skip wrapper must stop at
    // the comma rather than swallowing the following field.
    expect(() => parse('include file ("path") , b = "x"')).not.toThrow(ParseError)
  })

  it('rejects bare include followed by non-string token', () => {
    expect(() => parse('include 42')).toThrow(ParseError)
  })
})

describe('ts#113 — Copilot review feedback (PR #118): pre-path wrapper allowlist must be narrow', () => {
  it('rejects required( ) "x" — closing-paren before quoted path (silent-pass risk)', () => {
    expect(() => parse('include required( ) "x"')).toThrow(ParseError)
  })

  it('rejects file ) "x" — closing-paren before quoted path', () => {
    expect(() => parse('include file ) "x"')).toThrow(ParseError)
  })

  it('rejects required ( url ("a.conf")) — url keyword silently swallowed (whitespace-nested)', () => {
    expect(() => parse('include required ( url ("a.conf"))')).toThrow(ParseError)
  })

  it('rejects required ( classpath ("a.conf")) — classpath keyword silently swallowed', () => {
    expect(() => parse('include required ( classpath ("a.conf"))')).toThrow(ParseError)
  })

  it('still accepts required(file("path")) — bundled file qualifier inside required', () => {
    expect(() => parse('include required(file("path"))\n')).not.toThrow(ParseError)
  })

  it('still accepts required( file("path") ) — file qualifier with one space after required(', () => {
    expect(() => parse('include required( file("path") )\n')).not.toThrow(ParseError)
  })
})
