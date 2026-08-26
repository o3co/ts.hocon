// tests/e19-float-overflow.test.ts
//
// E19 — a numeric literal whose magnitude overflows the double range is a
// parse error in all four sibling implementations (xx.hocon#97, posture B).
// This is a documented divergence from Lightbend: the reference admits the
// literal as Infinity, but HOCON has no Infinity literal, so the value cannot
// be rendered or re-parsed as a number (Lightbend's own render → re-parse
// silently turns it into the STRING "Infinity"). go.hocon has always errored
// here via strconv.ParseFloat; ts/py/rs align with it.
//
// Underflow is NOT an error: `1e-400` reads as 0 in every implementation and
// in Lightbend, so only the infinite case is rejected.

import { describe, expect, it } from 'vitest'
import { ParseError, parse } from '../src/index.js'

describe('E19 — overflowing float literal is a parse error', () => {
  it('rejects a = 1e999', () => {
    expect(() => parse('a = 1e999')).toThrow(ParseError)
    expect(() => parse('a = 1e999')).toThrow(/invalid float "1e999"/)
  })

  it('rejects a = -1e999', () => {
    expect(() => parse('a = -1e999')).toThrow(ParseError)
    expect(() => parse('a = -1e999')).toThrow(/invalid float "-1e999"/)
  })

  it('rejects an overflowing fraction/exponent combination', () => {
    expect(() => parse('a = 2.5e999')).toThrow(ParseError)
  })

  it('rejects an overflow inside an array element', () => {
    expect(() => parse('a = [1, 1e999]')).toThrow(ParseError)
  })

  it('rejects an integer-form literal beyond the double range', () => {
    // E19 is keyed on the lexeme's value, not its spelling: 400 nines
    // overflow Number the same way an exponent form does.
    expect(() => parse(`a = ${'9'.repeat(400)}`)).toThrow(ParseError)
  })

  it('accepts underflow as 0 (1e-400)', () => {
    const cfg = parse('a = 1e-400')
    expect(cfg.getNumber('a')).toBe(0)
  })

  it('accepts the finite extremes', () => {
    expect(parse('a = 1e308').getNumber('a')).toBe(1e308)
    expect(parse('a = 5e-324').getNumber('a')).toBe(5e-324)
  })

  it('keeps a quoted "1e999" as a string', () => {
    expect(parse('a = "1e999"').getString('a')).toBe('1e999')
  })

  it('keeps unquoted Infinity as a string (no Infinity literal in HOCON)', () => {
    expect(parse('a = Infinity').getString('a')).toBe('Infinity')
  })

  it('reports the position of the offending literal', () => {
    try {
      parse('a = 1e999')
      expect.unreachable('expected ParseError')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).line).toBe(1)
      expect((e as ParseError).col).toBe(5)
    }
  })
})
