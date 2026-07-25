import type { HoconValue } from '../../value.js'
import { ParseError } from '../../errors.js'
import { stripBom } from '../strip-bom.js'

/**
 * Parse a `.properties` file the way `java.util.Properties` does, which is what
 * Lightbend uses for `include "x.properties"`.
 *
 * Covers S23.5 (backslash continuations) and S23.6 (unicode escapes), both in
 * scope since 2026-07-24, along with the rules that come with them: `=`, `:` or
 * whitespace as the separator, an escaped separator belonging to the key, and a
 * value keeping its trailing whitespace (Java skips whitespace before a value,
 * never after it).
 */
export function parseProperties(input: string): Record<string, unknown> {
  // Collect (key, value) pairs first so we can sort before inserting.
  // S23.4 — HOCON.md L1485: when a key conflict exists between a scalar ("a=hello")
  // and an object expansion ("a.b=world"), the object must always win.
  // Sorting keys gives a single deterministic processing order regardless of input
  // line order (mirrors go.hocon's sort.Strings(keys) and spec L1476-1479 intent).
  const pairs: PathPair[] = []
  for (const { text, line } of logicalLines(stripBom(input))) {
    const [rawKey, rawValue] = splitKeyValue(text)
    const key = unescapeProps(rawKey, line)
    if (key === '') continue
    // F2.1: a `.properties` key is a path expression, so the split happens
    // here, in the caller that owns that rule — nestPairs never re-splits.
    pairs.push([key.split('.'), unescapeProps(rawValue, line)])
  }

  return nestPairs(pairs)
}

/**
 * One flat entry: the path **already split into segments**, and its value.
 *
 * Segments rather than a joined string because what counts as a boundary is the
 * caller's rule, not this module's: `.properties` splits keys on `.` (F2.1)
 * while env splits only on `__`, so a literal `.` in a variable name is key text
 * (F1.2). Joining and re-splitting here would manufacture a boundary the source
 * never had.
 */
export type PathPair = [segments: string[], value: string]

/**
 * Turn pre-split path pairs into a nested object, applying the S23.4/F2.5
 * object-wins rule. Entries are sorted first so the outcome does not depend on
 * input order.
 *
 * Exported because the `env` adapter mounts variables the same way and must not
 * carry a second copy of this rule.
 */
export function nestPairs(pairs: PathPair[]): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null)
  // Ordered segment-wise, so `a.b` (one segment) and `a` → `b` (two) sort as the
  // different paths they are, with no delimiter to assume. Array.sort is stable,
  // so equal paths keep input order and the last one wins (F0.7).
  const sorted = [...pairs].sort(([a], [b]) => compareSegments(a, b))
  for (const [segments, value] of sorted) {
    setNested(root, segments, value)
  }
  return root
}

/** Lexicographic order on the segment lists themselves. */
function compareSegments(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as string
    const y = b[i] as string
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length - b.length
}

/**
 * A collision-free key for a segment list, for callers that need one path per
 * map entry (the env adapter's F1.6 collision check).
 *
 * JSON encoding rather than a joined string: a `.properties` key can contain
 * any character, NUL included (F2.3 honours `\u0000`), so no single delimiter is
 * safe in general. `JSON.stringify` escapes unambiguously, so two segment lists
 * share a key only when they are equal.
 */
export function pathKey(segments: readonly string[]): string {
  return JSON.stringify(segments)
}

interface LogicalLine {
  text: string
  /** 1-based natural line the logical line starts on, for error messages. */
  line: number
}

/**
 * Drop blank and comment lines and join backslash continuations.
 *
 * Comment status is decided per natural line before joining, so a continuation
 * line that happens to start with '#' is value text rather than a comment.
 */
function logicalLines(input: string): LogicalLine[] {
  const natural = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: LogicalLine[] = []

  for (let i = 0; i < natural.length; i++) {
    let text = trimLeadingSpace(natural[i] ?? '')
    if (text === '' || text.startsWith('#') || text.startsWith('!')) continue

    const start = i + 1
    while (endsWithContinuation(text)) {
      text = text.slice(0, -1)
      if (i + 1 >= natural.length) break
      i++
      text += trimLeadingSpace(natural[i] ?? '')
    }
    out.push({ text, line: start })
  }
  return out
}

function trimLeadingSpace(s: string): string {
  return s.replace(/^[ \t\f]+/, '')
}

/**
 * An odd number of trailing backslashes means the last one is an escape, so the
 * line continues; an even number means they escape each other.
 */
function endsWithContinuation(line: string): boolean {
  let n = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) n++
  return n % 2 === 1
}

/**
 * Split at the first unescaped '=', ':' or whitespace run, then skip whitespace
 * around that separator. Whatever remains is the value, trailing whitespace
 * included.
 */
function splitKeyValue(line: string): [string, string] {
  let key = ''
  let i = 0
  for (; i < line.length; i++) {
    const c = line[i] as string
    if (c === '\\' && i + 1 < line.length) {
      key += c + line[i + 1]
      i++
      continue
    }
    if (c === '=' || c === ':' || isPropsSpace(c)) break
    key += c
  }
  while (i < line.length && isPropsSpace(line[i] as string)) i++
  if (i < line.length && (line[i] === '=' || line[i] === ':')) {
    i++
    while (i < line.length && isPropsSpace(line[i] as string)) i++
  }
  return [key, line.slice(i)]
}

function isPropsSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\f'
}

/**
 * Apply the `java.util.Properties` escape rules. An unknown escape drops the
 * backslash and a trailing lone backslash is dropped, both as Java does.
 *
 * A `\uXXXX` becomes one UTF-16 code unit, so an adjacent surrogate pair forms
 * its astral character naturally and a lone surrogate survives — matching Java,
 * whose strings are UTF-16 too. go.hocon and rs.hocon must reject a lone
 * surrogate instead, because their strings cannot hold one (see S1.2.6).
 */
function unescapeProps(s: string, line: number): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      out += s[i]
      continue
    }
    i++
    if (i >= s.length) break
    const e = s[i] as string
    switch (e) {
      case 't':
        out += '\t'
        break
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 'f':
        out += '\f'
        break
      case 'u': {
        const hex = s.slice(i + 1, i + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new ParseError(`malformed \\u escape in .properties: \\u${hex}`, line, i + 1)
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        break
      }
      default:
        out += e
    }
  }
  return out
}

/**
 * Insert one path into the tree.
 *
 * F2.9: there is no key denylist. `__proto__`, `constructor` and `prototype`
 * are ordinary keys in a file another program owns, and dropping them is silent
 * data loss (the old denylist also left the parent it had already created
 * behind as a phantom empty object). Prototype-pollution safety comes from the
 * carrier instead: every level is an `Object.create(null)` object, which
 * inherits no `__proto__` setter and no `constructor`, so assigning any of
 * these names defines a plain own property and reaches nothing global.
 */
function setNested(obj: Record<string, unknown>, segments: string[], value: string): void {
  let current = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (seg === undefined) return
    if (!(seg in current) || typeof current[seg] !== 'object' || current[seg] === null) {
      current[seg] = Object.create(null)
    }
    current = current[seg] as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (last === undefined) return
  // S23.4 — HOCON.md L1485: object must always win over scalar.
  // If the last segment already holds an object, do not overwrite it with a scalar.
  if (typeof current[last] === 'object' && current[last] !== null) return
  current[last] = value
}

/**
 * Convert a .properties file string into a HoconValue (object with string scalars).
 * All values remain as strings — no type coercion is applied.
 */
export function propertiesToHoconValue(input: string): HoconValue {
  const parsed = parseProperties(input)
  return recordToHoconValue(parsed)
}

function recordToHoconValue(obj: Record<string, unknown>): HoconValue & { kind: 'object' } {
  const fields = new Map<string, HoconValue>()
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      fields.set(key, { kind: 'scalar', raw: val, valueType: 'string' })
    } else if (val !== null && typeof val === 'object') {
      fields.set(key, recordToHoconValue(val as Record<string, unknown>))
    }
  }
  return { kind: 'object', fields }
}
