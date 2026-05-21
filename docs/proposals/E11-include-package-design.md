# E11 `include package(...)` — ts.hocon API Surface and Resolution Design

**Status**: Design notes — NOT approved for implementation yet (★1 gate pending).
**Branch**: `feat/include-package-design`
**Spec**: `xx.hocon/docs/extra-spec-conventions.md § E11`
**Tracking**: [xx.hocon#33](https://github.com/o3co/xx.hocon/issues/33)

---

## 1. Context

E11 adds a new `include package("identifier", "file")` qualifier. ts.hocon's lookup
mechanism is Node `require.resolve` — implicit, host-driven, no explicit registry. This
document records the design decisions needed before implementation begins.

---

## 2. Decision 1 — Resolution starting-point default

### Proposed call site

```text
require.resolve(identifier + "/" + file, { paths: [path.dirname(includingConfFile)] })
```

`includingConfFile` is the absolute path of the `.conf` file that contains the
`include package(...)` directive, threaded into the resolver via `ResolveOptions.baseDir`.

### Correctness analysis by package manager

| Package manager | Layout | Does the call work? | Notes |
| --- | --- | --- | --- |
| npm flat | `node_modules/<id>/…` | Yes | Canonical case; `paths` array starts search from the `.conf` file's directory, resolves up through parent `node_modules` trees — standard Node resolution. |
| pnpm with hoisted layout (`shamefully-hoist=true`) | Same as npm flat | Yes | Hoisted mode places deps in root `node_modules`; resolution identical to npm. |
| pnpm default (symlink layout) | `node_modules/<id>` → `.pnpm/<id@ver>/node_modules/<id>` | Yes | `require.resolve` follows symlinks; the virtual-store target is a real directory. The `.conf` file path need not be inside the symlinked tree — `paths` is the starting scope, resolution still works. |
| pnpm PnP (experimental) | Package zip files | **Untested** | pnpm PnP is rare and experimental; treat as unsupported with a clear error. |
| Yarn Berry PnP | ZIP-based store (`__pnp_loader__` intercept) | **Problematic** | Yarn Berry's PnP runtime monkey-patches `Module._resolveFilename`. `require.resolve` may work if the consuming process loaded Yarn's runtime loader (`--loader`), but the file inside the ZIP cannot be read by `fs.readFileSync` after resolution. The resolved path is a ZIP entry path, not a real fs path. **Design conclusion**: detect PnP store paths (path contains `.yarn/cache` or `.pnp.cjs`), throw a clear error recommending Yarn's `module.createRequire` + PnP API, or requiring the package to export its conf content explicitly. |
| Yarn Classic | `node_modules/<id>` | Yes | Same as npm flat. |

### Pitfall: `baseDir` absent

When `parse(input, {})` is called (no `baseDir`, no file path), `includingConfFile` is
`undefined`. In this case `require.resolve` must be called with `paths: [process.cwd()]`
as the fallback. This matches the existing behaviour of bare `include "..."` in ts.hocon
(which resolves relative to `baseDir ?? process.cwd()`).

### Pitfall: file reading after resolve

`require.resolve` returns the absolute path to the resolved file. The actual file read
then goes through the caller-supplied `readFile` / `readFileSync` option, which is correct
for testability but means the file must be a real fs path. This is compatible with all
non-PnP environments.

---

## 3. Decision 2 — Parser option API

### Option A: `resolveFrom` (path or path[])

```ts
export type ParseOptions = {
  // … existing fields …
  /**
   * Override the starting directory (or directories) used when resolving
   * `include package("id", "file")` via Node module resolution.
   *
   * Default: path.dirname(includingConfFile) when known, process.cwd() otherwise.
   *
   * Useful for monorepos where the conf file lives outside the package tree,
   * or for test fixtures that need a stable resolution root.
   */
  resolveFrom?: string | string[]
}
```

### Option B: Full resolver callback

```ts
export type PackageResolver = (identifier: string, file: string, includingFile: string | undefined) => string
// Returns the absolute path to the resolved file, or throws if not found.

export type ParseOptions = {
  // … existing fields …
  /**
   * Custom resolver for `include package("id", "file")`.
   * Receives the identifier, file, and (if known) the absolute path of the
   * including .conf file. Must return an absolute path or throw.
   *
   * When not provided, the default resolver uses Node's `require.resolve`.
   */
  packageResolver?: PackageResolver
}
```

### Decision

Provide **both**, with Option B being the escape hatch. Rationale:

1. `resolveFrom` covers the common monorepo / test-fixture override case with minimal API
   surface (a string is easy to reason about and document).
2. `packageResolver` is needed for: Yarn PnP environments, bundler contexts where
   `require.resolve` is replaced, edge runtimes, and advanced test isolation. Without it,
   those users have no recourse.
3. Both options can coexist: if `packageResolver` is provided it takes full control;
   `resolveFrom` modifies the default resolver only.
4. The callback signature `(identifier, file, includingFile) => string` is enough
   information for any resolution strategy without over-engineering. The return type is a
   plain path string — keeping file-reading in ts.hocon's existing `readFile` / `readFileSync`
   path, which preserves the existing test-hook surface.

**Interface shape** (internal type, not public-exported initially — see §9):

```ts
// internal/resolver/types.ts additions
export type PackageResolver = (
  identifier: string,
  file: string,
  includingFile: string | undefined,
) => string   // must return absolute path or throw

export type ResolveOptions = {
  env: Record<string, string>
  baseDir: string | undefined
  readFileSync: (filePath: string) => string
  readFile?: (filePath: string) => Promise<string>
  includeStack?: string[]    // existing — now extended with package cycle keys
  // NEW:
  resolveFrom?: string | string[]
  packageResolver?: PackageResolver
}
```

`ParseOptions` mirrors these two new fields into the public API surface (src/parse.ts).

---

## 4. Decision 3 — Sync vs async

### Existing parse paths

| Entry point | Sync | Async |
| --- | --- | --- |
| `parse()` | Yes (uses `readFileSync`) | — |
| `parseAsync()` | — | Yes (uses `readFile`) |
| `parseFile()` | Yes | — |
| `parseFileAsync()` | Yes (fallback `readFileSync`) + | Yes (primary `readFile`) |

### `package(...)` in sync path

`require.resolve()` is **synchronous**. File reading uses `readFileSync`. No async
primitives needed. The sync path is fully compatible without additional design.

### `package(...)` in async path

`require.resolve()` is still sync (no `require.resolve`-as-promise exists in Node).
The resolution step is sync; only the file read is async. The `packageResolver` callback
(Option B above) also returns `string` synchronously (not `Promise<string>`), keeping the
pattern consistent. If a custom resolver needs to do async work (e.g., hitting a network
registry), the caller must pre-resolve and pass a sync wrapper or use `packageResolver`
with a pre-built cache. This tradeoff is acceptable: module resolution is by definition a
local-filesystem-and-manifest operation in all supported environments.

**Conclusion**: `PackageResolver` returns `string` (sync). Both `load` and `loadAsync`
in `IncludeLoader` call the same sync resolution step, then branch on
`readFileSync` vs `readFile` for the content fetch.

---

## 5. Decision 4 — ESM vs CJS resolution

### Runtime landscape (Node ≥ 22, per `engines` field in package.json)

- **CJS context**: `require.resolve(id, { paths })` — available, synchronous, correct.
- **ESM context (`import.meta.resolve`)**: Node 20.6+ stabilized. Node 22 fully supports it.
  However `import.meta.resolve` is async in some contexts, does not accept a `paths`
  override option, and resolves relative to the calling module's URL (not a configurable
  starting path). This makes it unsuitable as the primary mechanism.
- **Mixed CJS/ESM**: ts.hocon publishes both `./dist/index.cjs` and `./dist/index.js`
  (ESM) per the `exports` map. The dist bundle is produced by `tsup`.

### ESM/CJS decision

Use **CJS `require.resolve`** as the default, detected via a guard:

```ts
function defaultPackageResolver(
  identifier: string,
  file: string,
  includingFile: string | undefined,
  resolveFrom?: string | string[],
): string {
  if (typeof require === 'undefined' || typeof require.resolve === 'undefined') {
    throw new ResolveError(
      `include package("${identifier}", "${file}") requires Node.js CommonJS require.resolve, ` +
      `which is not available in this environment (ESM-only, bundler, or edge runtime). ` +
      `Provide a custom packageResolver option.`,
      identifier, 0, 0,
    )
  }
  const from = resolveFrom
    ? (Array.isArray(resolveFrom) ? resolveFrom : [resolveFrom])
    : (includingFile ? [nodePath.dirname(includingFile)] : [process.cwd()])
  try {
    return require.resolve(`${identifier}/${file}`, { paths: from })
  } catch {
    throw new ResolveError(
      `include package("${identifier}", "${file}"): module not found via require.resolve ` +
      `(starting from: ${from.join(', ')})`,
      identifier, 0, 0,
    )
  }
}
```

**ESM interop note**: when ts.hocon's ESM build is loaded in a pure ESM Node process,
`require` is not defined natively. However, callers can create a CJS-compatible `require`
via `import { createRequire } from 'module'; const require = createRequire(import.meta.url)`.
The design provides the `packageResolver` escape hatch specifically for this and for
Yarn PnP / bundler cases — the default resolver fails loudly with an actionable error
rather than silently.

**`import.meta.resolve` path**: not used in the default resolver. It could be wrapped in
a future opt-in via a helper export (`createImportMetaResolver(import.meta)`), but that
is out of scope for this design (ESM-only consolidation is listed as a non-goal in E11).

---

## 6. Decision 5 — Caching

### Options

| Level | Pros | Cons |
| --- | --- | --- |
| **None** | Simple, no state, no stale-file risk | Re-reads same file if `include package` appears N times |
| Per-parser-call | Warm within a single `parse()` invocation | Requires threading cache through `ResolveOptions`; adds complexity |
| Per-process (`Map` module-level) | Fastest across calls | Test isolation problem (shared mutable state) |

### Caching decision

**None** for V1. Rationale:

1. `require.resolve` is fast (filesystem metadata, no file read). The expensive part is
   file reading + tokenize + parse of the included content; these happen once per
   `include package(...)` occurrence in the source document, not per package identifier.
2. A per-process cache would require `ResetPackageCache()` for test isolation (the
   go.hocon pattern). ts.hocon explicitly avoids a global registry (E11 spec decision 3,
   ts.hocon column), so adding a global cache would partially contradict that stance.
3. HOCON includes are typically few in number; the performance impact of re-resolution is
   negligible in practice.
4. A caching layer can be added by the caller via a memoized `packageResolver` callback.

---

## 7. Decision 6 — Bundler / edge runtime detection

### When `require.resolve` is unavailable

Contexts: webpack (replaces `require.resolve` with its own module graph), esbuild
(similar), Cloudflare Workers (no `require`), Deno (no `require`), browser bundles.

### Detection strategy

The guard in `defaultPackageResolver` (§Decision 4) checks:

```ts
typeof require === 'undefined' || typeof require.resolve === 'undefined'
```

This fires in pure ESM node processes and in most bundlers (webpack re-defines `require`
but `require.resolve` may throw or return incorrect paths inside a bundle).

A secondary heuristic for webpack-inside-Node: `typeof __webpack_require__ !== 'undefined'`.
Add this to the guard condition.

### Error message

The error must:

1. Identify the qualifier that triggered it: `include package("id", "file")`
2. Explain why it failed: `require.resolve` not available
3. Give an actionable resolution: "Provide a custom packageResolver option, or pre-bundle
   the package content and pass it via a pre-populated custom resolver."

Bundler users are expected to provide a `packageResolver` that uses the bundler's own
asset/import mechanism (e.g., webpack's `require.context`, Vite's `import.meta.glob`).
This is intentional: bundler integration cannot be made automatic without coupling
ts.hocon to specific bundler APIs.

---

## 8. Decision 7 — File arg validation (E11 decision 6)

### Validation rules (from E11 spec)

- non-empty
- forward-slash separators only (no `\`)
- no leading `/`
- no `.` or `..` segments
- no consecutive `//`
- no percent-decoding applied

### Where to validate

**Recommended: include resolver layer** (`IncludeLoader.loadPackage`), not the parser or tokenizer.

Rationale:

- The parser already treats `package("id", "file")` as an opaque pair of HOCON strings.
  Inserting validation at the AST level would require the parser to understand E11
  semantics, which it should not.
- The tokenizer has no access to the `file` argument's semantic meaning; it merely
  tokenizes the quoted strings.
- The resolver layer is the right point because it is the first consumer that understands
  what `("identifier", "file")` means in context. Validation at this layer is consistent
  with how existing qualifiers' path constraints are enforced (e.g., `file()` implicitly
  resolves only to filesystem paths; bare include rejects missing files at resolution
  time).
- Validation runs before `require.resolve` is called, giving a clean parse-time error
  rather than a confusing `MODULE_NOT_FOUND` from Node.

### Validation logic shape

```ts
// internal/resolver/include-loader.ts (in loadPackage / loadPackageAsync)
function validatePackageFile(file: string, identifier: string): void {
  if (file.length === 0)
    throw new ResolveError(`include package("${identifier}", ...): file argument must be non-empty`, ...)
  if (file.includes('\\'))
    throw new ResolveError(`include package: backslash not allowed in file arg (use forward slash): "${file}"`, ...)
  if (file.startsWith('/'))
    throw new ResolveError(`include package: absolute path not allowed in file arg: "${file}"`, ...)
  if (/(?:^|\/)\.\.?(?:\/|$)/.test(file))
    throw new ResolveError(`include package: path traversal (. or ..) not allowed in file arg: "${file}"`, ...)
  if (file.includes('//'))
    throw new ResolveError(`include package: consecutive slashes not allowed in file arg: "${file}"`, ...)
}
```

Note: the regex `/(?:^|\/)\.\.?(?:\/|$)/` rejects both `.` and `..` as path segments
while allowing filenames that contain dots (e.g., `reference.conf` is valid).

---

## 9. Decision 8 — Cycle detection

### Where existing cycle detection lives

In `IncludeLoader.load` / `loadAsync` (src/internal/resolver/include-loader.ts, lines
47–49 and 90–92):

```ts
if (includeStack.includes(absPath)) {
  throw new ResolveError(`circular include: ${absPath}`, absPath, 0, 0)
}
```

`includeStack` is a `string[]` in `ResolveOptions`, threaded through each recursive
`loadSingle` / `loadSingleAsync` call with a spread-copy (`[...includeStack, candidate]`).

### Adding `("package", identifier, file)` cycle key

The cycle key for a `package(...)` include must distinguish it from `file(...)` includes.
The spec mandates: `("package", <identifier>, <file>)`.

Serialize as a single string key to slot into the existing `string[]`:

```ts
const cycleKey = `\0package\0${identifier}\0${file}`
// \0 (NUL) is not valid in fs paths or in HOCON string values, so it is a safe separator.
```

Usage:

```ts
loadPackage(identifier: string, file: string, required: boolean): ResObj {
  const { includeStack = [] } = this.opts
  const cycleKey = `\0package\0${identifier}\0${file}`

  if (includeStack.includes(cycleKey)) {
    throw new ResolveError(
      `circular include: package("${identifier}", "${file}")`,
      identifier, 0, 0,
    )
  }
  if (includeStack.length >= 50) {
    throw new ResolveError(`include depth limit exceeded (max 50)`, identifier, 0, 0)
  }

  // … validate file arg, resolve path, read content, parse …

  return this.onBuildResObj(ast, {
    ...this.opts,
    baseDir: nodePath.dirname(resolvedPath),
    includeStack: [...includeStack, cycleKey],
  })
}
```

The `\0package\0` prefix ensures no collision with filesystem paths (which cannot
contain NUL) while keeping the existing `includeStack: string[]` type unchanged.

---

## 10. AST changes required

The current `AstNode` include variant:

```ts
{ kind: 'include'; path: string; required: boolean; isFile?: boolean; pos: Pos }
```

Must be extended to carry package qualifier data. Two approaches:

### Option A: Add optional fields

```ts
{ kind: 'include'; path: string; required: boolean; isFile?: boolean;
  isPackage?: boolean; packageIdentifier?: string; pos: Pos }
```

Drawback: `path` is overloaded (file path vs. package file arg); `isPackage + packageIdentifier`
are awkward.

### Option B: Discriminated qualifier union (recommended)

```ts
type IncludeQualifier =
  | { kind: 'bare' }
  | { kind: 'file' }
  | { kind: 'package'; identifier: string }

{ kind: 'include'; qualifier: IncludeQualifier; path: string; required: boolean; pos: Pos }
```

`path` becomes: bare/file → file path string; package → the `<file>` argument. The
`identifier` lives in the qualifier discriminant. This is a **breaking change** to the
internal AST type but `AstNode` is not part of the public API surface (it is in
`src/internal/`).

### AST design decision

Option B. Rationale: it makes the qualifier explicit in the type system, avoids boolean
flag accumulation (`isFile`, `isPackage`, future `isUrl`...), and is correct at the
type level. Since `AstNode` is internal-only, the refactor scope is bounded to
`parser.ts`, `structure-builder.ts`, and `include-loader.ts`.

---

## 11. Public API surface changes

### `ParseOptions` (src/parse.ts) — additive, non-breaking

```ts
export type ParseOptions = {
  baseDir?: string
  env?: Record<string, string>
  readFile?: (filePath: string) => Promise<string>
  readFileSync?: (filePath: string) => string
  // NEW — E11:
  resolveFrom?: string | string[]
  packageResolver?: (identifier: string, file: string, includingFile: string | undefined) => string
}
```

### `PackageResolver` type — whether to export

The `PackageResolver` callback type is used in `ParseOptions`. It SHOULD be exported from
`src/index.ts` so callers can type their custom resolver without re-declaring the type.

Per the Design Principles self-check (CLAUDE.md): exporting this type is correct because
it is a public contract — callers who implement `packageResolver` need this type. The name
`PackageResolver` describes the layer's responsibility (resolving package references),
not the implementation (`require.resolve`). It will remain meaningful if the default
mechanism changes.

**Proposed exports addition** (src/index.ts):

```ts
export type { PackageResolver } from './parse.js'
// (defined in parse.ts, re-exported from internal/resolver/types.ts or parse.ts directly)
```

---

## 12. Open questions for ★1

The following items require Yoshi's decision before implementation begins:

1. **`PackageResolver` type name and export location**: export from `src/index.ts` as `PackageResolver`?
   Or keep it inline in `ParseOptions` without a named type? Named type is better for callers but
   adds one more public identifier. (Design recommendation: export it.)

2. **AST refactor scope**: the Option B discriminated qualifier union (§10) changes the internal
   `AstNode` include variant. This is a parser-layer refactor. Yoshi to confirm this is in scope
   for the same PR as the E11 feature, or whether the AST refactor should be a preparatory PR first.

3. **`resolveFrom` vs `packageResolver` precedence**: if both are provided, `packageResolver`
   wins (takes full control, `resolveFrom` is ignored). This is the proposed precedence. Confirm.

4. **Yarn Berry PnP stance**: detected PnP paths produce a clear error pointing to `packageResolver`.
   Is this the right stance, or should ts.hocon attempt to support PnP natively via
   `import { PnpApi } from 'pnpapi'`? (Recommendation: fail with clear error + docs; PnP
   support is out of scope for V1.)

5. **Error type**: should `include package` lookup failure throw `ResolveError` (existing) or a
   new `PackageLookupError extends ResolveError`? A distinct subclass makes it programmatically
   catchable by library users who want to handle "missing package" differently from other resolve
   failures. (Recommendation: new subclass; low implementation cost, high caller value.)

---

## 13. Implementation pipeline (informational — NOT yet approved)

When ★1 is approved, the implementation order should be:

1. AST refactor (`AstNode` include qualifier union) — isolated, no behavior change.
2. Parser: recognize `package(...)` qualifier, emit `{ kind: 'include', qualifier: { kind: 'package', identifier }, path: file }` AST node. Validate two-arg form (reject one-arg).
3. `IncludeLoader`: add `loadPackage` / `loadPackageAsync` methods. Wire file-arg validation (§8) and cycle detection (§9). Add default resolver (§5).
4. `StructureBuilder`: route `qualifier.kind === 'package'` to `loadPackage`.
5. `ParseOptions` / `ResolveOptions`: add `resolveFrom` + `packageResolver`.
6. Export `PackageResolver` from `src/index.ts`.
7. Tests: ipk01–ipk14 fixtures per E11 spec.

---

---

## 14. Codex review findings and dispositions

Codex review run 2026-05-21 (`design-review-include-package-ts`). Five issues found and addressed below.

### Issue 1 — Missing identifier non-empty check (must-fix, applied)

**Finding**: The design defined `validatePackageFile` but had no corresponding identifier validation.
E11 decision 1 says parsers MUST enforce a non-empty identifier (the only shape constraint at the
parser layer).

**Resolution**: Add `validatePackageIdentifier` alongside `validatePackageFile`:

```ts
function validatePackageIdentifier(identifier: string): void {
  if (identifier.length === 0)
    throw new ParseError('include package: identifier argument must be non-empty', 0, 0)
}
```

Both validators run at the start of `loadPackage` before `require.resolve` is called. This ensures
the error is a parse-phase `ParseError`, not a confusing `MODULE_NOT_FOUND`.

### Issue 2 — Validation placement: resolver layer must throw ParseError (must-fix, clarified)

**Finding**: The design said "resolver layer" and used `ResolveError`, but E11 decision 6 says file-arg
violations are parse errors. Contradicts the spec's error phase.

**Resolution**: `validatePackageFile` and `validatePackageIdentifier` MUST throw `ParseError`, not
`ResolveError`. The `IncludeLoader` already imports from `errors.ts`; adding `ParseError` to that
import is the only change required. The layer boundary is resolver, but the error class is parser.
This is consistent with how the existing parser throws `ParseError` for structural issues (e.g., bad
qualifier syntax) while the resolver throws `ResolveError` for semantic issues (e.g., file not found).
Decision 6 violations are structural (bad qualifier argument shape), so `ParseError` is correct.

Updated error class table:

| Violation | Error class |
| --- | --- |
| One-arg form `package("x")` | `ParseError` (parser — bad syntax) |
| Non-empty identifier check | `ParseError` (resolver entry, but ParseError class) |
| File arg validation (decision 6) | `ParseError` (resolver entry, but ParseError class) |
| Lookup failure (decision 4) | `ResolveError` |
| Cycle detection (decision 8) | `ResolveError` |
| Bundler/edge runtime no-`require` | `ResolveError` |

### Issue 3 — Case-sensitive equality vs macOS/Windows FS (documented limitation + mitigation)

**Finding**: Node `require.resolve` resolves on the host filesystem, which is case-insensitive
by default on macOS (HFS+ / APFS case-insensitive) and Windows (NTFS). This means
`Reference.conf` can satisfy `reference.conf` in practice, violating E11 decision 5 (`ipk07`).

**Resolution**: This is a structural limitation of delegating to `require.resolve` — it cannot
be fully mitigated without a post-resolution case-comparison step. Design decision:

1. **Post-resolution case check**: after `require.resolve` returns a path, extract the basename
   and compare it byte-exactly to the `file` argument's last segment.

   ```ts
   const resolved = require.resolve(...)
   const resolvedBasename = nodePath.basename(resolved)
   const expectedBasename = file.split('/').at(-1)!
   if (resolvedBasename !== expectedBasename) {
     throw new ResolveError(
       `include package("${identifier}", "${file}"): case mismatch — resolved "${resolvedBasename}" ` +
       `but expected "${expectedBasename}" (decision 5: case-sensitive)`,
       identifier, 0, 0,
     )
   }
   ```

   This catches the most common case (wrong capitalization of the file name). The intermediate
   directory segments cannot be post-checked from the resolved path without parsing the entire
   `node_modules` tree — this is an accepted residual limitation.

2. **Documentation**: add a note in `ParseOptions.packageResolver` JSDoc that on macOS/Windows,
   the default resolver may resolve case-insensitively for intermediate path segments. Callers
   who need strict cross-platform enforcement should use a `packageResolver` that performs
   their own case check.

3. **`ipk07` fixture**: the fixture must be run in CI on a case-sensitive filesystem
   (Linux) to be a meaningful conformance test. Add a comment to the fixture file noting
   this requirement.

### Issue 4 — NUL cycle-key collision (must-fix, applied)

**Finding**: HOCON strings CAN contain NUL via `" "` — the claim "NUL not valid in HOCON"
is incorrect. Different `(identifier, file)` pairs containing NUL could produce identical cycle keys.

**Resolution**: Use `JSON.stringify` for the cycle key:

```ts
const cycleKey = JSON.stringify(['package', identifier, file])
// e.g. '["package","github.com/o3co/auth","reference.conf"]'
```

`JSON.stringify` produces an unambiguous, collision-free encoding of the `(identifier, file)`
pair regardless of embedded NUL, quotes, or other special characters. The resulting key string
cannot appear as a filesystem path (it starts with `[`), so no collision with file-include
stack entries.

### Issue 5 — ESM default resolver: concrete wiring plan (must-fix, design updated)

**Finding**: The ESM build (`./dist/index.js`) has no native `require`. Using ambient `typeof
require` will always be undefined in ESM contexts, making `package(...)` unusable from the ESM
entry point without a user-supplied `packageResolver`.

**Resolution**: The `defaultPackageResolver` in the distributed code must use `createRequire`:

```ts
// At module load time (top of the default-resolver module or include-loader):
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)   // works in both CJS and ESM

function defaultPackageResolver(
  identifier: string,
  file: string,
  includingFile: string | undefined,
  resolveFrom?: string | string[],
): string {
  // _require is always defined here (createRequire works in Node ≥ 12, both CJS + ESM)
  const from = resolveFrom
    ? (Array.isArray(resolveFrom) ? resolveFrom : [resolveFrom])
    : (includingFile ? [nodePath.dirname(includingFile)] : [process.cwd()])
  try {
    return _require.resolve(`${identifier}/${file}`, { paths: from })
  } catch {
    throw new ResolveError(
      `include package("${identifier}", "${file}"): module not found ` +
      `(starting from: ${from.join(', ')})`,
      identifier, 0, 0,
    )
  }
}
```

`createRequire(import.meta.url)` is available in Node ≥ 12 (well within the `engines: node >= 22`
requirement) and works identically in CJS and ESM contexts. This eliminates the ambient-`require`
detection guard entirely — no `typeof require === 'undefined'` needed. The only remaining runtime
check is for non-Node environments (edge runtimes, browsers) where `createRequire` itself may not
be importable; that case is caught at import time, not at call time, and the bundler/edge detection
heuristic in §Decision 6 is still valid for those cases.

**Revised bundler detection**: since `createRequire` is imported from `node:module`, bundlers that
tree-shake or stub `node:module` will produce an import error at bundle time (not a silent runtime
failure). This is actually better behavior than the ambient-`require` guard — it fails loud and
early at bundle stage rather than silently at runtime.

---

*Document created 2026-05-21 by design-notes agent on branch `feat/include-package-design`.*
*Codex review applied 2026-05-21 — all 5 issues addressed.*
