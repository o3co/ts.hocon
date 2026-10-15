// tests/zod-unit-markers.test.ts
// hocon.duration() / hocon.bytes() — Zod schema markers for HOCON unit values
// (ts.hocon#195). A marker must read exactly what the matching Config getter
// reads, so the parity tables below run each input through both.

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { getValidated, hocon, parseWithSchema, validate } from '../src/zod.js'
import type { ByteUnit, DurationUnit } from '../src/coerce.js'

/** The getter's answer: a number, or 'error' when it throws. */
function viaGetter(read: () => number): number | 'error' {
  try {
    return read()
  } catch {
    return 'error'
  }
}

/** The marker's answer through getValidated: a number, or 'error' when validation fails. */
function viaMarker(schema: z.ZodType<number>, input: string, path = 'v'): number | 'error' {
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
    'v = -5s', 'v = "  7 h  "', 'v = 1e3', 'v = 0.0000001', 'v = 30M', 'v = 30 parsecs',
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
    expect(issue.message).toBe('invalid duration: "5 parsecs"')
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

  it('is recognised through optional / default / nullable / describe / nested pipes', () => {
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

  it('reads the plain value when parsed outside the entry points', () => {
    expect(hocon.duration('s').parse('30m')).toBe(1800)
    expect(hocon.duration('s').parse(2000)).toBe(2)
    expect(() => hocon.duration().parse(true)).toThrow(/expected duration, got boolean/)
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
      message: 'byte size must be non-negative: "-1k"',
    })
    expect(issueFor('limits.body = 3 parsecs')).toMatchObject({
      path: ['limits', 'body'],
      message: 'invalid byte size: "3 parsecs"',
    })
    expect(issueFor('limits.body = 1E')).toMatchObject({
      path: ['limits', 'body'],
      message: expect.stringMatching(/overflows/),
    })
  })
})
