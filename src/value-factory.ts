// src/value-factory.ts
// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { Config } from './config.js'
import { ConfigError } from './errors.js'
import { depthError, guardStackDepth } from './internal/depth.js'
import type { HoconValue } from './value.js'

/**
 * Constructs a resolved Config from a plain JS/TS object. Keys are treated as
 * plain keys (NOT path expressions — "a.b" produces a top-level key literally
 * named "a.b", not nested a → b). Values are coerced per E12 § "Value factories":
 *
 *   string          → scalar/string
 *   number (finite) → scalar/number (integer or float as-is; NaN/Infinity error)
 *   boolean         → scalar/boolean
 *   null            → scalar/null
 *   Array<unknown>  → array (elements recursively coerced)
 *   Record<string,unknown> → object (values recursively coerced)
 *   bigint          → scalar/number, digits kept verbatim (out of int64 = error)
 *   undefined / function / symbol → ConfigError
 *
 * A `bigint` is how a caller (or a format adapter) hands over an integer that a
 * JS `number` cannot hold exactly: its digits are kept verbatim in the value's
 * raw text, so `getString` returns them intact, while `getNumber` / `toObject`
 * apply the JS number model as they do for any other value. Integers outside
 * the int64 range are rejected (spec F0.5).
 *
 * originDescription (optional) provides a source name for error messages.
 * E12 decision 13.
 */
export function fromMap(values: Record<string, unknown>, originDescription?: string): Config {
  // Every adapter funnels its decoded tree through here, and the coercion below
  // recurses once per level, so this is the one place that has to keep a
  // too-deep tree from leaving as a RangeError (see internal/depth.ts).
  const fields = guardStackDepth(
    () => coerceObject(values, ''),
    msg => depthError(`fromMap: ${msg}`),
  )
  const root: HoconValue & { kind: 'object' } = { kind: 'object', fields }
  return Config._fromResolvedValue(root, { originDescription })
}

/**
 * Returns a resolved Config with no keys. Equivalent to fromMap({}).
 * originDescription (optional) labels the source in error messages.
 * E12 decision 13.
 */
export function empty(originDescription?: string): Config {
  const root: HoconValue & { kind: 'object' } = { kind: 'object', fields: new Map() }
  return Config._fromResolvedValue(root, { originDescription })
}

// ─── internal coercion helpers ────────────────────────────────────────────────

/** HOCON integers are int64-wide (spec F0.5); past these bounds is an error. */
const INT64_MAX = 9223372036854775807n
const INT64_MIN = -9223372036854775808n

function coerceObject(obj: Record<string, unknown>, atPath: string): Map<string, HoconValue> {
  const fields = new Map<string, HoconValue>()
  for (const [k, v] of Object.entries(obj)) {
    const childPath = atPath ? `${atPath}.${k}` : k
    fields.set(k, coerceValue(v, childPath))
  }
  return fields
}

function coerceValue(v: unknown, atPath: string): HoconValue {
  if (v === null) {
    return { kind: 'scalar', raw: 'null', valueType: 'null' }
  }
  if (v === undefined) {
    throw new ConfigError(
      `fromMap: undefined is not a valid HOCON value at path "${atPath}"`,
      atPath,
    )
  }
  switch (typeof v) {
    case 'string':
      return { kind: 'scalar', raw: v, valueType: 'string' }
    case 'number': {
      if (Number.isNaN(v) || !Number.isFinite(v)) {
        throw new ConfigError(
          `fromMap: ${v} is not representable in HOCON (NaN/Infinity not allowed) at path "${atPath}"`,
          atPath,
        )
      }
      // `String(-0)` is "0", which loses a sign the source carried and the core
      // parser keeps (`z = -0` reads back as "-0"). Negative zero is a real
      // IEEE-754 value; adapters should not quietly normalize it away.
      return { kind: 'scalar', raw: Object.is(v, -0) ? '-0' : String(v), valueType: 'number' }
    }
    case 'boolean':
      return { kind: 'scalar', raw: v ? 'true' : 'false', valueType: 'boolean' }
    case 'bigint': {
      // F0.5: integers map to int64, and overflowing it is an error. A bigint
      // is how a format adapter carries an integer literal that a JS `number`
      // cannot hold exactly — decoding such a literal into a number and
      // rounding it is precisely the forbidden case — so its digits go into
      // the scalar's raw text verbatim. Getters still apply the JS number
      // model, exactly as they do for the same literal in HOCON source text.
      if (v > INT64_MAX || v < INT64_MIN) {
        throw new ConfigError(
          `fromMap: integer ${v} is out of int64 range (HOCON integers are int64; spec F0.5) at path "${atPath}"`,
          atPath,
        )
      }
      return { kind: 'scalar', raw: String(v), valueType: 'number' }
    }
    case 'object': {
      if (Array.isArray(v)) {
        const items: HoconValue[] = v.map((item, i) => coerceValue(item, `${atPath}[${i}]`))
        return { kind: 'array', items }
      }
      // Plain object.
      const fields = coerceObject(v as Record<string, unknown>, atPath)
      return { kind: 'object', fields }
    }
    default:
      throw new ConfigError(
        `fromMap: unsupported value type "${typeof v}" at path "${atPath}"`,
        atPath,
      )
  }
}
