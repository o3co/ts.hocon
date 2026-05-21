> **Project-local copy** of the cross-impl E12 design spec. Canonical source:
> `.claude/superpowers/specs/2026-05-21-e12-deferred-resolution-design.md`
> in the hocon scope (not part of this repo). Spec reference:
> [xx.hocon `docs/extra-spec-conventions.md` § E12](https://github.com/o3co/xx.hocon/blob/main/docs/extra-spec-conventions.md#e12).

# E12 — Deferred substitution resolution (parse / merge / resolve lifecycle)

**Date**: 2026-05-21
**Phase**: E-series (extra-spec conventions)
**Target item**: E12 (new, will be appended to `docs/extra-spec-conventions.md` after E11)
**External request**: [o3co/go.hocon#99](https://github.com/o3co/go.hocon/issues/99) (cgordon)
**Tracking**: xx.hocon#TBD (to be filed after ★1)

---

## Summary

Expose Lightbend's `parse / withFallback / resolve` lifecycle as a public API in all three impls. Currently `ParseString`/`ParseFile` parse-and-resolve in a single step, which prevents callers from composing fallback layers before resolution and forces ugly workarounds (synthetic HOCON injection, env mutation, pre-serialised fallback layers).

The internal pipeline in all three impls is **already two-phase** (parse → unresolved tree → resolve to value tree). This spec only exposes the existing seam — no resolution-engine redesign is required.

---

## Motivation

### Current behaviour (all three impls)

`ParseString` / `parseString` / `parse` invokes parse and substitution resolution in one shot. A HOCON like:

```hocon
version = ${shortversion}-${CI_RUN_NUMBER}
variables { shortversion = "1.2.3" }
```

fails at parse time if `CI_RUN_NUMBER` is not in `os.Environ` / `process.env` / `std::env`, even when the caller wants to supply `CI_RUN_NUMBER` from a programmatic fallback layer after parsing.

### Lightbend reference behaviour

In `com.typesafe.config`:

- `ConfigFactory.parseString(str)` returns an **unresolved** `Config` by default.
- `Config.withFallback(ConfigMergeable other)` composes configs (receiver wins).
- `Config.resolve()` / `resolve(ConfigResolveOptions)` resolves substitutions explicitly.
- `Config.isResolved()` reports completion.
- `ConfigFactory.defaultReferenceUnresolved()` exists specifically to return unresolved configs for callers that want to defer resolution.

The three impls deviated from Lightbend by fusing parse+resolve. Restoring the lifecycle separation is a Lightbend-parity fix, not a feature addition.

### Acceptance criteria (from issue #99)

- Existing `ParseString` / `ParseFile` behaviour remains backward compatible.
- A caller can parse a config containing unresolved substitutions without receiving an error.
- A caller can merge fallback layers after parsing and before resolution.
- A caller can resolve the merged config explicitly.
- Substitutions resolve against the full merged fallback stack.
- `WithFallback` precedence matches Lightbend (receiver wins).
- `AllowUnresolved` supports partial resolution.
- `UseSystemEnvironment=false` supports deterministic, explicit-source-only resolution.
- Error messages after explicit `Resolve` still preserve useful source path, line, and column information.

---

## Resolved decisions (★1-pending — see Open Q)

OQ-1 through OQ-10 from the Open-Questions pass on 2026-05-21:

| OQ | Decision |
|---|---|
| OQ-1 (default `ResolveSubstitutions`) | Keep existing `ParseString`/`ParseFile` fused (parse+resolve) for back-compat. New opt-in `ParseStringWithOptions` for parse-only. Future v2 may flip default; not in scope. |
| OQ-2 (options shape) | `ParseOptions` / `ResolveOptions` struct passed to `*WithOptions` entry points. No builder pattern. |
| OQ-3 (`WithFallback` on unresolved) | Existing `WithFallback` is extended to accept both resolved and unresolved configs. Merge operates at unresolved-tree level when either operand is unresolved. |
| OQ-4 (`ResolveWith`) | Spec text includes `ResolveWith(source)` (Lightbend semantic: source used for lookup only, not merged into result). Impl conformance: MUST in v1 for the impl where the issue was filed (go.hocon); MAY for ts/rs in v1 (follow-on PR ok). |
| OQ-5 (`FromMap`) | `FromMap(values, originDescription)` (plain keys, Lightbend `ConfigValueFactory.fromMap`). **`FromAnyRef` deferred to follow-on** (requires public `ConfigValue` type — see § "Value factories"). Path-expression `parseMap` also deferred. |
| OQ-6 (Unresolved getter) | Getters on unresolved `Config` return language-idiomatic `NotResolved` error. `AllowUnresolved=true` still errors on getters that hit unresolved paths. |
| OQ-7 (Custom resolver chain) | Out of scope for v1. Lightbend `ConfigResolveOptions.appendResolver` is a v1.3.2+ feature; track as follow-on E-item if needed. |
| OQ-8 (xx.hocon spec category) | `docs/extra-spec-conventions.md` E12 entry (HOCON.md is silent on API surface, so cross-impl convention applies). |
| OQ-9 (Include timing) | Includes are resolved at parse phase, NOT deferred. `UnresolvedConfig` has includes already expanded; only `${...}` substitutions are deferred. E11 `package(...)` resolver runs at parse time. |
| OQ-10 (Other ConfigParseOptions fields) | v1 `ParseOptions`: **`ResolveSubstitutions` + `OriginDescription`**. `FromMap`/`Empty` also accept `originDescription`. Other Lightbend `ConfigParseOptions` fields (`setAllowMissing`, `setIncluder`, `setClassLoader`, `setSyntax`) deferred. (Revised from initial "ResolveSubstitutions only" — adding parse origin was trivial and improves error messages for non-file sources.) |

---

## Definitions

- **Unresolved Config**: a `Config` produced by parsing where one or more `${...}` substitutions remain unresolved. `IsResolved()` returns `false`. Getters raise `NotResolved` for paths whose value (or transitive parent) contains an unresolved substitution.
- **Resolved Config**: a `Config` where no `${...}` substitution remains. `IsResolved()` returns `true`. Getters operate normally.
- **Substitution placeholder**: the in-memory representation of an unresolved `${foo}` / `${?foo}` / `${X[]}` reference. Each impl already has an internal type for this (go: `substPlaceholder`, ts: `SubstPlaceholder`, rs: `ResolverValue::Subst`). The type stays internal; the public surface only exposes it via `IsResolved()` and error paths.
- **Phase-1 (parse)**: tokenize → AST → unresolved value tree (with includes expanded, substitution placeholders intact).
- **Phase-2 (resolve)**: walk unresolved tree, look up each substitution path against the merged tree + (optionally) env, replace placeholders with values.
- **Merged tree**: the value tree resulting from a chain of `WithFallback` invocations. Logical structure: `[receiver, fallback₁, fallback₂, …]`, with receiver winning. Substitution placeholders within any layer survive into the merged tree.
- **Fallback stack**: synonym for *merged tree* when emphasising the layered composition.

### Immutability invariant

All `Config` instances are immutable. `WithFallback`, `Resolve`, `ResolveWith` return new `Config` instances; receivers are never mutated. This matches Lightbend `Config` (immutable, all "modifier" methods return new instances).

### Idempotency of Resolve

`Resolve` on an already-resolved `Config` is a no-op that returns an equivalent `Config` (either the same instance or a copy with identical value tree). Matches Lightbend's documented `resolve()` behaviour: "Resolving an already-resolved config is a harmless no-op".

### Single-pass resolution over fallback stack (one top-level operation)

`Resolve()` performs **one top-level resolve operation over the entire fallback stack**. This is the Lightbend recommendation: "ideally [resolve] should be invoked on root config objects … resolved one time for your entire stack of fallbacks". Per-layer resolution before `WithFallback` is allowed but discouraged because substitutions in upper layers cannot see lower-layer values.

"One top-level operation" does NOT mean "one tree walk". Substitution resolution is **transitive and lazy** within that one operation: resolving `${a}` where `a = ${b}` and `b = ${c}` and `c = 1` MUST yield `1` (not leave `${b}` unresolved). Cycles within the transitive chain are detected per § "Cross-layer cycle detection".

Transitive resolution fixture: dr20 (chained substitution within a single source) and dr21 (chained substitution across fallback layers).

### Hidden substitutions are not evaluated

HOCON's substitution semantics (HOCON.md §Substitutions L670–L703) require that **substitutions in overridden values are discarded before resolution**:

```hocon
foo = ${does-not-exist}
foo = 42
```

This MUST resolve to `{ foo: 42 }` without error. The first `foo = ${does-not-exist}` is overridden by the second definition and removed from the resolution tree.

The same rule applies across fallback layers. `A.WithFallback(B)` produces a merged tree where A's keys win. If A has `foo = ${does-not-exist}` and B has `foo = 42`, then **A's substitution wins** (A is receiver) — error. But `B.WithFallback(A)` makes B the receiver, B's `foo = 42` wins, and A's substitution is dropped — no error.

**Definition refinement**: the **merged tree** (the input to resolution) is the *visible* value tree post-merge. Overridden values, including their substitution placeholders, are NOT in the merged tree and are NOT evaluated.

**Lookback exception**: self-reference lookback (s13a) preserves a separate "lookback chain" of prior values that were overridden by the substituting definition. This chain is consulted only by self-reference resolution and is otherwise invisible. See § "s13a × WithFallback".

Fixtures dr22 (hidden unresolved within single source) and dr23 (hidden unresolved across fallback layers) pin this behaviour.

### Transitive substitution resolution

`${a}` where `a` resolves to a value containing `${b}` MUST trigger resolution of `${b}` as part of the same top-level resolve operation. Resolution does not stop at one level of indirection.

Implementations typically achieve this via lazy / recursive evaluation of the substitution graph with cycle detection. The conformance requirement is the outcome, not the algorithm. Fixtures dr20/dr21 cover direct and cross-layer cases.

### Cross-layer cycle detection

Substitution cycles must be detected in the merged tree, including cycles that emerge only after merging:

```hocon
# receiver
a = ${b}
# fallback
b = ${a}
```

After `WithFallback`, resolving the merged tree must detect the `a → b → a` cycle and raise `ResolveError` (or `NotResolved` with `AllowUnresolved=true`, per § "Conformance levels"). The cycle-detection algorithm is impl-internal; the conformance requirement is that emerging-on-merge cycles are detected.

---

## Public API surface

The surface is defined here language-agnostically; per-impl naming follows each language's idiom (see § "Per-impl naming").

### Parse entry points

```text
ParseString(input) -> Config                    (existing, fused parse+resolve)
ParseFile(path)    -> Config                    (existing, fused parse+resolve)

ParseStringWithOptions(input, ParseOptions) -> Config   (new)
ParseFileWithOptions(path, ParseOptions)    -> Config   (new)
```

When `ParseOptions.ResolveSubstitutions = true` (the spec-defined default), `ParseStringWithOptions` produces a `Config` indistinguishable from `ParseString` (same resolved value tree, same origin chain). When `false`, the returned `Config` has `IsResolved() == false` if the input contains any `${...}`, otherwise `true`.

`ParseOptions` v1 *semantic* fields (per-language encoding follows § "Options encoding per language"):

```text
ResolveSubstitutions: bool    // default true
OriginDescription:    string  // optional, default ""; user-visible source name (Lightbend ConfigParseOptions.setOriginDescription)
```

`OriginDescription` is included in v1 because it is trivial to plumb through and improves error messages when the source isn't a file path (e.g. in-memory strings, REST API payloads). Other Lightbend `ConfigParseOptions` fields (`setSyntax`, `setAllowMissing`, `setIncluder`, `setClassLoader`) are deferred (see § "Out of scope").

### Options encoding per language

The spec defines option **semantics** (which defaults are which). Each impl encodes options idiomatically to its language. The hard constraint: an invocation equivalent to "use all defaults" MUST produce Lightbend default behaviour without requiring the caller to set anything.

| Lang | Encoding | Default invocation |
|---|---|---|
| **Go** | Builder pattern: unexported fields + `DefaultParseOptions()` / `DefaultResolveOptions()` factory functions + `WithX(v) ParseOptions` setter methods that return modified copies. **`ParseOptions{}` zero-value literal is NOT a valid invocation** and is documented as such — package-level lint or runtime check MAY reject it. Idiomatic Go convention (cf. `tls.Config`-style builders, `gRPC` `DialOption`). | `hocon.ParseString(s)` (no opts); or `hocon.ParseStringWithOptions(s, hocon.DefaultParseOptions())` |
| **TS** | `Partial<ParseOptions>` (interface where every field is optional). Omitted field → spec default. | `parseString(s)` (no opts); or `parseString(s, { resolveSubstitutions: false })` |
| **Rust** | `Default` impl returning spec defaults + chainable builder methods. `ParseOptions::default()` returns defaults. | `hocon::parse(s)` (no opts); or `hocon::parse_with_options(s, ParseOptions::default().with_resolve_substitutions(false))` |

**Rationale for Go builder over struct literal**: in Go, `ResolveOptions{}` with `UseSystemEnvironment bool` would mean `false`, contradicting Lightbend's "default true". Inverting the field name (`NoSystemEnvironment`) would lose Lightbend-name parity and confuse maintainers. Builder pattern is the standard Go idiom for "struct with non-zero defaults" and aligns with `gRPC` `DialOption`, `tls.Config` builders, etc.

**Rejected alternatives**:
- Tri-state `*bool` fields: ergonomically poor (callers write `&true`).
- Variadic `ResolveOption` functions: works but diverges further from struct-based TS/Rust.
- Exported fields with documented zero-value semantic inversion: brittle and Lightbend-incompatible naming.

**TS / Rust note**: in both languages, the zero-value problem doesn't bite because the language provides natural ways to express "unspecified = default" (optional fields, `Default` trait). Struct/object literal idioms work for them.

### Value factories

```text
FromMap(values, originDescription) -> Config            (Lightbend ConfigValueFactory.fromMap)
Empty(originDescription) -> Config                      (Lightbend ConfigFactory.empty)
```

**`FromAnyRef` is OUT OF SCOPE for v1**. Lightbend's `ConfigValueFactory.fromAnyRef` returns `ConfigValue` (not `Config`) and accepts scalars / lists / null at the root. To expose this we would need to publish a `ConfigValue` type and define its public surface (getters? rendering? `WithFallback` for non-object roots? `IsResolved` for scalar roots?). That is a separate, larger spec. v1 ships `FromMap` (object-root only) which satisfies issue #99's fallback-injection use case. Track `FromAnyRef` + `ConfigValue` public surface as a follow-on E-item.

**Origin description handling per language** (since Lightbend uses Java overloads which don't translate uniformly):

| Lang | Pattern | Default-origin form |
|---|---|---|
| Go | required `string` arg, empty string `""` means "use default origin" | `hocon.FromMap(m, "")` |
| TS | optional second arg | `fromMap(m)` (origin omitted) or `fromMap(m, "name")` |
| Rust | `origin: Option<&str>` | `from_map(m, None)` or `from_map(m, Some("name"))` |

**`Empty()` equivalence**: `Empty(o)` is equivalent to `FromMap({}, o)`. Impls MAY implement one in terms of the other.

**`FromMap` input type per language** (`values` parameter):

| Lang | Type |
|---|---|
| Go | `map[string]any` |
| TS | `Record<string, unknown>` |
| Rust | `HashMap<String, FromMapValue>` (typed enum: see "Type coercion") OR `serde_json::Value::Object` if `serde-compat` feature flag is enabled |

**Type coercion table** for `FromMap` values (keys are plain — NOT path expressions; nested objects use the same rules recursively):

| HOCON type | Go input | TS input | Rust input |
|---|---|---|---|
| `null` | `nil` | `null` (not `undefined`) | `Value::Null` or `Option::None` wrapper |
| `boolean` | `bool` | `boolean` | `bool` |
| `number` (int) | `int`, `int8/16/32/64`, `uint`, `uint8/16/32` | `number` (integral via `Number.isInteger`) | `i8/16/32/64`, `u8/16/32/64` |
| `number` (float) | `float32`, `float64` | `number` (non-integral) | `f32`, `f64` |
| `string` | `string` | `string` | `String`, `&str` |
| `array` | `[]any` | `unknown[]` | `Vec<T>` (T = supported) |
| `object` | `map[string]any` | `Record<string, unknown>` | `HashMap<String, T>` / `BTreeMap<String, T>` |

Type coercion edge cases:

- **Go `uint64` exceeding `int64` range**: error (HOCON numbers map to int64-equivalent precision). Document as known limitation.
- **TS `undefined`**: error (use explicit `null`). Lightbend equivalent is "throw"; we mirror.
- **TS `bigint`**: error in v1. Future enhancement under separate spec.
- **TS non-integer `number` requested as int via getter**: existing impl behaviour. Out of scope for this spec.
- **Rust `Option::None` field**: skip the key (omit from object). `Option::Some(v)` → emit `v`. This differs from Lightbend (no `Option`), but is the idiomatic Rust mapping.
- **Map key ordering**: HOCON object key ordering follows insertion order. Go `map` is unordered; impls must use a stable iteration order — recommend sorted keys when origin is `FromMap` (no source-file order to preserve). TS uses object key order. Rust uses `BTreeMap` for sorted, `IndexMap` for insertion-preserving. v1: each impl documents its choice; cross-impl tests assert resolved values, not iteration order.

### Composition

```text
config.WithFallback(other) -> Config
```

- Receiver's keys win.
- Accepts both resolved and unresolved operands. Result is unresolved iff either operand is unresolved.
- Non-object values do not merge: `obj.WithFallback(nonObj).WithFallback(otherObj)` ignores `otherObj` (Lightbend `ConfigMergeable` semantic).
- Substitution placeholders survive merge unchanged. Substitution lookup at `Resolve()` time uses the merged tree.

### Resolution

```text
config.Resolve(ResolveOptions) -> Config
config.ResolveWith(source, ResolveOptions) -> Config
config.IsResolved() -> bool
```

`ResolveOptions` fields (Lightbend `ConfigResolveOptions` subset):

```text
UseSystemEnvironment: bool   // default true; if false, no os.Environ/process.env fallback
AllowUnresolved:      bool   // default false; if true, partial resolution doesn't error
```

`Resolve(ResolveOptions{})` with default values is equivalent to Lightbend `Config.resolve()`. Each impl SHOULD also provide a no-arg `Resolve()` overload as ergonomic shortcut, equivalent to `Resolve(default ResolveOptions)`.

`Resolve()` recommendation: callers SHOULD resolve once at the top of the fallback stack, not per layer (matches Lightbend's documented advice; see § "Single-pass resolution over fallback stack").

`ResolveWith(source, opts)` semantic: substitutions in receiver are looked up in `source`, but `source`'s keys are NOT merged into the result. Differs from `WithFallback(source).Resolve(opts)` because the latter includes `source`'s keys in the resulting `Config`.

**Precondition on `ResolveWith` source**: `source` MUST be resolved (or empty of substitutions). If `source` is unresolved, `ResolveWith` MUST error with `NotResolved` BEFORE attempting to resolve the receiver. The error path is the same `NotResolved` category used elsewhere in this spec; impls SHOULD include a marker in the error message indicating the violation occurred at `ResolveWith` source (not at a getter). Test in dr11b.

Rationale: Lightbend documents calling `resolveWith` with an unresolved source as a bug-condition. Making this a normative MUST avoids cross-impl divergence on a corner case.

**Behaviour on already-resolved receiver**: `ResolveWith` on a resolved `Config` is a no-op (no substitutions remain to look up). Same idempotency rule as `Resolve()`.

`IsResolved()` returns `false` if any substitution placeholder remains in the value tree (whole-config granularity, matching Lightbend; no per-value `isResolved`).

### Getters on unresolved Config

Reading any path whose value (or any transitive parent's value) contains an unresolved substitution placeholder returns the language-idiomatic `NotResolved` error.

`AllowUnresolved=true` does NOT make getters lenient — it only makes `Resolve()` itself non-erroring. Paths that resolve cleanly are returned; paths that don't error at getter call. Matches Lightbend.

**Required substitution under `AllowUnresolved=true`**: `${foo}` (required, not `${?foo}`) that cannot be resolved does NOT raise at `Resolve()` time when `AllowUnresolved=true`. It survives as a placeholder. A subsequent getter on its path raises `NotResolved`. The fact that the substitution was *required* (vs optional) is preserved on the placeholder — used only for diagnostic messages.

**Optional substitution under `AllowUnresolved=true`**: `${?foo}` that cannot be resolved is **resolved to "missing"** (the same way it would under `AllowUnresolved=false`) — optional semantics already define the "missing" outcome, so there is no remaining substitution to defer. This matches Lightbend.

### Optional substitution materialisation in concat contexts

Per HOCON.md §Substitutions L626–L645 + §Concatenation L387–L441, when an optional `${?foo}` is undefined, the materialised value depends on the surrounding concat context. Normative rules:

| Context | Undefined `${?foo}` materialises as | Example | Result |
|---|---|---|---|
| Standalone field value | Field is **omitted** from parent object | `a = ${?x}` (x undef) | `{}` (no `a` key) |
| String concat | Empty string | `a = ${?x} "tail"` | `a = " tail"` (leading space preserved per HOCON whitespace rules) |
| String concat (multiple optional, all undef) | Empty string; if entire value is empty, field is omitted | `a = ${?x}${?y}` (both undef) | `{}` (no `a` key) |
| Array concat | Empty array (no elements contributed) | `a = ${?x} [1,2]` (x undef) | `a = [1,2]` |
| Object merge | Empty object (no keys contributed) | `a = ${?x} { k = 1 }` (x undef) | `a = { k = 1 }` |
| Type-mixed concat (e.g. `${?x}` between string and array) | Type-determined: empty string for string-context, empty array for array-context — disambiguation per s10 (concat type-check) rules | `a = "p" ${?x} [1]` | s10 type error (string + array, not compatible) — `${?x}` does not bridge incompatible types |

**Under `AllowUnresolved=true`** with required `${foo}` in concat: the concat survives as a partial concat-placeholder per § "s10 × AllowUnresolved". The placeholder records the optional/required status of each operand. Getter behaviour matches the standalone case: `NotResolved` error.

Fixtures dr24–dr28 cover these cases (see updated inventory).

---

## Per-impl naming

Lightbend names are the reference. Each impl adopts the language-idiomatic form:

| Lightbend (Java) | Go (`hocon` pkg) | TS (`@o3co/hocon`) | Rust (`hocon` crate) |
|---|---|---|---|
| `ConfigFactory.parseString(s)` | `hocon.ParseString(s)` | `parseString(s)` (or `parse(s)`) | `hocon::parse(s)` |
| `(opts variant)` | `hocon.ParseStringWithOptions(s, opts)` | `parseString(s, opts)` | `hocon::parse_with_options(s, opts)` |
| `ConfigParseOptions` | `hocon.ParseOptions` (struct) | `ParseOptions` (interface) | `hocon::ParseOptions` (struct) |
| `ConfigResolveOptions` | `hocon.ResolveOptions` | `ResolveOptions` | `hocon::ResolveOptions` |
| `Config.withFallback` | `(*Config).WithFallback` | `Config.withFallback` | `Config::with_fallback` |
| `Config.resolve()` | `(*Config).Resolve(opts)` | `Config.resolve(opts?)` | `Config::resolve(&self, opts)` |
| `Config.resolveWith(src)` | `(*Config).ResolveWith(src, opts)` | `Config.resolveWith(src, opts?)` | `Config::resolve_with(&self, src, opts)` |
| `Config.isResolved()` | `(*Config).IsResolved()` | `Config.isResolved()` | `Config::is_resolved(&self)` |
| `ConfigValueFactory.fromMap(m, origin)` | `hocon.FromMap(m, originDescription)` | `fromMap(m, originDescription?)` | `hocon::from_map(m, origin)` |
| `ConfigFactory.empty()` | `hocon.Empty(originDescription)` | `empty(originDescription?)` | `hocon::empty(origin)` |

---

## Cross-spec interactions

### s13a (self-reference lookback) × WithFallback

S13a defines that `${?a}` inside the definition of `a` looks at the **prior value** of `a`. The "prior value" semantic must extend to merged trees:

> After `WithFallback`, the receiver's definition of `a` (if any) is the "current" value, and the fallback's definition of `a` is the "prior value" for self-reference lookback purposes within the receiver's `a` definition.

Edge cases:

1. Receiver has `a = ${?a} extra`, fallback has `a = base`. After merge + resolve: `a = "base extra"`.
2. Receiver has `a = ${?a} extra`, fallback has no `a`. After merge + resolve: `a = " extra"` (optional self-ref to undefined → empty per S13a).
3. Receiver has `a = ${a} extra` (required, not optional), fallback has `a = base`. After merge + resolve: `a = "base extra"`. (Required self-ref resolves successfully because the fallback layer supplies the prior value.)
4. Receiver has `a = ${a} extra`, fallback has no `a`. After merge + resolve: **error** (required self-ref with no prior value, per S13a).

### s10 (concat type-check) × AllowUnresolved

S10 type-checks value concatenations during resolve:

- `a = "str" 42` → string concat ("str42")
- `a = [1,2] [3,4]` → array concat
- `a = "str" [1,2]` → type error
- `a = ${foo} [1,2]` → type-check depends on `${foo}` resolution

Under `AllowUnresolved=true`, `${foo}` may not resolve. The concat type-check must:

- **Resolved operands present**: type-check fires if at least one operand's type is determined.
- **All operands unresolved**: no type-check; concat remains as concat-placeholder. Getter on this path → `NotResolved`.
- **Mixed operands, types compatible**: concat succeeds for the resolved portion; placeholder remains for unresolved portion. Getter → `NotResolved`.
- **Mixed operands, types incompatible**: type-error fires immediately (e.g. `a = ${foo} [1,2]` where `${foo}` resolves to a string → type error even under `AllowUnresolved`).

Rationale: `AllowUnresolved` defers *missing-value* errors, not *type* errors. A type error is structurally invalid regardless of resolution status.

---

## Error types

Each impl defines a `NotResolved` error idiomatic to the language:

| Impl | Error | Where raised |
|---|---|---|
| Go | `var ErrNotResolved = errors.New(...)` (sentinel); wrapped via `fmt.Errorf("%w: path=%s", ErrNotResolved, path)` | `(*Config).GetString` etc. on unresolved value |
| TS | `class NotResolvedError extends Error { path: string }` | getter call |
| Rust | `ConfigError::NotResolved { path: String, origin: Origin }` | getter call |

---

## Origin preservation

Each `ConfigValue` (and each substitution placeholder) carries an `Origin` (file, line, column) per Lightbend. Origin survives:

- Parse → unresolved tree: ✓ already preserved by all three impls.
- WithFallback merge: each merged value retains its origin from the source layer. For object-merge, child values retain their source-layer origin; the parent object's origin is the receiver's.
- Resolve: resolved value adopts the resolution-time origin (the value the substitution resolved to).

Error messages MUST include the relevant `Origin`. Verified against issue #99 acceptance criterion "error messages after explicit `Resolve` still preserve useful source path, line, and column information."

---

## Conformance levels

| Item | Level | Notes |
|---|---|---|
| Existing `ParseString`/`ParseFile` parse+resolve | MUST | Backward compatibility. |
| `ParseStringWithOptions(s, ParseOptions{ResolveSubstitutions:false})` returns unresolved | MUST | Core feature. |
| `WithFallback` accepts unresolved operands | MUST | Required for issue #99 use case. |
| `Resolve(ResolveOptions{})` defaults match Lightbend (`UseSystemEnvironment=true`, `AllowUnresolved=false`) | MUST | |
| `Resolve` with `UseSystemEnvironment=false` does not consult env | MUST | Hermetic mode required by issue. |
| `Resolve` with `AllowUnresolved=true` does not error on unresolved | MUST | Required by issue. |
| `IsResolved()` reports completeness accurately | MUST | |
| Getters on unresolved → `NotResolved` error | MUST | Lightbend-aligned. |
| `FromMap(values, origin)` accepts plain-key map | MUST | Lightbend `ConfigValueFactory.fromMap`. |
| `Empty(origin)` | SHOULD | Convenience; trivial. |
| Transitive substitution (`a=${b}`, `b=${c}`, `c=1`) resolves to `a=1` | MUST | Per § "Transitive substitution resolution". |
| Hidden substitution in overridden value not evaluated | MUST | Per § "Hidden substitutions are not evaluated". |
| Optional `${?foo}` materialisation in concat contexts per § "Optional substitution materialisation in concat contexts" | MUST | Cross-impl divergence risk; explicit normative table. |
| `ResolveWith` with unresolved source errors with `NotResolved` | MUST | Per § ResolveWith precondition. |
| Origin preserved through merge + resolve | MUST | |
| s13a lookback walks merged tree | MUST | Cross-spec interaction. |
| s10 type-check under `AllowUnresolved=true` per § "s10 × AllowUnresolved" | MUST | Cross-spec interaction. |

---

## Fixture inventory (30 scenarios)

| ID | Scenario |
|---|---|
| dr01 | Basic fallback (issue #99 example) |
| dr02 | FromMap-only fallback (no receiver-side var) |
| dr03 | Multi-layer fallback (3+ layers) |
| dr04 | Self-reference across fallback (`a = ${?a} extra` + fallback `a = base`) |
| dr05 | Required self-reference with fallback prior |
| dr06 | Required self-reference without fallback prior → error |
| dr07 | AllowUnresolved=true partial resolution |
| dr08 | UseSystemEnvironment=false ignores process env |
| dr09 | Getter on unresolved → NotResolved error |
| dr10 | WithFallback non-object override |
| dr11a | ResolveWith vs WithFallback().Resolve(): source keys present in latter, absent in former |
| dr11b | ResolveWith with unresolved source → NotResolved error |
| dr12 | Origin preserved through merge + resolve |
| dr13 | Type-check under AllowUnresolved (incompatible operand types) |
| dr14 | Type-check under AllowUnresolved (deferred concat-placeholder for fully-unresolved) |
| dr15 | Include + deferred resolve (include already expanded; only `${...}` deferred) |
| dr16 | FromMap nested coercion |
| dr17 | E11 `include package(...)` + deferred resolve (lightbendSkip) |
| dr18 | Cross-layer cycle → error |
| dr19 | Resolve idempotency |
| dr20 | Transitive substitution within single source |
| dr21 | Transitive substitution across fallback layers |
| dr22 | Hidden unresolved within single source → no error |
| dr23 | Hidden unresolved across fallback layers → no error |
| dr24 | Optional `${?x}` standalone, undefined → field omitted |
| dr25 | Optional `${?x}` in string concat, undefined → empty-string contribution |
| dr26 | Optional `${?x}` in array concat, undefined → empty-array contribution |
| dr27 | Optional `${?x}` in object merge, undefined → empty-object contribution |
| dr28 | Multiple optional `${?x}${?y}` all undefined → field omitted |
| dr29 | Empty config edge cases |
| dr30 | Object-merge barrier |
