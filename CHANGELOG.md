# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- **S12.5 include-key reservation**: `include = 1`, `include.foo = 1`, `include : 1`, `include += [1]`, and `include { }` in key position now throw `ParseError` ("'include' is reserved at the start of a key path expression"). Quoted form `"include" = 1` and non-initial `foo.include = 1` are unaffected. Fixtures ir01-ir14. Phase 6 #3e. Closes #80.

- **S10.4/S10.13/S10.19 concat type-check tightening**: `joinPair` now throws `ResolveError` for spec-disallowed type combinations — `[1] {b:2}`, `[1, 2] 3`, `{b:1} x`, and substitution-resolved equivalents — instead of silently coercing. Lightbend-spec-conformant per HOCON.md L373/L385. Phase 6 #3b. Fixtures: `testdata/hocon/concat-errors/ce01–ce15`. Closes #75, #77, #79.
  Preserved unchanged: Object+Object merge (S10.3), Array+Array concat, the S15 numeric-keyed-object→array bridge (S15.3), and Scalar+Scalar string-concat.

### Added

- **S13c env-var list expansion** (`${X[]}` / `${?X[]}`): substitutions ending with a `[]` suffix now expand environment variables `X_0`, `X_1`, … (stopping at the first absent index) into a HOCON array. Required form with no elements throws `ResolveError`; optional form removes the key. Config-defined values win over the env-var list (E6 convention). ASCII space and tab between the path expression and `[]` are allowed (E7 convention: `${X []}` is equivalent to `${X[]}`). Pins S13c.1–S13c.5 as ✅. Fixtures: ev01–ev13 in `tests/lightbend/testdata/hocon/env-var-list/`.

## [1.2.0] - 2026-05-18

### Notes

- Substitution and top-level quoted strings continue to accept `\uXXXX` escapes producing surrogate code units (Java/Lightbend semantics). This intentionally diverges from rs.hocon, which rejects them because Rust's `char` cannot represent unpaired surrogates. See spec "Surrogate codepoint divergence" note.

### Changed

- **BREAKING**: Minimum Node.js version raised from 18 to 22 (`engines.node` is `">=22"`). Node 18 reached EOL on 2025-04-30; Node 20 reached EOL on 2026-04-30. npm install on Node ≤ 21 will emit `EBADENGINE` and refuse to install.
- **BREAKING (S8.6)**: `a = -foo`, `a = -bar`, `a = -` and other `-`-not-followed-by-digit inputs are now lex errors. Per HOCON.md L270–276, a leading `-` must begin a number literal (i.e. be followed by a digit). Previously these were silently accepted as unquoted strings (`"-foo"`, `"-"`). Mitigation: quote the value (`a = "-foo"`). Note: this is intentionally stricter than Lightbend's reference implementation, which falls back to unquoted on number-parse failure. Digit-leading inputs (e.g. `123abc`, `01`, `1e+x`) are unaffected — ts.hocon's token model has no separate `number` kind, so the resolved value continues to match Lightbend's value-concat output for the common cases (see docs/spec-compliance.md §S8.6 for the remaining gaps tracked under #73).
- Substitution body tokenization: `${...}` internals are now tokenized at lex time via `parseSubstBody`. `SubstPlaceholder.segments` is now `Segment[]` (each segment carries `text`, `line`, `col`). The `opt_subst` token kind has been removed — use `token.subst.optional` instead.
- Key parser now handles mixed quoted/unquoted paths like `a."b.c".d` in both key position and substitution paths.

### Fixed

- Escape expansion and whitespace concatenation inside substitution paths now match Lightbend behavior (closes #58). Example: `${"a" "b"}` produces a single-segment path with text `"a b"`; `${"a\nb"}` produces a newline in the segment text.
- `parseSubstPath` (resolver-level re-parse) removed; substitution segments now flow directly from the lexer without a second parse pass, eliminating a class of subtle position and escape-handling bugs.

## [1.1.0] — 2026-04-05

### Changed

- **Scalar internal representation**: scalars now store `raw: string` + `valueType: ScalarValueType` instead of typed JS values. This eliminates type erasure (e.g., `0100` → `100`) and preserves original text. Note: `HoconValue` scalar variant changed from `{ value: string | number | boolean | null }` to `{ raw: string; valueType: ScalarValueType }`.
- `getString()` now returns the raw text for **all** scalar types (number, boolean, null), matching Lightbend behavior. Previously it threw on non-string values.
- `getDuration()` / `getBytes()` reject boolean and null values with a clear type error instead of a generic parse error.
- Env var lookup uses raw dot-join instead of `segmentsToKey` (no quoting), matching Lightbend behavior.

### Fixed

- `include file("path")` now resolves relative to the process working directory (CWD) instead of the including file's directory, matching Lightbend reference behavior. Bare `include "path"` is unchanged (resolves relative to including file).
- `.33` (no leading zero) now correctly classified as string, not number — aligned with Lightbend reference implementation.
- Number literal detection restricted to tokens starting with `0-9` or `-`. `0xff`, `Infinity`, etc. are no longer classified as numbers.
- Quoted-key include relativization: `${"a.b".c}` inside included files now resolves correctly.
- Nested include prefix composition: multi-layer includes accumulate prefixes correctly.

### Added

- `ScalarValueType` type exported from package root.
- Substitution path segments: `SubstPlaceholder` uses `segments: string[]` for correct quoted-key handling.

## [1.0.0] — 2026-04-04

### Added

- `getDuration(path, unit?)` — parse HOCON duration strings (`30s`, `5m`, `2h`) with configurable output unit (default: ms)
- `getBytes(path, unit?)` — parse HOCON byte size strings (`512MB`, `1GiB`) with configurable output unit (default: bytes)
- `DurationUnit` and `ByteUnit` types exported from package root
- `.properties` file support for includes (P1)
- `include required()` and `include required(file())` directives
- Include depth limit (max 50 levels)
- TypeDoc API documentation deployed to GitHub Pages on minor/major releases
- Security Considerations section in README
- Known Limitations section in README
- Performance benchmarks in README

### Fixed

- Include probing: changed from first-match to merge-all per HOCON spec
- Include probe order: `.properties → .json → .conf` (`.conf` wins via last-merge-wins)
- `\uXXXX` unicode escape validation in lexer
- Error on unknown escape sequences in quoted strings
- Circular include check moved before file read
- `parseBytes` supports fractional values and case-insensitive units
- Stray `}` after braced root now errors
- Package metadata: `license`, `engines`, `homepage`, `bugs` fields added

### Changed

- Cross-language spec alignment with go.hocon and rs.hocon

## [0.1.0] — 2026-03-20

### Added

- Full HOCON parser: Lexer → Parser → Resolver → Config pipeline
- Two-pass resolver with substitution (`${path}`, `${?path}`), concat, env fallback, self-referential substitution, cycle detection
- `include "file"` and `include file("file")` directives with circular include detection
- `parse()`, `parseAsync()`, `parseFile()`, `parseFileAsync()` public API
- `Config` class: `get`, `getString`, `getNumber`, `getBoolean`, `getConfig`, `getList`, `has`, `keys`, `withFallback`, `toObject`
- Zod integration: `validate(config, schema)` and `getValidated(config, path, schema)` via `@o3co/ts.hocon/zod`
- ESM + CJS dual package via tsup
- Browser compatible (`parse`/`parseAsync`)
- TypeScript strict mode throughout
- Lightbend official test suite: 13/13 test groups passing
- 109 tests total
