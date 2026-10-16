// tests/zod-unit-markers.test.ts
// hocon.duration() / hocon.bytes() / hocon.period() — Zod schema markers for
// HOCON unit values (ts.hocon#195, o3co/xx.hocon#102). A marker must read what
// the matching Config getter reads, so the parity tables below run each input
// through both. The documented differences — number literals in exponent form,
// and for a period also with a decimal point — are pinned separately.

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { NotResolvedError } from '../src/errors.js'
import { getValidated, hocon, parseWithSchema, validate } from '../src/zod.js'
import { namesMagnitudeUnit, namesPeriodUnit, readBytes, readDuration } from '../src/coerce.js'
import type { ByteUnit, DurationUnit, Period } from '../src/coerce.js'

/** The getter's answer: its value, or 'error' when it throws. */
function viaGetter<T>(read: () => T): T | 'error' {
  try {
    return read()
  } catch {
    return 'error'
  }
}

/** The marker's answer through getValidated: its value, or 'error' when validation fails. */
function viaMarker<T>(schema: z.ZodType<T>, input: string, path = 'v'): T | 'error' {
  try {
    return getValidated(parse(input), path, schema)
  } catch {
    return 'error'
  }
}

describe('hocon.duration()', () => {
  it('reads the issue example', () => {
    const cfg = parse('session { lifetime = 30m, max-body = 64KiB }')
    const section = z.object({
      lifetime: hocon.duration('s').pipe(z.number().int().min(60).max(86_400)),
      'max-body': hocon.bytes('B').pipe(z.number().int().positive()),
    })
    expect(getValidated(cfg, 'session', section)).toEqual({ lifetime: 1800, 'max-body': 65536 })
  })

  const inputs = [
    'v = 30m', 'v = "30 m"', 'v = 1500', 'v = 1.5s', 'v = 2 days', 'v = 10ns', 'v = 0',
    'v = -5s', 'v = "  7 h  "', 'v = 0.000001', 'v = 30M', 'v = 30 parsecs',
    'v = abc', 'v = ""', 'v = true', 'v = null', 'v = [1]', 'v { a = 1 }',
  ]
  const units: (DurationUnit | undefined)[] = [undefined, 'ns', 'ms', 's', 'm', 'd']

  for (const unit of units) {
    it(`agrees with getDuration (unit ${unit ?? 'default'})`, () => {
      for (const input of inputs) {
        const expected = viaGetter(() => parse(input).getDuration('v', unit))
        expect([input, viaMarker(hocon.duration(unit), input)]).toEqual([input, expected])
      }
    })
  }

  it('reads a plain number as milliseconds, like getDuration', () => {
    expect(getValidated(parse('t = 2500'), 't', hocon.duration('s'))).toBe(2.5)
  })

  it('fails with the key path on an invalid duration', () => {
    const schema = z.object({ server: z.object({ timeout: hocon.duration() }) })
    const result = (() => {
      try {
        validate(parse('server.timeout = 5 parsecs'), schema)
      } catch (err) {
        return err
      }
    })()
    expect(result).toBeInstanceOf(z.ZodError)
    const issue = (result as z.ZodError).issues[0]
    expect(issue.path).toEqual(['server', 'timeout'])
    expect(issue.message).toBe('not a duration')
  })

  it('names the type it got for a non-scalar or boolean', () => {
    expect(() => getValidated(parse('t = true'), 't', hocon.duration())).toThrow(/expected duration, got boolean/)
    expect(() => getValidated(parse('t { a = 1 }'), 't', hocon.duration())).toThrow(/expected duration, got object/)
  })

  it('leaves constraints to the piped schema', () => {
    const schema = hocon.duration('s').pipe(z.number().int().min(60))
    expect(getValidated(parse('t = 90s'), 't', schema)).toBe(90)
    expect(() => getValidated(parse('t = 30s'), 't', schema)).toThrow(/>=60/)
    expect(() => getValidated(parse('t = 1500ms'), 't', schema)).toThrow(/int/)
  })

  it('works through optional / default / nullable / describe / nested pipes', () => {
    const schema = z.object({
      a: hocon.duration('s').optional(),
      b: hocon.duration('s').default(5),
      c: hocon.duration('s').nullable(),
      d: hocon.duration('s').describe('doc').pipe(z.number()).pipe(z.number().int()),
    })
    expect(validate(parse('a = 1m, c = null, d = 2m'), schema)).toEqual({ a: 60, b: 5, c: null, d: 120 })
  })

  it('reads array elements', () => {
    const schema = z.object({ backoff: z.array(hocon.duration('ms')) })
    expect(validate(parse('backoff = [100ms, 1s, 2500]'), schema)).toEqual({ backoff: [100, 1000, 2500] })
  })

  it('works in parseWithSchema', () => {
    const schema = z.object({ ttl: hocon.duration('m') })
    expect(parseWithSchema('ttl = 2h', schema)).toEqual({ ttl: 120 })
  })

  it('reads a value supplied by a fallback layer and a substitution', () => {
    const cfg = parse('base = 45s\nsession.idle = ${base}').withFallback(parse('session.lifetime = 30m'))
    const schema = z.object({ idle: hocon.duration('s'), lifetime: hocon.duration('s') })
    expect(getValidated(cfg, 'session', schema)).toEqual({ idle: 45, lifetime: 1800 })
  })

  it('works in record, union and intersection positions', () => {
    const schema = z.object({
      timeouts: z.record(z.string(), hocon.duration('s')),
      retry: z.union([z.literal('never'), hocon.duration('s')]),
      both: z.intersection(z.object({ a: hocon.duration('s') }), z.object({ b: z.string() })),
    })
    const cfg = parse('timeouts { read = 5s, write = 1m }\nretry = 2s\nboth { a = 1m, b = x }')
    expect(validate(cfg, schema)).toEqual({
      timeouts: { read: 5, write: 60 }, retry: 2, both: { a: 60, b: 'x' },
    })
  })

  it('works on a resolved value of a partially unresolved config', () => {
    const cfg = parse('t = 30s\nu = ${missing}', { resolveSubstitutions: false })
    expect(getValidated(cfg, 't', hocon.duration('s'))).toBe(30)
    // The whole config still holds ${missing} (#210).
    expect(() => validate(cfg, z.object({ t: hocon.duration('s') }))).toThrow(NotResolvedError)
  })

  it('works with schema.parse directly', () => {
    expect(hocon.duration('s').parse('30m')).toBe(1800)
    expect(hocon.duration('s').parse(2000)).toBe(2)
    expect(() => hocon.duration().parse(true)).toThrow(/expected duration, got boolean/)
  })

  // E20 exponent forms (xx.hocon#111): the getters read exponent forms too, so
  // a number literal written with an exponent, or one JavaScript prints with
  // one (0.0000001 → "1e-7"), reads the same through the getter and the marker.
  it('reads a number literal in exponent form like the getter', () => {
    expect(viaGetter(() => parse('v = 1e3').getDuration('v'))).toBe(1000)
    expect(viaMarker(hocon.duration(), 'v = 1e3')).toBe(1000)
    expect(viaGetter(() => parse('v = 0.0000001').getDuration('v'))).toBe(1e-7)
    expect(viaMarker(hocon.duration(), 'v = 0.0000001')).toBe(1e-7)
  })

  // Documented difference (E20): the getters read the literal's digits exactly,
  // the marker reads the double they round to.
  it('reads a number literal beyond double precision through its JS value', () => {
    expect(parse('v = 1.0000000000000001').getDuration('v', 'ns')).toBe(1000000.0000000001)
    expect(viaMarker(hocon.duration('ns'), 'v = 1.0000000000000001')).toBe(1000000)
    // Written with a unit, it is a string and reads the same.
    expect(viaMarker(hocon.duration('ns'), 'v = 1.0000000000000001ms')).toBe(1000000.0000000001)
  })
})

describe('hocon.bytes()', () => {
  const inputs = [
    'v = 64KiB', 'v = "10 MB"', 'v = 512', 'v = 0.5M', 'v = 1.5', 'v = 1k', 'v = 1kB', 'v = 1KB',
    'v = 2 megabytes', 'v = -1', 'v = -1k', 'v = 1E', 'v = 9007199254740993', 'v = 1 parsec',
    'v = abc', 'v = true', 'v = null', 'v = [1]',
  ]
  const units: (ByteUnit | undefined)[] = [undefined, 'B', 'KB', 'KiB', 'MiB']

  for (const unit of units) {
    it(`agrees with getBytes (unit ${unit ?? 'default'})`, () => {
      for (const input of inputs) {
        const expected = viaGetter(() => parse(input).getBytes('v', unit))
        expect([input, viaMarker(hocon.bytes(unit), input)]).toEqual([input, expected])
      }
    })
  }

  // Documented difference (E20): see the duration pin above.
  it('reads a number literal beyond double precision through its JS value', () => {
    expect(parse('v = 1.99999999999999999').getBytes('v')).toBe(1)
    expect(viaMarker(hocon.bytes(), 'v = 1.99999999999999999')).toBe(2)
    expect(parse('v = 9007199254740991.5').getBytes('v')).toBe(9007199254740991)
    expect(viaMarker(hocon.bytes(), 'v = 9007199254740991.5')).toBe('error')
    expect(viaMarker(hocon.bytes(), 'v = "1.99999999999999999"')).toBe(1)
  })

  it('reads a plain number as bytes, like getBytes', () => {
    expect(getValidated(parse('n = 2048'), 'n', hocon.bytes('KiB'))).toBe(2)
  })

  it('fails with the key path on a negative, invalid, or overflowing size', () => {
    const schema = z.object({ limits: z.object({ body: hocon.bytes() }) })
    const issueFor = (input: string) => {
      try {
        validate(parse(input), schema)
      } catch (err) {
        return (err as z.ZodError).issues[0]
      }
      throw new Error(`expected ${input} to fail`)
    }
    expect(issueFor('limits.body = -1k')).toMatchObject({
      path: ['limits', 'body'],
      message: 'byte size must be non-negative',
      params: { problem: 'negative' },
    })
    expect(issueFor('limits.body = 3 parsecs')).toMatchObject({
      path: ['limits', 'body'],
      message: 'not a byte size',
      params: { problem: 'invalid' },
    })
    expect(issueFor('limits.body = 1E')).toMatchObject({
      path: ['limits', 'body'],
      message: 'byte size overflows the representable range',
      params: { problem: 'overflow' },
    })
  })
})

describe('hocon.period()', () => {
  const inputs = [
    'v = 7', 'v = "7"', 'v = " 7 "', 'v = 7d', 'v = 2w', 'v = "3 months"', 'v = 3mo', 'v = 1y', 'v = -7',
    'v = "-2w"', 'v = "+7d"', 'v = "-0"', 'v = 7.5', 'v = 7.0d', 'v = "7D"', 'v = 2147483648',
    'v = 306783379w', 'v = 7 parsecs',
    'v = abc', 'v = ""', 'v = true', 'v = null', 'v = [1]', 'v { a = 1 }',
  ]

  it('agrees with getPeriod', () => {
    for (const input of inputs) {
      const expected = viaGetter(() => parse(input).getPeriod('v'))
      expect([input, viaMarker(hocon.period(), input)]).toEqual([input, expected])
    }
  })

  it('gives a Period, refined by the piped schema', () => {
    const schema = z.object({
      retention: hocon.period().refine((p) => p.years === 0, 'use months, not years'),
    })
    const parsed: { retention: Period } = validate(parse('retention = 6 months'), schema)
    expect(parsed).toEqual({ retention: { years: 0, months: 6, days: 0 } })
    expect(() => validate(parse('retention = 1y'), schema)).toThrow(/use months, not years/)
  })

  it('fails with the key path on an invalid period', () => {
    try {
      validate(parse('backup.keep = 7.5'), z.object({ backup: z.object({ keep: hocon.period() }) }))
      expect.unreachable()
    } catch (err) {
      expect((err as z.ZodError).issues[0]).toMatchObject({
        path: ['backup', 'keep'],
        message: 'not a period',
        params: { problem: 'invalid' },
      })
    }
  })

  // Documented difference: the getter reads the source text and refuses a
  // number literal with a decimal point or an exponent (integer only); the
  // marker reads the JS number, so `7.0` is 7 and `1e2` is 100.
  it('reads a number literal with a decimal point or an exponent through its JS value', () => {
    for (const [input, days] of [['v = 7.0', 7], ['v = -7.00', -7], ['v = 1e2', 100]] as const) {
      expect([input, viaGetter(() => parse(input).getPeriod('v'))]).toEqual([input, 'error'])
      expect([input, viaMarker(hocon.period(), input)]).toEqual([input, { years: 0, months: 0, days }])
    }
  })

  it('names the type it got for a non-scalar or boolean', () => {
    expect(() => getValidated(parse('p = true'), 'p', hocon.period())).toThrow(/expected period, got boolean/)
    expect(() => getValidated(parse('p = [1]'), 'p', hocon.period())).toThrow(/expected period, got array/)
  })
})

describe('unit readers (coerce.ts)', () => {
  it('tell whether a magnitude names its unit, by the readers\' split', () => {
    for (const text of ['30s', ' 30 s ', '1e3ms', '1E', '0.5G', '64KiB']) expect([text, namesMagnitudeUnit(text)]).toEqual([text, true])
    for (const text of ['30', ' 30 ', '1e3', '1E+3', '.5', '-0']) expect([text, namesMagnitudeUnit(text)]).toEqual([text, false])
  })

  it('tell whether a period names its unit, by readPeriod\'s split', () => {
    for (const text of ['7d', '2 w', '-7d', '+1y']) expect([text, namesPeriodUnit(text)]).toEqual([text, true])
    for (const text of ['14', ' 14 ', '-7', '+0']) expect([text, namesPeriodUnit(text)]).toEqual([text, false])
  })

  it('report why a text is not a unit value', () => {
    expect(readDuration('90s', 's')).toEqual({ ok: true, value: 90 })
    expect(readDuration('90 parsecs')).toEqual({ ok: false, problem: 'invalid' })
    expect(readBytes('1KiB')).toEqual({ ok: true, value: 1024 })
    expect(readBytes('-1')).toEqual({ ok: false, problem: 'negative' })
    expect(readBytes('1E')).toEqual({ ok: false, problem: 'overflow' })
    expect(readBytes('abc')).toEqual({ ok: false, problem: 'invalid' })
  })
})

// #226 — a marker's issue names the problem, never the value: validation
// messages end up in boot logs, and the value may be a secret set under the
// wrong key.
describe('marker issues keep the value out', () => {
  const secret = 's3cret-token'

  for (const [name, schema, input] of [
    ['duration', hocon.duration(), `"${secret}"`],
    ['byte size', hocon.bytes(), `"${secret}"`],
    ['negative byte size', hocon.bytes(), '"-123456789k"'],
    ['overflowing byte size', hocon.bytes(), '"987654321E"'],
    ['period', hocon.period(), `"${secret}"`],
  ] as const) {
    it(`leaves the ${name} out of every rendering of the error`, () => {
      const value = input.slice(1, -1)
      let err: z.ZodError | undefined
      try {
        validate(parse(`a.b = ${input}`), z.object({ a: z.object({ b: schema }) }))
      } catch (e) {
        err = e as z.ZodError
      }
      expect(err).toBeInstanceOf(z.ZodError)
      for (const rendered of [
        err!.message,
        z.prettifyError(err!),
        JSON.stringify(err!.issues),
        JSON.stringify(z.treeifyError(err!)),
        JSON.stringify(z.flattenError(err!)),
      ]) {
        expect(rendered).not.toContain(value)
      }
    })
  }

  it('keeps the value in input when the caller asks Zod to report it', () => {
    const result = hocon.duration().safeParse(secret, { reportInput: true })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]).toMatchObject({ message: 'not a duration', input: secret })
  })
})

// #233 — `requireUnit` makes the unit part of the schema's contract: a value
// without one (a number, or a string of the number alone, which is what an
// environment variable gives) is refused instead of read in the default unit.
describe('requireUnit', () => {
  const issueOf = (src: string, schema: z.ZodType, env: Record<string, string> = {}) => {
    try {
      validate(parse(src, { env }), schema)
    } catch (err) {
      return (err as z.ZodError).issues[0]
    }
    throw new Error(`expected ${src} to fail`)
  }

  const ttl = z.object({ ttl: hocon.duration('s', { requireUnit: true }).pipe(z.number().int().min(1).max(3600)) })

  it('reads a value that names its unit', () => {
    expect(validate(parse('ttl = 30s'), ttl)).toEqual({ ttl: 30 })
    expect(validate(parse('ttl = "30 s"'), ttl)).toEqual({ ttl: 30 })
    expect(validate(parse('ttl = 1m'), ttl)).toEqual({ ttl: 60 })
    expect(validate(parse('ttl = ${?TTL}', { env: { TTL: '2m' } }), ttl)).toEqual({ ttl: 120 })
  })

  it('refuses a number, a bare numeric string and an exponent without a unit', () => {
    for (const [src, env] of [
      ['ttl = 30', {}],
      ['ttl = "30"', {}],
      ['ttl = ${?TTL}', { TTL: '30' }],
      ['ttl = "1e3"', {}],
      ['ttl = " 30 "', {}],
    ] as const) {
      expect(issueOf(src, ttl, env)).toMatchObject({
        code: 'custom',
        path: ['ttl'],
        message: 'duration must name its unit',
        params: { problem: 'missing-unit' },
      })
    }
  })

  it('reports a value that does not read as a value, not as a missing unit', () => {
    expect(issueOf('ttl = abc', ttl)).toMatchObject({ params: { problem: 'invalid' } })
    expect(issueOf('ttl = "5 parsecs"', ttl)).toMatchObject({ params: { problem: 'invalid' } })
  })

  it('applies to byte sizes and periods', () => {
    const limits = z.object({
      max: hocon.bytes('B', { requireUnit: true }).pipe(z.number().int().positive()),
      keep: hocon.period({ requireUnit: true }),
    })
    expect(validate(parse('max = 64KiB, keep = 2w'), limits)).toEqual({
      max: 65536,
      keep: { years: 0, months: 0, days: 14 },
    })
    expect(issueOf('max = 65536, keep = 2w', limits)).toMatchObject({
      path: ['max'],
      message: 'byte size must name its unit',
      params: { problem: 'missing-unit' },
    })
    expect(issueOf('max = 1k, keep = 14', limits)).toMatchObject({
      path: ['keep'],
      message: 'period must name its unit',
      params: { problem: 'missing-unit' },
    })
    expect(issueOf('max = "-1k", keep = 2w', limits)).toMatchObject({ params: { problem: 'negative' } })
  })

  it('keeps the default: a bare number reads in the default unit', () => {
    expect(validate(parse('ttl = 30'), z.object({ ttl: hocon.duration('s') }))).toEqual({ ttl: 0.03 })
    expect(validate(parse('ttl = 30'), z.object({ ttl: hocon.duration('s', { requireUnit: false }) }))).toEqual({
      ttl: 0.03,
    })
    expect(validate(parse('keep = 14'), z.object({ keep: hocon.period() }))).toEqual({
      keep: { years: 0, months: 0, days: 14 },
    })
  })

  it('reads the unit forms the readers accept', () => {
    const d = hocon.duration('s', { requireUnit: true })
    expect(d.parse('1e3ms')).toBe(1)
    expect(d.parse('.5s')).toBe(0.5)
    expect(d.parse('+30s')).toBe(30)
    expect(hocon.bytes('B', { requireUnit: true }).parse('0.5k')).toBe(512)
    expect(validate(parse('max = ${?MAX}', { env: { MAX: '1k' } }), z.object({ max: hocon.bytes('B', { requireUnit: true }) }))).toEqual({ max: 1024 })
    expect(validate(parse('keep = ${?KEEP}', { env: { KEEP: '2 w' } }), z.object({ keep: hocon.period({ requireUnit: true }) }))).toEqual({
      keep: { years: 0, months: 0, days: 14 },
    })
  })

  it('keeps the problem of a value that does not read, unit or not', () => {
    const problem = (schema: z.ZodType, input: unknown) =>
      (schema.safeParse(input).error?.issues[0] as z.core.$ZodIssueCustom | undefined)?.params?.problem
    expect(problem(hocon.bytes('B', { requireUnit: true }), -1)).toBe('negative')
    expect(problem(hocon.bytes('B', { requireUnit: true }), '-1')).toBe('negative')
    expect(problem(hocon.duration('ms', { requireUnit: true }), '1e400')).toBe('overflow')
    expect(problem(hocon.period({ requireUnit: true }), '7.5')).toBe('invalid')
    expect(problem(hocon.duration('ms', { requireUnit: true }), '30S')).toBe('invalid')
  })

  it('keeps the default for byte sizes and periods with requireUnit false', () => {
    expect(hocon.bytes('B', { requireUnit: false }).parse(30)).toBe(30)
    expect(hocon.period({ requireUnit: false }).parse('14')).toEqual({ years: 0, months: 0, days: 14 })
  })

  it('keeps the value in input only when Zod is asked to report it', () => {
    const d = hocon.duration('s', { requireUnit: true })
    expect(d.safeParse('30', { reportInput: true }).error?.issues[0]).toMatchObject({
      params: { problem: 'missing-unit' },
      input: '30',
    })
    expect(d.safeParse('30').error?.issues[0]).not.toHaveProperty('input')
  })

  it('keeps the value out of the message', () => {
    const err = (() => {
      try {
        validate(parse('ttl = "31536000"'), ttl)
      } catch (e) {
        return e as z.ZodError
      }
    })()
    expect(err?.message).not.toContain('31536000')
    expect(z.prettifyError(err!)).not.toContain('31536000')
  })
})
