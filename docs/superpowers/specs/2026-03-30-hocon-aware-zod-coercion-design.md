# HOCON-Aware Zod Coercion in validate()

**Date**: 2026-03-30
**Issue**: o3co/ts.hocon#8
**Status**: Design

## Problem

`@o3co/ts.hocon/zod`'s `validate()` passes `config.toObject()` directly to `schema.parse()` without any HOCON-aware type coercion. This causes failures when HOCON config values arrive as strings (e.g., via environment variable overrides) but the Zod schema expects typed values.

- `z.boolean()` rejects string `"false"`
- `z.coerce.boolean()` treats `"false"` as `true` (JavaScript `Boolean("false") === true`)
- `z.stringbool()` (Zod v4) rejects boolean literals, which HOCON returns for non-env-var values

The root cause: HOCON has well-defined type coercion rules (implemented in `Config.getBoolean()`, `Config.getNumber()`), but the Zod integration layer doesn't apply them.

## Decision

`validate()` and `getValidated()` will introspect the Zod schema via `_zod.def.type` and apply HOCON-aware coercion to the plain object before passing it to Zod's `schema.parse()`. This makes standard Zod schemas (`z.boolean()`, `z.number()`) work correctly with HOCON configs without requiring special helper schemas or user-side workarounds.

### Why not helper schemas (Option A)?

Exporting `hoconBoolean()` etc. would require users to import and use special schemas everywhere, which doesn't solve the boilerplate problem the issue describes. The Zod schema's type declaration already expresses the user's intent — `z.boolean()` means "I want a boolean." In the HOCON context, coercing string `"false"` to `false` is always the correct behavior. There is no realistic opt-out case.

### Why introspection is acceptable

- Peer dep will be narrowed to `zod >=4.0.0` (from `>=3.0.0`)
- Zod v4's `_zod.def.type` is documented for library authors
- The set of types to introspect is small and bounded
- `validate()` exists to be HOCON-aware; without coercion it's just `schema.parse(config.toObject())`

## Coercion Rules

### Boolean (case-insensitive)

| String value | Coerced to |
|---|---|
| `"true"`, `"yes"`, `"on"` | `true` |
| `"false"`, `"no"`, `"off"` | `false` |
| Other strings | No coercion (let Zod reject) |

Already-boolean values pass through unchanged.

These rules align with go.hocon's boolean coercion and Zod v4's `z.stringbool()` defaults.

### Number

| String value | Coerced to |
|---|---|
| Parseable by `Number()` and not `NaN` | The numeric value |
| Other strings | No coercion (let Zod reject) |

Already-numeric values pass through unchanged.

## Schema Introspection Walk

The coercion function walks the Zod schema tree and the corresponding plain value simultaneously:

```
_zod.def.type     Action
─────────────     ──────
"object"          Recurse into each field (def.shape)
"array"           Recurse into element schema (def.element)
"optional"        Unwrap def.schema, recurse
"nullable"        Unwrap def.schema, recurse
"default"         Unwrap def.schema, recurse
"catch"           Unwrap def.schema, recurse
"boolean"         Coerce string → boolean if matches rules
"number" / "int"  Coerce string → number if parseable
"pipe"            Skip (z.transform, z.stringbool etc. handle their own coercion)
"union"           Skip (ambiguous target type)
"lazy"            Skip (deferred evaluation)
Other             No coercion (pass through)
```

`pipe`, `union`, `lazy` are intentionally skipped — they either handle coercion themselves or have ambiguous target types. Letting Zod handle these directly is safer than guessing.

## Changes

### `src/zod.ts` — HOCON-aware coercion in validate/getValidated

- `validate(config, schema)`: walk schema + `config.toObject()`, coerce, then `schema.parse()`
- `getValidated(config, path, schema)`: coerce `config.get(path)` based on top-level schema type, then `schema.parse()`
- Internal `coerceValue(value, schema)` function: recursive schema walker + coercion

### `src/config.ts` — Extend getBoolean() coercion rules

Current `getBoolean()` only handles `"true"` / `"false"`. Extend to:
- Truthy: `"true"`, `"yes"`, `"on"` (case-insensitive)
- Falsy: `"false"`, `"no"`, `"off"` (case-insensitive)

This aligns with go.hocon behavior and ensures consistency between `Config.getBoolean()` and the Zod coercion layer.

### `package.json` — Narrow peer dep

```
"zod": ">=3.0.0" → ">=4.0.0"
```

## Test Plan

### validate() / getValidated() coercion

- Boolean coercion: `"true"/"yes"/"on"` → `true`, `"false"/"no"/"off"` → `false`
- Boolean case-insensitive: `"True"/"TRUE"/"Yes"/"ON"` etc.
- Number coercion: `"8080"` → `8080`, `"3.14"` → `3.14`
- Pass-through: boolean `true`/`false` → `z.boolean()` works as-is
- Pass-through: number `8080` → `z.number()` works as-is
- Pass-through: string `"hello"` → `z.string()` works as-is
- Nested objects: coercion inside `z.object({ inner: z.object({ ... }) })`
- Wrapper unwrap: `z.optional(z.boolean())`, `z.nullable(z.boolean())`, `z.default(z.boolean(), false)`
- Array coercion: `z.array(z.boolean())` with string elements
- Invalid values: `"maybe"` with `z.boolean()` → ZodError
- Invalid numbers: `"abc"` with `z.number()` → ZodError

### Config.getBoolean() extension

- `"yes"/"on"` → `true`
- `"no"/"off"` → `false`
- Case-insensitive: `"Yes"/"TRUE"/"On"/"NO"` etc.
- Existing tests unchanged: `"true"/"false"`, boolean literals, wrong types throw
