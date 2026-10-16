import { z } from 'zod'
import type { ZodTransform, ZodType } from 'zod'

import { coerceBoolean, coerceNumber, readBytes, readDuration, readPeriod } from './coerce.js'
import type { ByteUnit, DurationUnit, Period, UnitProblem, UnitReading } from './coerce.js'
import type { Config } from './config.js'
import type { NotResolvedError } from './errors.js'
// NOTE: parse/parseFile are imported at module level. This means importing
// '@o3co/ts.hocon/zod' pulls in Node.js built-ins (fs, path). Consumers
// who only need validate()/getValidated() in browser environments should
// import those from a custom wrapper that avoids this module.
import { parse, parseFile } from './parse.js'
import type { ParseOptions } from './parse.js'

/**
 * The whole config, validated against `schema`. HOCON strings are coerced
 * where the schema expects a number or a boolean (`"8080"` → 8080), through
 * objects (and their catchall), arrays, records, tuples, unions,
 * intersections, pipes (by their input schema), lazy schemas, numeric literals
 * and enums, and optional / nullable / default / prefault / nonoptional /
 * success / catch / readonly wrappers; a union coerces by the option that
 * takes the value (see the README). Unit values go through the {@link hocon}
 * markers.
 *
 * An object key named `__proto__`, `constructor` or `prototype` anywhere in
 * the value is refused with a `ZodError` issue at the object that holds it
 * (#202), reported together with the schema's issues for the rest of the value
 * (#227); read such a key with the plain getters instead.
 *
 * @throws {@link NotResolvedError} when the config still holds an unresolved
 *   substitution (#210); call `resolve()` first.
 * @throws `ZodError` when the value does not match the schema.
 */
export function validate<T>(config: Config, schema: ZodType<T>): T {
  requireResolved(config, '')
  return parseValue(config.toObject(), schema)
}

/**
 * The value at `path`, validated against `schema` as {@link validate} does;
 * issue paths are relative to that value.
 *
 * An object key named `__proto__`, `constructor` or `prototype` anywhere in
 * the value is refused with a `ZodError` issue at the object that holds it
 * (#202), reported together with the schema's issues for the rest of the value
 * (#227); read such a key with the plain getters instead.
 *
 * @throws {@link NotResolvedError} when the value at `path` still holds an
 *   unresolved substitution (#210); a resolved subtree of an otherwise
 *   unresolved config validates.
 * @throws `ZodError` when the value does not match the schema.
 */
export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  requireResolved(config, path)
  return parseValue(config.get(path), schema)
}

// The plain value without its prototype-named keys, coerced and parsed. A
// refused key is one more issue next to the schema's, so one run reports
// everything wrong with the value (#227).
function parseValue<T>(value: unknown, schema: ZodType<T>): T {
  const refused: z.core.$ZodIssue[] = []
  const coerced = coerceValue(dropPrototypeKeys(value, [], refused), schema)
  if (refused.length === 0) return schema.parse(coerced)
  let result: ReturnType<ZodType<T>['safeParse']>
  try {
    result = schema.safeParse(coerced)
  } catch (err) {
    // A schema that cannot run synchronously (an async refinement): the
    // refusals still stand, as they did before the schema ran (#201). Anything
    // else the schema throws is its own error and goes to the caller, as it
    // does when no key is refused. The name check covers a schema built with
    // another copy of zod (the CJS and ESM builds side by side).
    if (err instanceof z.core.$ZodAsyncError || (err as Error | undefined)?.constructor?.name === '$ZodAsyncError') {
      throw new z.ZodError(refused)
    }
    throw err
  }
  if (result.success) throw new z.ZodError(refused)
  throw new z.ZodError([...refused, ...withoutPrototypeKeyIssues(result.error.issues)])
}

// The schema's issues without those at a prototype-named key, at any depth
// (also inside a union's per-option issues). These entry points never hand the
// schema such a key, so an issue there only repeats a refusal or asks for a key
// they refuse; and its path would break Zod's formatters (see below).
function withoutPrototypeKeyIssues(issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] {
  return issues
    .filter((issue) => !issue.path.some((seg) => typeof seg === 'string' && PROTOTYPE_KEYS.has(seg)))
    .map((issue) =>
      issue.code === 'invalid_union'
        ? ({ ...issue, errors: issue.errors.map(withoutPrototypeKeyIssues) } as z.core.$ZodIssue)
        : issue,
    )
}

// The plain value (toObject / get) leaves out what is still a substitution, so
// a schema would validate an unfinished config as if those keys were absent
// (ts.hocon#210). Config.getValue throws NotResolvedError when the node at
// `path` or anything under it is unresolved — the getters' answer — so ask it
// first. A missing path is fine here; the schema decides about `undefined`.
function requireResolved(config: Config, path: string): void {
  config.getValue(path)
}

// ─── prototype-named keys ─────────────────────────────────────────────────────
// A HOCON object may hold a key named `__proto__`, `constructor` or
// `prototype`, and the plain value (toObject / get) keeps it as an own data
// property. A JS object built from it can lose it or read the prototype's
// member instead: Zod drops `__proto__` from a record without an error
// (ts.hocon#201). So the Zod entry points refuse such a key wherever it is in
// the value: the schema sees the value without it, and the refusal is reported
// with the schema's own issues (#227). The plain getters read keys by name and
// are unaffected.
//
// The issue sits at the object holding the key, with the key in the message and
// in `params.key`, as Zod's own unrecognized_keys does. A path that contains
// `__proto__` or `constructor` makes Zod's treeifyError / format / flattenError
// throw (zod 4.4), and a `__proto__` segment before the last one makes them
// write to Object.prototype. So no path built here contains such a key: the
// issue stops at the parent, and the walk does not descend into a refused key.

const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * `value` without its prototype-named keys, at any depth, with one issue in
 * `issues` for each key left out.
 */
function dropPrototypeKeys(value: unknown, path: PropertyKey[], issues: z.core.$ZodIssue[]): unknown {
  if (Array.isArray(value)) return value.map((item, i) => dropPrototypeKeys(item, [...path, i], issues))
  if (typeof value !== 'object' || value === null) return value
  // Assigning to a fresh object is safe: no key written here names a prototype.
  const kept: Record<string, unknown> = {}
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
      kept[key] = dropPrototypeKeys(item, [...path, key], issues)
    }
  }
  return kept
}

// ─── unit markers ─────────────────────────────────────────────────────────────
// A unit marker is a Zod schema that reads a HOCON unit value (a duration, a
// byte size, a period) and gives a number, or a Period for a period. ts.hocon
// owns the unit rules (the readers in coerce.ts); the schema the marker is piped
// into owns the constraints (range, integer, …). A marker is a plain transform,
// so it works wherever Zod runs it.
//
// It reads the plain value: a string as written, a number through String(n).
// The getters read the literal's source text instead, exactly (E20). Both read
// exponent forms (`1e3`, and the `1e-7` JavaScript prints for 0.0000001), so
// what String(n) changes matters only where the number does not keep it:
// digits beyond a double's precision (`1.99999999999999999` → "2"), and for an
// integer-only unit system (a period) a decimal point or an exponent (`7.0` →
// "7", `1e2` → "100") the getter refuses. A value written with a unit is a
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
    // The message names the problem, never the value: validation messages end
    // up in boot logs, and a value can be a secret set under the wrong key
    // (#226). The value stays in `input`, which Zod leaves out of the issues it
    // finalizes unless asked to report input; `params.problem` names the
    // problem for code.
    ctx.issues.push({
      code: 'custom',
      message: unitProblemMessage(what, reading.problem),
      input,
      params: { problem: reading.problem },
    })
    return z.NEVER
  })
}

function unitProblemMessage(what: string, problem: UnitProblem): string {
  switch (problem) {
    case 'invalid': return `not a ${what}`
    case 'negative': return `${what} must be non-negative`
    case 'overflow': return `${what} overflows the representable range`
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
   * exponent forms included, except that a number literal with more
   * significant digits than a double holds can read differently: the getter
   * reads its text, the marker its JS value (`1.0000000000000001` in `us`:
   * 1000.0000000000001 through the getter, 1000 here).
   */
  duration(unit?: DurationUnit): ZodTransform<number, unknown> {
    return unitMarker('duration', (text) => readDuration(text, unit))
  },
  /**
   * A byte size, read as {@link Config.getBytes} reads it (default unit `B`),
   * exponent forms included, except that a number literal with more
   * significant digits than a double holds can read differently: the getter
   * reads its text, the marker its JS value (`1.99999999999999999`: 1 through
   * the getter, 2 here).
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

function getDef(schema: ZodType): Record<string, unknown> | undefined {
  return (schema as any)._zod?.def
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

// The literal values each key of an object (or a union of objects) can take,
// which is what Zod's discriminated union picks an option by: present for an
// object, and for a nested discriminated union, alike.
function getPropValues(schema: ZodType): Record<string, ReadonlySet<unknown>> | undefined {
  return (schema as any)._zod?.propValues
}

function getArrayElement(schema: ZodType): ZodType | undefined {
  return (schema as any)._zod?.def?.element
}

/**
 * Parse a HOCON string and {@link validate} it.
 *
 * @throws as `parse`; {@link NotResolvedError} when parsed with
 *   `resolveSubstitutions: false` and a substitution is left (#210); `ZodError`
 *   when the value does not match the schema.
 */
export function parseWithSchema<T>(input: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parse(input, opts)
  return validate(config, schema)
}

/**
 * Read and parse a HOCON file and {@link validate} it.
 *
 * @throws as `parseFile`; {@link NotResolvedError} when parsed with
 *   `resolveSubstitutions: false` and a substitution is left (#210); `ZodError`
 *   when the value does not match the schema.
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

    case 'enum': {
      // An enum with number values (z.enum({ A: 1 }), z.nativeEnum) expects a
      // number, as a number literal does. `_zod.values` is the set Zod checks
      // against, a nativeEnum's reverse-mapping names left out (zod >= 4.0).
      const values = (schema as any)._zod.values as ReadonlySet<unknown>
      return coerceToLiteral(value, values)
    }

    case 'literal': {
      // A number or boolean literal expects that number or boolean: `"1"` for
      // z.literal(1), as a discriminator tag from an environment variable is.
      const values = getDef(schema)?.values as readonly unknown[] | undefined
      return values ? coerceToLiteral(value, new Set(values)) : value
    }

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
      // Keys the shape does not name go by the catchall, if there is one
      // (`unknown` / `never` from looseObject / strictObject leave them as is).
      const catchall = getDef(schema)?.catchall as ZodType | undefined
      if (catchall) {
        for (const key of Object.keys(obj)) {
          if (!Object.prototype.hasOwnProperty.call(shape, key)) result[key] = coerceValue(obj[key], catchall)
        }
      }
      return result
    }

    case 'intersection': {
      // Both sides see one value, so coercing it for one side can break the
      // other. Take the first form the intersection accepts: the value as it
      // is (as a union does), coerced for the left side only, for the right
      // side only; otherwise coerced for both. When the two sides need
      // different forms of one key, no form passes and Zod reports it.
      if (accepts(schema, value)) return value
      const def = getDef(schema) as { left: ZodType; right: ZodType }
      const forLeft = coerceValue(value, def.left)
      if (accepts(schema, forLeft)) return forLeft
      const forRight = coerceValue(value, def.right)
      if (accepts(schema, forRight)) return forRight
      return coerceValue(forLeft, def.right)
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = getArrayElement(schema)
      if (!elementSchema) return value
      return value.map((item) => coerceValue(item, elementSchema))
    }

    case 'record': {
      // Keys stay strings; each value is coerced by the value schema.
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const valueSchema = getDef(schema)?.valueType as ZodType | undefined
      if (!valueSchema) return value
      const result: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) result[key] = coerceValue(item, valueSchema)
      return result
    }

    case 'tuple': {
      if (!Array.isArray(value)) return value
      const def = getDef(schema)
      const items = (def?.items ?? []) as ZodType[]
      const rest = def?.rest as ZodType | null | undefined
      return value.map((item, i) => {
        const itemSchema = i < items.length ? items[i] : rest
        return itemSchema ? coerceValue(item, itemSchema) : item
      })
    }

    case 'union':
      return coerceUnion(value, schema)

    case 'pipe': {
      // The input schema is what sees the HOCON value; the output schema sees
      // what the input schema (a transform, say) made of it.
      const input = getDef(schema)?.in as ZodType | undefined
      return input ? coerceValue(value, input) : value
    }

    case 'lazy': {
      const getter = getDef(schema)?.getter as (() => ZodType) | undefined
      return getter ? coerceValue(value, getter()) : value
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'success':
    case 'catch':
    case 'readonly': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner) : value
    }

    default:
      return value
  }
}

// A union is coerced by the option that takes the value: for a discriminated
// union, the option its discriminator picks (coerced even if it then fails, so
// the issues are about the coerced value). Any other union takes the value as
// it is when an option accepts it (`"5"` stays a string for number | string),
// and is coerced otherwise, by the first option that accepts the value coerced
// for it. This is how py.hocon (a Pydantic smart union) and rs.hocon (a serde
// untagged enum) read the same value; Lightbend has no unions. When no option
// takes the value, it goes to the schema as it is.
function coerceUnion(value: unknown, schema: ZodType): unknown {
  const def = getDef(schema)
  const options = (def?.options ?? []) as ZodType[]
  const discriminator = def?.discriminator as string | undefined
  if (discriminator !== undefined) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    // An absent tag is `undefined`, which an option with an optional tag takes.
    const tag = Object.prototype.hasOwnProperty.call(value, discriminator)
      ? (value as Record<string, unknown>)[discriminator]
      : undefined
    // The tag as it is first, in every option, then the tag coerced: an exact
    // `"1"` option wins over a `1` option, as a plain union keeps the value.
    const tagsOf = (o: ZodType) => getPropValues(o)?.[discriminator]
    const option =
      options.find((o) => tagsOf(o)?.has(tag)) ??
      options.find((o) => {
        const tags = tagsOf(o)
        return tags !== undefined && tags.has(coerceToLiteral(tag, tags))
      })
    return option ? coerceValue(value, option) : value
  }
  if (options.some((option) => accepts(option, value))) return value
  for (const option of options) {
    const coerced = coerceValue(value, option)
    if (accepts(option, coerced)) return coerced
  }
  return value
}

// `value`, or the number or boolean among `literals` that the string `value`
// reads as.
function coerceToLiteral(value: unknown, literals: ReadonlySet<unknown>): unknown {
  if (typeof value !== 'string' || literals.has(value)) return value
  const n = coerceNumber(value)
  if (n !== undefined && literals.has(n)) return n
  const b = coerceBoolean(value)
  if (b !== undefined && literals.has(b)) return b
  return value
}

// Whether `schema` accepts `value`. An option that throws instead of answering
// (an async refinement, a refinement that throws on an unexpected value) does
// not; the schema's own parse reports what it does.
function accepts(schema: ZodType, value: unknown): boolean {
  try {
    return schema.safeParse(value).success
  } catch {
    return false
  }
}
