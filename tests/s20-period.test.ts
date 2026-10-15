// tests/s20-period.test.ts
//
// S20.1–S20.4 — Config.getPeriod and readPeriod (coerce.ts), at parity with
// rs.hocon `get_period` / `parse_period` and py.hocon `get_period`
// (o3co/xx.hocon#102). The units-default fixtures up01–up05 run in
// tests/s18-units-default.test.ts.
import { describe, expect, it } from 'vitest'
import { readPeriod } from '../src/coerce.js'
import { ConfigError, NotResolvedError } from '../src/errors.js'
import { parse } from '../src/index.js'
import type { Period } from '../src/index.js'

function period(years: number, months: number, days: number): Period {
  return { years, months, days }
}

describe('getPeriod', () => {
  it.each([
    ['7', period(0, 0, 7)],
    ['7d', period(0, 0, 7)],
    ['7 day', period(0, 0, 7)],
    ['7 days', period(0, 0, 7)],
    ['2w', period(0, 0, 14)],
    ['2 week', period(0, 0, 14)],
    ['2 weeks', period(0, 0, 14)],
    ['3m', period(0, 3, 0)],
    ['3mo', period(0, 3, 0)],
    ['3 month', period(0, 3, 0)],
    ['3 months', period(0, 3, 0)],
    ['1y', period(1, 0, 0)],
    ['1 year', period(1, 0, 0)],
    ['10 years', period(10, 0, 0)],
    ['+7d', period(0, 0, 7)],
    ['-7d', period(0, 0, -7)],
    ['-2w', period(0, 0, -14)],
    ['  7 m  ', period(0, 7, 0)],
  ])('reads %j', (raw, expected) => {
    expect(parse(`p = ${JSON.stringify(raw)}`).getPeriod('p')).toEqual(expected)
  })

  it('reads a bare number literal as days', () => {
    expect(parse('p = 7').getPeriod('p')).toEqual(period(0, 0, 7))
    expect(parse('p = -7').getPeriod('p')).toEqual(period(0, 0, -7))
  })

  it('reads an unquoted value with a unit', () => {
    expect(parse('p = 3 months').getPeriod('p')).toEqual(period(0, 3, 0))
  })

  it('reads -0 as 0', () => {
    expect(Object.is(parse('p = "-0"').getPeriod('p').days, 0)).toBe(true)
  })

  // Unit names are case-sensitive, lowercase only (HOCON.md L1304, as for durations).
  it.each(['7D', '7 Days', '1Y', '3 Months', '2W', '3M'])('rejects the unit case %j', (raw) => {
    expect(() => parse(`p = ${JSON.stringify(raw)}`).getPeriod('p')).toThrow(ConfigError)
  })

  // Integer only (Lightbend Integer.parseInt), unlike durations and byte sizes.
  it.each(['7.5', '7.0', '.5d', '1e2', '1e2d'])('rejects the non-integer %j', (raw) => {
    expect(() => parse(`p = ${JSON.stringify(raw)}`).getPeriod('p')).toThrow(ConfigError)
  })

  it.each(['', ' ', 'd', 'days', 'x7', '7x', '--7', '+-7', '7-', '7 d d', '7 constructor', '7 toString'])(
    'rejects %j',
    (raw) => {
      expect(() => parse(`p = ${JSON.stringify(raw)}`).getPeriod('p')).toThrow(ConfigError)
    },
  )

  // Each component is an i32, as in Lightbend, rs and py; weeks are checked after folding.
  it('rejects a component outside the i32 range', () => {
    expect(parse('p = "2147483647"').getPeriod('p')).toEqual(period(0, 0, 2147483647))
    expect(parse('p = "-2147483648y"').getPeriod('p')).toEqual(period(-2147483648, 0, 0))
    expect(parse('p = "306783378w"').getPeriod('p')).toEqual(period(0, 0, 2147483646))
    for (const raw of ['2147483648', '-2147483649m', '306783379w', '99999999999999999999d']) {
      expect(() => parse(`p = "${raw}"`).getPeriod('p'), raw).toThrow(ConfigError)
    }
  })

  it('throws ConfigError with the path and the value', () => {
    expect(() => parse('a.p = "7.5"').getPeriod('a.p')).toThrow(new ConfigError('invalid period at a.p: "7.5"', 'a.p'))
  })

  it('rejects a boolean, null, object or list', () => {
    expect(() => parse('p = true').getPeriod('p')).toThrow(new ConfigError('expected period at p, got boolean', 'p'))
    expect(() => parse('p = null').getPeriod('p')).toThrow(new ConfigError('expected period at p, got null', 'p'))
    expect(() => parse('p { a = 1 }').getPeriod('p')).toThrow(ConfigError)
    expect(() => parse('p = [1]').getPeriod('p')).toThrow(ConfigError)
  })

  it('throws ConfigError for a missing path', () => {
    expect(() => parse('p = 7').getPeriod('q')).toThrow(ConfigError)
  })

  it('throws NotResolvedError for an unresolved value', () => {
    const c = parse('p = ${x}', { resolveSubstitutions: false })
    expect(() => c.getPeriod('p')).toThrow(NotResolvedError)
  })
})

describe('readPeriod', () => {
  it('gives a Period or the problem', () => {
    expect(readPeriod('2w')).toEqual({ ok: true, value: period(0, 0, 14) })
    expect(readPeriod('7.5')).toEqual({ ok: false, problem: 'invalid' })
    expect(readPeriod('2147483648')).toEqual({ ok: false, problem: 'invalid' })
  })
})
