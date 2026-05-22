# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2026-05-22

Cross-impl bugfix release: addresses [go.hocon#105](https://github.com/o3co/go.hocon/issues/105) (cgordon-reported Lightbend divergence on empty/comment-only includes) at the ts.hocon layer, and pins go.hocon#106 (include-ordering / self-ref-through-include) which already worked correctly here. Pure include-path behaviour; no public API changes; safe drop-in upgrade from v1.4.0.

### Tests

- **Cross-impl regression tests for include ordering ([go.hocon#106](https://github.com/o3co/go.hocon/issues/106))**. Pin Lightbend-equivalent semantics for `include` directives — scalar override, parent-after-include, self-referential append through include, both-object deep-merge, nested-include scope isolation, and sequential includes — so the existing correct behaviour does not regress when the merge logic is touched. No production-code change; `ts.hocon`'s `deepMergeResObjInto` already implements src-wins + prior-capture.

### Changed — include path

- **Empty / comment-only / whitespace-only included files contribute an empty config** ([go.hocon#105](https://github.com/o3co/go.hocon/issues/105), Lightbend compatibility). Previously, `include "empty.conf"` (or comment-only / whitespace-only / BOM-only content) errored with `empty file is not a valid HOCON document (HOCON.md L130)`. This blocked the common optional-override-file pattern. The carve-out is **narrow** — applies only to the file-include code path (`loadSingle` / `loadSingleAsync`); top-level empty parses (`parse("")`) and E11 package includes (which already had their own zero-byte carve-out) are unchanged. Reported via go.hocon by [@cgordon](https://github.com/cgordon); cross-impl with [go.hocon PR #110](https://github.com/o3co/go.hocon/pull/110) and [rs.hocon PR #108](https://github.com/o3co/rs.hocon/pull/108).

## [1.4.0] - 2026-05-21

### Added — E12 deferred substitution resolution (external request via [go.hocon#99](https://github.com/o3co/go.hocon/issues/99))

This release adds the Lightbend-aligned `parseStringWithOptions → withFallback → resolve()`
lifecycle requested by [@cgordon](https://github.com/cgordon) (see [go.hocon#99](https://github.com/o3co/go.hocon/issues/99)).
Existing `parse()` / `parseFile()` behaviour is unchanged (still parse-and-resolve
in one call); the new API surface is purely additive.

**New entry points:**
- `parseString(input, opts?)` — alias for `parse()` (Lightbend-aligned name).
- `parseStringWithOptions(input, opts)` — `opts.resolveSubstitutions = false` produces
  an unresolved `Config` whose `isResolved()` is `false` when the input contains `${...}`.
- `parseFileWithOptions(path, opts)` — file-reading counterpart of `parseStringWithOptions`.
- `fromMap(values, originDescription?)` — construct a `Config` from a plain JS object.
  Lightbend `ConfigValueFactory.fromMap` parallel.
- `empty(originDescription?)` — empty `Config`.

**New methods on `Config`:**
- `resolve(opts?)` — single top-level resolve over the entire merged fallback stack.
  Idempotent on already-resolved configs.
- `resolveWith(source, opts?)` — resolves receiver using `source` for substitution lookup;
  source's keys are NOT merged into the result. Precondition: `source.isResolved()` must be
  `true` (otherwise throws `NotResolvedError`).
- `isResolved()` — reports whole-config resolution state (E12 decision 11).
- `withFallback(other)` — now accepts unresolved operands; preserves substitution placeholders
  into the merged tree. Result is resolved iff both inputs are resolved.

**New types:**
- `ResolveOptions` — `{ useSystemEnvironment?: boolean; allowUnresolved?: boolean }`.
  `defaultResolveOptions()` returns `{ useSystemEnvironment: true, allowUnresolved: false }`.
- `ParseOptions.resolveSubstitutions` (new field) — when `false`, parse-only without resolving.
- `ParseOptions.originDescription` (new field) — source label for error messages.
- `defaultParseOptions()` — returns `{ resolveSubstitutions: true }`.

**New errors:**
- `NotResolvedError extends ConfigError` — thrown when a getter is called on a path that
  holds an unresolved substitution placeholder. Use `instanceof NotResolvedError` to detect.

**Cross-spec amendments:**
- S13a × WithFallback: self-reference lookback walks across fallback layers. Receiver
  `a = ${?a} extra` with fallback `a = base` resolves to `a = "base extra"`.
- S10 × AllowUnresolved: type-incompatible concat errors fire even under `allowUnresolved=true`;
  only missing-value errors are deferred.
- Optional substitution materialisation: `a = ${?x}${?y}` with both undefined now correctly
  omits field `a` (was incorrectly returning null).

**Spec source:** [xx.hocon#37](https://github.com/o3co/xx.hocon/issues/37) /
E12 in `docs/extra-spec-conventions.md`. Design doc: `docs/proposals/E12-deferred-resolution-design.md`.

### Added — E11 `include package("<id>", "<file>")` qualifier

xx.hocon [#33](https://github.com/o3co/xx.hocon/issues/33), [#36](https://github.com/o3co/xx.hocon/pull/36); supersedes [#109](https://github.com/o3co/ts.hocon/issues/109). A new include qualifier with **service-locator semantics** — looks up `.conf` files registered under a stable name via Node module resolution. **Not a Java classpath equivalent** (no auto-discovery, no auto `reference.conf` merge, no transitive auto-resolution). New public surface:

- `include package("github.com/myorg/pkg", "reference.conf")` syntax — two-arg form mandatory; one-arg + missing-comma rejected at parse time.
- `ParseOptions.packageResolver?: PackageResolver` — custom resolver callback. When provided, takes full control; `resolveFrom` is ignored. Use for Yarn Berry PnP, bundler contexts, edge runtimes, or test isolation.
- `ParseOptions.resolveFrom?: string | string[]` — override the starting directory(ies) for the default resolver's `require.resolve`. Default resolution order: `resolveFrom` > `baseDir` > `path.dirname(includingFile)` > `process.cwd()`.
- Exported `PackageResolver` type — `(identifier, file, includingFile, baseDir) => string`.
- Exported `PackageLookupError extends ResolveError` — thrown on registry/module miss.
- File argument validated **after HOCON string unescaping**: rejects empty, absolute, `..`, `./`, backslash, consecutive `/`.
- Yarn Berry PnP detected and rejected with a clear error (cross-impl decision X1).
- Cycle detection: `("package", id, file)` cycle-key integrated with existing include-cycle detection.

### Changed

- `IncludeQualifier` AST type refactored from a boolean `isFile` flag to a discriminated union (`kind: 'bare' | 'file' | 'package'`; `url` / `classpath` qualifiers are rejected with a `ParseError` rather than represented in the AST). Internal change; not part of the documented public AST surface.

### Fixed — E12 must-fix follow-up bundle (PR [#118](https://github.com/o3co/ts.hocon/pull/118))

- **#116 unresolved-getter error semantics**: `getConfig` / `getList` / `requireScalar` previously threw `NotResolvedError` for any missing path on an unresolved `Config`, even when the path was genuinely absent from `_resObjRoot`. Now gated on `_resObjRootSubtreeHasPlaceholders(path)` — truly-missing paths fall through to `ConfigError("path not found")` as on resolved configs. Helper also descends into HoconValue arrays so a placeholder element no longer hides under "missing".
- **#113 parseInclude strictness** (cross-impl gap from go.hocon v1.3.1 PR [#101](https://github.com/o3co/go.hocon/pull/101)). Two convergent bugs:
  - **Issue 2 (false-match)**: `innerPrefix.startsWith('file')` matched `fileX(`, same shape for `urlencode(`, `classpathish(`, `packagex(`. Tightened to exact match or `startsWith('X(')`. After all qualifier branches, any non-empty `innerPrefix` raises a parse error.
  - **Issue 1 (silent swallow)**: `parseQuotedPathSkipWrapper` advanced unconditionally past `,`, `=`, identifiers until a quoted string — so `include file () b = "x"` silently bound the path to `"x"` and dropped the trailing `b = ...` statement. Narrowed via `isIncludeWrapperToken` to bare `(` only; qualifier keywords consumed at call site. After the path, only `)`/`))` allowed before the statement boundary.
  - Issue 3 (whitespace-nested `include required ( file("foo"))`) remains tracked separately — those inputs now raise a loud `ParseError` instead of silently mis-routing to bare semantics.
- **#114 regression-pinned**: `Config.resolveWith(source, { allowUnresolved: true })` placeholder tracking — addressed in PR #117 squash; regression tests added in this bundle as a guard.

## [1.3.0] - 2026-05-21

v1.3 is a spec-compliance bugfix release. The implementation has been corrected to match the HOCON spec and Lightbend typesafe-config reference behavior across several previously-divergent areas (concat type-checking, `include` key reservation, leading-`-` value-position lexing, leading-zero number canonicalization, single-letter byte units, empty-file rejection, `.properties` object-wins, duration/bytes default unit). The spec did not change; the parser was simply wrong in places.

A subset of these fixes change observable runtime behavior. Configs that relied on the previously-incorrect lenience need updating — read the `### Breaking` and `### Fixed` sections below if your CI fails to upgrade cleanly. We elected MINOR (not MAJOR) because no API or architectural changes occurred; v2.0 is reserved for parser/lexer rewrites or similar structural shifts.

### Breaking

- **E8 amendment — `a = 01` resolves to number `1` (was `"01"` string)** (xx.hocon [#31](https://github.com/o3co/xx.hocon/issues/31), [#32](https://github.com/o3co/xx.hocon/pull/32)). xx.hocon's E8 was rewritten 2026-05-20 (commit `dd102e8`) to adopt Lightbend's pragmatic reading of HOCON.md L270-276 ("begin" = value-position begin, not token-position). ts.hocon now matches Lightbend on the leading-zero numeric literal (Lightbend `Long.parseLong("01") = 1`, JS `Number("01") === 1`). Other E8 changes are additive (see *Changed* below); only F3 (`01` → number) is a value-type change BREAKING. Phase 6 #3c Phase 3 (relax of the strict posture introduced in Phase 6 #3c Phase 2, [#96](https://github.com/o3co/ts.hocon/pull/96)+[#97](https://github.com/o3co/ts.hocon/pull/97)).

- **S12.5 include-key reservation**: `include = 1`, `include.foo = 1`, `include : 1`, `include += [1]`, and `include { }` in key position now throw `ParseError` ("'include' is reserved at the start of a key path expression"). Quoted form `"include" = 1` and non-initial `foo.include = 1` are unaffected. Fixtures ir01-ir14. Phase 6 #3e. Closes #80.

- **S10.4/S10.13/S10.19 concat type-check tightening**: `joinPair` now throws `ResolveError` for spec-disallowed type combinations — `[1] {b:2}`, `[1, 2] 3`, `{b:1} x`, and substitution-resolved equivalents — instead of silently coercing. Lightbend-spec-conformant per HOCON.md L373/L385. Phase 6 #3b. Fixtures: `testdata/hocon/concat-errors/ce01–ce15`. Closes #75, #77, #79.
  Preserved unchanged: Object+Object merge (S10.3), Array+Array concat, the S15 numeric-keyed-object→array bridge (S15.3), and Scalar+Scalar string-concat.

### Changed

- **E8 amendment — value-position `-` and concat-continuation relaxation** (xx.hocon [#31](https://github.com/o3co/xx.hocon/issues/31), [#32](https://github.com/o3co/xx.hocon/pull/32), commit `dd102e8`). The strict reject at the main tokenize loop's unquoted-start branch (`src/internal/lexer/lexer.ts`) has been removed. New behaviors (all additive — previously-erroring inputs now parse successfully):
  - `a = -foo` lexes as unquoted `"-foo"` (was `ParseError`).
  - `a = -` lexes as unquoted `"-"` (was `ParseError`).
  - `b = ${a}-bar` (and symmetric concat-continuation cases: `${a}--bar`, `${a}-1`, `${a}1bar`, `${a}.bar`, `${a}_bar`, `"foo"-bar`, `"foo".bar`, `"foo"1bar`, `${a}-${a}`, `${a}-${b}`, `foo-${a}`, `"foo"-${a}`) resolves to the value-concat string (was `ParseError`).
  - `+` rejection retained in both value-start and concat-continuation positions (HOCON `+=` operator reservation, unchanged).
  - Path-element strict checks preserved (out of E8 scope): `parseSubstBody`'s segment-start `-` check and `parseKey`'s per-segment `-` check still reject `${-foo}` and `a.-foo = 1` respectively.
  - New conformance fixtures `us17`–`us30` (14 cases) pin the cross-impl behavior alongside the existing `us01`–`us16` set.
  - Conformance test `tests/s8-unquoted-starts.test.ts` reorganized — `SUCCESS_FIXTURES` now includes us02/us03/us13 + us17-us30; `ERROR_FIXTURES` removed (was us02/us03); `KNOWN_GAP_FIXTURES` slimmed to us15 only (`1e+x` `+` reservation gap).

### Fixed

- **S3.1 empty file rejection** (Phase 6 #3h): `parse('')`, `parse('   \n  ')`, `parse('# only a comment\n')`, and any other input that produces no semantic tokens now throw `ParseError("empty file is not a valid HOCON document (HOCON.md L130)")`. Previously `parse('')` returned an empty Config without throwing. Both `parse()` and `parseAsync()` are covered via the shared `buildResolveContext()` guard. Conformance fixtures ef01–ef06.

- **S21.4 single-letter byte abbreviations** (Phase 6 #3h): `getBytes()` and `parseBytes()` now accept single-letter K/k/M/m/G/g/T/t/P/p/E/e as powers-of-two per HOCON.md L1385 (java -Xmx convention). Lightbend typesafe-config 1.4.3 verified: `1K=1024`, `1M=1048576`, etc. Values that would exceed `Number.MAX_SAFE_INTEGER` (e.g. `1E` = 2^60 ≈ 1.15e18 > 2^53-1) throw `RangeError`. Multi-letter units (KB/MB/etc.) remain SI decimal and are unaffected. Z/Y deferred (require BigInt accessor). Conformance fixtures bsl01–bsl09.

- **S23.4 .properties object-wins rule** (Phase 6 #3h): `parseProperties()` now sorts keys before inserting via `setNested`, and `setNested` guards last-segment writes so an existing object is never overwritten by a scalar. Both orderings of conflicting keys (`a=hello;a.b=world` and `a.b=world;a=hello`) now produce `{a:{b:"world"}}` (object wins per HOCON.md L1485). Deep nesting cases (pc03/pc04) also correct. Conformance fixtures pc01–pc04.

- **S18.1 + S18.4 units default**: `getDuration()` and `getBytes()` now accept bare numbers and strings with no unit suffix, treating them as the family's default unit (milliseconds for duration, bytes for bytes). `getDuration(5000)` → 5000 ms; `getDuration("5000")` → 5000 ms; `getDuration("500.5")` → 500.5 ms (fractional accepted, Lightbend-faithful). `getBytes("1024")` → 1024; `getBytes("1024.5")` → 1024 (truncated via `Math.trunc`, matching Lightbend `BigDecimal.toBigInteger()`). `getBytes()` now rejects negative byte sizes (Lightbend positive-only accessor invariant). Whitespace stripping uses HOCON_WS predicate (`trimHoconWs` helper). `+` prefix now accepted in numeric strings. xx.hocon fixtures ud01–ud08, ub01–ub06, un01–un03 pass; up01–up05 (period) inapplicable — S20 ➖. Phase 6 #3d.

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
