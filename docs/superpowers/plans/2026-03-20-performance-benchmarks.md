# Performance Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end performance benchmarks for ts.hocon and comparison benchmarks against JSON.parse.

**Architecture:** Vitest bench (`vitest bench` / `tinybench`) with generated fixture data. Three files: fixture generators, ts.hocon solo benchmarks, and JSON.parse comparison benchmarks.

**Tech Stack:** Vitest 3.x bench API, tinybench (already in node_modules via Vitest)

**Spec:** `docs/superpowers/specs/2026-03-20-performance-benchmarks-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `package.json` | Add `bench` script |
| Modify | `vitest.config.ts` | Add `test.benchmark.include` |
| Create | `tests/bench/fixtures.ts` | Generate HOCON/JSON test data |
| Create | `tests/bench/parse.bench.ts` | ts.hocon solo performance benchmarks |
| Create | `tests/bench/compare.bench.ts` | JSON.parse comparison benchmarks |

---

### Task 1: Configuration — Add bench script and Vitest benchmark config

**Files:**
- Modify: `package.json:20-26` (scripts section)
- Modify: `vitest.config.ts:3-7`

- [ ] **Step 1: Add bench script to package.json**

In `package.json`, add `"bench"` to the `scripts` object:

```json
"scripts": {
  "build": "tsup",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "coverage": "vitest run --coverage",
  "bench": "vitest bench"
}
```

- [ ] **Step 2: Add benchmark include to vitest.config.ts**

Replace the current config with:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
    },
  },
})
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm test`
Expected: All 109 tests pass. Bench files are not picked up by `vitest run`.

- [ ] **Step 4: Commit**

```bash
git add package.json vitest.config.ts
git commit -m "chore: add bench script and vitest benchmark config"
```

---

### Task 2: Fixture generators — Create test data for benchmarks

**Files:**
- Create: `tests/bench/fixtures.ts`

- [ ] **Step 1: Create `tests/bench/` directory and `fixtures.ts`**

```typescript
// tests/bench/fixtures.ts

type FixturePair = { hocon: string; json: string }

/**
 * Generate a flat/nested config with the given number of keys.
 * Produces equivalent HOCON and JSON strings.
 */
export function generateConfig(size: 'small' | 'medium' | 'large'): FixturePair {
  const specs = { small: { keys: 10, depth: 2 }, medium: { keys: 100, depth: 4 }, large: { keys: 1000, depth: 6 } }
  const { keys, depth } = specs[size]
  return buildNestedConfig(keys, depth)
}

/**
 * Generate a config with substitutions. HOCON uses ${ref}, JSON resolves inline.
 * Returns only HOCON (JSON has no substitution equivalent).
 */
export function generateWithSubstitutions(count: number, baseKeys?: number): { hocon: string } {
  const total = baseKeys ?? count * 2
  const lines: string[] = []

  // Base keys
  for (let i = 0; i < total; i++) {
    lines.push(`base${i} = "value${i}"`)
  }

  // Substitution keys referencing base keys
  for (let i = 0; i < count; i++) {
    lines.push(`sub${i} = \${base${i % total}}`)
  }

  return { hocon: lines.join('\n') }
}

/**
 * Generate a deeply nested config. Produces equivalent HOCON and JSON.
 */
export function generateDeepNested(depth: number): FixturePair {
  return buildDeepConfig(depth)
}

function buildNestedConfig(totalKeys: number, maxDepth: number): FixturePair {
  const obj: Record<string, unknown> = {}
  const hoconLines: string[] = []
  const keysPerGroup = Math.max(1, Math.floor(totalKeys / maxDepth))

  for (let d = 0; d < maxDepth; d++) {
    const groupKey = `group${d}`
    const inner: Record<string, unknown> = {}
    const innerLines: string[] = []

    const count = d < maxDepth - 1 ? keysPerGroup : totalKeys - keysPerGroup * (maxDepth - 1)
    for (let i = 0; i < count; i++) {
      inner[`key${i}`] = `value${d}_${i}`
      innerLines.push(`  key${i} = "value${d}_${i}"`)
    }

    obj[groupKey] = inner
    hoconLines.push(`${groupKey} {`)
    hoconLines.push(...innerLines)
    hoconLines.push('}')
  }

  return { hocon: hoconLines.join('\n'), json: JSON.stringify(obj) }
}

function buildDeepConfig(depth: number): FixturePair {
  // Build from inside out
  let innerObj: Record<string, unknown> = {}
  for (let i = 0; i < 5; i++) {
    innerObj[`key${i}`] = `deep_value${i}`
  }

  let hoconInner = ''
  for (let i = 0; i < 5; i++) {
    hoconInner += `  key${i} = "deep_value${i}"\n`
  }

  for (let d = depth - 1; d >= 0; d--) {
    const key = `level${d}`
    innerObj = { [key]: innerObj }
    hoconInner = `${key} {\n${hoconInner}}\n`
  }

  return { hocon: hoconInner, json: JSON.stringify(innerObj) }
}

/**
 * Pre-generated fixtures for benchmark use.
 */
export const fixtures = {
  small: generateConfig('small'),
  medium: generateConfig('medium'),
  large: generateConfig('large'),
  substitutions10: generateWithSubstitutions(10),
  substitutions50: generateWithSubstitutions(50),
  substitutions100: generateWithSubstitutions(100),
  deepNest5: generateDeepNested(5),
  deepNest10: generateDeepNested(10),
  deepNest20: generateDeepNested(20),
}
```

- [ ] **Step 2: Verify fixtures generate valid data**

Verification is deferred to Task 3 — when `pnpm bench -- parse` runs, it will exercise all fixtures. If any fixture produces invalid HOCON or empty strings, the benchmarks will fail with parse errors.

- [ ] **Step 3: Commit**

```bash
git add tests/bench/fixtures.ts
git commit -m "test: add benchmark fixture generators for HOCON and JSON"
```

---

### Task 3: ts.hocon solo benchmarks — parse.bench.ts

**Files:**
- Create: `tests/bench/parse.bench.ts`

**Docs:** Vitest bench API uses `describe` and `bench` from `vitest`. The `bench` function signature: `bench(name, fn, options?)`.

- [ ] **Step 1: Create parse.bench.ts**

```typescript
// tests/bench/parse.bench.ts
import { describe, bench } from 'vitest'
import { parse } from '../../src/parse.js'
import { fixtures } from './fixtures.js'

describe('parse - config size', () => {
  bench('small (10 keys)', () => {
    const config = parse(fixtures.small.hocon)
    config.getString('group0.key0')
  })

  bench('medium (100 keys)', () => {
    const config = parse(fixtures.medium.hocon)
    config.getString('group0.key0')
  })

  bench('large (1000 keys)', () => {
    const config = parse(fixtures.large.hocon)
    config.getString('group0.key0')
  })
})

describe('parse - substitutions', () => {
  bench('10 substitutions', () => {
    const config = parse(fixtures.substitutions10.hocon)
    config.getString('sub0')
  })

  bench('50 substitutions', () => {
    const config = parse(fixtures.substitutions50.hocon)
    config.getString('sub0')
  })

  bench('100 substitutions', () => {
    const config = parse(fixtures.substitutions100.hocon)
    config.getString('sub0')
  })
})

describe('parse - deep nesting', () => {
  bench('depth 5', () => {
    const config = parse(fixtures.deepNest5.hocon)
    config.getString('level0.level1.level2.level3.level4.key0')
  })

  bench('depth 10', () => {
    const config = parse(fixtures.deepNest10.hocon)
    config.getString('level0.level1.level2.level3.level4.level5.level6.level7.level8.level9.key0')
  })

  bench('depth 20', () => {
    const config = parse(fixtures.deepNest20.hocon)
    config.getString(
      Array.from({ length: 20 }, (_, i) => `level${i}`).join('.') + '.key0'
    )
  })
})
```

- [ ] **Step 2: Run the benchmark to verify it works**

Run: `pnpm bench -- parse`
Expected: All 9 benchmarks run and produce ops/sec numbers. No errors.

- [ ] **Step 3: Commit**

```bash
git add tests/bench/parse.bench.ts
git commit -m "test: add ts.hocon solo performance benchmarks"
```

---

### Task 4: JSON.parse comparison benchmarks — compare.bench.ts

**Files:**
- Create: `tests/bench/compare.bench.ts`

- [ ] **Step 1: Create compare.bench.ts**

```typescript
// tests/bench/compare.bench.ts
import { describe, bench } from 'vitest'
import { parse } from '../../src/parse.js'
import { fixtures } from './fixtures.js'

describe('compare - small config (10 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.small.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.small.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})

describe('compare - medium config (100 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.medium.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.medium.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})

describe('compare - large config (1000 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.large.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.large.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})
```

- [ ] **Step 2: Run the comparison benchmark**

Run: `pnpm bench -- compare`
Expected: All 6 benchmarks run. JSON.parse should be significantly faster — this is expected and the point of the comparison.

- [ ] **Step 3: Run all benchmarks together**

Run: `pnpm bench`
Expected: All 15 benchmarks (9 from parse.bench.ts + 6 from compare.bench.ts) complete without errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `pnpm test`
Expected: All 109 tests pass. Bench files are not included.

- [ ] **Step 5: Commit**

```bash
git add tests/bench/compare.bench.ts
git commit -m "test: add JSON.parse comparison benchmarks"
```
