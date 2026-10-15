// tests/exact-ratio.test.ts
// ratioToNumber (src/internal/exact-ratio.ts) against an independent oracle:
// JavaScript's decimal-string parsing, which is correctly rounded, so
// Number(`${n}e-${k}`) is n / 10^k rounded once to the nearest double.
import { describe, expect, it } from 'vitest'
import { ratioToNumber } from '../src/internal/exact-ratio.js'

/** A small deterministic PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDigits(next: () => number, length: number): string {
  let s = String(1 + Math.floor(next() * 9))
  for (let i = 1; i < length; i++) s += String(Math.floor(next() * 10))
  return s
}

describe('ratioToNumber', () => {
  it('agrees with correctly rounded decimal parsing on n / 10^k', () => {
    const next = rng(20)
    for (let i = 0; i < 3000; i++) {
      const digits = randomDigits(next, 1 + Math.floor(next() * 60))
      const k = Math.floor(next() * 420)
      const sign = next() < 0.5 ? '-' : ''
      const got = ratioToNumber(BigInt(sign + digits), 10n ** BigInt(k))
      expect([digits, k, got]).toEqual([digits, k, Number(`${sign}${digits}e-${k}`)])
    }
  })

  it('agrees on both sides of the fast path (2^53)', () => {
    for (const n of [2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 60n + 3n]) {
      for (const k of [0, 1, 7, 16, 17, 40]) {
        expect(ratioToNumber(n, 10n ** BigInt(k))).toBe(Number(`${n}e-${k}`))
      }
    }
  })

  it('overflows to Infinity only at the rounding threshold', () => {
    const threshold = 2n ** 1024n - 2n ** 970n
    expect(ratioToNumber(threshold - 1n, 1n)).toBe(Number.MAX_VALUE)
    expect(ratioToNumber(threshold, 1n)).toBe(Infinity)
    expect(ratioToNumber(-threshold, 1n)).toBe(-Infinity)
  })
})
