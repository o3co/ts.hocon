// tests/e20-exact-unit-arithmetic.test.ts
//
// E20 (xx.hocon docs/extra-spec-conventions.md): the numeric part of a unit
// value is read from its source text as an exact decimal and multiplied by the
// unit exactly.
// - Duration: the exact product, rounded once to the nearest double in the
//   output unit (a deliberate divergence from Lightbend's double product).
// - Byte size: the exact product, truncated toward zero, then converted to the
//   output unit with one rounding (Lightbend parity, BigDecimal.toBigInteger).
// E21: a duration the implementation cannot represent is an error; here, a
// result that is not a finite double.
// The units-default fixtures ud09-ud13 / ub07-ub08 run in s18-units-default.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseBytes, parseDuration, readBytes, readDuration } from '../src/coerce.js'
import { ConfigError, parse } from '../src/index.js'
import { getValidated, hocon } from '../src/zod.js'

describe('E20 — duration', () => {
  it.each([
    ['1.001s', 'ms', 1001],
    ['1.001s', 'ns', 1001000000],
    ['2.3h', 'ms', 8280000],
    ['2.3h', 'ns', 8280000000000],
    ['1.001', 'ms', 1.001],
    ['1.001', 'ns', 1001000],
    ['0.1s', 'ms', 100],
    ['0.7m', 's', 42],
    ['1.1d', 'h', 26.4],
    ['-1.001s', 'ms', -1001],
    ['+2.5 seconds', 'ms', 2500],
  ] as const)('%s in %s is %d', (text, unit, expected) => {
    expect(parseDuration(text, unit)).toBe(expected)
  })

  // Integer values in units below a millisecond were inexact too: the unit
  // factor was a float (1e-3) and the output unit divided again.
  it.each([
    ['9us', 'ms', 0.009],
    ['7us', 'ns', 7000],
    ['3ns', 'ms', 0.000003],
    ['123456789ns', 's', 0.123456789],
    ['1500us', 'ms', 1.5],
  ] as const)('%s in %s is %d', (text, unit, expected) => {
    expect(parseDuration(text, unit)).toBe(expected)
  })

  it('rounds once, to the nearest double, in the output unit', () => {
    // 1/3 of an hour in seconds and in days: the exact quotient, rounded once.
    expect(parseDuration('20m', 'h')).toBe(1 / 3)
    expect(parseDuration('1h', 'd')).toBe(1 / 24)
    expect(parseDuration('1ms', 'd')).toBe(1 / 86_400_000)
  })

  it('rounds a result below the normal double range once, too', () => {
    // Exact decimal text for m * 2^-1075 ms (half-units of the smallest subnormal).
    const halves = (m: bigint) => {
      const digits = (m * 5n ** 1075n).toString().padStart(1075, '0')
      return `${digits.slice(0, -1075) || '0'}.${digits.slice(-1075)}`
    }
    expect(parseDuration(halves(1n))).toBe(0) // a tie, to even: 0
    expect(parseDuration(halves(3n))).toBe(2 * 5e-324) // a tie, to even: 2 units
    expect(parseDuration(halves(5n))).toBe(2 * 5e-324) // a tie, to even: 2 units
    // Just above the first tie rounds up (two roundings gave 0 here).
    expect(parseDuration(`0.${'0'.repeat(323)}24703282292062328`)).toBe(5e-324)
    expect(parseDuration(`0.${'0'.repeat(323)}24703282292062327`)).toBe(0)
    // Either side of the smallest normal, 2^-1022.
    expect(parseDuration(`0.${'0'.repeat(307)}22250738585072014`)).toBe(2.2250738585072014e-308)
    expect(parseDuration(`0.${'0'.repeat(307)}22250738585072009`)).toBe(2.225073858507201e-308)
  })

  it('keeps a fraction below a nanosecond in the output unit', () => {
    expect(parseDuration('1.5ns', 'ms')).toBe(0.0000015)
    expect(parseDuration('1.5ns', 'ns')).toBe(1.5)
  })

  it('still rejects what it rejected', () => {
    for (const text of ['', ' ', 's', '1.2.3s', '.s', '-s', '5 parsecs', '5 MS', '5 constructor', '5 toString']) {
      expect([text, parseDuration(text)]).toEqual([text, NaN])
    }
  })

  it('reaches the getter and the marker through readDuration', () => {
    expect(readDuration('1.001s')).toEqual({ ok: true, value: 1001 })
    const c = parse('t = 1.001s, u = 9us')
    expect(c.getDuration('t')).toBe(1001)
    expect(c.getDuration('u')).toBe(0.009)
    expect(getValidated(c, 't', hocon.duration().pipe(z.number().int()))).toBe(1001)
  })
})

describe('E20 — byte size', () => {
  it.each([
    ['1.0009kB', 'B', 1000],
    ['1.001kB', 'B', 1001],
    ['1.9999B', 'B', 1],
    ['0.5KiB', 'B', 512],
    ['1.0009kB', 'KB', 1],
    ['1.0009KiB', 'KiB', 1],
    ['1.5009KiB', 'KiB', 1536 / 1024],
    ['2.5MB', 'MB', 2.5],
    ['1.0000001GB', 'MB', 1000.0001],
  ] as const)('%s in %s is %d (exact product, truncated, then converted)', (text, unit, expected) => {
    expect(parseBytes(text, unit)).toBe(expected)
  })

  it('truncates a bare fractional number too, in any output unit', () => {
    expect(parseBytes('1024.9', 'KiB')).toBe(1)
    expect(parseBytes('1023.9', 'KiB')).toBe(1023 / 1024)
  })

  it('computes the units beyond 2^63 bytes exactly', () => {
    // 0.001 * 1024^6 = 1152921504606846.976 → 1152921504606846 (rounding gave …847)
    expect(parseBytes('0.001EiB')).toBe(1152921504606846)
    expect(parseBytes('0.000000001Y')).toBe(1208925819614629)
    expect(parseBytes('0.000000001YB')).toBe(1000000000000000)
  })

  it('reports an overflow or a negative size as before', () => {
    expect(readBytes('1E')).toEqual({ ok: false, problem: 'overflow' })
    expect(readBytes('9007199254740993')).toEqual({ ok: false, problem: 'overflow' })
    expect(readBytes('9007199254740991')).toEqual({ ok: true, value: 9007199254740991 })
    expect(readBytes('-1kB')).toEqual({ ok: false, problem: 'negative' })
    expect(readBytes('-0.5')).toEqual({ ok: true, value: 0 })
  })

  it('still rejects what it rejected', () => {
    for (const text of ['', 'kB', '1.2.3kB', '1KB', '1 kb', '5 parsecs', '5 constructor', '5 toString']) {
      expect([text, readBytes(text)]).toEqual([text, { ok: false, problem: 'invalid' }])
    }
  })

  it('reaches the getter and the marker through readBytes', () => {
    const c = parse('b = 1.0009kB')
    expect(c.getBytes('b')).toBe(1000)
    expect(getValidated(c, 'b', hocon.bytes())).toBe(1000)
  })
})

describe('E21 — a duration that is not a finite number is an error', () => {
  const huge = `1${'0'.repeat(400)}`

  it('reports overflow from readDuration, for either sign and either form', () => {
    for (const text of [`${huge}d`, `${huge}.5d`, `-${huge}d`, `${huge}`, `${huge}ns`]) {
      expect([text.length, readDuration(text)]).toEqual([text.length, { ok: false, problem: 'overflow' }])
    }
  })

  it('reads the largest finite values', () => {
    const big = `1${'0'.repeat(290)}`
    expect(readDuration(`${big}d`)).toEqual({ ok: true, value: 8.64e297 })
    expect(readDuration(`${huge}ns`, 'd')).toEqual({ ok: false, problem: 'overflow' })
    expect(readDuration(`1${'0'.repeat(300)}ns`, 's')).toEqual({ ok: true, value: Number('1e291') })
  })

  it('makes the getter throw ConfigError with the path', () => {
    const c = parse(`t = "${huge}d"`)
    expect(() => c.getDuration('t')).toThrow(new ConfigError(`duration overflows the representable range at t: "${huge}d"`, 't'))
  })

  it('fails the marker with the key path', () => {
    const c = parse(`t = "${huge}.5d"`)
    expect(() => getValidated(c, 't', hocon.duration())).toThrow(/duration overflows the representable range/)
  })
})

// E20 "exponent forms" (xx.hocon#111): the number part of a unit value is a
// full number, exponent included (the Java double grammar), computed exactly.
// Rows ud14-ud20 / ub09-ub13 as measured on Lightbend 1.4.6 (ud19: E21).
describe('E20 — exponent forms in unit values', () => {
  const durationMs = (text: string) => parse(text).getDuration('t')
  it.each([
    ['t = "1e+5ms"', 100000], // ud14
    ['t = "1.5e2s"', 150000], // ud15
    ['t = "1E3"', 1000], // ud16
    ['t = 1e3', 1000], // ud17 (NUMBER)
    ['t = "1e-3s"', 1], // ud18
    ['t = "-1e3ms"', -1000],
    ['t = "1e3 ms"', 1000],
    ['t = "1.e3ms"', 1000],
    ['t = ".5e1s"', 5000],
    ['t = "1e-400s"', 0],
    ['t = "1e-3ns"', 1e-9], // float output: not short-circuited to 0
    ['t = "0e999999999s"', 0],
  ] as const)('%s → %d ms', (text, ms) => {
    expect(durationMs(text)).toBe(ms)
  })

  it('reads ud18 in ns exactly', () => {
    expect(parse('t = "1e-3s"').getDuration('t', 'ns')).toBe(1000000)
  })

  it.each([
    't = "1e400s"', // ud19 — E21 (Lightbend saturates)
    't = "1e999999999s"',
    't = "-1e999999999s"',
  ])('%s is an overflow (E21)', (text) => {
    expect(() => parse(text).getDuration('t')).toThrow(/duration overflows the representable range/)
  })

  it.each([
    't = "1e3.5ms"', // ud20
    't = "1e3e"',
    't = "1e"',
    't = "1e+"',
    't = "e3ms"',
  ])('%s is invalid', (text) => {
    expect(() => parse(text).getDuration('t')).toThrow(/invalid duration/)
  })

  it.each([
    ['b = "1e3kB"', 1000000], // ub09
    ['b = "1e3"', 1000], // ub10
    ['b = "2E2KiB"', 204800], // ub11
    ['b = "1e-3kB"', 1], // ub12
    ['b = "1.0005e3B"', 1000], // ub12 (b2)
    ['b = "1e-999999999kB"', 0],
    ['b = "1.9e0"', 1],
  ] as const)('%s → %d bytes', (text, bytes) => {
    expect(parse(text).getBytes('b')).toBe(bytes)
  })

  it.each([
    'b = "1e400B"', // ub13
    'b = "1e999999999kB"',
    'b = "1e3e"', // 1e3 exabytes
    'b = "1e16"',
  ])('%s overflows', (text) => {
    expect(() => parse(text).getBytes('b')).toThrow(/byte size overflows/)
  })

  it('keeps the single-letter E unit when no digit follows', () => {
    expect(() => parse('b = "1E"').getBytes('b')).toThrow(/byte size overflows/)
    expect(parse('b = "0.000001E"').getBytes('b')).toBe(Number(1024n ** 6n / 1_000_000n))
  })

  it('reads an exponent with leading zeros by its value (Codex)', () => {
    expect(parse('t = "1e0000000000003ms"').getDuration('t')).toBe(1000)
    expect(parse('t = "1e-0000000000003s"').getDuration('t')).toBe(1)
    expect(parse('b = "1e-0000000000000B"').getBytes('b')).toBe(1)
    expect(parse('b = "1e+00000000000003"').getBytes('b')).toBe(1000)
  })

  it('decides a huge exponent without building the power', () => {
    const start = performance.now()
    expect(() => parse('t = "1e999999999999s"').getDuration('t')).toThrow(/overflows/)
    expect(parse('b = "1e-999999999999kB"').getBytes('b')).toBe(0)
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('leaves periods integer-only', () => {
    expect(() => parse('p = "1e2d"').getPeriod('p')).toThrow(/invalid period/)
  })

  it('makes the marker agree with the getter on exponent forms', () => {
    for (const text of ['t = 1e3', 't = 0.0000001', 't = "1e+5ms"']) {
      const c = parse(text)
      expect([text, getValidated(c, 't', hocon.duration())]).toEqual([text, c.getDuration('t')])
    }
  })
})
