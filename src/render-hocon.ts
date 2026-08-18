// src/render-hocon.ts
// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

// E18 HOCON emitter — port of go.hocon's render_hocon.go (v1.11.0).
// See `Config.renderHocon` in config.ts for the public contract.

import { ConfigError } from './errors.js'
import type { HoconValue } from './value.js'

/**
 * Renders a resolved, data-only HoconValue object tree as HOCON text.
 *
 * The output round-trips: parsing it back yields the same value tree. That is
 * the correctness contract, not byte-for-byte formatting — a scalar is quoted
 * whenever leaving it bare would re-parse as a different type (a string
 * `"8080"` becomes `"8080"`, not `8080`), and left bare only when it provably
 * cannot.
 *
 * The root object's fields are emitted without enclosing braces, nested
 * objects as `key { … }`, arrays as newline-separated `[ … ]`, indented two
 * spaces. Source comments are not represented — a value tree does not carry
 * them.
 */
export function renderHoconFromRoot(root: HoconValue & { kind: 'object' }): string {
  const out: string[] = []
  renderObjectBody(out, root, 0)
  return out.join('')
}

function renderObjectBody(out: string[], o: HoconValue & { kind: 'object' }, depth: number): void {
  const indent = '  '.repeat(depth)
  for (const [k, v] of o.fields) {
    out.push(indent, renderKey(k))
    if (v.kind === 'object') {
      out.push(' {')
      if (v.fields.size === 0) {
        out.push('}\n')
        continue
      }
      out.push('\n')
      renderObjectBody(out, v, depth + 1)
      out.push(indent, '}\n')
    } else {
      out.push(' = ')
      renderValue(out, v, depth)
      out.push('\n')
    }
  }
}

function renderValue(out: string[], v: HoconValue, depth: number): void {
  switch (v.kind) {
    case 'object': {
      if (v.fields.size === 0) {
        out.push('{}')
        return
      }
      out.push('{\n')
      renderObjectBody(out, v, depth + 1)
      out.push('  '.repeat(depth), '}')
      return
    }
    case 'array':
      renderArray(out, v, depth)
      return
    case 'scalar':
      out.push(renderScalar(v))
      return
    default:
      // Unreachable for a well-formed HoconValue; a placeholder masquerading
      // as one (allowUnresolved leftovers) has no `kind` and lands here.
      throw new ConfigError(
        'renderHocon: unrenderable value (config must be resolved data)',
        '',
      )
  }
}

function renderArray(out: string[], a: HoconValue & { kind: 'array' }, depth: number): void {
  if (a.items.length === 0) {
    out.push('[]')
    return
  }
  const inner = '  '.repeat(depth + 1)
  out.push('[\n')
  for (const e of a.items) {
    out.push(inner)
    renderValue(out, e, depth + 1)
    out.push('\n')
  }
  out.push('  '.repeat(depth), ']')
}

function renderScalar(s: HoconValue & { kind: 'scalar' }): string {
  switch (s.valueType) {
    case 'null':
      return 'null'
    case 'boolean':
    case 'number':
      // raw already holds the canonical textual form; both re-parse to their
      // own type, so they are emitted bare.
      return s.raw
    case 'string':
      return renderString(s.raw)
  }
}

/**
 * Matches a key that is unambiguous unquoted: no dot (which would nest), no
 * whitespace, no forbidden character.
 */
const SAFE_UNQUOTED_KEY = /^[A-Za-z0-9_-]+$/

function renderKey(k: string): string {
  // `include` is reserved unquoted at the start of a key (S12.5/S14a) — the
  // parser (and Lightbend: "include keyword is not followed by a quoted
  // string") rejects `include = 1`, so the key must be quoted to round-trip.
  if (k === 'include') return quoteString(k)
  return SAFE_UNQUOTED_KEY.test(k) ? k : quoteString(k)
}

/**
 * Matches a string value that cannot be misread as another type: an
 * identifier that is not a boolean/null keyword and not numeric. Any other
 * string is quoted, which always round-trips.
 */
const SAFE_BARE_STRING = /^[A-Za-z][A-Za-z0-9_-]*$/

const STRING_KEYWORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off'])

function renderString(s: string): string {
  return SAFE_BARE_STRING.test(s) && !STRING_KEYWORDS.has(s.toLowerCase()) ? s : quoteString(s)
}

function quoteString(s: string): string {
  // A string containing newlines is triple-quoted when that is unambiguous
  // and lossless: no embedded `"""`, no trailing `"`, and no carriage return
  // (an invisible raw CR inside triple quotes is ambiguous to readers and
  // editors even though this lexer preserves it — Lightbend probe 2026-08-19
  // — so CR strings take the escaped double-quoted form below).
  if (s.includes('\n') && !s.includes('\r') && !s.includes('"""') && !s.endsWith('"')) {
    return `"""${s}"""`
  }
  let b = '"'
  for (const ch of s) {
    switch (ch) {
      case '"':
        b += '\\"'
        break
      case '\\':
        b += '\\\\'
        break
      case '\n':
        b += '\\n'
        break
      case '\r':
        b += '\\r'
        break
      case '\t':
        b += '\\t'
        break
      default:
        b += ch
    }
  }
  return b + '"'
}
