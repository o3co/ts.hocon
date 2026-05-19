// tests/conformance/byte-single-letter.test.ts
//
// S21.4 conformance — xx.hocon fixture loop for single-letter byte abbreviations.
// Fixtures store raw strings like { "b": "1K" }; this test calls getBytes("b")
// and asserts the byte-count values per HOCON.md L1385 (powers of two).
//
// Expected byte counts (Lightbend typesafe-config 1.4.3 verified):
//   bsl01-1K.conf      → getBytes("b") = 1024       (2^10)
//   bsl02-1k.conf      → getBytes("b") = 1024       (2^10, lowercase)
//   bsl03-1M.conf      → getBytes("b") = 1048576    (2^20)
//   bsl04-1G.conf      → getBytes("b") = 1073741824 (2^30)
//   bsl05-1T.conf      → getBytes("b") = 1099511627776 (2^40)
//   bsl06-1P.conf      → getBytes("b") = 1125899906842624 (2^50)
//   bsl07-1E.conf      → getBytes("b") throws RangeError (2^60 > MAX_SAFE_INTEGER)
//   bsl08-1024K.conf   → getBytes("b") = 1048576    (1024 × 1024)
//   bsl09-05K.conf     → getBytes("b") = 512        (0.5 × 1024)
//
// Fixtures from: tests/lightbend/testdata/hocon/byte-single-letter/

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../../src/index.js'

const fixtureDir = fileURLToPath(
  new URL('../lightbend/testdata/hocon/byte-single-letter', import.meta.url)
)

function loadConf(filename: string) {
  const content = readFileSync(join(fixtureDir, filename), 'utf-8')
  return parse(content)
}

describe('S21.4 conformance — byte-single-letter fixtures (bsl01-bsl09)', () => {
  it('bsl01-1K.conf → getBytes("b") = 1024 (2^10, K = kibibyte)', () => {
    const c = loadConf('bsl01-1K.conf')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('bsl02-1k.conf → getBytes("b") = 1024 (lowercase k)', () => {
    const c = loadConf('bsl02-1k.conf')
    expect(c.getBytes('b')).toBe(1024)
  })

  it('bsl03-1M.conf → getBytes("b") = 1048576 (2^20)', () => {
    const c = loadConf('bsl03-1M.conf')
    expect(c.getBytes('b')).toBe(1_048_576)
  })

  it('bsl04-1G.conf → getBytes("b") = 1073741824 (2^30)', () => {
    const c = loadConf('bsl04-1G.conf')
    expect(c.getBytes('b')).toBe(1_073_741_824)
  })

  it('bsl05-1T.conf → getBytes("b") = 1099511627776 (2^40)', () => {
    const c = loadConf('bsl05-1T.conf')
    expect(c.getBytes('b')).toBe(1_099_511_627_776)
  })

  it('bsl06-1P.conf → getBytes("b") = 1125899906842624 (2^50)', () => {
    const c = loadConf('bsl06-1P.conf')
    expect(c.getBytes('b')).toBe(1_125_899_906_842_624)
  })

  it('bsl07-1E.conf → getBytes("b") throws RangeError (2^60 > MAX_SAFE_INTEGER)', () => {
    const c = loadConf('bsl07-1E.conf')
    // 1E = 2^60 = 1.15e18 overflows Number.MAX_SAFE_INTEGER (2^53-1 = 9.0e15)
    expect(() => c.getBytes('b')).toThrow(RangeError)
  })

  it('bsl08-1024K.conf → getBytes("b") = 1048576 (1024 × 1024)', () => {
    const c = loadConf('bsl08-1024K.conf')
    expect(c.getBytes('b')).toBe(1_048_576)
  })

  it('bsl09-05K.conf → getBytes("b") = 512 (0.5 × 1024)', () => {
    const c = loadConf('bsl09-05K.conf')
    expect(c.getBytes('b')).toBe(512)
  })
})
