# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **BREAKING (spec fix, S3.4)**: an unbraced root followed by an unbalanced
  `}` — e.g. `a = 1` on one line and a stray `}` on the next — now raises
  `ParseError` instead of being silently accepted with the trailing tokens
  ignored (#55). The braced-root and array-root paths already rejected this;
  only the unbraced-root path skipped the end-of-input check. A document that
  relied on the old behaviour has an unbalanced brace to delete.
- Spec-compliance bookkeeping: S13a.3 was recorded as ⚠️ from a stale
  2026-05-13 probe, but the #120 self-reference widening had already routed
  `a = ${a}` (no prior value) to the spec's "undefined" classification
  (`could not resolve substitution`), distinct from a genuine cycle's
  `circular substitution`. Both classifications are now pinned by tests, and
  with S3.4 fixed the in-scope compliance rate is **100.0%** (spec-total
  90.0%). `tests/docs.test.ts` now also gates README.ja.md's compliance
  table, which had drifted 15+ points.

## [1.12.0] - 2026-07-31

Cross-impl release, coordinated to land at v1.12.0 across go.hocon / ts.hocon /
rs.hocon / py.hocon so the ecosystem stays on one version line.

**Minor, not patch, and the `.env` changes are BREAKING in both directions**:
the prefix filter now runs before validation (a file that used to fail may now
load), a variable name containing whitespace or `#` is refused (a file that used
to load may now fail), and "whitespace" is now the Unicode `White_Space`
property rather than the regex `\s` — so a name containing U+0085 is refused
where it used to become part of a key, and one containing U+FEFF is accepted
where it used to throw.

The rest: deeply nested input now raises this library's own error instead of a
bare `RangeError`, coinciding sibling keys in YAML are an error rather than
last-wins, and the documentation was corrected where it had drifted.

The F-item spec these errors cite is now public at
[`xx.hocon/docs/format-ingestion-mapping.md`](https://github.com/o3co/xx.hocon/blob/main/docs/format-ingestion-mapping.md);
it previously lived in a private working scope.

The published version comes from the tag; `package.json` stays at
`0.0.0-snapshot`.

### Changed — `.env`: the prefix filter runs first, and names are validated (F1.7)

**BREAKING both ways**: a line the prefix discards is no longer validated (so a
`.env` that used to fail may now load), and a name containing whitespace or `#`
is now refused (so one that used to load may now fail).

Three things, all pinned by an amended spec F1.7 after cross-checking found all
four implementations behaving identically by accident
([xx.hocon#78](https://github.com/o3co/xx.hocon/issues/78)):

- **The prefix filter moves ahead of validation.** The value was parsed before
  the filter and the path mapped after it, so one check landed on each side —
  `BAD=x # y` failed even when the caller only wanted `APP_*`, while
  `OTHER__=x` was never checked at all. `load`'s contract already said which
  way this goes ("entries outside the prefix are never inspected", the F1.1
  principle); the two functions disagreeing was the actual inconsistency.
- **`export` may be followed by spaces or tabs.** Matching the literal
  `export ` missed a tab, so `export<TAB>FOO=bar` became the variable
  `export<TAB>foo` — a key nothing would ever look up, produced silently. Space
  and tab specifically, matching what this dialect already trims on the value
  side; anything else leaves `export` part of the name, where the rule below
  refuses it. A name that merely begins with `export` is still a name.
- **A name containing whitespace or `#` is an error.** F1.7's rule for values —
  an error naming the fix rather than a guess about the author's intent —
  applies to names too; both characters mean the line was mis-parsed.
  `FOO BAR=baz` and `FOO#x=1` used to become the keys `foo bar` and `foo#x`.
  Deliberately narrower than a POSIX name grammar, which would reject
  `APP_FOO.BAR` — a name F1.2 documents as valid.

### Documented — `adapters/jsonc`: accepting an unpaired surrogate is deliberate (F3.5)

No behaviour change. New spec item F3.5 makes an unpaired `\uXXXX` surrogate an
error in the JSON family, and go.hocon, py.hocon and rs.hocon now refuse one
([xx.hocon#75](https://github.com/o3co/xx.hocon/issues/75)). **This
implementation keeps accepting it**, and that is recorded here and pinned by a
test so it is not mistaken for an oversight.

A JavaScript string is UTF-16, like Java's: it holds a lone surrogate natively
and round-trips it. A Go or Rust string cannot hold one at all — go.hocon was
silently substituting U+FFFD — and a Python `str` can hold one but cannot encode
it as UTF-8, so all three refuse rather than defer the failure. Refusing here
would be the spec overriding the host language rather than protecting anyone;
the properties adapter already carries the same divergence under F2.8, and
S1.2.6 is the class.

### Fixed — deeply nested input threw `RangeError`, outside the documented error contract

**BREAKING** for one of the two halves (a mapped path over 64 segments is now
refused; nothing else changes about what is accepted).

`RangeError` is not a type this library documents, so a caller writing
`catch (e) { if (e instanceof ConfigError) … }` did not recognise it and the
failure surfaced as an engine-level error from the middle of a parse
([#177](https://github.com/o3co/ts.hocon/issues/177)).

Two mechanisms, because two different things can be too deep:

- **A name that maps to a path is capped at 64 segments** — an environment
  variable's `__` segments, a `.properties` dotted key. One name produces one
  arbitrarily deep chain, so the input needed was a single long string rather
  than a structured document, which is reachable for anything bulk-mounting a
  container environment. rs.hocon and py.hocon cap the same mapping at the same
  number, so a name that mounts in one implementation mounts in the other. Over
  the limit is a `ConfigError` (env) or `ParseError` (Properties) naming the
  depth and the limit.
- **A deeply nested document is not capped** — refusing a 65-level JSON file
  would be a claim about the format rather than about a mapping we invented.
  Instead the `RangeError` is turned into the error type the entry point's
  contract names: `ConfigError` from the adapters (including the `from*Value`
  tree entry points, which skip the decoder) and from `fromMap`, `ParseError`
  from `parse`. That matters beyond tidiness, because the depth at which V8
  gives out depends on how deep the *caller* already is: the same document could
  parse from one call site and throw from another. The same guard covers a
  *cyclic* input structure — an object that contains itself, handed to `fromMap`
  — which from inside the handler is indistinguishable from depth, so the
  message names both shapes.

Only stack-exhaustion `RangeError`s are converted; one thrown for any other
reason keeps its own identity rather than being relabelled a depth problem.

### Fixed — `adapters/yaml`: coinciding sibling keys were last-wins, not an error

**BREAKING** (input previously accepted is now refused; rename one of the two
keys — quoting only helps where it changes the key text, as `0x10` → `"0x10"`
does and `1` → `"1"` does not).

`parseYaml("1: a\n'1': b\n")` returned `{"1":"b"}`. The integer key and the
string key are distinct in YAML but have the same string form, so writing the
second dropped the first's value with nothing to show for it — the silent loss
F5.3 exists to prevent. The same held for `~`/`"null"`, `true`/`"true"` and
`0x10`/`"16"`, and for a `Map` handed to `fromYamlValue`
([#171](https://github.com/o3co/ts.hocon/issues/171)).

The document is now decoded with `mapAsMap`, so both keys survive the decode
and one collision check covers the parse path and the injected-tree path
alike. Which forms coincide is still the library's business — `1.0` resolves to
the number `1` here and so does not meet the string `"1.0"`.

**A null key now spells itself `"null"` rather than `""`**, which is what
go.hocon, rs.hocon and py.hocon produce; `mapAsMap` keeps the key as `null`
instead of the empty string the object form substitutes.

### Fixed — documentation that had drifted away from the code

Nothing was checking the README's factual claims, so they aged with each
release. The ones that can be recomputed from a source of truth in this
repository are now pinned by `tests/docs.test.ts`, which runs in the release
workflow — a stale README fails the cut.

- **"Stricter than Lightbend — S8.6 leading-hyphen rejection" described behavior
  retracted in v1.3.0.** `a = -foo`, `a = -`, and (since v1.9.0) `a.-foo = 1`
  all parse; the section told readers to quote values that need no quoting. The
  E8 amendment and its retraction are already recorded in the [1.3.0] and
  [1.9.0] sections, so the section is removed rather than rewritten.
- **The compliance rates were a 2026-05-13 snapshot** (74.2% / 83.3%) against
  the current 89.3% / 99.2%. They are now recomputed from the status glyphs in
  `docs/spec-compliance.md` and compared against the table, so the two cannot
  diverge again.
- **`CONTRIBUTING.md` told contributors to release with `npm version`**, which
  bumps `package.json` — the opposite of this repository's convention, where the
  tag is the version and `package.json` stays at `0.0.0-snapshot` for CI to
  overwrite. Following it produced exactly the PR that broke the v1.4.0 publish.
- The node-config comparison now names the version it was checked against
  (v4.4.2) and drops the editorializing lead-in.

### Fixed — the F-item spec citations pointed at a document readers cannot open

Three adapter doc comments and the fixture manifest cited
`docs/specs/format-ingestion-mapping.md`, which is not in this repository — it
lived in a private working scope. The adapters raise errors that name items from
it (`(spec F0.5)`, `(spec F1.6)`), so anyone following a citation reached
nothing. The spec is now published at
[`xx.hocon/docs/format-ingestion-mapping.md`](https://github.com/o3co/xx.hocon/blob/main/docs/format-ingestion-mapping.md) and every citation points
there ([xx.hocon#81](https://github.com/o3co/xx.hocon/issues/81)). Error text is
unchanged; only the pointers move.

### Fixed — `.env`: "whitespace" in a name is the Unicode `White_Space` property (F1.7)

`checkName` used `/\s/`, which is **not** the `White_Space` property:
enumerated over the whole codepoint space, `\s` is `White_Space` minus U+0085
(NEL) plus U+FEFF. So `FOO<NEL>BAR=baz` produced the key `foo<NEL>bar` here and
raised in the other three implementations, whose `unicode.IsSpace` /
`char::is_whitespace` / `str.isspace` all have NEL.

Whether a name is refused must not depend on which helper an implementation
reached for; this is the same argument F1.3 makes for ASCII-only case folding.
The spec now pins the property
([xx.hocon#81](https://github.com/o3co/xx.hocon/issues/81)) and `checkName` uses
`/\p{White_Space}/u`. Two changes, in opposite directions: a name containing
U+0085 now throws, and a name containing U+FEFF no longer does — F0.9 already
removes the realistic BOM case, and the property is what the spec cites.

The behaviour being corrected has not been released; the name rule itself
arrived in this same unreleased window.

## [1.11.0] - 2026-07-26

### Changed (behavior) — read this before upgrading

Several fixes below change what previously "worked", always by refusing or
reshaping input that was being mangled silently. In brief:

| What changed | Before | Now |
| --- | --- | --- |
| JSONC `1/*c*/2`, `tr/*c*/ue` | parsed as `12` / `true` | `SyntaxError` |
| JSONC `//` comment ending at CR | ate the rest of the line, dropping keys with no error | ends at the CR |
| JSONC/YAML integer past 2^53 | silently rounded | exact via `getString`; past int64 it errors |
| JSONC integer past 2^53 with no `JSON.parse` source access | silently rounded | `ConfigError` |
| `APP_FOO.BAR` (env) | nested as `foo` → `bar` | one key `"foo.bar"`; coexists with `APP_FOO__BAR` |
| env key case folding | full Unicode (`İ` → `i̇`) | ASCII-only (`İ` unchanged) |
| `__proto__`/`constructor`/`prototype` keys from properties, env, YAML, TOML | silently dropped | preserved, so `toObject()` output now contains them |
| Leading BOM | became part of the first key (properties) or a syntax error (JSONC/TOML) | stripped |
| `-0` from an adapter | `"0"` | `"-0"` |

The `__proto__` one deserves a second look if you hand `toObject()` output to
other code: `Object.assign({}, data)` and naive deep merges are unsafe with such
a key present (the hazard is the destination's prototype, not this library's
output). Use spread or `structuredClone`, or the new
`toObject({ nullPrototype: true })`. See SECURITY.md.

### Fixed — CJS entrypoints threw at load, then ESM `include package(...)` broke

- **`require('@o3co/ts.hocon')` (and all six other subpath exports) crashed with
  `ERR_INVALID_ARG_VALUE` in 1.10.0.** The include loader evaluated
  `createRequire(import.meta.url)` at module scope, and the CJS bundle shims
  `import.meta` to `{}`, so every `require()` of the package executed
  `createRequire(undefined)` before any user code ran.
- The first fix for that guarded on `typeof require === 'function'`, which
  **broke `include package(...)` in the ESM bundle**: esbuild rewrites a bare
  `require` in ESM output into a Proxy whose `typeof` is `"function"` but whose
  `.resolve` is `undefined`, so every package include failed with a misleading
  "module not found". The loader now probes for `.resolve` itself and falls back
  to `createRequire(import.meta.url)`, with a cwd anchor as a last resort. Both
  formats load *and* resolve package includes; verified against a packed
  tarball, not just the sources.
- **The smoke gate now uses each entrypoint, not just loads it** (`pnpm smoke`,
  `tools/smoke-entrypoints.mjs`): it resolves a real `include package(...)`
  through both bundles, parses a document with every adapter, and checks the
  declaration files each condition points at. It runs on PRs **and in the
  release workflow**, which previously published with no smoke step at all.

### Fixed — CJS TypeScript consumers could not compile (TS1479)

- **Every subpath pointed both module conditions at one `dist/*.d.ts`.** The
  package is `"type": "module"`, so TypeScript read those declarations as ESM and
  rejected `require()` imports from a `node16`/`nodenext` CJS project with
  TS1479 — the entrypoints loaded but did not typecheck. Each condition now has
  its own `types`, so `require` resolves the `.d.cts` files tsup was already
  emitting.

### Fixed — `toObject()` lost `__proto__` keys and let config data choose the result's prototype

- **A key literally named `__proto__` vanished from `toObject()` / `get()` /
  `getList()` output, and its value became the returned object's prototype.**
  The object conversion ended with `Object.assign({}, obj)`, which copies via
  `[[Set]]` and therefore triggers the `Object.prototype.__proto__` setter.
  Conversion now copies with `Object.fromEntries` (CreateDataProperty
  semantics): the key survives as an own data property, the result's prototype
  is always `Object.prototype`, and the global `Object.prototype` is never
  touched.

### Fixed — a large YAML `!!binary` scalar threw `RangeError`

- **A `!!binary` value around a megabyte or larger — an embedded certificate,
  key or image — crashed `parseYaml` with `RangeError: Maximum call stack size
  exceeded`** instead of parsing. The base64 conversion spread every byte into
  `String.fromCharCode` as its own argument; it now converts in chunks, with no
  size limit and no Node-only API.

### Fixed — env: a literal `.` in a variable name became a path boundary (F1.2)

- **`APP_FOO.BAR=v` nested as `foo` → `bar`, and collided with
  `APP_FOO__BAR`.** `__` is the only hierarchy boundary the env adapter has, so
  a dot in the name is key text: the variable now yields the single top-level
  key `foo.bar`, reachable as the quoted path `"foo.bar"`, and both spellings
  coexist rather than one of them being refused as an F1.6 collision. Paths
  travel as segment lists from the adapter into the nesting step, so nothing
  joins on `.` and re-splits along the way; `parseDotEnv` gets the same
  treatment, and `.properties` keys still split on `.` per F2.1.

### Fixed — properties/env silently dropped `__proto__`, `constructor` and `prototype` keys (F2.9)

- **A `.properties` file or environment variable whose key was one of those
  three lost that key entirely**, and the nesting step left the parent it had
  already created behind as an empty object. They are ordinary keys in a file
  another program owns, so dropping them is data loss. They are now preserved,
  and prototype-pollution safety comes from construction instead of a denylist:
  the nesting carrier is a null-prototype object, so these names define plain
  own properties, and `toObject()` emits them as own properties too. Nothing
  reaches `Object.prototype`.

### Fixed — JSONC and YAML silently rounded large integers (F0.5)

- **`9007199254740993` arrived as `9007199254740992`** from both adapters, even
  through `getString`, while the core parser preserves the literal's own text.
  Both decoded integers into JS `number`s, which is exactly what spec F0.5
  forbids. JSONC now reads the literal's source text through the `JSON.parse`
  reviver (standard since Node 22, this package's minimum) and YAML decodes with
  `intAsBigInt`, so an integer too wide for a double reaches the value model as
  a BigInt and keeps its digits. Integers **beyond int64 are now an error**
  (`9223372036854775808` is refused) rather than silently rounded; floats and
  safe integers are untouched. Getters still apply the JS number model — the
  ingest is what had to be lossless, and the core parser rounds the same
  literal identically.
- `fromMap` accepts a `bigint` up to the int64 bound accordingly, keeping its
  digits verbatim in the value's raw text; it previously refused anything past
  `Number.MAX_SAFE_INTEGER`.
- On a runtime **without** `JSON.parse` source access (not Node ≥ 22, but
  `parse()` is documented as browser-usable) JSONC now **refuses** a document
  containing such an integer instead of quietly returning the rounded double —
  falling back to `Number`-only decoding is the case F0.5 forbids. Documents
  with no oversized integer are unaffected.

### Fixed — a JSONC `//` comment ran past a CR, deleting keys with no error

- **`{"a":1,//c\r"b":2,\n"c":3}` parsed as `{"a":1,"c":3}`.** The line-comment
  scanner stopped only at LF, so a CR-terminated comment swallowed the rest of
  the line and the trailing-comma pass then tidied the remains into valid JSON —
  a key vanished and nothing complained. A `//` comment now ends at **LF or CR**
  (F3.2). Same shape as the bug in another HOCON library that motivated this
  project's implementation-preference rule, and py.hocon was found with it too.
- **U+2028/U+2029 deliberately do not end a comment.** They are line breaks to
  ECMAScript and to most editors, but `node-jsonc-parser` — which defines this
  dialect, and is what VS Code reads its own config with — recognizes only LF and
  CR, so a `//` comment runs through one to the next real break. Ending early
  would make the same file mean different things in the editor that owns the
  format and here. Line positions in `JSON.parse` errors also survive comment
  removal now: a removed span gives back the line breaks it contained, with CRLF
  emitted as the pair so it stays one break rather than two.

### Fixed — YAML and TOML dropped `__proto__` keys (F2.9's principle)

- **`[a.__proto__]` in TOML yielded `{"a":{}}`, and a `__proto__` mapping in
  YAML disappeared**, including through the public `fromYamlValue` injection
  point. Both libraries hand the key over correctly; the adapters lost it by
  building objects with `out[k] = …` on a `{}` carrier, which writes through
  `Object.prototype`'s setter — the same defect already fixed in `toObject()`.
  Both now materialize objects with own-property definition.

### Fixed — a leading BOM corrupted the first key or broke the parse (F0.9)

- **A Windows editor's UTF-8 BOM made `.properties` produce the key `"\ufeffa"`**
  — a lookup of `a` then missed and the value was silently unreachable — while
  JSONC and TOML failed with confusing syntax errors. Every adapter now strips a
  leading U+FEFF (the core parser already did). A U+FEFF anywhere else is data
  and is left alone.

### Changed — env keys fold case ASCII-only (F1.3)

- **`APP_İ` (U+0130) mapped to `i` + U+0307** under JS's full Unicode
  lowercasing, while Go's simple mapping produces plain `i` — which decides
  whether it collides with `APP_I` under F1.6. Case folding is now ASCII-only in
  every implementation, so `İ` stays itself. Environment variable names are
  ASCII in practice.

### Added — `toObject({ nullPrototype: true })`

- Returns the same data with `null`-prototype objects, for handing config to
  code you do not control. It inherits nothing, so `x.constructor` and
  `x.__proto__` read config data or `undefined` rather than something global.
  It cannot fix a consumer that copies into a plain `{}` — that hazard belongs
  to the destination object. See SECURITY.md.

### Fixed — `-0` from an adapter lost its sign

- `{"z": -0}` read back as `"0"` while the core parser keeps `"-0"` for the same
  literal. Negative zero is a real IEEE-754 value and is no longer normalized
  away on the way in.

### Fixed — a JSONC block comment could weld two tokens into one

- **`parseJsonc('{"a":1/*x*/2}')` silently parsed as `{"a":12}`.** The comment
  stripper replaced a block comment with only the newlines it contained, so a
  comment with none was replaced by the empty string and the tokens around it
  fused. Per spec F3.2 a comment is now replaced by whitespace — its contained
  newlines (preserving line positions in errors), or a single space when it
  has none — so the halves stay separate tokens and the JSON decode rejects
  them.

## [1.10.0] - 2026-07-25

### Added — format adapters for config owned by other programs

- **Properties, env, JSONC, TOML and YAML can now be mounted under a HOCON
  document**, so a `${...}` can reach into a file another program maintains.
  Five subpath exports — `@o3co/ts.hocon/adapters/{properties,env,jsonc,toml,yaml}` —
  following the shape `./zod` already established here. `dependencies` stays
  empty: `smol-toml` and `yaml` are declared as **optional peer dependencies**,
  and the other three adapters need none. Plain JSON needs no adapter, HOCON
  being a JSON superset.
- Ingestion is AST-level — a document is decoded and built into a value tree via
  `fromMap`, never rendered to HOCON text. A `${a.b}` in a mounted value stays
  literal, the foreign file never having agreed to HOCON's syntax. Parse the host
  document with `resolveSubstitutions: false` before attaching the fallback.
- **YAML scalar resolution is the library's answer, not a guarantee here.** The
  adapter declares `version: '1.2'` rather than trusting a default (the same
  library returns `8` for `010` under 1.1 and `10` under 1.2), and `fromYamlValue`
  takes an already-decoded tree so a caller can supply a different library or
  schema. `yaml` (eemeli) is the packaged default; `js-yaml` was measured and set
  aside, its v5 throwing on `!!binary` and not merging `<<`.

### Fixed — `.properties` now accepts the whole java.util.Properties syntax (S23.5, S23.6)

- **Backslash continuations, escapes, and whitespace separators in a
  `.properties` file were mishandled**, and a continued line was dropped silently.
  `parseProperties` had implemented roughly the `key=value`-with-comments subset;
  `b\:c = 2` produced the key `b\` with value `c = 2`, `d = x\ty` stayed literal,
  and `a = one\` continued by `two` lost the second line. S23.5/S23.6 were
  out-of-scope until [xx.hocon#73](https://github.com/o3co/xx.hocon/pull/73)
  brought them in.
- **Behavior change**: a value keeps its trailing whitespace, because Java skips
  whitespace before a value and never after it (`key = value  ` → `"value  "`).
- A `\uXXXX` becomes one UTF-16 code unit, so a surrogate pair forms its astral
  character and a lone surrogate survives — matching Java. A malformed escape
  throws `ParseError`. The syntax layer is shared with `adapters/properties`, so
  the include path and the adapter cannot drift.

### Fixed — empty path segments rejected in key position (S11.7, [xx.hocon#68](https://github.com/o3co/xx.hocon/issues/68))

- **`a..b: 3`, `.a: 3`, `a...c: 4`, `o { a..b: 3 }` and `a...c."": 4` now throw
  `ParseError` instead of silently collapsing the empty elements** (they previously
  parsed to `{"a":{"b":3}}`, `{"a":3}`, `{"a":{"c":4}}`, … ). HOCON.md L515-519: "If a
  path element is an empty string, it must always be quoted … But `a..b` is invalid and
  should generate an error. Following the same rule, a path that starts or ends with a
  `.` is invalid and should generate an error." The substitution-path parser
  (`parseSubstBody`) enforced this from the start; the key-path parser
  (`parser.ts:parseKey`) dropped empty pieces with `parts.filter(s => s.length > 0)`
  after splitting an unquoted key token at `.`. Empty pieces are now rejected except the
  two that are not empty segments: a trailing piece (the dot-continuation separator,
  still caught by the existing trailing-dot check) and a leading piece when the dot is a
  separator after an already-complete segment (the E13 path-whitespace forms `a .b`,
  `a . b`, `a. .b` — unchanged). Quoted empty segments stay legal, so `a."".b: 3` →
  `{"a":{"":{"b":3}}}` per S11.6. Pinned by `tests/issue68-path-empty-segment.test.ts`
  and the xx.hocon `path-empty-segment/pe01–pe08` fixtures.

### Fixed — backtick rejected in unquoted strings (S8.1, [xx.hocon#68](https://github.com/o3co/xx.hocon/issues/68))

- **`` a = `t` ``, `` `k` = 1 `` and `` a = x`y `` now throw `ParseError`** instead of
  producing the strings `` "`t`" `` / `` "x`y" `` and the key `` "`k`" ``. HOCON.md
  L245-247 lists `` $ " { } [ ] : = , + # ` ^ ? ! @ * & \ `` as the forbidden set for
  unquoted strings; backtick was the only member `isUnquotedStart` /
  `isUnquotedContinue` in `src/internal/lexer/lexer.ts` did not exclude. Backtick inside
  a quoted string remains ordinary content (`a = "x\`y"` → `{"a":"x\`y"}`), and
  parentheses are still accepted — they are deliberately not in the forbidden set
  (xx.hocon#34). Flips the S8.1 compliance cell ⚠️ → ✅. Pinned by
  `tests/issue68-path-empty-segment.test.ts` and the xx.hocon
  `unquoted-forbidden/uf01–uf04` fixtures.

## [1.9.0] - 2026-07-23

Cross-impl release coordinated to land at v1.9.0 across ts.hocon / go.hocon / rs.hocon / py.hocon. Covers the two same-day spec corrections from [xx.hocon#62](https://github.com/o3co/xx.hocon/pull/62) (S3.1 — empty document parses to `{}`) and [xx.hocon#64](https://github.com/o3co/xx.hocon/pull/64) (S3.5 — array-root document rejected with a type error), plus the S19.8 case-sensitive duration units breaking change (queued since the previous cycle, shipped here). MINOR (not PATCH) because sibling impls add public API surface in the same coordinated cycle (rs `HoconError::Config` variant, go `ResolveError.Cause`/`Unwrap`) and the error-taxonomy / empty-document behavior changes are consumer-observable. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Fixed — array-root document rejected with a type error (S3.5, [xx.hocon#64](https://github.com/o3co/xx.hocon/pull/64))

- **`parse("[1,2]")` now throws `ConfigError` ("document has type array rather than
  object at file root", HOCON.md L989-991) instead of `ParseError` "expected key, got
  lbracket".** An array-root document is syntactically valid HOCON ("both JSON and
  HOCON allow arrays as root values in a document"); the reference implementation
  parses it and rejects at the Config boundary (`Parseable.forceParsedToObject`,
  `ConfigException.WrongType`). The parser now accepts `[` at root and parses the
  array value — malformed arrays (`[1,2`) and trailing content after the root array
  remain `ParseError`s — and `buildResolveContext()` rejects the array-root AST with
  the type error. Include paths (file + package, sync + async) raise `ResolveError`
  "included file has array at file root … (HOCON.md L993-994)" naming the included
  source, improving the S14b.1 diagnostic (previously the generic parser error).
  Net behavior is unchanged (array-root documents still error) — only the error class,
  layer, and message change. Pinned by `tests/spec-s3-5-array-root.test.ts` and
  `tests/conformance/array-root.test.ts` (xx.hocon `array-root/ar01–ar03` `.error`
  sidecars).

### Fixed — empty document parses to `{}` (S3.1 corrected, [xx.hocon#62](https://github.com/o3co/xx.hocon/pull/62))

- **`parse("")` (and whitespace-only / comment-only / BOM-only input) returns an empty
  `Config` instead of throwing `ParseError`.** The S3.1 checklist item "Empty file is
  invalid (HOCON.md L130)" misread the L130-132 *JSON baseline* as HOCON-normative; the
  L134-136 brace-omission relaxation parses any document not beginning with `[` or `{`
  as if enclosed in `{}` — an empty document is therefore the empty object. Confirmed by
  the reference implementation (Lightbend's `"Empty document"` error is
  `ConfigSyntax.JSON`-only; `ConfigFactory.parseString("")` is a valid empty config in
  its own test suite). Restores pre-1.3.0 behavior — the Phase 6 #3h
  `assertNonEmptyDocument` guard was a regression (`src/internal/parser/empty-check.ts`
  removed). The rule now applies uniformly: top-level parse, file includes (the former
  go.hocon#105 carve-out is simply the rule), and package includes (whitespace-only /
  comment-only registered content now contributes `{}` like zero-byte content — the
  zero-byte-only asymmetry is gone). Pure loosening — no previously-valid input changes
  meaning; previously-rejected empty documents now succeed. Pinned by
  `tests/spec-s3-1-empty-file.test.ts`, `tests/spec-s3-1-empty-include.test.ts`,
  `tests/conformance/empty-file.test.ts` (ef01–ef06 `{}` sidecars now normative,
  per-impl override removed), and ipk08 whitespace/comment variants.

### Changed — **BREAKING**: duration unit names are case-sensitive (S19.8, HOCON.md L1304)

- **`getDuration` now rejects non-lowercase duration units** per HOCON.md L1304 ("The
  supported unit strings for duration are case sensitive and must be lowercase").
  Previously `parseDuration` lowercased the unit before lookup, so `"5 MS"`,
  `"5 Seconds"`, `"5 DAYS"` were wrongly accepted; they now throw `ConfigError`.
  Lowercase units (`ms`, `seconds`, …) are unaffected. Aligns with go.hocon (already
  compliant) and rs.hocon's equivalent fix in the same cross-impl cycle. Flips the
  S19.8 compliance cell ❌ → ✅.

## [1.8.0] - 2026-06-16

### Added — value introspection: `Config.getValue` + `HoconValue` accessors (1.8)

Cross-impl coordinated MINOR (1.8) responsibility "value → type for any node" + value introspection, ported to the ts idiom (rs.hocon [#140](https://github.com/o3co/rs.hocon/pull/140) / go.hocon [#150](https://github.com/o3co/go.hocon/pull/150) merged). ts already satisfied "value → type" via `getValidated` (zod); this release fills the introspection gap — the public `HoconValue` union previously had no retrieval handle and no accessors.

- **`Config.getValue(path): ReadonlyHoconValue | undefined`** — returns the raw value node at `path` for structural introspection, where `get` decodes to a plain JS value. Missing path → `undefined`; unresolved node or subtree → `NotResolvedError` (the `HoconValue` union has no placeholder variant, so an unresolved value cannot be represented — same stance as `getConfig` / `getList`). `getValue('')` returns the root object node.
- **Value accessor functions** (exported from the package root) — `asString` (strict: scalar/string only), `asNumber` and `asBoolean` (scalar coerced via the same `coerceNumber` / `coerceBoolean` as the typed getters), `asObject`, `asArray`, and the type guards `isObject` / `isArray` / `isScalar` plus `isNull`. They mirror rs.hocon's `HoconValue::as_* / is_*`; `asNumber` unifies rs's `as_i64` + `as_f64` because TS has a single `number` type.
- **`ReadonlyHoconValue`** — a new exported, deeply-immutable view of `HoconValue` (`ReadonlyMap` / `readonly[]` recursively). `getValue` returns live nodes (not clones) typed as this, so callers cannot mutate the parsed tree; `HoconValue` remains assignable to it, so the accessors accept both forms. Integer-coercion parity (rs/go's non-whole-float reject) is N/A — TS `number` is float64 and int-ness is zod's concern (`z.number().int()`). No breaking changes; additive public API. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

## [1.7.1] - 2026-06-14

Cross-impl coordinated patch release (v1.7.1 across go.hocon / ts.hocon / rs.hocon). **No functional changes in ts.hocon.** The substantive change in this patch is rs.hocon's false-positive `circular substitution` fix ([rs.hocon#136](https://github.com/o3co/rs.hocon/pull/136)); ts.hocon was unaffected — it already resolves the same self-ref-below-merge shapes (verified in the cross-impl audit) — so this release carries no ts-side change and exists for cross-impl version parity (precedent: v1.7.0's coordinated sync). No public API changes; safe drop-in upgrade from v1.7.0. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

## [1.7.0] - 2026-05-30

Cross-impl release coordinated to land at v1.7.0 across go.hocon / ts.hocon / rs.hocon. The minor bump is driven by go.hocon's new `GetXxxE` accessor family ([go.hocon#142](https://github.com/o3co/go.hocon/issues/142), additive public API); ts.hocon's content for this cycle is the cross-impl leading-zero JSON-render validity fix ([xx.hocon#50](https://github.com/o3co/xx.hocon/issues/50), byte-aligned with go.hocon's equivalent fix) — no new ts-side public API, but the version syncs with go/rs per project convention. No breaking changes; safe drop-in upgrade from v1.6.1. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Fixed — leading-zero numeric values render as valid canonical JSON ([xx.hocon#50](https://github.com/o3co/xx.hocon/issues/50))

- **Leading-zero numeric *value* literals now render as canonical JSON numbers** (Lightbend / rs.hocon parity). `renderHoconAsJSON` emitted numeric-value lexemes verbatim, so `b = 023` / `c = 08.53` produced `{"b":023,"c":08.53}` — not valid JSON, and divergent from Lightbend/rs (which emit `23` / `8.53`). The renderer now strips redundant leading zeros from the integer part of a number lexeme before emitting (`023`→`23`, `-08.53`→`-8.53`, `007`→`7`; `0`, `0.5`, `1.0` unchanged), matching the xx.hocon `lzv01` cross-impl fixture and byte-identical to go.hocon's equivalent fix. Render-only: `getString`/concat still return the verbatim source lexeme (S10.11), so `getString('0100')` is unchanged. The broader numeric-canonical family (exponent `1e3`→`1000.0`, trailing-zero `1.50`→`1.5`, `-0`→`0`) is a separate, untested convergence tracked as a follow-up. No public API change. Pinned by `tests/deferred-resolution.test.ts`.

## [1.6.1] - 2026-05-29

Bugfix release: S13b.2 `+=` accumulation across includes ([go.hocon#134](https://github.com/o3co/go.hocon/issues/134)) — the follow-up deferred from v1.6.0. No public API changes; safe drop-in upgrade from v1.6.0. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Fixed — S13b.2 `+=` accumulation across includes ([go.hocon#134](https://github.com/o3co/go.hocon/issues/134))

- **Repeated `+=` array appends across included files now accumulate in document order**, matching Lightbend's treat-includes-as-textual-inlining semantics (HOCON.md L732, `a += b` ≡ `a = ${?a} [b]`). `include "first" (items += "a"); include "second" (items += "b"); items += "main"` now yields `["a", "b", "main"]` instead of dropping earlier includes' elements. `+=` was an eager-snapshot `AppendPlaceholder` whose `existing` was captured in each included file's isolated scope, so the cross-include merge overwrote it. The fix desugars `+=` to the fully-qualified `${?key} [b]` self-ref concat at structure-build time (`StructureBuilder.desugarAppend`), so it flows through the chained-self-ref machinery (#131/#120). `deepMergeResObjInto` now splices the destination's pre-merge value into the included chain's `knownAbsent` bottom (`foldKnownAbsentSelfRef`), and reset semantics (an explicit `k = [...]` before a `k +=`, in an included file or the parent) are tracked via a new `ResObj.resetKeys` origin flag — distinguishing a reset from a *within-file `+=` chain* (which also records a prior). The eager `AppendPlaceholder` variant and `resolveAppend` are removed. The same fold discipline is applied in `mergeUnresolved` (the E12 `withFallback` path) so a deferred `withFallback` whose fallback uses `+=` accumulates correctly (`parseStringWithOptions('items += "r"', deferred).withFallback(parseStringWithOptions('items += "f"', deferred)).resolve()` → `['f','r']`) instead of throwing a stack overflow. No public API change. Pinned by 15 tests in `tests/issue134-plus-equals-include.test.ts`, including within-file `+=` chains inside a later include merged onto a non-empty destination, multi-write includes, nested-path, prefix-mounted includes, the deferred `withFallback` + `+=` case, and `+= [array]` single-element nesting / degenerate self-ref.

## [1.6.0] - 2026-05-27

Cross-impl release coordinated to land at v1.6.0 across go.hocon / ts.hocon / rs.hocon. Covers: E6 cross-source list-suffix env-fallback ordering ([xx.hocon#22](https://github.com/o3co/xx.hocon/issues/22) C4), C3 cluster 3h cross-impl resolver bugs ([xx.hocon#27](https://github.com/o3co/xx.hocon/issues/27) — E14, sr13–sr16), E13 key-position parsing alignment ([xx.hocon#42](https://github.com/o3co/xx.hocon/issues/42)), cross-impl regression coverage for [go.hocon#128](https://github.com/o3co/go.hocon/issues/128) include-child env-with-default (ts.hocon is structurally immune — these tests pin the invariant), and the S10.5 string-concat whitespace fix ([go.hocon#132](https://github.com/o3co/go.hocon/issues/132)) from the go.hocon#131–#135 audit. (go.hocon#134 — `+=` accumulation across includes — also applies to ts.hocon but is deferred to a follow-up: the correct fix is a resolver-chain change that needs the multi-agent-review treatment the chained-self-ref machinery already required. go.hocon#133 numeric-lexeme is N/A — ts.hocon already preserves the lexeme.) No public API changes; safe drop-in upgrade from v1.5.2. The release line skips v1.5.3 for ts.hocon to align all three impls at v1.6.0. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Fixed — S10.5 inner whitespace in value concatenation ([go.hocon#132](https://github.com/o3co/go.hocon/issues/132))

- **Literal whitespace runs between simple values in a string concatenation are now preserved verbatim** (HOCON.md §String value concatenation L332). `parseValue` inserted a single hardcoded `' '` separator between concat pieces, collapsing every multi-space run to one space (`foo   bar` → `"foo bar"`, and `"left"  ${?UNSET}  "right"` → `"left  right"` instead of Lightbend's `"left    right"`). The fix threads `t.precedingWhitespace` (the lexer field E13 already added for key-position whitespace) into the value-position separator. Single-space concatenations are unchanged. One incidental side effect: a lone CR (`0x0D`, not a newline per S6.5) between simple values is now preserved verbatim rather than collapsed to a space — impl-lenient behaviour with no Lightbend ground truth (Lightbend rejects `x = 1\ry = 2`), cross-impl consistent with rs.hocon. Pinned by 6 tests in `tests/s10-5-concat-whitespace.test.ts`.

### Fixed — E6 cross-source list-suffix env-fallback ordering ([xx.hocon#22](https://github.com/o3co/xx.hocon/issues/22) C4)

- **`${X}` / `${X[]}` in an included file now consults the original config path before any env-var fallback** ([xx.hocon#22](https://github.com/o3co/xx.hocon/issues/22) C4). Port of rs.hocon `substitution_resolver.rs:443–493` into ts.hocon's `SubstitutionResolver.resolveSubst`: after the primary `lookupPath` branch and before the listSuffix / scalar-env branches, fall back to `lookupPath(this.root, segments[prefixLen..])` so a substitution inside an included file (relativized to `${prefix.X}`) still sees `X` defined at the parent's root, matching Lightbend 1.4.6 `ResolveSource.java:100–130` order: primary → S14c.2 → listSuffix → scalar-env. Includes a delayed-merge mirror guard so the original-path fallback does not race with structure-build-time merge fixup (cluster spec §8 + rs.hocon#44). S13c.5 invariant preserved: ev12a (required `${X[]}` with no `_0` env) still throws `ResolveError`. ev12c-include-config-defined-wins added to the env-var-list success suite as the cross-source pin.

### Fixed — C3 cluster 3h cross-impl resolver bugs ([xx.hocon#27](https://github.com/o3co/xx.hocon/issues/27) — E14, sr13–sr16)

- **sr15 — universal "drop first concat" cross-impl resolver bug** ([xx.hocon#27](https://github.com/o3co/xx.hocon/issues/27)). Optional self-references with no prior value at save time previously caused `foldOrSkipPrior` to skip the prior-save, so the first concat in chains like `a = ${?a} [...]; a = ${?a} [...]` dropped its element. Fix introduces a `SubstPlaceholder.knownAbsent` sentinel — optional no-prior self-refs fold to the sentinel rather than skipping the save. The sentinel resolves to undefined in `resolveSubst` and is ignored by pointer-identity self-ref detection. Container-aware via the existing concat/array/object recursion.
- **sr13 — post-fold overwrite regression**. Adjacent to the sr15 fix, the prior is now saved BEFORE `foldNestedSelfRefs`, and the structure-builder gate that previously suppressed the fold when `existing` was a plain ResObj is removed (always fold when existing is ResObj). Pinned by 20 new unit tests in `tests/fold-self-ref-unit.test.ts` covering all `foldOptionalSelfRefAbsent` branches (Append / ResObj / HoconArray / HoconObject / fallback).
- **sr14 / sr16 — cache pollution on prior-with-external-ref / order-dependent external-then-self-ref**. `resolveResObj` now invalidates the cache before resolving each field, writes the authoritative resolved value after, and recursively caches descendants. Combined with the round-2 Codex P1 fix to `shouldFoldNested` gate (`o.a="x"; o.a=${?o.a}bar; o=${?o}` repro) and the `stringSegmentsToKey` escape for `resolvingFieldPath` join (dotted-key cache collision), the four bugs are fixed under a single shared shape.

### Changed — E13 key-position parsing (xx.hocon [#42](https://github.com/o3co/xx.hocon/issues/42))

- **S8.6 is no longer enforced on key path segments** — `foo -bar = 1`, `foo.-bar = 1`, `-foo bar = 1`, `foo -1bar = 1` etc. now parse verbatim per Lightbend 1.4.3. The HOCON.md L270-276 "begin with `-` requires digit" rule is a value-position lexer-disambiguation rule (governed by E8 in [xx.hocon extra-spec-conventions](https://github.com/o3co/xx.hocon/blob/main/docs/extra-spec-conventions.md)); key-position is governed by path-element parsing rules where Lightbend takes characters verbatim. Pinned by 8 new fixtures (`key-hyphen-position/kh01–kh08`) in xx.hocon main. Pure loosening — no previously-valid input is now rejected.
- **Path-expression whitespace adjacent to dots is preserved verbatim** — `a b. c = 1` → `{"a b":{" c":1}}` (leading space on `" c"` preserved); `a b.\tc = 1` → `{"a b":{"\tc":1}}` (HOCON_WS tab uniformly preserved); `a .b = 1` → `{"a ":{"b":1}}` (trailing space on `"a "` preserved). Per Lightbend's char-by-char path parsing. Pinned by 6 new fixtures (`path-expr-whitespace/pw01–pw05, pw07`) + 1 error fixture (`pw06: a b. = 1` → BadPath, loosening does NOT cascade into empty path segments). See [xx.hocon E13](https://github.com/o3co/xx.hocon/blob/main/docs/extra-spec-conventions.md#e13).
- **Behavior change — key string normalisation no longer fires for path-WS-adjacent-to-dot inputs**. Inputs like `a .b = X` previously produced path `["a", "b"]`; now produce `["a ", "b"]`. Inputs that worked via `cfg.getString("a.b")` lookup (after the path key was implicitly trimmed) will need to use the literal key `"a b"` or `"a "` if they were relying on the prior trimming. Also: tab between key tokens is now preserved (was normalised to single ASCII space) — `a\tb = 1` now yields key `["a\tb"]` instead of `["a b"]`. Narrow set of affected inputs.
- **Bundled fix — trailing-dot key paths now consistently reject**. `foo. = 1`, `a.b. = 1`, `a b. = 1`, and `a. . = 1` now throw `ParseError` ("path has a trailing period — empty key segment not allowed"). Pre-E13 these silently parsed to the prefix segments (e.g. `foo. = 1` → `{"foo":1}`). Aligned with Lightbend BadPath and E13 boundary fixture `pw06`. Leading-dot (`.foo = 1`) and double-dot (`a..b = 1`) in key paths are NOT addressed in this PR (pre-existing silent-accept gap, no xx.hocon fixture yet — tracked as a follow-up).
- **Bundled fix — dot-WS-dot in key paths produces a WS segment per Lightbend**. `a. .b = 1` now yields `["a", " ", "b"]` (was `["a", " b"]` from the initial E13 patch; Lightbend probe confirms `{"a":{" ":{"b":1}}}`). Caught by Codex multi-agent-review on this PR.

#### Implementation

- **Lexer**: `Token.precedingWhitespace: string` field added (the literal whitespace chars consumed since the previous token). `Token.precedingSpace: boolean` retained for clarity at call sites. The two fields are related but **not** equivalent: comments set `hadSpace=true` without contributing chars to the whitespace buffer, so the `newline` token emitted immediately after a `// foo\n` or `# foo\n` comment carries `precedingSpace=true` while `precedingWhitespace=""`. `precedingSpace` is the right signal for concat detection (S10.5 / S10.8); `precedingWhitespace` is the right signal for path-WS preservation (E13). See `src/internal/lexer/token.ts` for the full rationale.
- **Parser `parseKey`**: S8.6-in-key check removed; literal `' '` joiner in space-concat replaced with `t.precedingWhitespace`; post-trailing-dot iteration captures next token's `precedingWhitespace` as `postDotPrefix` and prepends to next segment; post-loop guard rejects trailing-dot-before-separator (matches Lightbend BadPath behavior).

### Tests — cross-impl regression coverage for [go.hocon#128](https://github.com/o3co/go.hocon/issues/128)

- **Pin include-child `${?ENV}` env-with-default semantics so a future refactor to a multi-pass shape can't silently regress to go.hocon's pre-fix shape** ([go.hocon#128](https://github.com/o3co/go.hocon/issues/128) — fixed in go.hocon v1.5.3 / [go.hocon#129](https://github.com/o3co/go.hocon/pull/129)). 5 new tests in `tests/issue128-include-env-fallback.test.ts`: include "file" env-unset / env-set, include package(...) env-unset / env-set, deferred-resolve path env-unset. Env is injected via `ParseOptions.env` (no `process.env` mutation) per the cross-impl hermeticity convention. ts.hocon's single-pass substitution-resolve over a merge-time-populated `priorValues` (via `deepMergeResObjInto`) is structurally immune to the go.hocon bug, but the tests pin that invariant.

## [1.5.2] - 2026-05-23

Cross-impl chained / value-interior self-referential substitution fix — version aligned with [go.hocon v1.5.2](https://github.com/o3co/go.hocon/releases/tag/v1.5.2) and [rs.hocon v1.5.2](https://github.com/o3co/rs.hocon/releases/tag/v1.5.2), which all cover the same two bug classes (#118 + #120). No public API changes; safe drop-in upgrade from v1.5.0. (v1.5.1 was skipped to match the go.hocon version where the same fix scope landed.) `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Fixed — chained / value-interior self-referential substitution

- **Chained self-referential append and value-interior self-references no longer crash or produce wrong values** ([#131](https://github.com/o3co/ts.hocon/issues/131); cross-impl with [go.hocon#118](https://github.com/o3co/go.hocon/issues/118) and [go.hocon#120](https://github.com/o3co/go.hocon/issues/120) fixed in go.hocon v1.5.1 / v1.5.2, and [rs.hocon#119](https://github.com/o3co/rs.hocon/issues/119) fixed in rs.hocon v1.5.2). Patterns: chained `${a}` substitution append (`a = ${a} [...]` × N, direct or via includes); array-element / object-field-value self-references (`a = [${a}, "x"]` × N, `o = { history = ${o}, v = 2 }`, even at chain length 2); multi-segment chain (`r.x = ${r.x} [...]` × N, including length ≥ 4); nested-object scoped self-references (`r { x = ${r.x} [...] }`); include-merge object form (parent `o = { v = 1 }`, included `o = { history = ${o}, v = 2 }`); nested include-merge under an object (parent `r { s = { v = 1 } }`, included `s = { history = ${s}, v = 2 }`). The fix introduces a new `fold-self-ref` module (`containsSelfRef` / `foldSelfRef` / `foldOrSkipPrior` / `foldNestedSelfRefs` / `containsSubstByPath` / `cloneResolverValue`) covering all six wrapping shapes (`SubstPlaceholder` / `ConcatPlaceholder` / `AppendPlaceholder` / HoconValue array / HoconValue object / `ResObj`); widens `resolveSubst`'s self-ref detection from the strict `isConcat(found) && resolvingConcats.has(found)` outer guard to also fire for `isOwner && containsSubstByPath(found, target)` so value-interior shapes (array / object / ResObj) are detected; adds a `resolvingFieldPath` stack to provide the `isOwner` prefix-match gate (cross-impl with rs.hocon's `resolving_field_path`); applies a `foldNestedSelfRefs` pre-pass + `foldOrSkipPrior` at `structure-builder::applyField` and `deepMergeResObjInto`'s both-objects branch so the recorded `priorValues` is always self-ref-free across all save sites. `deepMergeResObjInto` takes a `pathPrefix` argument so the fold checks the full dotted key — without this, the synthetic-object path used for dotted-form chain (`r.x = ${r.x} [...]`) saved an inner prior with bare key `x` that did not match the full-key `${r.x}` self-ref, breaking induction at chain length ≥ 4. The "no self-ref" save case in `foldOrSkipPrior` returns a deep clone (`cloneResolverValue`) so subsequent in-place mutation by `deepMergeResObjInto` does not leak into the saved prior (this differs from rs.hocon where `prior.clone()` is implicit via Rust's derived `Clone`). Reported by post-release audit of go.hocon v1.5.0 (cgordon-driven cross-impl check).

## [1.5.0] - 2026-05-23

Cross-impl spec-compliance release with [go.hocon v1.5.0](https://github.com/o3co/go.hocon/releases/tag/v1.5.0) and [rs.hocon v1.5.0](https://github.com/o3co/rs.hocon/releases/tag/v1.5.0). Two spec-compliance bugfixes ([#88](https://github.com/o3co/ts.hocon/issues/88) S17.6 null-typed `getString`, [#81](https://github.com/o3co/ts.hocon/issues/81) S13b.2 `+=` on non-array prior), one parser fix ([#76](https://github.com/o3co/ts.hocon/issues/76) S10.8 unquoted space-concat in keys), and resolver include-relativization coverage hardening ([#49](https://github.com/o3co/ts.hocon/issues/49): 37 new tests, 5 source files moved to 87–100% statement coverage). No public API changes; safe drop-in upgrade from v1.4.1. `package.json` stays at `"0.0.0-snapshot"`; the release workflow bumps from the tag.

### Tests

- **Improved resolver coverage for include relativization paths** ([#49](https://github.com/o3co/ts.hocon/issues/49)). Added 37 focused tests in `tests/resolver-include-cov.test.ts` targeting uncovered lines reported by codecov/patch on PR #47. Coverage deltas on the targeted files (before → after):
  - `include-loader.ts`: 70% → 87% stmts — new tests cover `loadPackageAsync` (lines 305–344: async package include load, circular detection, depth limit, empty-content carve-out, async readFile branch), `loadAsync` no-extension probing (lines 240, 245: foundAny flag and required-missing throw), `loadSingleAsync` empty-content carve-out (line 412), and `load()` explicit-extension circular detection (line 172).
  - `structure-builder.ts`: 87% → 92% stmts — covers `relativizeSubstPaths` `isAppend` branch (lines 247–249: `+=` inside nested include) and HoconValue array branch (lines 259–260: array with substitution items inside nested include).
  - `substitution-resolver.ts`: 96% → 100% stmts — covers `listSuffix + useSystemEnvironment=false` paths (lines 286–288: optional/allowUnresolved/required branches) and `nonSep.length === 0` in `resolveConcat` (lines 399–402: all-separator resolved list).
  - `types.ts`: 97% → 100% stmts — covers `mergeUnresolved` fallback `priorValues` carry-through (line 152).
  - `utils.ts`: 91% → 100% stmts — covers `lookupPath` returning `undefined` for non-ResObj intermediate segment (line 30).
  - Intentionally uncovered: `defaultPackageResolver` function body (lines 94–140) and its lambda wrappers (lines 276, 323) — these require a real `npm`/Node `require.resolve` environment and cannot be exercised with mock I/O.

### Fixed — S10.8 spec compliance

- **Unquoted space-concat in field keys now accepted as a single key** ([#76](https://github.com/o3co/ts.hocon/issues/76)). Per HOCON spec L317 ("string value concatenation is allowed in field keys") and L553-560 (`a b c : 42` is equivalent to `"a b c" : 42`), space-separated unquoted tokens before the `:`/`=`/`{`/`+=` separator must merge into a single key. Previously `foo bar = 1` errored with `unexpected token after key: unquoted`; now it parses as key `["foo bar"]`. The fix extends `parseKey` in `src/internal/parser/parser.ts` with a space-concat continuation branch: when the next key token has `precedingSpace`, it merges into the LAST existing segment with a literal space (so `a.b c = 1` → `["a", "b c"]` and `a b.c = 1` → `["a b", "c"]`). Quoted+unquoted mixed concat (`"foo bar" baz = 1` → `["foo bar baz"]`) and inline-object shorthand (`a b { x = 1 }`) work transitively. A leading `.` in the spaced-in token still acts as a path separator per S11.1, not a literal: `a .b = 1` → `["a", "b"]` and `a.b .c = 1` → `["a", "b", "c"]` (the leading dot is NOT folded into the previous segment).

### Fixed — S17.6 spec compliance

- **`getString()` on a null-typed scalar now throws `ConfigError` instead of returning `"null"`** ([#88](https://github.com/o3co/ts.hocon/issues/88)). Per HOCON spec L1252, asking for a non-null type when the value is null must be an error. The other typed getters (`getNumber`, `getBoolean`, `getDuration`, …) already rejected null via their coerce/check paths; `getString` was the lone exception. A null-type guard is added in `getString` for parity.

### Fixed — S13b.2 spec compliance

- **`+=` on a non-array prior value now errors instead of silently wrapping** ([#81](https://github.com/o3co/ts.hocon/issues/81)). Per HOCON spec L732, `a += b` is sugar for `a = ${?a} [b]`; when the prior value of `a` is not an array, this must produce a resolve-time error. Previously the resolver silently wrapped the non-array as a single-element array (`x = 1; x += 3` produced `[1, 3]`; now errors). The fix throws `ResolveError` in `resolveAppend` when the prior value is a scalar or a non-numeric-keyed object. Numeric-keyed objects continue to succeed via S15.3 (`numericObjectToArray`), matching the long-form `${?a} [b]` desugaring.

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
