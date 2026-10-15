import { z } from 'zod'
import type { ZodTransform, ZodType } from 'zod'

import { coerceBoolean, coerceNumber, parseBytes, parseDuration } from './coerce.js'
import type { ByteUnit, DurationUnit } from './coerce.js'
import type { Config } from './config.js'
import { NotResolvedError } from './errors.js'
// NOTE: parse/parseFile are imported at module level. This means importing
// '@o3co/ts.hocon/zod' pulls in Node.js built-ins (fs, path). Consumers
// who only need validate()/getValidated() in browser environments should
// import those from a custom wrapper that avoids this module.
import { parse, parseFile } from './parse.js'
import type { ParseOptions } from './parse.js'
import type { ReadonlyHoconValue } from './value.js'

export function validate<T>(config: Config, schema: ZodType<T>): T {
  const plain = config.toObject()
  const coerced = coerceValue(plain, schema, sourceNode(config, ''))
  return schema.parse(coerced)
}

export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  const val = config.get(path)
  const coerced = coerceValue(val, schema, sourceNode(config, path))
  return schema.parse(coerced)
}

// ─── unit markers ─────────────────────────────────────────────────────────────
// A unit marker is a Zod schema that reads a HOCON unit value (a duration, a
// byte size) with the same rules as the matching Config getter and gives a
// number. ts.hocon owns the unit grammar (parseDuration / parseBytes); the
// schema the marker is piped into owns the constraints (range, integer, …).
//
// The validate / getValidated / parseWithSchema entry points hand a marker the
// scalar's source text, so it sees exactly what getDuration / getBytes see. A
// marker parsed outside them gets the plain JS value instead: a string is read
// as is, a number through String(n).
//
// Markers are recognised by their transform function, which Zod keeps when it
// clones a schema (.describe, .meta, …). Adding a unit system = one reader below.

const unitMarkers = new WeakSet<Function>()

function unitMarker(what: string, read: (text: string) => number): ZodTransform<number, unknown> {
  const fn = (input: unknown, ctx: z.RefinementCtx): number => {
    if (typeof input !== 'string' && typeof input !== 'number') {
      ctx.issues.push({ code: 'custom', message: `expected ${what}, got ${describeInput(input)}`, input })
      return z.NEVER
    }
    const text = typeof input === 'string' ? input : String(input)
    let value: number
    try {
      value = read(text)
    } catch (err) {
      if (!(err instanceof RangeError)) throw err
      ctx.issues.push({ code: 'custom', message: err.message, input })
      return z.NEVER
    }
    if (Number.isNaN(value)) {
      ctx.issues.push({ code: 'custom', message: `invalid ${what}: ${JSON.stringify(text)}`, input })
      return z.NEVER
    }
    return value
  }
  unitMarkers.add(fn)
  return z.transform(fn)
}

function describeInput(input: unknown): string {
  if (input === null) return 'null'
  if (Array.isArray(input)) return 'array'
  return typeof input
}

/**
 * Zod schema markers for HOCON unit values. Each reads the forms the matching
 * Config getter reads and gives a number in the requested unit; pipe it into a
 * number schema for the constraints:
 *
 * ```ts
 * const Session = z.object({
 *   lifetime: hocon.duration('s').pipe(z.number().int().min(60)),
 *   maxBody: hocon.bytes().pipe(z.number().int().positive()),
 * })
 * ```
 */
export const hocon = {
  /** A duration, read as {@link Config.getDuration} reads it (default unit `ms`). */
  duration(unit?: DurationUnit): ZodTransform<number, unknown> {
    return unitMarker('duration', (text) => parseDuration(text, unit))
  },
  /** A byte size, read as {@link Config.getBytes} reads it (default unit `B`). */
  bytes(unit?: ByteUnit): ZodTransform<number, unknown> {
    return unitMarker('byte size', (text) => {
      const result = parseBytes(text, unit)
      // Config.getBytes: byte sizes are non-negative (Lightbend getBytesBigInteger).
      if (result < 0) throw new RangeError(`byte size must be non-negative: ${JSON.stringify(text)}`)
      return result
    })
  },
}

function isUnitMarker(schema: ZodType): boolean {
  const def = (schema as any)._zod?.def
  return def?.type === 'transform' && unitMarkers.has(def.transform)
}

/** True for a marker, or a pipe whose input side (followed through pipes) is one. */
function leadsToUnitMarker(schema: ZodType): boolean {
  let current: ZodType | undefined = schema
  while (current && getDefType(current) === 'pipe') current = getPipeInput(current)
  return current !== undefined && isUnitMarker(current)
}

/**
 * The node behind `config.get(path)`, for a unit marker to read the source
 * text. An unresolved Config cannot give its containers (getValue throws
 * NotResolvedError); markers below then read the plain value instead.
 */
function sourceNode(config: Config, path: string): ReadonlyHoconValue | undefined {
  try {
    return config.getValue(path)
  } catch (err) {
    if (err instanceof NotResolvedError) return undefined
    throw err
  }
}

/** A string or number scalar's source text — what getDuration / getBytes read. */
function sourceText(value: unknown, node: ReadonlyHoconValue | undefined): unknown {
  if (node?.kind === 'scalar' && (node.valueType === 'string' || node.valueType === 'number')) {
    return node.raw
  }
  return value
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

function getPipeInput(schema: ZodType): ZodType | undefined {
  return (schema as any)._zod?.def?.in
}

export function parseWithSchema<T>(input: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parse(input, opts)
  return validate(config, schema)
}

export function parseFileWithSchema<T>(filePath: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parseFile(filePath, opts)
  return validate(config, schema)
}

// `node` is the HOCON node `value` was decoded from, when known; only unit
// markers read it.
function coerceValue(value: unknown, schema: ZodType, node?: ReadonlyHoconValue): unknown {
  if (value === null || value === undefined) return value

  const defType = getDefType(schema)
  if (!defType) return value

  switch (defType) {
    case 'transform':
      return isUnitMarker(schema) ? sourceText(value, node) : value

    case 'pipe': {
      // Only a unit marker's pipe is looked into (`hocon.duration().pipe(z.number())`);
      // other pipes keep their input as is.
      const input = getPipeInput(schema)
      return input && leadsToUnitMarker(input) ? coerceValue(value, input, node) : value
    }

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
          const child = node?.kind === 'object' ? node.fields.get(key) : undefined
          result[key] = coerceValue(obj[key], shape[key], child)
        }
      }
      return result
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = getArrayElement(schema)
      if (!elementSchema) return value
      const items = node?.kind === 'array' ? node.items : undefined
      return value.map((item, i) => coerceValue(item, elementSchema, items?.[i]))
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'readonly': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner, node) : value
    }

    default:
      return value
  }
}
