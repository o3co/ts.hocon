# ts.hocon

[![npm](https://img.shields.io/npm/v/@o3co/ts.hocon.svg)](https://www.npmjs.com/package/@o3co/ts.hocon)
[![CI](https://github.com/o3co/ts.hocon/actions/workflows/test.yml/badge.svg)](https://github.com/o3co/ts.hocon/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/o3co/ts.hocon/branch/main/graph/badge.svg)](https://codecov.io/gh/o3co/ts.hocon)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

A full [Lightbend HOCON](https://github.com/lightbend/config/blob/main/HOCON.md) spec-compliant TypeScript library.

> **Implemented by [Claude](https://claude.ai/) (Anthropic)** — designed and built end-to-end with Claude Code.

[日本語](README.ja.md)

---

## Features

- Full HOCON parsing: objects, arrays, scalars, substitutions (`${path}`, `${?path}`)
- Self-referential substitutions (`path = ${path}:/extra`)
- Deep-merge for duplicate keys (last definition wins)
- `+=` append operator
- `include "file.conf"` and `include file("file.conf")` directives
- Triple-quoted strings (`"""..."""`)
- Sync and async API (`parse` / `parseAsync` / `parseFile` / `parseFileAsync`)
- ESM + CJS dual package
- Optional [Zod](https://zod.dev/) integration for schema validation
- Browser compatible (`parse`/`parseAsync` — no Node.js required)

## Installation

```bash
npm install @o3co/ts.hocon
```

Requires Node.js 18+.

## Quick Start

```ts
import { parse, parseFile } from '@o3co/ts.hocon'

// Parse from string
const cfg = parse(`
  server {
    host = "localhost"
    port = 8080
  }
`)

// Parse from file
const cfg = parseFile('application.conf')

// Scalar getters (throw ConfigError on missing/wrong type)
const host = cfg.getString('server.host')   // "localhost"
const port = cfg.getNumber('server.port')   // 8080

// Safe access
const host = cfg.get('server.host')         // unknown | undefined
const exists = cfg.has('server.host')       // true
```

## API

### Parse functions

```ts
import { parse, parseAsync, parseFile, parseFileAsync } from '@o3co/ts.hocon'
import type { ParseOptions } from '@o3co/ts.hocon'

parse(input: string, opts?: ParseOptions): Config
parseAsync(input: string, opts?: ParseOptions): Promise<Config>
parseFile(path: string, opts?: ParseOptions): Config
parseFileAsync(path: string, opts?: ParseOptions): Promise<Config>
```

`ParseOptions`:
| Option | Type | Description |
|--------|------|-------------|
| `baseDir` | `string` | Base directory for `include` resolution |
| `env` | `Record<string, string>` | Environment variables for substitution (default: `process.env`) |
| `readFileSync` | `(path: string) => string` | Custom file reader (sync) |
| `readFile` | `(path: string) => Promise<string>` | Custom file reader (async) |

### Config methods

| Method | Returns | Throws if |
|--------|---------|-----------|
| `get(path)` | `unknown \| undefined` | — |
| `getString(path)` | `string` | missing, wrong type |
| `getNumber(path)` | `number` | missing, wrong type |
| `getBoolean(path)` | `boolean` | missing, wrong type |
| `getConfig(path)` | `Config` | missing, not an object |
| `getList(path)` | `unknown[]` | missing, not an array |
| `has(path)` | `boolean` | — |
| `keys()` | `string[]` | — |
| `withFallback(fallback)` | `Config` | — |
| `toObject()` | `unknown` | — |

### Zod integration

```ts
import { validate, getValidated } from '@o3co/ts.hocon/zod'
import { z } from 'zod'

const Schema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number().int(),
  }),
})

// Validate entire config
const app = validate(cfg, Schema)

// Validate a single path
const port = getValidated(cfg, 'server.port', z.number().int())
```

Install Zod as a peer dependency:
```bash
npm install zod
```

### Error types

```ts
import { ParseError, ResolveError, ConfigError } from '@o3co/ts.hocon'

// ParseError   — lexing/parsing failure: .line, .col, .file?
// ResolveError — substitution/include failure: .path, .line, .col, .file?
// ConfigError  — wrong type or missing path: .path
```

## HOCON Examples

```hocon
# Comments with # or //
database {
  host = "db.example.com"
  port = 5432
  url  = "jdbc:"${database.host}":"${database.port}
}

# Duplicate keys deep-merge (last wins for scalars)
server { host = localhost }
server { port = 8080 }      // result: { host: "localhost", port: 8080 }

# Self-referential append
path = "/usr/bin"
path = ${path}":/usr/local/bin"

# += shorthand
items = [1]
items += 2
items += 3   // [1, 2, 3]

# Include
include "defaults.conf"
include file("overrides.conf")

# Triple-quoted multiline strings
description = """
  This is a
  multiline string.
"""
```

## Spec Compliance

Tested against the [Lightbend official test suite](https://github.com/lightbend/config/tree/main/config/src/test/resources): **13/13 test groups pass**.

Not supported in v0.1.0:
- `include url(...)`
- `include classpath(...)`
- `.properties` file parsing

## Performance

### ts.hocon Parsing Cost

Measured with [Vitest bench](https://vitest.dev/guide/features.html#benchmarking) (tinybench). Run `pnpm bench` to reproduce.

| Scenario | ops/sec | Time per op |
|---|---|---|
| Small config (10 keys) | ~200,000 | ~5 µs |
| Medium config (100 keys) | ~23,000 | ~43 µs |
| Large config (1,000 keys) | ~2,100 | ~476 µs |
| 10 substitutions | ~74,000 | ~14 µs |
| 50 substitutions | ~14,000 | ~71 µs |
| 100 substitutions | ~6,900 | ~145 µs |
| Depth 5 nesting | ~210,000 | ~5 µs |
| Depth 10 nesting | ~147,000 | ~7 µs |
| Depth 20 nesting | ~80,000 | ~13 µs |

### Comparison with JSON.parse

JSON.parse is V8's native C++ implementation — the fastest possible baseline. This comparison shows the overhead of HOCON's rich feature set.

| Config Size | ts.hocon | JSON.parse | Ratio |
|---|---|---|---|
| Small (10 keys) | ~198K ops/s | ~1,967K ops/s | ~10x |
| Medium (100 keys) | ~23K ops/s | ~280K ops/s | ~12x |
| Large (1,000 keys) | ~2.2K ops/s | ~12K ops/s | ~5.4x |

For typical application configs (loaded once at startup), the parsing cost is negligible — even a 1,000-key config parses in under 0.5 ms.

### Feature Comparison with node-config

ts.hocon provides significantly richer configuration capabilities compared to [node-config](https://github.com/node-config/node-config) (JSON):

| Feature | ts.hocon | node-config (JSON) |
|---|---|---|
| Comments | `//` `#` | No |
| Multi-line strings | `"""..."""` | No |
| Substitution (`${path}`) | Yes | No |
| Optional substitution (`${?path}`) | Yes | No |
| Environment variable reference | Yes (via substitution) | Partial (`custom-environment-variables` file) |
| Include | Yes | No |
| Deep merge | Yes (arrays too) | Partial (arrays replaced) |
| Append operator (`+=`) | Yes | No |
| Environment-based config | Configurable via HOCON | Yes (filename convention) |
| Schema validation | Zod integration | No |
| Programmatic API | `parse(string)` | File-based initialization, then `get()` |
| Typed getters | `getString`, `getNumber`, etc. | `get()` (any) |

## Browser Compatibility

`parse()` and `parseAsync()` work in browsers. `parseFile()` and `parseFileAsync()` require Node.js (or a custom `readFileSync`/`readFile` option).

```ts
// Browser usage with custom file loader
const cfg = await parseAsync(hoconString, {
  readFile: async (path) => {
    const res = await fetch(`/config/${path}`)
    return res.text()
  },
})
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2026 o3co Inc.
