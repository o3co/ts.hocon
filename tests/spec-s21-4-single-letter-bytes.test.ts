// tests/spec-s21-4-single-letter-bytes.test.ts
//
// S21.4 — Single-letter byte abbreviations use powers of two (HOCON.md L1385)
// RED tests — must FAIL before the fix is applied to src/coerce.ts.
//
// Spec: "single-character abbreviations ('128K') should go with... powers of two."
// Lightbend typesafe-config 1.4.3 verified: 1K=1024, 1M=1048576, etc.
//
// Fix location: src/coerce.ts BYTE_UNITS — add K/k/M/m/G/g/T/t/P/p/E/e entries.
// Plus overflow guard: if result > Number.MAX_SAFE_INTEGER → throw RangeError.

import { describe, it, expect } from 'vitest'
import { parseBytes } from '../src/coerce.js'

describe('S21.4 — single-letter byte abbreviations → powers of two (HOCON.md L1385)', () => {
  it('S21.4: parseBytes("1K") = 1024 (2^10)', () => {
    expect(parseBytes('1K')).toBe(1024)
  })

  it('S21.4: parseBytes("1k") = 1024 (lowercase k → same binary)', () => {
    expect(parseBytes('1k')).toBe(1024)
  })

  it('S21.4: parseBytes("1M") = 1048576 (2^20)', () => {
    expect(parseBytes('1M')).toBe(1_048_576)
  })

  it('S21.4: parseBytes("1G") = 1073741824 (2^30)', () => {
    expect(parseBytes('1G')).toBe(1_073_741_824)
  })

  it('S21.4: parseBytes("1T") = 1099511627776 (2^40)', () => {
    expect(parseBytes('1T')).toBe(1_099_511_627_776)
  })

  it('S21.4: parseBytes("1P") = 1125899906842624 (2^50)', () => {
    expect(parseBytes('1P')).toBe(1_125_899_906_842_624)
  })

  it('S21.4: parseBytes("1E") throws RangeError — 2^60 > MAX_SAFE_INTEGER (2^53-1)', () => {
    // 1E = 2^60 = 1.15e18 > Number.MAX_SAFE_INTEGER = 9.0e15
    expect(() => parseBytes('1E')).toThrow(RangeError)
  })

  it('S21.4: parseBytes("16E") throws RangeError — overflow', () => {
    expect(() => parseBytes('16E')).toThrow(RangeError)
  })

  it('S21.4: parseBytes("1024K") = 1048576 (1024 × 1024)', () => {
    expect(parseBytes('1024K')).toBe(1_048_576)
  })

  it('S21.4: parseBytes("0.5K") = 512 (fractional × single-letter)', () => {
    expect(parseBytes('0.5K')).toBe(512)
  })

  // Lowercase variants for M/G/T/P/E
  it('S21.4: parseBytes("1m") = 1048576', () => {
    expect(parseBytes('1m')).toBe(1_048_576)
  })

  it('S21.4: parseBytes("1g") = 1073741824', () => {
    expect(parseBytes('1g')).toBe(1_073_741_824)
  })

  it('S21.4: parseBytes("1t") = 1099511627776', () => {
    expect(parseBytes('1t')).toBe(1_099_511_627_776)
  })

  it('S21.4: parseBytes("1p") = 1125899906842624', () => {
    expect(parseBytes('1p')).toBe(1_125_899_906_842_624)
  })

  it('S21.4: parseBytes("1e") throws RangeError — lowercase e also 2^60', () => {
    expect(() => parseBytes('1e')).toThrow(RangeError)
  })

  // Regression guard: multi-letter units (KB/MB) remain unchanged (SI decimal)
  it('S21.4 regression: parseBytes("1KB") = 1000 (multi-letter KB stays SI decimal)', () => {
    expect(parseBytes('1KB')).toBe(1_000)
  })

  it('S21.4 regression: parseBytes("1MB") = 1000000 (multi-letter MB stays SI decimal)', () => {
    expect(parseBytes('1MB')).toBe(1_000_000)
  })
})
