/**
 * Drop a leading UTF-8 BOM (U+FEFF).
 *
 * Spec F0.9: every format, every file-reading entry point. Windows editors add
 * one, and a BOM left in place becomes part of the first key — `a: 1` yields the
 * key `"﻿a"`, so a lookup of `a` misses and the value is silently
 * unreachable. That is plausible-but-wrong output, which is worse than an error.
 *
 * Only the *leading* one is a byte-order mark; a U+FEFF anywhere else is data
 * and is left alone.
 */
export function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
}
