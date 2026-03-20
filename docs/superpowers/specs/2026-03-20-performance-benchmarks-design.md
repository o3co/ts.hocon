# Performance Benchmarks Design Spec

## Purpose

Provide transparent performance data for ts.hocon so users can make informed adoption decisions:

1. **ts.hocon single performance** — disclose the parsing cost across different config sizes and features
2. **JSON.parse comparison** — show the overhead of HOCON's rich features against the fastest baseline (V8 native JSON.parse)
3. **Feature comparison table** — clarify what ts.hocon offers over node-config (JSON) to contextualize the performance cost

## Approach

Use Vitest's built-in benchmark feature (`vitest bench` / `tinybench`). No additional dependencies required. Use tinybench defaults for warmup and iteration count — Vitest auto-calibrates iterations based on execution time, which is sufficient for these benchmarks.

## File Structure

```
tests/
└── bench/
    ├── parse.bench.ts        # ts.hocon single performance benchmarks
    ├── compare.bench.ts      # JSON.parse comparison benchmarks
    └── fixtures.ts           # Test data generation helpers
```

## Configuration Changes

### package.json

Add script:

```json
"bench": "vitest bench"
```

### vitest.config.ts

Add benchmark configuration under `test.benchmark.include`. Normal test runs already exclude `.bench.ts` files via the existing `test.include` pattern (`tests/**/*.test.ts`).

```typescript
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
    },
  },
})
```

## Test Data (fixtures.ts)

Dynamic generators that produce equivalent data in both HOCON and JSON formats.

### Generator Functions

```typescript
generateConfig(size: 'small' | 'medium' | 'large'): { hocon: string; json: string }
generateWithSubstitutions(count: number, baseKeys?: number): { hocon: string; json: string }
generateDeepNested(depth: number): { hocon: string; json: string }
```

### Size Definitions

| Scenario | Keys | Nesting Depth | Rationale |
|---|---|---|---|
| small | ~10 | 2 | Typical microservice config |
| medium | ~100 | 4 | Typical monolith / multi-module config |
| large | ~1000 | 6 | Stress test |

Substitution and deep nesting are separate generators to isolate their individual cost impact.

### Substitution Benchmark Data

For substitution benchmarks, the base config size should be proportional: `baseKeys = count * 2` (each substitution needs at least one source key to reference). For example, 50 substitutions uses a config with ~100 base keys. The `generateWithSubstitutions` function accepts an optional `baseKeys` parameter, defaulting to `count * 2`.

### Fairness Constraint

For JSON.parse comparison, only substitution-free equivalent data is used (since JSON has no substitution feature). Substitution cost is shown in ts.hocon-only benchmarks.

## Benchmark 1: ts.hocon Single Performance (parse.bench.ts)

Intentionally end-to-end only: `parse(hoconString)` -> `Config` -> `config.getString('key')`. Parse-only (without value retrieval) is not measured separately — the goal is to show the cost users actually experience, not internal breakdown.

### Groups

```typescript
describe('parse - config size', () => {
  bench('small (10 keys)')
  bench('medium (100 keys)')
  bench('large (1000 keys)')
})

describe('parse - substitutions', () => {
  bench('10 substitutions')
  bench('50 substitutions')
  bench('100 substitutions')
})

describe('parse - deep nesting', () => {
  bench('depth 5')
  bench('depth 10')
  bench('depth 20')
})
```

### Measurement Scope

- String generation happens outside the bench callback (setup)
- Only parse + value retrieval is measured
- Each bench callback: `parse(hoconString)` then `config.getString('someKey')`

## Benchmark 2: JSON.parse Comparison (compare.bench.ts)

### Purpose

Show the overhead of ts.hocon compared to the fastest possible baseline — V8's native `JSON.parse`.

### Structure

```typescript
describe('compare - small config', () => {
  bench('ts.hocon (HOCON)', () => {
    const config = parse(fixtures.small.hocon)
    config.getString('key0')
  })
  bench('JSON.parse (JSON)', () => {
    const obj = JSON.parse(fixtures.small.json)
    obj.key0
  })
})
// Repeat for medium, large
```

### Why JSON.parse (not node-config directly)

- node-config internally uses `JSON.parse` + file I/O + layer merging
- File I/O and singleton initialization introduce noise
- `JSON.parse` is the clearest baseline: V8 native, fastest possible
- Shows the pure computational overhead of HOCON parsing

### Value Retrieval

- ts.hocon: `config.getString('key0')` — includes path lookup + type check
- JSON: `obj.key0` — direct property access
- This reflects the real-world cost difference users experience

### Documentation Note

Benchmark results should note:
- JSON.parse is V8 native implementation (fastest possible baseline)
- ts.hocon overhead is the cost of HOCON features (comments, substitution, includes, deep merge, typed access)

## Feature Comparison Table

To be included alongside benchmark results for context.

| Feature | ts.hocon | node-config (JSON) |
|---|---|---|
| Comments | `//` `#` | No |
| Multi-line strings | `"""..."""` | No |
| Substitution (`${path}`) | Yes | No |
| Optional substitution (`${?path}`) | Yes | No |
| Environment variable reference | Yes (via substitution) | Partial (custom-environment-variables.EXT) |
| Include | Yes | No |
| Deep merge | Yes (arrays too) | Partial (arrays replaced) |
| Append operator (`+=`) | Yes | No |
| Environment-based config | Configurable via HOCON | Yes (filename convention) |
| Schema validation | Zod integration | No |
| Programmatic API | `parse(string)` | File-based initialization, then `get()` |
| Typed getters | `getString`, `getNumber`, etc. | `get()` (any) |

## Scope

This spec covers the benchmark implementation only. Publishing results to README or docs is a separate task.

## Execution

```bash
pnpm bench              # Run all benchmarks
pnpm bench -- parse     # ts.hocon single performance only
pnpm bench -- compare   # JSON.parse comparison only
```
