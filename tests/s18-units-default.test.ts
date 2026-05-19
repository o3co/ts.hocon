// tests/s18-units-default.test.ts
//
// S18.1 + S18.4 — Default unit for bare number and no-unit string.
// Fixture-driven conformance against xx.hocon/testdata/hocon/units-default/.
//
// Duration fixtures (ud01-ud08): getDuration default unit = ms.
// Bytes fixtures (ub01-ub06): getBytes default unit = bytes (Math.trunc for fractional).
// Negative edge cases (un01-un03): empty/ws-only/unit-only strings → error.
//
// Period fixtures (up01-up05): SKIPPED — S20 ➖ out-of-scope for ts.hocon
// (getPeriod is not implemented). These fixtures are inapplicable.
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
// Period fixtures (up01-up05): SKIPPED
// S20 ➖ out-of-scope for ts.hocon — getPeriod is not implemented.
// Fixtures exist in xx.hocon but are inapplicable to this impl.
// ---------------------------------------------------------------------------
// describe.skip('S18.4 — period no-unit (up01-up05) — S20 ➖ out-of-scope', () => { ... })
