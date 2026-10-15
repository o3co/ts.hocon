import { z } from 'zod'
import type { ZodTransform, ZodType } from 'zod'

import { coerceBoolean, coerceNumber, readBytes, readDuration, readPeriod } from './coerce.js'
import type { ByteUnit, DurationUnit, Period, UnitProblem, UnitReading } from './coerce.js'
import type { Config } from './config.js'
// NOTE: parse/parseFile are imported at module level. This means importing
// '@o3co/ts.hocon/zod' pulls in Node.js built-ins (fs, path). Consumers
// who only need validate()/getValidated() in browser environments should
// import those from a custom wrapper that avoids this module.
import { parse, parseFile } from './parse.js'
import type { ParseOptions } from './parse.js'

/**
 * The whole config, validated against `schema`. HOCON strings are coerced
 * where the schema expects a number or a boolean (`"8080"` → 8080); unit values
 * go through the {@link hocon} markers.
 *
 * An object key named `__proto__`, `constructor` or `prototype` anywhere in
 * the value is refused with a `ZodError` issue at the object that holds it
 * (#202); read such a key with the plain getters instead.
 *
 * @throws `ZodError` when the value does not match the schema.
 */
export function validate<T>(config: Config, schema: ZodType<T>): T {
  const plain = config.toObject()
  refusePrototypeKeys(plain)
  const coerced = coerceValue(plain, schema)
  return schema.parse(coerced)
}

/**
 * The value at `path`, validated against `schema` as {@link validate} does;
 * issue paths are relative to that value.
 *
 * An object key named `__proto__`, `constructor` or `prototype` anywhere in
 * the value is refused with a `ZodError` issue at the object that holds it
 * (#202); read such a key with the plain getters instead.
 *
 * @throws `ZodError` when the value does not match the schema.
 */
export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  const val = config.get(path)
  refusePrototypeKeys(val)
  const coerced = coerceValue(val, schema)
  return schema.parse(coerced)
}

// ─── prototype-named keys ─────────────────────────────────────────────────────
// A HOCON object may hold a key named `__proto__`, `constructor` or
// `prototype`, and the plain value (toObject / get) keeps it as an own data
// property. A JS object built from it can lose it or read the prototype's
// member instead: Zod drops `__proto__` from a record without an error
// (ts.hocon#201). So the Zod entry points refuse such a key wherever it is in
// the value, before the schema sees it. The plain getters read keys by name and
// are unaffected.
//
// The issue sits at the object holding the key, with the key in the message and
// in `params.key`, as Zod's own unrecognized_keys does. A path that contains
// `__proto__` or `constructor` makes Zod's treeifyError / format / flattenError
// throw (zod 4.4), and a `__proto__` segment before the last one makes them
// write to Object.prototype. So no path built here contains such a key: the
// issue stops at the parent, and the walk does not descend into a refused key.

const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

function refusePrototypeKeys(value: unknown): void {
  const issues: z.core.$ZodIssue[] = []
  collectPrototypeKeys(value, [], issues)
  if (issues.length > 0) throw new z.ZodError(issues)
}

function collectPrototypeKeys(value: unknown, path: PropertyKey[], issues: z.core.$ZodIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectPrototypeKeys(item, [...path, i], issues))
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (PROTOTYPE_KEYS.has(key)) {
        // No `input`: Zod leaves it out of the issues it finalizes unless asked
        // to report input, and an issue built here would otherwise carry the
        // value (a secret, perhaps) into error.message.
        issues.push({
          code: 'custom',
          path,
          message: `key ${JSON.stringify(key)} names an object's prototype`,
          params: { key },
        })
      } else {
        collectPrototypeKeys(item, [...path, key], issues)
      }
    }
  }
}

// ─── unit markers ─────────────────────────────────────────────────────────────
// A unit marker is a Zod schema that reads a HOCON unit value (a duration, a
// byte size, a period) and gives a number, or a Period for a period. ts.hocon
// owns the unit rules (the readers in coerce.ts); the schema the marker is piped
// into owns the constraints (range, integer, …). A marker is a plain transform,
// so it works wherever Zod runs it.
//
// It reads the plain value: a string as written, a number through String(n).
// The getters read the literal's source text instead, exactly (E20), and
// String(n) drops what the number does not keep: digits beyond a double's
// precision (`1.99999999999999999` → "2"), trailing fraction zeros (`7.0` →
// "7"), leading zeros, and the exponent form (`1e3` → "1000"; JavaScript prints
// values below 1e-6 or from 1e21 with one). So a marker can read a different
// value than the getter, or accept what the getter refuses, and the reverse: a
// number literal with more significant digits than a double holds, or in
// exponent form, for every unit system, and a literal with a decimal point
// (`7.0`) for an integer-only one (a period). A value written with a unit is a
// string and reads the same.

function unitMarker<T>(what: string, read: (text: string) => UnitReading<T>): ZodTransform<T, unknown> {
  return z.transform((input: unknown, ctx): T => {
    if (typeof input !== 'string' && typeof input !== 'number') {
      ctx.issues.push({ code: 'custom', message: `expected ${what}, got ${describeInput(input)}`, input })
      return z.NEVER
    }
    const text = typeof input === 'string' ? input : String(input)
    const reading = read(text)
    if (reading.ok) return reading.value
    ctx.issues.push({ code: 'custom', message: unitProblemMessage(what, reading.problem, text), input })
    return z.NEVER
  })
}

function unitProblemMessage(what: string, problem: UnitProblem, text: string): string {
  switch (problem) {
    case 'invalid': return `invalid ${what}: ${JSON.stringify(text)}`
    case 'negative': return `${what} must be non-negative: ${JSON.stringify(text)}`
    case 'overflow': return `${what} overflows the representable range: ${JSON.stringify(text)}`
  }
}

function describeInput(input: unknown): string {
  if (input === null) return 'null'
  if (Array.isArray(input)) return 'array'
  return typeof input
}

/**
 * Zod schema markers for HOCON unit values. Each reads the forms the matching
 * Config getter reads and gives what the getter gives (a number in the
 * requested unit, or a {@link Period}); pipe it into a schema for the
 * constraints:
 *
 * ```ts
 * const Session = z.object({
 *   lifetime: hocon.duration('s').pipe(z.number().int().min(60)),
 *   maxBody: hocon.bytes().pipe(z.number().int().positive()),
 * })
 * ```
 */
export const hocon = {
  /**
   * A duration, read as {@link Config.getDuration} reads it (default unit `ms`),
   * except that a number literal with more significant digits than a double
   * holds (`1.0000000000000001`) or in exponent form (`1e3`) can read
   * differently: the getter reads the literal's text, the marker its JS value.
   */
  duration(unit?: DurationUnit): ZodTransform<number, unknown> {
    return unitMarker('duration', (text) => readDuration(text, unit))
  },
  /**
   * A byte size, read as {@link Config.getBytes} reads it (default unit `B`),
   * except that a number literal with more significant digits than a double
   * holds (`1.99999999999999999`: 1 through the getter, 2 here) or in exponent
   * form can read differently: the getter reads the literal's text, the marker
   * its JS value.
   */
  bytes(unit?: ByteUnit): ZodTransform<number, unknown> {
    return unitMarker('byte size', (text) => readBytes(text, unit))
  },
  /**
   * A calendar period, read as {@link Config.getPeriod} reads it (a bare
   * integer is days), except that a number literal with a decimal point or in
   * exponent form (`7.0`, `1e2`) can read differently: the getter refuses it,
   * the marker reads the JS number.
   */
  period(): ZodTransform<Period, unknown> {
    return unitMarker('period', readPeriod)
  },
}

function getDefType(schema: ZodType): string | undefined {
  const zod = (schema as any)._zod
  return zod?.def?.type
}

function getInnerSchema(schema: ZodType): ZodType | undefined {
  const def = (schema as any)._zod?.def
  // Zod v4 wrapper types (optional, nullable, default, catch, readonly) store
  // the wrapped schema in `def.innerType`. The `def.schema` fallback is for
  // forward-compatibility in case future Zod versions change the property name.
  return def?.innerType ?? def?.schema
}

function getObjectShape(schema: ZodType): Record<string, ZodType> | undefined {
  const shape = (schema as any)._zod?.def?.shape
  return typeof shape === 'object' && shape !== null ? shape : undefined
}

function getArrayElement(schema: ZodType): ZodType | undefined {
  return (schema as any)._zod?.def?.element
}

/**
 * Parse a HOCON string and {@link validate} it.
 *
 * @throws as `parse`, or `ZodError` when the value does not match the schema.
 */
export function parseWithSchema<T>(input: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parse(input, opts)
  return validate(config, schema)
}

/**
 * Read and parse a HOCON file and {@link validate} it.
 *
 * @throws as `parseFile`, or `ZodError` when the value does not match the schema.
 */
export function parseFileWithSchema<T>(filePath: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parseFile(filePath, opts)
  return validate(config, schema)
}

function coerceValue(value: unknown, schema: ZodType): unknown {
  if (value === null || value === undefined) return value

  const defType = getDefType(schema)
  if (!defType) return value

  switch (defType) {
    case 'boolean':
      if (typeof value === 'string') {
        const coerced = coerceBoolean(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'number':
      if (typeof value === 'string') {
        const coerced = coerceNumber(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const shape = getObjectShape(schema)
      if (!shape) return value
      const obj = value as Record<string, unknown>
      const result: Record<string, unknown> = { ...obj }
      for (const key of Object.keys(shape)) {
        // Own properties only, not `in`: toObject() returns
        // Object.prototype-backed objects, so a schema field named
        // `constructor` or `toString` would otherwise match an inherited
        // property and copy a function into the value handed to zod.
        // (hasOwnProperty.call rather than Object.hasOwn — the tsconfig lib is
        // ES2020.)
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = coerceValue(obj[key], shape[key])
        }
      }
      return result
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = getArrayElement(schema)
      if (!elementSchema) return value
      return value.map((item) => coerceValue(item, elementSchema))
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'readonly': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner) : value
    }

    default:
      return value
  }
}
