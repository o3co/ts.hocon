/**
 * Exact rational → double conversion for the unit readers (E20).
 *
 * The unit arithmetic in coerce.ts is done in BigInt, so its result is an
 * exact ratio of two integers; this turns that ratio into the nearest double,
 * rounding once. It knows nothing about units.
 */

/** 2^53: every integer up to here is exact as a double. */
const EXACT_LIMIT = 2n ** 53n

function bitLength(n: bigint): number {
  return n.toString(2).length
}

/** `x * 2^e`, exact while the result is a normal double. */
function timesPowerOfTwo(x: number, e: number): number {
  while (e > 1000) { x *= 2 ** 1000; e -= 1000 }
  while (e < -1000) { x *= 2 ** -1000; e += 1000 }
  return x * 2 ** e
}

/**
 * `n / d` (d > 0) rounded once to the nearest double (ties to even). The
 * quotient is taken to 65 bits with the remainder folded into the lowest bit,
 * so Number(bigint)'s own rounding to 53 bits sees an exact tie only when there
 * is one. A result below the normal range (2^-1022) has fewer bits, so it is
 * rounded directly in units of the smallest subnormal, 2^-1074.
 */
export function ratioToNumber(n: bigint, d: bigint): number {
  if (n === 0n) return 0
  // Both exact as doubles: one IEEE division is the correctly rounded quotient.
  if (n <= EXACT_LIMIT && n >= -EXACT_LIMIT && d <= EXACT_LIMIT) return Number(n) / Number(d)
  const negative = n < 0n
  const a = negative ? -n : n
  let shift = 65 - (bitLength(a) - bitLength(d))
  for (;;) {
    const num = shift >= 0 ? a << BigInt(shift) : a
    const den = shift >= 0 ? d : d << BigInt(-shift)
    const q = num / den
    const length = bitLength(q)
    // The first shift gives 65 or 66 bits, so at most one step corrects it.
    if (length > 65) { shift--; continue }
    if (length < 65) { shift++; continue }
    // q * 2^-shift is in [2^(64-shift), 2^(65-shift)): below 2^-1022 from shift 1087.
    const value = shift > 1086
      ? subnormalRatio(a, d)
      : timesPowerOfTwo(Number(q | (num % den === 0n ? 0n : 1n)), -shift)
    return negative ? -value : value
  }
}

/** `a / d` (a, d > 0, below 2^-1022) rounded to the nearest multiple of 2^-1074, ties to even. */
function subnormalRatio(a: bigint, d: bigint): number {
  const num = a << 1074n
  let k = num / d
  const twice = (num % d) * 2n
  if (twice > d || (twice === d && (k & 1n) === 1n)) k++
  // k <= 2^52, so both the conversion and the scaling are exact.
  return Number(k) * 2 ** -1074
}
