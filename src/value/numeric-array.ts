// src/value/numeric-array.ts
//
// S15 — Numerically-indexed object → array conversion helper.
// Spec: docs/superpowers/specs/2026-05-16-s15-numeric-obj-array-design.md
// Issue: https://github.com/o3co/ts.hocon/issues/87
//
// This module is intentionally NOT exported from the public API (src/index.ts).
// It is a private helper shared between the accessor call-site (Config.getList)
// and the resolver concat call-site (SubstitutionResolver.resolveConcat).

import type { HoconValue } from '../value.js'

/**
 * Attempt to convert a numerically-keyed HOCON object to an array.
 *
 * Contract (per spec §"Function contract"):
 *   - If `value` is not an object        → returns null
 *   - If `value` is an empty object      → returns null  (S15.4: empty NOT converted)
 *   - If no key parses as non-neg int    → returns null
 *   - Otherwise                          → returns values sorted by parsed key (ascending)
 *
 * Integer key parse rule (per spec §"Integer key parse rule"):
 *   Pre-filter: ^(0|[1-9][0-9]*)$  — rejects "+1", "-0", "00", " 1", "", hex, decimal, etc.
 *   Then: parse to integer and verify in i32 range [0, 2147483647].
 *
 * Conversion is non-recursive: only top-level keys are examined.
 * The returned array is a new HoconValue — the original object is NOT mutated.
 */
export function numericObjectToArray(value: HoconValue): HoconValue[] | null {
  if (value.kind !== 'object') return null
  if (value.fields.size === 0) return null

  // Pre-filter pattern: canonical decimal non-negative integers only.
  // Rejects: "+1", "-0", "-1", "00", "01", " 1", "1 ", "0x1", "1e2", "1.0", ""
  const canonicalInt = /^(0|[1-9][0-9]*)$/

  const eligible: Array<{ n: number; v: HoconValue }> = []

  for (const [key, val] of value.fields) {
    if (!canonicalInt.test(key)) continue
    // Parse to number. The pre-filter guarantees no sign, no leading zeros, decimal only.
    // We still need a native parse for the in-range check.
    const n = Number(key)
    // i32 max: 2147483647
    if (!Number.isInteger(n) || n > 2_147_483_647) continue
    eligible.push({ n, v: val })
  }

  if (eligible.length === 0) return null

  // Sort ascending by parsed key value, project to value array.
  eligible.sort((a, b) => a.n - b.n)
  return eligible.map((e) => e.v)
}
