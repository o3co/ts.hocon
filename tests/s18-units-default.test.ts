// tests/s18-units-default.test.ts
//
// S18.1 + S18.4 — Default unit for bare number and no-unit string.
// Fixture-driven conformance against xx.hocon/testdata/hocon/units-default/.
//
// Duration fixtures (ud01-ud08): getDuration default unit = ms.
// Bytes fixtures (ub01-ub06): getBytes default unit = bytes (Math.trunc for fractional).
// E20 fixtures (ud09-ud11, ub07-ub08): unit arithmetic is exact decimal.
// E21 fixtures (ud12-ud13): a duration that cannot be represented is an error.
// Negative edge cases (un01-un03): empty/ws-only/unit-only strings → error.
//
// Period fixtures (up01-up05): getPeriod default unit = days, integer only.
//
// Fixture path: copied from xx.hocon into ts.hocon via `make testdata`.
// Local path: tests/lightbend/testdata/hocon/units-default/
// (safe for CI — no sibling-repo assumption)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors.js'
import { parse } from '../src/index.js'

const fixtureDir = fileURLToPath(new URL('./lightbend/testdata/hocon/units-default', import.meta.url))

function loadConf(filename: string): ReturnType<typeof parse> {
  const content = readFileSync(join(fixtureDir, filename), 'utf-8')
  return parse(content)
}

// ---------------------------------------------------------------------------
// Duration fixtures (ud01-ud08)
// ---------------------------------------------------------------------------
describe('S18.4 + S18.1 — duration no-unit fallthrough (ud01-ud08)', () => {
  it('ud01: "500" bare string → getDuration("t") = 500 ms', () => {
    const c = loadConf('ud01-duration-bare.conf')
    expect(c.getDuration('t')).toBe(500)
  })

  it('ud02: " 500" leading-WS string → getDuration("t") = 500 ms', () => {
    const c = loadConf('ud02-duration-leading-ws.conf')
    expect(c.getDuration('t')).toBe(500)
  })

  it('ud03: "500 " trailing-WS string → getDuration("t") = 500 ms', () => {
    const c = loadConf('ud03-duration-trailing-ws.conf')
    expect(c.getDuration('t')).toBe(500)
  })

  it('ud04: " 500 " leading+trailing WS string → getDuration("t") = 500 ms', () => {
    const c = loadConf('ud04-duration-both-ws.conf')
    expect(c.getDuration('t')).toBe(500)
  })

  it('ud05: "500.5" fractional string → getDuration("t") = 500.5 ms (Lightbend double-parse)', () => {
    // Per-family Lightbend-faithful: duration accepts fractional; default unit is ms.
    const c = loadConf('ud05-duration-fractional.conf')
    expect(c.getDuration('t')).toBeCloseTo(500.5)
  })

  it('ud06: "-500" negative string → getDuration("t") = -500 ms (negative allowed at accessor)', () => {
    const c = loadConf('ud06-duration-negative.conf')
    expect(c.getDuration('t')).toBe(-500)
  })

  it('ud07: "500ms" with unit → getDuration("t") = 500 ms (regression: unit-present path)', () => {
    const c = loadConf('ud07-duration-with-unit.conf')
    expect(c.getDuration('t')).toBe(500)
  })

  it('ud08: "500 ms" WS between number+unit → getDuration("t") = 500 ms (regression: WS-between)', () => {
    const c = loadConf('ud08-duration-ws-between.conf')
    expect(c.getDuration('t')).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Bytes fixtures (ub01-ub06)
// ---------------------------------------------------------------------------
describe('S18.4 + S18.1 — bytes no-unit fallthrough (ub01-ub06)', () => {
  it('ub01: "1024" bare string → getBytes("b") = 1024', () => {
    const c = loadConf('ub01-bytes-bare.conf')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('ub02: " 1024 " leading+trailing WS → getBytes("b") = 1024', () => {
    const c = loadConf('ub02-bytes-leading-trailing-ws.conf')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('ub03: "1024.5" fractional → getBytes("b") = 1024 (Math.trunc per Lightbend BigDecimal.toBigInteger)', () => {
    const c = loadConf('ub03-bytes-fractional-truncated.conf')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('ub04: "-1" negative → getBytes("b") throws ConfigError (positive-only accessor invariant)', () => {
    const c = loadConf('ub04-bytes-negative-accessor-rejects.conf')
    expect(() => c.getBytes('b')).toThrow(ConfigError)
  })

  // ub05: "1024K" — S21.4 ✅ fixed in Phase 6 #3h.
  it('ub05: "1024K" single-letter K → getBytes("b") = 1048576 (1024 × 1024 per S21.4)', () => {
    const c = loadConf('ub05-bytes-with-unit.conf')
    expect(c.getBytes('b')).toBe(1_024 * 1_024)
  })

  it('ub06: "" empty string → getBytes("b") throws ConfigError', () => {
    const c = loadConf('ub06-bytes-empty-rejected.conf')
    expect(() => c.getBytes('b')).toThrow(ConfigError)
  })
})

// ---------------------------------------------------------------------------
// Negative edge cases (un01-un03): empty / ws-only / unit-only strings
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// E20 fixtures (ud09-ud11, ub07-ub08): exact decimal unit arithmetic
// ---------------------------------------------------------------------------
describe('E20 — exact decimal unit arithmetic (ud09-ud11, ub07-ub08)', () => {
  it('ud09: "1.001s" → getDuration("t") = 1001 ms (not 1000.9999999999999)', () => {
    const c = loadConf('ud09-duration-fractional-exact.conf')
    expect(c.getDuration('t')).toBe(1001)
    expect(c.getDuration('t', 'ns')).toBe(1001000000)
  })

  it('ud10: "2.3h" → getDuration("t") = 8280000 ms (not 8279999.999999999)', () => {
    const c = loadConf('ud10-duration-fractional-exact-hours.conf')
    expect(c.getDuration('t')).toBe(8280000)
    expect(c.getDuration('t', 'ns')).toBe(8280000000000)
  })

  it('ud11: "1.001" no unit → getDuration("t") = 1.001 ms (1001000 ns)', () => {
    const c = loadConf('ud11-duration-fractional-exact-no-unit.conf')
    expect(c.getDuration('t')).toBe(1.001)
    expect(c.getDuration('t', 'ns')).toBe(1001000)
  })

  it('ub07: "1.0009kB" → getBytes("b") = 1000 (truncated, not rounded)', () => {
    const c = loadConf('ub07-bytes-fractional-unit-truncated.conf')
    expect(c.getBytes('b')).toBe(1000)
  })

  it('ub08: "1.001kB" → getBytes("b") = 1001 (exact before truncation)', () => {
    const c = loadConf('ub08-bytes-fractional-unit-exact.conf')
    expect(c.getBytes('b')).toBe(1001)
  })
})

describe('E21 — unrepresentable duration (ud12-ud13)', () => {
  it('ud12: 10^400 days → getDuration("t") throws ConfigError (not Infinity)', () => {
    const c = loadConf('ud12-duration-overflow-rejected.conf')
    expect(() => c.getDuration('t')).toThrow(ConfigError)
  })

  it('ud13: 10^400.5 days, fractional form → getDuration("t") throws ConfigError (not Infinity)', () => {
    const c = loadConf('ud13-duration-overflow-fractional-rejected.conf')
    expect(() => c.getDuration('t')).toThrow(ConfigError)
  })
})

describe('S18.4 — negative edge cases (un01-un03)', () => {
  it('un01: "" empty string → getDuration("t") throws ConfigError', () => {
    const c = loadConf('un01-empty-duration.conf')
    expect(() => c.getDuration('t')).toThrow(ConfigError)
  })

  it('un02: "   " whitespace-only string → getDuration("t") throws ConfigError', () => {
    const c = loadConf('un02-ws-only-duration.conf')
    expect(() => c.getDuration('t')).toThrow(ConfigError)
  })

  it('un03: "ms" unit-only string → getDuration("t") throws ConfigError (number required)', () => {
    const c = loadConf('un03-unit-only-duration.conf')
    expect(() => c.getDuration('t')).toThrow(ConfigError)
  })
})

// ---------------------------------------------------------------------------
// Period fixtures (up01-up05)
// ---------------------------------------------------------------------------
describe('S18.4 — period no-unit (up01-up05)', () => {
  it('up01: "7" bare string → getPeriod("p") = 7 days', () => {
    const c = loadConf('up01-period-bare.conf')
    expect(c.getPeriod('p')).toEqual({ years: 0, months: 0, days: 7 })
  })

  it('up02: " 7 " leading+trailing WS string → getPeriod("p") = 7 days', () => {
    const c = loadConf('up02-period-leading-trailing-ws.conf')
    expect(c.getPeriod('p')).toEqual({ years: 0, months: 0, days: 7 })
  })

  it('up03: "7.5" fractional string → getPeriod("p") throws ConfigError (integer only)', () => {
    const c = loadConf('up03-period-fractional-rejected.conf')
    expect(() => c.getPeriod('p')).toThrow(ConfigError)
  })

  it('up04: "-7" negative string → getPeriod("p") = -7 days (negative allowed)', () => {
    const c = loadConf('up04-period-negative.conf')
    expect(c.getPeriod('p')).toEqual({ years: 0, months: 0, days: -7 })
  })

  it('up05: "7w" → getPeriod("p") = 49 days (weeks fold into days)', () => {
    const c = loadConf('up05-period-with-unit.conf')
    expect(c.getPeriod('p')).toEqual({ years: 0, months: 0, days: 49 })
  })
})
