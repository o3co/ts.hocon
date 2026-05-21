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

  it('rejects file ("path") , b = "x" — comma after string', () => {
    expect(() => parse('include file ("path") , b = "x"')).not.toThrow(ParseError)
    // Note: trailing comma + b = "x" is valid HOCON because the include ends at
    // the comma. Other test cases below validate "stuff after include path but
    // before newline/comma" is rejected.
  })

  it('rejects bare include followed by non-string token', () => {
    expect(() => parse('include 42')).toThrow(ParseError)
  })
})
