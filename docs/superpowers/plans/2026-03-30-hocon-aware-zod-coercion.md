# HOCON-Aware Zod Coercion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `validate()` and `getValidated()` apply HOCON-aware type coercion (boolean, number) by introspecting the Zod v4 schema before passing values to `schema.parse()`, and extend `Config.getBoolean()` to support `"yes"/"no"/"on"/"off"`.

**Architecture:** Add a recursive `coerceValue(value, schema)` function to `src/zod.ts` that walks the Zod schema tree via `_zod.def.type` and applies HOCON coercion rules to matching values. Extract shared boolean coercion logic into `src/coerce.ts` so both `Config.getBoolean()` and `coerceValue()` use the same rules.

**Tech Stack:** TypeScript, Zod v4 (`_zod.def.type` introspection), vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/coerce.ts` | Create | Shared HOCON coercion functions: `coerceBoolean(v)`, `coerceNumber(v)` |
| `src/config.ts` | Modify | Use `coerceBoolean()` from coerce.ts in `getBoolean()` |
| `src/zod.ts` | Modify | Add `coerceValue()` schema walker, update `validate()`/`getValidated()` |
| `src/index.ts` | No change | — |
| `package.json` | Modify | Narrow peer dep `zod >=3.0.0` → `zod >=4.0.0` |
| `tests/config.test.ts` | Modify | Update boolean coercion tests (add "yes"/"no"/"on"/"off", fix "yes" throw test) |
| `tests/zod.test.ts` | Modify | Add coercion tests for validate()/getValidated() |

---

### Task 1: Shared Boolean/Number Coercion Functions

**Files:**
- Create: `src/coerce.ts`
- Create: `tests/coerce.test.ts`

- [ ] **Step 1: Write failing tests for coerceBoolean**

```ts
// tests/coerce.test.ts
import { describe, it, expect } from 'vitest'
import { coerceBoolean, coerceNumber } from '../src/coerce.js'

describe('coerceBoolean', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['yes', true],
    ['no', false],
    ['on', true],
    ['off', false],
    ['True', true],
    ['FALSE', false],
    ['Yes', true],
    ['NO', false],
    ['ON', true],
    ['Off', false],
  ])('coerces %s to %s', (input, expected) => {
    expect(coerceBoolean(input)).toBe(expected)
  })

  it('returns undefined for non-boolean string', () => {
    expect(coerceBoolean('maybe')).toBeUndefined()
    expect(coerceBoolean('1')).toBeUndefined()
    expect(coerceBoolean('')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd repos/ts.hocon && pnpm test -- tests/coerce.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement coerceBoolean**

```ts
// src/coerce.ts
const TRUTHY = new Set(['true', 'yes', 'on'])
const FALSY = new Set(['false', 'no', 'off'])

export function coerceBoolean(value: string): boolean | undefined {
  const lower = value.toLowerCase()
  if (TRUTHY.has(lower)) return true
  if (FALSY.has(lower)) return false
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd repos/ts.hocon && pnpm test -- tests/coerce.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for coerceNumber**

Add to `tests/coerce.test.ts`:

```ts
describe('coerceNumber', () => {
  it.each([
    ['8080', 8080],
    ['3.14', 3.14],
    ['0', 0],
    ['-1', -1],
    ['1e3', 1000],
  ])('coerces %s to %s', (input, expected) => {
    expect(coerceNumber(input)).toBe(expected)
  })

  it('returns undefined for non-numeric string', () => {
    expect(coerceNumber('abc')).toBeUndefined()
    expect(coerceNumber('')).toBeUndefined()
    expect(coerceNumber('NaN')).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd repos/ts.hocon && pnpm test -- tests/coerce.test.ts`
Expected: FAIL — coerceNumber not exported

- [ ] **Step 7: Implement coerceNumber**

Add to `src/coerce.ts`:

```ts
export function coerceNumber(value: string): number | undefined {
  if (value === '') return undefined
  const n = Number(value)
  if (Number.isNaN(n)) return undefined
  return n
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd repos/ts.hocon && pnpm test -- tests/coerce.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd repos/ts.hocon && git add src/coerce.ts tests/coerce.test.ts
git commit -m "feat: add shared HOCON coercion functions (coerceBoolean, coerceNumber)"
```

---

### Task 2: Extend Config.getBoolean() to Use Shared Coercion

**Files:**
- Modify: `src/config.ts:29-37`
- Modify: `tests/config.test.ts:73-76`

- [ ] **Step 1: Update existing test and add new boolean coercion tests**

In `tests/config.test.ts`, replace the test at line 73-76:

```ts
// REPLACE this test:
//   it('getBoolean() throws ConfigError for non-boolean string', () => {
//     const c = makeConfig({ val: { kind: 'scalar', value: 'yes' } })
//     expect(() => c.getBoolean('val')).toThrow(ConfigError)
//   })
//
// WITH these tests:

it('getBoolean() coerces string "yes" to true', () => {
  const c = makeConfig({ val: { kind: 'scalar', value: 'yes' } })
  expect(c.getBoolean('val')).toBe(true)
})

it('getBoolean() coerces string "no" to false', () => {
  const c = makeConfig({ val: { kind: 'scalar', value: 'no' } })
  expect(c.getBoolean('val')).toBe(false)
})

it('getBoolean() coerces string "on" to true', () => {
  const c = makeConfig({ val: { kind: 'scalar', value: 'on' } })
  expect(c.getBoolean('val')).toBe(true)
})

it('getBoolean() coerces string "off" to false', () => {
  const c = makeConfig({ val: { kind: 'scalar', value: 'off' } })
  expect(c.getBoolean('val')).toBe(false)
})

it('getBoolean() is case-insensitive', () => {
  const c1 = makeConfig({ val: { kind: 'scalar', value: 'TRUE' } })
  expect(c1.getBoolean('val')).toBe(true)
  const c2 = makeConfig({ val: { kind: 'scalar', value: 'Yes' } })
  expect(c2.getBoolean('val')).toBe(true)
  const c3 = makeConfig({ val: { kind: 'scalar', value: 'OFF' } })
  expect(c3.getBoolean('val')).toBe(false)
})

it('getBoolean() throws ConfigError for non-boolean string', () => {
  const c = makeConfig({ val: { kind: 'scalar', value: 'maybe' } })
  expect(() => c.getBoolean('val')).toThrow(ConfigError)
})
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `cd repos/ts.hocon && pnpm test -- tests/config.test.ts`
Expected: FAIL — "yes"/"no"/"on"/"off" and case-insensitive tests fail

- [ ] **Step 3: Update getBoolean() to use coerceBoolean**

In `src/config.ts`, add import and replace the string handling in `getBoolean()`:

Add at top of file:
```ts
import { coerceBoolean } from './coerce.js'
```

Replace lines 29-37 of `getBoolean()`:
```ts
getBoolean(path: string): boolean {
  const v = this.requireScalar(path)
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const coerced = coerceBoolean(v)
    if (coerced !== undefined) return coerced
  }
  throw new ConfigError(`expected boolean at ${path}, got ${typeof v}`, path)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd repos/ts.hocon && pnpm test -- tests/config.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd repos/ts.hocon && pnpm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd repos/ts.hocon && git add src/config.ts tests/config.test.ts
git commit -m "feat: extend getBoolean() to support yes/no/on/off (case-insensitive)"
```

---

### Task 3: HOCON-Aware Coercion in validate() and getValidated()

**Files:**
- Modify: `src/zod.ts`
- Modify: `tests/zod.test.ts`

- [ ] **Step 1: Write failing tests for boolean coercion in validate()**

Add to `tests/zod.test.ts`:

```ts
describe('validate() HOCON-aware coercion', () => {
  it('coerces string "true" to boolean for z.boolean()', () => {
    const c = parse('debug = "true"')
    const schema = z.object({ debug: z.boolean() })
    const result = validate(c, schema)
    expect(result.debug).toBe(true)
  })

  it('coerces string "false" to boolean for z.boolean()', () => {
    const c = parse('debug = "false"')
    const schema = z.object({ debug: z.boolean() })
    const result = validate(c, schema)
    expect(result.debug).toBe(false)
  })

  it('coerces "yes"/"no"/"on"/"off" to boolean', () => {
    const c = parse(`
      a = "yes"
      b = "no"
      c = "on"
      d = "off"
    `)
    const schema = z.object({
      a: z.boolean(),
      b: z.boolean(),
      c: z.boolean(),
      d: z.boolean(),
    })
    const result = validate(c, schema)
    expect(result.a).toBe(true)
    expect(result.b).toBe(false)
    expect(result.c).toBe(true)
    expect(result.d).toBe(false)
  })

  it('coerces case-insensitively', () => {
    const c = parse('flag = "TRUE"')
    const schema = z.object({ flag: z.boolean() })
    expect(validate(c, schema).flag).toBe(true)
  })

  it('passes through boolean literals without coercion', () => {
    const c = parse('debug = false')
    const schema = z.object({ debug: z.boolean() })
    expect(validate(c, schema).debug).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd repos/ts.hocon && pnpm test -- tests/zod.test.ts`
Expected: FAIL — ZodError for string values with z.boolean()

- [ ] **Step 3: Write failing tests for number coercion**

Add to `tests/zod.test.ts`:

```ts
describe('validate() number coercion', () => {
  it('coerces numeric string to number for z.number()', () => {
    const c = parse('port = "8080"')
    const schema = z.object({ port: z.number() })
    expect(validate(c, schema).port).toBe(8080)
  })

  it('coerces float string to number', () => {
    const c = parse('rate = "3.14"')
    const schema = z.object({ rate: z.number() })
    expect(validate(c, schema).rate).toBe(3.14)
  })

  it('passes through number literals without coercion', () => {
    const c = parse('port = 8080')
    const schema = z.object({ port: z.number() })
    expect(validate(c, schema).port).toBe(8080)
  })

  it('lets Zod reject non-numeric strings', () => {
    const c = parse('port = "abc"')
    const schema = z.object({ port: z.number() })
    expect(() => validate(c, schema)).toThrow()
  })
})
```

- [ ] **Step 4: Write failing tests for schema wrapper unwrapping**

Add to `tests/zod.test.ts`:

```ts
describe('validate() wrapper unwrapping', () => {
  it('coerces through z.optional()', () => {
    const c = parse('debug = "true"')
    const schema = z.object({ debug: z.boolean().optional() })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces through z.nullable()', () => {
    const c = parse('debug = "false"')
    const schema = z.object({ debug: z.boolean().nullable() })
    expect(validate(c, schema).debug).toBe(false)
  })

  it('coerces through z.default()', () => {
    const c = parse('debug = "on"')
    const schema = z.object({ debug: z.boolean().default(false) })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces inside z.array()', () => {
    const c = parse('flags = ["true", "false", "yes"]')
    const schema = z.object({ flags: z.array(z.boolean()) })
    const result = validate(c, schema)
    expect(result.flags).toEqual([true, false, true])
  })

  it('coerces in nested objects', () => {
    const c = parse(`
      server {
        debug = "true"
        port = "3000"
      }
    `)
    const schema = z.object({
      server: z.object({
        debug: z.boolean(),
        port: z.number(),
      }),
    })
    const result = validate(c, schema)
    expect(result.server.debug).toBe(true)
    expect(result.server.port).toBe(3000)
  })
})
```

- [ ] **Step 5: Write failing test for getValidated() coercion**

Add to `tests/zod.test.ts`:

```ts
describe('getValidated() coercion', () => {
  it('coerces boolean string at path', () => {
    const c = parse('debug = "false"')
    expect(getValidated(c, 'debug', z.boolean())).toBe(false)
  })

  it('coerces numeric string at path', () => {
    const c = parse('port = "8080"')
    expect(getValidated(c, 'port', z.number())).toBe(8080)
  })
})
```

- [ ] **Step 6: Run all new tests to verify they fail**

Run: `cd repos/ts.hocon && pnpm test -- tests/zod.test.ts`
Expected: FAIL — new coercion tests fail, existing tests still pass

- [ ] **Step 7: Implement coerceValue() and update validate()/getValidated()**

Replace `src/zod.ts` entirely:

```ts
import type { ZodType } from 'zod'
import type { Config } from './config.js'
import { coerceBoolean, coerceNumber } from './coerce.js'

export function validate<T>(config: Config, schema: ZodType<T>): T {
  const plain = config.toObject()
  const coerced = coerceValue(plain, schema)
  return schema.parse(coerced)
}

export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  const val = config.get(path)
  const coerced = coerceValue(val, schema)
  return schema.parse(coerced)
}

function getDefType(schema: ZodType): string | undefined {
  const zod = (schema as any)._zod
  return zod?.def?.type
}

function getInnerSchema(schema: ZodType): ZodType | undefined {
  return (schema as any)._zod?.def?.schema
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
    case 'int':
      if (typeof value === 'string') {
        const coerced = coerceNumber(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const shape = (schema as any)._zod?.def?.shape
      if (!shape || typeof shape !== 'object') return value
      const result: Record<string, unknown> = {}
      const obj = value as Record<string, unknown>
      for (const key of Object.keys(obj)) {
        const fieldSchema = shape[key]
        result[key] = fieldSchema ? coerceValue(obj[key], fieldSchema) : obj[key]
      }
      return result
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = (schema as any)._zod?.def?.element
      if (!elementSchema) return value
      return value.map((item) => coerceValue(item, elementSchema))
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner) : value
    }

    default:
      return value
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd repos/ts.hocon && pnpm test -- tests/zod.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Run full test suite**

Run: `cd repos/ts.hocon && pnpm test`
Expected: ALL PASS

- [ ] **Step 10: Run typecheck**

Run: `cd repos/ts.hocon && pnpm typecheck`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
cd repos/ts.hocon && git add src/zod.ts tests/zod.test.ts
git commit -m "feat(zod): add HOCON-aware coercion in validate()/getValidated()

Introspects Zod v4 schema via _zod.def.type and applies HOCON coercion
rules (boolean: true/false/yes/no/on/off, number: numeric strings)
before passing values to schema.parse().

Closes #8"
```

---

### Task 4: Update Peer Dependency and Final Verification

**Files:**
- Modify: `package.json:29`

- [ ] **Step 1: Update peer dep**

In `package.json`, change:
```json
"zod": ">=3.0.0"
```
to:
```json
"zod": ">=4.0.0"
```

- [ ] **Step 2: Run full test suite**

Run: `cd repos/ts.hocon && pnpm test`
Expected: ALL PASS

- [ ] **Step 3: Run typecheck**

Run: `cd repos/ts.hocon && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd repos/ts.hocon && git add package.json
git commit -m "chore: narrow zod peer dep to >=4.0.0 (required for schema introspection)"
```
