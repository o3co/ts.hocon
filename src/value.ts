import { coerceBoolean, coerceNumber } from './coerce.js'

// JavaScript の Map は挿入順を保証するため keys フィールド不要
export type ScalarValueType = 'string' | 'number' | 'boolean' | 'null'

export type HoconValue =
  | { kind: 'object'; fields: Map<string, HoconValue> }
  | { kind: 'array'; items: HoconValue[] }
  | { kind: 'scalar'; raw: string; valueType: ScalarValueType }

/**
 * Deeply-immutable view of a {@link HoconValue}. `Config.getValue` returns this
 * so callers cannot mutate the parsed configuration tree (the live nodes are
 * shared, not cloned). `Map`/array containers become `ReadonlyMap`/`readonly[]`
 * recursively, so `.set` / `.push` / element assignment are compile errors.
 *
 * `HoconValue` is structurally assignable to `ReadonlyHoconValue`, so internal
 * code holding a mutable node can return it here, and the accessor functions
 * below accept both forms.
 */
export type ReadonlyHoconValue =
  | { readonly kind: 'object'; readonly fields: ReadonlyMap<string, ReadonlyHoconValue> }
  | { readonly kind: 'array'; readonly items: readonly ReadonlyHoconValue[] }
  | { readonly kind: 'scalar'; readonly raw: string; readonly valueType: ScalarValueType }

// ─── value accessors ──────────────────────────────────────────────────────────
// Standalone functions (HoconValue is a discriminated-union `type`, not a class,
// so methods are not possible). Mirror rs.hocon's `HoconValue::as_*` / `is_*`.

/** Scalar string only (strict): non-string scalars and containers → undefined. */
export function asString(v: ReadonlyHoconValue): string | undefined {
  return v.kind === 'scalar' && v.valueType === 'string' ? v.raw : undefined
}

/**
 * Scalar coerced to a number via {@link coerceNumber} (lenient, matching the
 * `getNumber` getter: a numeric-looking string scalar coerces too). TS has a
 * single `number` type, so this unifies rs's `as_i64` + `as_f64`.
 */
export function asNumber(v: ReadonlyHoconValue): number | undefined {
  return v.kind === 'scalar' ? coerceNumber(v.raw) : undefined
}

/** Scalar coerced to a boolean via {@link coerceBoolean} (true/yes/on, false/no/off). */
export function asBoolean(v: ReadonlyHoconValue): boolean | undefined {
  return v.kind === 'scalar' ? coerceBoolean(v.raw) : undefined
}

/** The object's fields, or undefined if not an object. */
export function asObject(v: ReadonlyHoconValue): ReadonlyMap<string, ReadonlyHoconValue> | undefined {
  return v.kind === 'object' ? v.fields : undefined
}

/** The array's items, or undefined if not an array. */
export function asArray(v: ReadonlyHoconValue): readonly ReadonlyHoconValue[] | undefined {
  return v.kind === 'array' ? v.items : undefined
}

/** Type guard: narrows to the object variant. */
export function isObject(
  v: ReadonlyHoconValue,
): v is { readonly kind: 'object'; readonly fields: ReadonlyMap<string, ReadonlyHoconValue> } {
  return v.kind === 'object'
}

/** Type guard: narrows to the array variant. */
export function isArray(
  v: ReadonlyHoconValue,
): v is { readonly kind: 'array'; readonly items: readonly ReadonlyHoconValue[] } {
  return v.kind === 'array'
}

/** Type guard: narrows to the scalar variant. */
export function isScalar(
  v: ReadonlyHoconValue,
): v is { readonly kind: 'scalar'; readonly raw: string; readonly valueType: ScalarValueType } {
  return v.kind === 'scalar'
}

/** True for a null scalar. */
export function isNull(v: ReadonlyHoconValue): boolean {
  return v.kind === 'scalar' && v.valueType === 'null'
}
