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
 *   undefined / function / symbol / bigint (> MAX_SAFE_INTEGER) → ConfigError
 *
 * originDescription (optional) provides a source name for error messages.
 * E12 decision 13.
 */
export function fromMap(values: Record<string, unknown>, originDescription?: string): Config {
  const fields = coerceObject(values, '')
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
      return { kind: 'scalar', raw: String(v), valueType: 'number' }
    }
    case 'boolean':
      return { kind: 'scalar', raw: v ? 'true' : 'false', valueType: 'boolean' }
    case 'bigint': {
      // Allow BigInt within Number.MAX_SAFE_INTEGER range.
      if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new ConfigError(
          `fromMap: bigint ${v} exceeds Number.MAX_SAFE_INTEGER (not representable as HOCON number) at path "${atPath}"`,
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
