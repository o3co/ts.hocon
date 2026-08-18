// S19.1–S19.3 / S21.2–S21.4 — unit-table alignment with the Lightbend
// reference (typesafe-config 1.4.6 probes, 2026-08-18), part of the four-impl
// units audit the py.hocon verification wave triggered:
//
//   - the bare nano/micro/milli (+plural) duration aliases were missing
//   - the byte table stopped at TiB (spec lists through YB / YiB) and was
//     keyed `KB` with a case-insensitive fallback — Lightbend's table is
//     case-sensitive and its kilo-decimal spelling is `kB` (KB/kb are errors)
//
// Magnitudes at or above 2^53 bytes hit the documented overflow guard, so the
// EB+ rows pin unit RECOGNITION with fractional counts — the same shape
// Lightbend itself needs past its own Java-long ceiling.

import { describe, expect, it } from 'vitest'

import { parseBytes, parseDuration } from '../src/coerce.js'

describe('S19.1–S19.3 — bare duration alias forms', () => {
  it.each([
    ['nano', 1e-6],
    ['nanos', 1e-6],
    ['micro', 1e-3],
    ['micros', 1e-3],
    ['milli', 1],
    ['millis', 1],
  ])('accepts 1%s', (unit, ms) => {
    expect(parseDuration(`1${unit}`)).toBe(ms)
  })

  it('rejects sec/secs (not in the spec list; Lightbend rejects them)', () => {
    expect(parseDuration('1sec')).toBeNaN()
    expect(parseDuration('1secs')).toBeNaN()
  })
})

describe('S21.2 — decimal units through YB', () => {
  it.each([
    ['1kB', 1e3],
    ['1MB', 1e6],
    ['1GB', 1e9],
    ['1TB', 1e12],
    ['1PB', 1e15],
    ['1petabyte', 1e15],
    ['0.001EB', 1e15],
    ['0.000001ZB', 1e15],
    ['0.000000001YB', 1e15],
    ['0.001exabytes', 1e15],
    ['0.000001zettabyte', 1e15],
    ['0.000000001yottabytes', 1e15],
  ])('parses %s', (text, want) => {
    expect(parseBytes(text)).toBe(want)
  })

  it('magnitudes past the 2^53 guard throw', () => {
    expect(() => parseBytes('1EB')).toThrow(RangeError)
    expect(() => parseBytes('1ZB')).toThrow(RangeError)
  })
})

describe('S21.3 — binary units through Yi/YiB', () => {
  it.each([
    ['1Ki', 1024],
    ['1KiB', 1024],
    ['1Pi', 1024 ** 5],
    ['1PiB', 1024 ** 5],
    ['1pebibytes', 1024 ** 5],
  ])('parses %s', (text, want) => {
    expect(parseBytes(text)).toBe(want)
  })

  it('pins Ei/Zi/Yi recognition with fractional counts', () => {
    expect(parseBytes('0.001EiB')).toBe(Math.round(1e-3 * 1024 ** 6))
    expect(parseBytes('0.000001Zi')).toBe(Math.round(1e-6 * 1024 ** 7))
    expect(parseBytes('0.000000001yobibyte')).toBe(Math.round(1e-9 * 1024 ** 8))
  })
})

describe('S21.4 — single letters both cases through Z/Y', () => {
  it('accepts Z/z/Y/y with fractional counts (count 1 overflows the guard)', () => {
    expect(parseBytes('0.000001Z')).toBe(Math.round(1e-6 * 1024 ** 7))
    expect(parseBytes('0.000001z')).toBe(Math.round(1e-6 * 1024 ** 7))
    expect(parseBytes('0.000000001Y')).toBe(Math.round(1e-9 * 1024 ** 8))
    expect(parseBytes('0.000000001y')).toBe(Math.round(1e-9 * 1024 ** 8))
  })
})

describe('S21 — Lightbend case-sensitivity', () => {
  it.each(['1KB', '1kb', '1Kb', '1mB', '1Kilobyte', '1MEGABYTES', '1kiB', '1ki', '1Byte'])(
    'rejects %s',
    (text) => {
      expect(parseBytes(text)).toBeNaN()
    },
  )

  it('keeps the two-case exceptions: bare byte unit and single letters', () => {
    expect(parseBytes('1B')).toBe(1)
    expect(parseBytes('1b')).toBe(1)
    expect(parseBytes('1K')).toBe(1024)
    expect(parseBytes('1k')).toBe(1024)
  })
})
