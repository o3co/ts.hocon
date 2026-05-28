/**
 * S10.5 — inner whitespace between simple values in a string value
 * concatenation is preserved verbatim (HOCON.md §String value
 * concatenation L332). Cross-impl regression for go.hocon#132.
 *
 * Pre-fix, `parseValue` inserted a single hardcoded `' '` separator
 * between concat pieces regardless of how many whitespace characters the
 * source had, collapsing every multi-space run to one space. Lightbend
 * keeps the literal run. The fix threads `t.precedingWhitespace` (the
 * lexer field E13 added for key-position whitespace) into the
 * value-position separator.
 *
 * The undefined-optional case (`"left"  ${?UNSET}  "right"`) is the shape
 * reported in go.hocon#132: both surrounding whitespace runs must survive
 * even though the substitution between them resolves to nothing, yielding
 * `"left    right"` (2 + 2 = 4 spaces). Env is injected via
 * `ParseOptions.env` (no `process.env` mutation).
 */
import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

describe('S10.5 value-concat whitespace preservation (go.hocon#132)', () => {
  it('unquoted multi-space run preserved', () => {
    expect(parse('a = foo   bar\n').getString('a')).toBe('foo   bar')
  })

  it('quoted multi-space run preserved', () => {
    expect(parse('a = "foo"   "bar"\n').getString('a')).toBe('foo   bar')
  })

  it('single space unchanged', () => {
    expect(parse('a = foo bar\n').getString('a')).toBe('foo bar')
  })

  it('defined substitution multi-space preserved', () => {
    expect(parse('x = mid\na = "left"  ${x}  "right"\n').getString('a')).toBe('left  mid  right')
  })

  it('undefined optional keeps both whitespace runs', () => {
    const cfg = parse('a = "left"  ${?GO132_UNSET}  "right"\n', { env: {} })
    expect(cfg.getString('a')).toBe('left    right')
  })

  it('tab run preserved (HOCON_WS includes tab)', () => {
    expect(parse('a = foo \t bar\n').getString('a')).toBe('foo \t bar')
  })
})
