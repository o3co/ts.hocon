// tests/lightbend/env-sidecar.ts
//
// Parse a KEY=VALUE env sidecar file as used by xx.hocon fixtures.
// Format: one KEY=VALUE per line, '#' comment lines, blank lines tolerated.
// No quoting, no escape sequences, no multi-line values.
// Returns a Record<string, string> suitable for passing as parse(input, { env }).

import { readFileSync } from 'node:fs'

/**
 * Parse a `.env` sidecar file and return a flat env-var map.
 *
 * Rules:
 * - Lines starting with '#' (after optional leading whitespace) are comments.
 * - Blank lines are ignored.
 * - Every other line must be KEY=VALUE. The key is everything before the
 *   first '='; the value is everything after (may be empty, may contain '=').
 * - Leading/trailing whitespace on the key is stripped; value is taken verbatim
 *   (no stripping — empty-string values like `KEY=` produce `""`).
 */
export function parseEnvSidecar(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf-8')
  const result: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line === '' || line.trimStart().startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue // malformed — skip
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1) // verbatim — preserves empty strings
    if (key !== '') result[key] = value
  }
  return result
}
