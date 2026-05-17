# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Notes

- Substitution and top-level quoted strings continue to accept `\uXXXX` escapes producing surrogate code units (Java/Lightbend semantics). This intentionally diverges from rs.hocon, which rejects them because Rust's `char` cannot represent unpaired surrogates. See spec "Surrogate codepoint divergence" note.

### Changed

- **BREAKING**: Minimum Node.js version raised from 18 to 20. Node 18 reached EOL on 2025-04-30.
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
