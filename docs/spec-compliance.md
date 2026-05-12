# HOCON Spec Compliance — ts.hocon

This file extends the canonical item definitions in [`xx.hocon/docs/spec-checklist.md`](../../xx.hocon/docs/spec-checklist.md). It inherits all 209 items in the same order, adding `tests:` and `status:` fields for this implementation.

- **`tests:`** — path to the test or fixture exercising each item, or `—` when no test covers it (test debt).
- **`status:`** — uses the glyphs defined in the template legend (✅ ⚠️ ❌ 🤷 ➖). Default is 🤷 (no test, unverified).
- **Compliance rate** — computed as `(✅ + ⚠️·0.5) / total` (spec-total) and `(✅ + ⚠️·0.5) / (total − ➖)` (in-scope). See the template for the full convention. Current rollup (execution pass): ✅ 115 / ⚠️ 0 / ❌ 1 / 🤷 77 / ➖ 16 — spec-total 55.0% (115/209), in-scope 59.6% (115/193).
- **Out-of-scope items** — inherited verbatim from the template; `status: ➖`.
- **Pre-population source** — GitHub issues on [o3co/ts.hocon](https://github.com/o3co/ts.hocon) verified at time of writing; see individual items for links.

Section headings (S1–S26) match the template exactly for cross-impl matrix alignment.

---

## S1. Unchanged from JSON

- **S1.1** Files must be valid UTF-8 — §Unchanged from JSON (L117)
  tests: —
  status: 🤷
- **S1.2.1** Quoted strings accept valid JSON escape sequences (`\" \\ \/ \b \f \n \r \t`) — §Unchanged from JSON (L118)
  tests: tests/lexer.test.ts:49; tests/lightbend/testdata/subst-tokenize/st10-escape-newline.conf (fixture)
  status: ✅
- **S1.2.2** Unknown / invalid escape sequence (e.g. `\q`, `\x`) is rejected — §Unchanged from JSON (L118)
  tests: tests/lexer.test.ts:86; tests/lightbend/testdata/subst-tokenize/st-err01-invalid-escape-x.conf (fixture)
  status: ✅
- **S1.2.3** Malformed `\uXXXX` (short / non-hex) is rejected — §Unchanged from JSON (L118)
  tests: tests/lexer.test.ts:74; tests/lightbend/testdata/subst-tokenize/st-err03-invalid-unicode-short.conf (fixture)
  status: ✅
- **S1.2.4** Unescaped control char / raw newline in quoted string is rejected — §Unchanged from JSON (L118)
  tests: tests/lightbend/testdata/subst-tokenize/st-err07-newline-in-string.conf (fixture)
  status: ✅
- **S1.2.5** Unterminated quoted string is rejected — §Unchanged from JSON (L118)
  tests: tests/lexer.test.ts:175; tests/lightbend/testdata/subst-tokenize/st-err06-unterminated-string.conf (fixture)
  status: ✅
- **S1.2.6** Unpaired UTF-16 surrogate codepoint in `\uXXXX` escape — §Unchanged from JSON (L118)
  out-of-scope: intentional language-natural divergence. Java (Lightbend reference) silently accepts unpaired surrogates because Java strings are 16-bit code-unit sequences; Rust `char` and Go `rune` cannot represent them and reject. xx.hocon conformance fixtures cannot cover this case (the Java generator fails to encode unpaired surrogates as UTF-8 when writing expected JSON). Each implementation follows its language's string-type constraints. Documented in xx.hocon commit 86bd82e.
  tests: tests/lexer.test.ts:67
  status: ➖
- **S1.3** Value types: string, number, object, array, boolean, null — §Unchanged from JSON (L119)
  tests: tests/parser.test.ts:66
  status: ✅
- **S1.4** Number formats match JSON (no NaN, no Infinity) — §Unchanged from JSON (L120)
  tests: tests/config.test.ts:64; tests/coerce.test.ts:50
  status: ✅

## S2. Comments

- **S2.1** `//` line comment — §Comments (L125)
  tests: tests/lexer.test.ts:29
  status: ✅
- **S2.2** `#` line comment — §Comments (L125)
  tests: tests/lexer.test.ts:36; tests/lightbend/testdata/equiv01/comments.conf (fixture)
  status: ✅
- **S2.3** Comment markers inside quoted strings are literal — §Comments (L126)
  tests: —
  status: 🤷

## S3. Omit root braces

- **S3.1** Empty file is invalid — §Omit root braces (L130)
  tests: —
  status: 🤷
- **S3.2** Root non-object/non-array is invalid (when explicitly enclosed) — §Omit root braces (L131)
  tests: —
  status: 🤷
- **S3.3** Implicit `{}` when file does not start with `[` or `{` — §Omit root braces (L134)
  tests: tests/lightbend/testdata/equiv01/no-root-braces.conf (fixture)
  status: ✅
- **S3.4** Unbalanced trailing `}` without opening `{` is invalid — §Omit root braces (L138)
  tests: tests/parser.test.ts:234
  status: ❌ ([#55](https://github.com/o3co/ts.hocon/issues/55)) — related test passes but specific case (unbraced root + stray `}`) is not covered

## S4. Key-value separator

- **S4.1** `=` is interchangeable with `:` — §Key-value separator (L143)
  tests: tests/lexer.test.ts:18; tests/lightbend/testdata/equiv01/equals.conf (fixture)
  status: ✅
- **S4.2** `:` / `=` may be omitted before `{` — §Key-value separator (L146)
  tests: tests/lightbend/testdata/equiv01/omit-colons.conf (fixture)
  status: ✅

## S5. Commas

- **S5.1** Newline acts as element/field separator — §Commas (L152)
  tests: tests/lightbend/testdata/equiv01/no-commas.conf (fixture)
  status: ✅
- **S5.2** Single trailing comma is allowed and ignored — §Commas (L155)
  tests: —
  status: 🤷
- **S5.3** Two trailing commas (`[1,2,3,,]`) is invalid — §Commas (L160)
  tests: —
  status: 🤷
- **S5.4** Leading comma (`[,1,2,3]`) is invalid — §Commas (L161)
  tests: —
  status: 🤷
- **S5.5** Two consecutive commas (`[1,,2,3]`) is invalid — §Commas (L162)
  tests: —
  status: 🤷
- **S5.6** Same comma rules apply to object fields — §Commas (L163)
  tests: —
  status: 🤷

## S6. Whitespace

- **S6.1** Unicode Zs/Zl/Zp category characters are whitespace — §Whitespace (L170)
  tests: —
  status: 🤷
- **S6.2** Non-breaking spaces (0x00A0, 0x2007, 0x202F) are whitespace — §Whitespace (L171)
  tests: —
  status: 🤷
- **S6.3** BOM (0xFEFF) treated as whitespace — §Whitespace (L173)
  tests: tests/lexer.test.ts:161; tests/lightbend/testdata/bom.conf (fixture)
  status: ✅
- **S6.4** ASCII control whitespace (tab, vtab, FF, CR, FS, GS, RS, US) — §Whitespace (L174)
  tests: —
  status: 🤷
- **S6.5** "newline" means specifically 0x000A (LF) — §Whitespace (L183)
  tests: —
  status: 🤷

## S7. Duplicate keys and object merging

- **S7.1** Later non-object key overrides earlier — §Duplicate keys (L189)
  tests: tests/resolver.test.ts:56
  status: ✅
- **S7.2** Two object values are merged recursively — §Duplicate keys (L191)
  tests: tests/resolver.test.ts:47
  status: ✅
- **S7.3** Merge: fields in only one object are kept — §Duplicate keys (L199)
  tests: tests/resolver.test.ts:47
  status: ✅
- **S7.4** Merge: non-object field in both → second wins — §Duplicate keys (L201)
  tests: tests/resolver.test.ts:56
  status: ✅
- **S7.5** Merge: object field in both → recursive merge — §Duplicate keys (L203)
  tests: tests/resolver.test.ts:159; tests/lightbend/testdata/equiv02/path-keys.conf (fixture)
  status: ✅
- **S7.6** Intermediate non-object value breaks merge with later object — §Duplicate keys (L207)
  tests: —
  status: 🤷

## S8. Unquoted strings

- **S8.1** Forbidden characters rejected (``$ " { } [ ] : = , + # ` ^ ? ! @ * & \``) and whitespace — §Unquoted strings (L245)
  tests: tests/lexer.test.ts:191
  status: ⚠️ — cited test covers only a subset of the forbidden set; `isUnquotedStart` / `isUnquotedContinue` in src/internal/lexer/lexer.ts do not exclude `` ` `` (backtick), so the impl allows it in unquoted strings contrary to spec L245
- **S8.2** `//` inside an unquoted string starts a comment — §Unquoted strings (L248)
  tests: tests/lexer.test.ts:29
  status: ✅
- **S8.3** Initial token `true`/`false`/`null` parsed as keyword — §Unquoted strings (L250)
  tests: tests/parser.test.ts:66
  status: ✅
- **S8.4** Initial number characters parse as number — §Unquoted strings (L250)
  tests: tests/parser.test.ts:79; tests/lexer.test.ts:117
  status: ✅
- **S8.5** Embedded `true`/`false`/`null`/number become string content — §Unquoted strings (L266)
  tests: tests/lightbend/testdata/equiv01/unquoted.conf (fixture)
  status: ✅
- **S8.6** Unquoted string cannot begin with `0-9` or `-` — §Unquoted strings (L270)
  tests: —
  status: ❌ — impl violates spec: lexer permits digits and `-` as unquoted starts (src/internal/lexer/lexer.ts:338), and parser turns non-JSON-number forms such as `123abc` / `-foo` into strings (src/internal/parser/parser.ts:325) rather than rejecting them
- **S8.7** No escape sequences in unquoted strings — §Unquoted strings (L253)
  tests: —
  status: 🤷
- **S8.8** Unquoted strings allow control characters except forbidden set — §Unquoted strings (L280)
  tests: —
  status: 🤷

## S9. Multi-line strings

- **S9.1** `"""..."""` triple-quoted string — §Multi-line strings (L291)
  tests: tests/lexer.test.ts:98; tests/lightbend/testdata/equiv05/triple-quotes.conf (fixture)
  status: ✅
- **S9.2** Newlines and whitespace preserved literally — §Multi-line strings (L293)
  tests: tests/lexer.test.ts:98; tests/lightbend/testdata/equiv05/triple-quotes.conf (fixture)
  status: ✅
- **S9.3** Unicode escapes NOT interpreted inside triple-quoted — §Multi-line strings (L294)
  tests: tests/lightbend/testdata/equiv05/triple-quotes.conf (fixture)
  status: ✅
- **S9.4** Scala-style trailing extra quotes are part of string — §Multi-line strings (L300)
  tests: tests/lightbend/testdata/equiv05/triple-quotes.conf (fixture)
  status: ✅
- **S9.5** Unterminated `"""` raises an error — §Multi-line strings (L291-293, by analogy with quoted strings)
  tests: tests/lexer.test.ts:183
  status: ✅

## S10. Value concatenation

- **S10.1** Simple values + non-newline whitespace → string concat — §Value concatenation (L310)
  tests: tests/lightbend/testdata/equiv01/unquoted.conf (fixture)
  status: ✅
- **S10.2** All arrays → array concatenation — §Value concatenation (L312)
  tests: tests/resolver.test.ts:284
  status: ✅
- **S10.3** All objects → object merge (concatenation) — §Value concatenation (L314)
  tests: tests/resolver.test.ts:159
  status: ✅
- **S10.4** Mixing arrays + objects in concat is an error — §Array and object concatenation (L385)
  tests: —
  status: 🤷
- **S10.5** Inner whitespace between simple values preserved — §String value concatenation (L332)
  tests: tests/lightbend/testdata/equiv01/unquoted.conf (fixture)
  status: ✅
- **S10.6** Leading/trailing whitespace around concat discarded — §String value concatenation (L346)
  tests: tests/lightbend/testdata/equiv01/unquoted.conf (fixture)
  status: ✅
- **S10.7** Concatenation does not span a newline — §String value concatenation (L335)
  tests: —
  status: 🤷
- **S10.8** String concat allowed in field keys — §Value concatenation (L317)
  tests: —
  status: 🤷
- **S10.9** `true`/`false` stringify to `"true"`/`"false"` in concat — §String value concatenation (L363)
  tests: —
  status: 🤷
- **S10.10** `null` stringifies to `"null"` in concat — §String value concatenation (L364)
  tests: —
  status: 🤷
- **S10.11** Numbers stringify as written in the source file — §String value concatenation (L366)
  tests: tests/config.test.ts:183
  status: ✅
- **S10.12** A single non-string value is NOT stringified (type preserved) — §String value concatenation (L376)
  tests: tests/config.test.ts:172
  status: ✅
- **S10.13** Array/object appearing in string concat is an error — §String value concatenation (L373)
  tests: —
  status: 🤷
- **S10.14** Whitespace around obj/array substitutions is ignored — §Concatenation with whitespace (L440)
  tests: —
  status: 🤷
- **S10.15** Quoted whitespace between obj/array substitutions is an error — §Concatenation with whitespace (L442)
  tests: tests/resolver.test.ts:181
  status: ✅
- **S10.16** Non-newline whitespace in arrays is concat, not separator — §Arrays without commas or newlines (L447)
  tests: —
  status: 🤷
- **S10.17** Substitution resolving to an array participates in array concat (`${arr} [x]`) — §Array and object concatenation (L387)
  tests: tests/resolver.test.ts:284
  status: ✅
- **S10.18** Substitution resolving to an object participates in object merge (`${obj} {x:1}`) — §Array and object concatenation (L388)
  tests: tests/resolver.test.ts:214
  status: ✅
- **S10.19** Mixing a substitution-resolved object with a literal array (or vice versa) is an error — §Array and object concatenation (L385-389)
  tests: —
  status: 🤷

## S11. Path expressions

- **S11.1** `.` outside quoted is a path separator — §Path expressions (L483)
  tests: tests/parser.test.ts:34; tests/lightbend/testdata/equiv01/path-keys.conf (fixture)
  status: ✅
- **S11.2** `.` inside quoted is literal — §Path expressions (L484)
  tests: tests/parser.test.ts:41; tests/lightbend/testdata/subst-tokenize/st03-quoted-dot-in-key.conf (fixture)
  status: ✅
- **S11.3** Numbers retain original string representation in paths — §Path expressions (L489)
  tests: tests/lightbend/testdata/equiv01/path-keys.conf (fixture)
  status: ✅
- **S11.4** `10.0foo` → path `[10, 0foo]` — §Path expressions (L496)
  tests: —
  status: 🤷
- **S11.5** `foo10.0` → path `[foo10, 0]` — §Path expressions (L498)
  tests: —
  status: 🤷
- **S11.6** Empty path element must be quoted (`a."".b` ok) — §Path expressions (L515)
  tests: tests/lightbend/testdata/subst-tokenize/st09-empty-quoted-key.conf (fixture)
  status: ✅
- **S11.7** `a..b` and paths starting/ending with `.` are errors — §Path expressions (L517)
  tests: tests/lightbend/testdata/subst-tokenize/st-err09-empty-segment-leading-dot.conf (fixture)
  status: ✅
- **S11.8** Path expression always stringifies (single `true` → `"true"`) — §Path expressions (L504)
  tests: —
  status: 🤷
- **S11.9** Substitutions not allowed inside path expressions — §Path expressions (L479)
  tests: —
  status: 🤷
- **S11.10** Quoted path segments respected in getter API (e.g. `config.get("foo.\"bar.baz\"")`) — §Path expressions (L485)
  tests: tests/config.test.ts:202
  status: ✅

## S12. Paths as keys

- **S12.1** `foo.bar : 42` expands to `foo { bar : 42 }` — §Paths as keys (L530)
  tests: tests/parser.test.ts:34; tests/lightbend/testdata/equiv01/path-keys.conf (fixture)
  status: ✅
- **S12.2** Multi-element keys expand to nested objects — §Paths as keys (L538)
  tests: tests/lightbend/testdata/equiv02/path-keys.conf (fixture)
  status: ✅
- **S12.3** Path keys merge per duplicate-key rules — §Paths as keys (L544)
  tests: tests/lightbend/testdata/equiv02/path-keys.conf (fixture)
  status: ✅
- **S12.4** Whitespace in keys: `a b c : 42` = `"a b c" : 42` — §Paths as keys (L553)
  tests: tests/lightbend/testdata/equiv02/path-keys-weird-whitespace.conf (fixture)
  status: ✅
- **S12.5** `include` may NOT begin a path expression in a key — §Paths as keys (L570)
  tests: —
  status: 🤷

## S13. Substitutions

- **S13.1** `${path}` is a required substitution — §Substitutions (L579)
  tests: tests/resolver.test.ts:88; tests/lightbend/testdata/equiv01/substitutions.conf (fixture)
  status: ✅
- **S13.2** `${?path}` is an optional substitution — §Substitutions (L579)
  tests: tests/resolver.test.ts:98; tests/lightbend/testdata/subst-tokenize/st15-optional-subst.conf (fixture)
  status: ✅
- **S13.3** `${?` is exactly 3 chars (no whitespace before `?`) — §Substitutions (L584)
  tests: —
  status: 🤷
- **S13.4** Resolver MAY consult external sources (env vars, system properties) for unresolved substitutions — §Substitutions (L588) (concrete env behavior → S26)
  tests: tests/parse.test.ts:35
  status: ✅
- **S13.5** Substitutions are NOT parsed inside quoted strings — §Substitutions (L593)
  tests: —
  status: 🤷
- **S13.6** Substitution paths are absolute (rooted at config root) — §Substitutions (L603)
  tests: tests/resolver.test.ts:93
  status: ✅
- **S13.7** Substitution resolution is last step (can look forward) — §Substitutions (L607)
  tests: tests/resolver.test.ts:152
  status: ✅
- **S13.8** Substitution sees the latest-assigned (merged) value — §Substitutions (L612)
  tests: tests/resolver.test.ts:213
  status: ✅
- **S13.9** `null` in config blocks env var lookup — §Substitutions (L618)
  tests: —
  status: 🤷
- **S13.10** Required substitution undefined → error — §Substitutions (L627)
  tests: tests/resolver.test.ts:126; tests/parse.test.ts:51
  status: ✅
- **S13.11** Optional undefined in field value → field not created — §Substitutions (L632)
  tests: tests/resolver.test.ts:103; tests/lightbend/testdata/equiv04/missing-substitutions.conf (fixture)
  status: ✅
- **S13.12** Optional undefined in array element → element not added — §Substitutions (L635)
  tests: tests/lightbend/testdata/equiv04/missing-substitutions.conf (fixture)
  status: ✅
- **S13.13** Optional undefined in string concat → empty string — §Substitutions (L636)
  tests: —
  status: 🤷
- **S13.14** Optional undefined in obj/array concat → empty obj/array — §Substitutions (L637)
  tests: —
  status: 🤷
- **S13.15** `foo : ${?bar}${?baz}` skipped only when BOTH undefined — §Substitutions (L640)
  tests: tests/resolver.test.ts:274
  status: ✅
- **S13.16** Substitutions only in field values / array elements — §Substitutions (L644)
  tests: —
  status: 🤷
- **S13.17** Single-substitution value preserves type — §Substitutions (L648)
  tests: tests/resolver.test.ts:88
  status: ✅
- **S13.18** Substitution in multi-value concat becomes string — §Substitutions (L650)
  tests: tests/resolver.test.ts:142; tests/parse.test.ts:31
  status: ✅
- **S13.19** Unterminated `${...}` (missing closing `}`) is rejected — §Substitutions syntax requires closing `}` (L579)
  tests: tests/lexer.test.ts:179; tests/lightbend/testdata/subst-tokenize/st-err05-unterminated-subst.conf (fixture)
  status: ✅

### S13a. Self-referential substitutions

- **S13a.1** `path : ${path}` resolves to prior `path` value — §Self-Referential (L666)
  tests: tests/resolver.test.ts:135
  status: ✅
- **S13a.2** Self-ref to overridden field works in merge — §Self-Referential (L748)
  tests: tests/resolver.test.ts:213
  status: ✅
- **S13a.3** Self-ref before any prior value → undefined → error — §Self-Referential (L767)
  tests: —
  status: 🤷
- **S13a.4** Optional self-ref `${?foo}` disappears silently — §Self-Referential (L776)
  tests: tests/resolver.test.ts:291
  status: ✅
- **S13a.5** Substitution hidden by later non-object → no error — §Self-Referential (L780)
  tests: tests/resolver.test.ts:222
  status: ✅
- **S13a.6** Cycle inside object `a : { b : ${a} }` → error — §Self-Referential (L688)
  tests: tests/resolver.test.ts:148
  status: ✅
- **S13a.7** Cycle inside array `a : [${a}]` → error — §Self-Referential (L689)
  tests: tests/resolver.test.ts:148
  status: ✅
- **S13a.8** Two-step cycle `bar : ${foo}; foo : ${bar}` → error — §Self-Referential (L857)
  tests: tests/resolver.test.ts:148; tests/lightbend/testdata/cycle.conf (fixture)
  status: ✅
- **S13a.9** Multi-step cycle `a→b→c→a` → error — §Self-Referential (L862)
  tests: tests/resolver.test.ts:148
  status: ✅
- **S13a.10** Substitution memoized by instance, not by path — §Self-Referential (L885)
  tests: —
  status: 🤷
- **S13a.11** Object can refer to its own descendant (`bar : { foo : 42, baz : ${bar.foo} }`) — §Self-Referential (L806)
  tests: tests/resolver.test.ts:227
  status: ✅
- **S13a.12** Self-ref in path expression `${foo.a}` resolves to "below" — §Self-Referential (L791)
  tests: tests/resolver.test.ts:93
  status: ✅
- **S13a.13** `a = ${?a}foo` resolves to `"foo"` (look-back undefined) — §Self-Referential (L841)
  tests: —
  status: 🤷
- **S13a.14** Mutually-referring object fields (`bar.a = ${foo.d}; foo.c = ${bar.b}`) resolve lazily without false cycle — §Self-Referential (L825-834)
  tests: tests/resolver.test.ts:227
  status: ✅

### S13b. `+=` field separator

- **S13b.1** `a += b` expands to `a = ${?a} [b]` — §`+=` field separator (L725)
  tests: tests/resolver.test.ts:67; tests/parse.test.ts:186
  status: ✅
- **S13b.2** `+=` on non-array prior value → error — §`+=` field separator (L732)
  tests: —
  status: 🤷
- **S13b.3** `+=` works on first mention of key (no prior `=`) — §`+=` field separator (L734)
  tests: tests/resolver.test.ts:74
  status: ✅

### S13c. List values from environment variables

- **S13c.1** `${X[]}` looks up `X_0`, `X_1`, ... env vars — §List values from env (L900)
  tests: —
  status: ❌ — not implemented; substitution lexer (src/internal/lexer/lexer.ts:333) rejects `[` / `]` inside `${...}` body and env fallback only resolves scalar values (src/internal/resolver/substitution-resolver.ts:220). `env-variables.conf` exists but is not wired into the Vitest Lightbend runner.
- **S13c.2** Stops at first missing index — §List values from env (L905)
  tests: —
  status: ❌ — not implemented (see S13c.1)
- **S13c.3** `${X[]}` no elements → required error — §List values from env (L910)
  tests: —
  status: ❌ — not implemented (see S13c.1)
- **S13c.4** `${?X[]}` no elements → undefined / removed — §List values from env (L912)
  tests: —
  status: ❌ — not implemented (see S13c.1)
- **S13c.5** `[]` suffix supported only for env vars (not config / sys props) — §List values from env (L902)
  tests: —
  status: ❌ — not implemented (see S13c.1); constraint is moot when the `[]` suffix itself is rejected by the lexer

## S14. Includes

### S14a. Include syntax

- **S14a.1** `include "filename"` (heuristic) — §Include syntax (L925)
  tests: tests/parser.test.ts:131; tests/resolver.test.ts:255
  status: ✅
- **S14a.2** `include url("...")` — §Include syntax (L927)
  out-of-scope: URL fetching is unsupported by design; declared as a Known Limitation in each implementation's README. HOCON.md L1175-1177 permits this: "Implementations need not support files, Java resources, or URLs."
  tests: —
  status: ➖
- **S14a.3** `include file("...")` — §Include syntax (L927)
  tests: tests/parser.test.ts:139; tests/resolver.test.ts:545
  status: ✅
- **S14a.4** `include classpath("...")` — §Include syntax (L927)
  out-of-scope: classpath resources are a JVM-only concept; non-JVM implementations have no equivalent loader.
  tests: —
  status: ➖
- **S14a.5** `include required(...)` — §Include syntax (L930)
  tests: tests/parser.test.ts:146; tests/resolver.test.ts:344
  status: ✅
- **S14a.6** Unquoted `include` at non-start-of-key is literal — §Include syntax (L962)
  tests: —
  status: 🤷
- **S14a.7** Whitespace allowed between `include` and resource name (incl. newlines) — §Include syntax (L952)
  tests: tests/lightbend/testdata/test03.conf (fixture)
  status: 🤷
- **S14a.8** No value concatenation on include argument — §Include syntax (L957)
  tests: —
  status: 🤷
- **S14a.9** No substitutions in include argument — §Include syntax (L959)
  tests: —
  status: 🤷
- **S14a.10** Include argument must be quoted string — §Include syntax (L958)
  tests: tests/parser.test.ts:282
  status: ✅
- **S14a.11** `"include"` (quoted) is just a normal key — §Include syntax (L977)
  tests: —
  status: 🤷

### S14b. Include semantics: merging

- **S14b.1** Included root must be an object (array → error) — §Include semantics: merging (L993)
  tests: —
  status: 🤷
- **S14b.2** Included keys merge per duplicate-key rules — §Include semantics: merging (L997)
  tests: tests/resolver.test.ts:255
  status: ✅
- **S14b.3** Earlier-in-including value + included → merged/overridden — §Include semantics: merging (L1000)
  tests: tests/resolver.test.ts:255
  status: ✅
- **S14b.4** Later-in-including value overrides included — §Include semantics: merging (L1004)
  tests: tests/resolver.test.ts:255
  status: ✅

### S14c. Include semantics: substitution

- **S14c.1** Substitutions in included file are relativized to including scope — §Include semantics: substitution (L1019)
  tests: tests/resolver.test.ts:403
  status: ✅
- **S14c.2** Original (non-relativized) path also tried as fallback — §Include semantics: substitution (L1048)
  tests: tests/resolver.test.ts:421
  status: ✅

### S14d. Include semantics: missing / required

- **S14d.1** Missing optional include silently ignored — §Include semantics: missing files (L1053)
  tests: tests/resolver.test.ts:323; tests/parse.test.ts:262
  status: ✅
- **S14d.2** Missing `required(...)` include → error — §Include semantics: missing files (L1057)
  tests: tests/resolver.test.ts:344; tests/parse.test.ts:406
  status: ✅
- **S14d.3** Non-missing IO errors NOT swallowed — §Include semantics: missing files (L1069)
  tests: tests/resolver.test.ts:356; tests/parse.test.ts:424
  status: ✅

### S14e. Include semantics: file formats & extensions

- **S14e.1** Extensionless basename probes multiple extensions — §Include semantics: file formats (L1080)
  tests: tests/resolver.test.ts:314; tests/parse.test.ts:244
  status: ✅
- **S14e.2** Multiple matching extensions all loaded — §Include semantics: file formats (L1088)
  tests: tests/resolver.test.ts:459
  status: ✅
- **S14e.3** Load order: `.properties` → `.json` → `.conf` — §Include semantics: file formats (L1091)
  tests: tests/resolver.test.ts:473
  status: ✅
- **S14e.4** URL include: no extension probing (exact URL only) — §Include semantics: file formats (L1103)
  out-of-scope: URL include unsupported; see S14a.2.
  tests: —
  status: ➖
- **S14e.5** URL include: format from Content-Type or URL path extension — §Include semantics: file formats (L1104)
  out-of-scope: URL include unsupported; see S14a.2.
  tests: —
  status: ➖

### S14f. Include semantics: locating resources

- **S14f.1** Quoted-string heuristic: URL if valid protocol — §Include semantics: locating (L1115)
  out-of-scope: URL include unsupported; see S14a.2. The heuristic that distinguishes URL strings from filenames is moot when no URL form is supported.
  tests: —
  status: ➖
- **S14f.2** Otherwise treated as file/resource adjacent to including — §Include semantics: locating (L1117)
  tests: tests/resolver.test.ts:606
  status: ✅
- **S14f.3** Filesystem: relative path = relative to including dir (NOT cwd) — §Include semantics: locating (L1154)
  tests: tests/parse.test.ts:110; tests/resolver.test.ts:606
  status: ✅
- **S14f.4** Filesystem: absolute path preserved — §Include semantics: locating (L1152)
  tests: tests/resolver.test.ts:568
  status: ✅
- **S14f.5** Filesystem: fall back to classpath on not-found — §Include semantics: locating (L1158)
  out-of-scope: classpath is JVM-only; see S14a.4.
  tests: —
  status: ➖
- **S14f.6** URL: "adjacent to" computed from URL path component — §Include semantics: locating (L1169)
  out-of-scope: URL include unsupported; see S14a.2.
  tests: —
  status: ➖
- **S14f.7** `url()`/`file()`/`classpath()` arguments NOT relativized — §Include semantics: locating (L1179)
  tests: tests/resolver.test.ts:545
  status: ✅
- **S14f.8** `file:` URLs follow plain-filename filesystem semantics — §Include semantics: locating (L1171-1172)
  out-of-scope: URL include unsupported; see S14a.2. `file:` URLs are reachable only via `include url()`, which is not implemented.
  tests: —
  status: ➖

## S15. Numerically-indexed objects to arrays

- **S15.1** `{"0":"a","1":"b"}` → `["a","b"]` when array context — §Conversion (L1191)
  tests: —
  status: 🤷
- **S15.2** Conversion is lazy (only on type-required access) — §Conversion (L1204)
  tests: —
  status: 🤷
- **S15.3** Conversion in concatenation when list expected — §Conversion (L1210)
  tests: —
  status: 🤷
- **S15.4** Empty object NOT converted — §Conversion (L1212)
  tests: —
  status: 🤷
- **S15.5** Non-integer keys ignored during conversion — §Conversion (L1214)
  tests: —
  status: 🤷
- **S15.6** Missing indices compacted in resulting array — §Conversion (L1216)
  tests: —
  status: 🤷
- **S15.7** Sorted by integer key value — §Conversion (L1216)
  tests: —
  status: 🤷

## S16. MIME Type

- **S16.1** Content-Type for HOCON resources is `application/hocon` — §MIME Type (L1223)
  out-of-scope: these implementations are parsers, not HTTP servers — they do not produce or advertise a Content-Type. The header is set by whoever serves a `.conf` file over HTTP.
  tests: —
  status: ➖

## S17. Automatic type conversions

- **S17.1** number → string (JSON-valid form) — §Automatic type conversions (L1235)
  tests: tests/config.test.ts:35
  status: ✅
- **S17.2** boolean → string ("true" / "false") — §Automatic type conversions (L1237)
  tests: tests/config.test.ts:178
  status: ✅
- **S17.3** string → number (JSON rules) — §Automatic type conversions (L1238)
  tests: tests/config.test.ts:44; tests/coerce.test.ts:31
  status: ✅
- **S17.4** string → bool: `true`/`yes`/`on`/`false`/`no`/`off` — §Automatic type conversions (L1239)
  tests: tests/config.test.ts:79; tests/coerce.test.ts:5
  status: ✅
- **S17.5** `"null"` → null when null requested — §Automatic type conversions (L1244)
  tests: —
  status: 🤷
- **S17.6** null → other type: error — §Automatic type conversions (L1252)
  tests: —
  status: 🤷
- **S17.7** object → other type: error — §Automatic type conversions (L1254)
  tests: —
  status: 🤷
- **S17.8** array → other (except numeric-indexed): error — §Automatic type conversions (L1255)
  tests: —
  status: 🤷

## S18. Units format

- **S18.1** Number value taken as default unit — §Units format (L1279)
  tests: —
  status: 🤷
- **S18.2** String parsed as: optional ws + number + ws + unit + ws — §Units format (L1281-1294)
  tests: tests/config.test.ts:239
  status: ✅
- **S18.3** Unit name letters-only (Unicode L* / `isLetter`) — §Units format (L1287)
  tests: —
  status: 🤷
- **S18.4** String with no unit → interpreted with default unit — §Units format (L1290)
  tests: —
  status: 🤷

## S19. Duration format

- **S19.1** `ns` / `nano` / `nanos` / `nanosecond` / `nanoseconds` — §Duration format (L1307)
  tests: tests/config.test.ts:264
  status: ✅
- **S19.2** `us` / `micro` / `micros` / `microsecond` / `microseconds` — §Duration format (L1308)
  tests: tests/config.test.ts:269
  status: ✅
- **S19.3** `ms` / `milli` / `millis` / `millisecond` / `milliseconds` — §Duration format (L1309)
  tests: tests/config.test.ts:259
  status: ✅
- **S19.4** `s` / `second` / `seconds` — §Duration format (L1310)
  tests: tests/config.test.ts:239; tests/config.test.ts:274
  status: ✅
- **S19.5** `m` / `minute` / `minutes` — §Duration format (L1311)
  tests: tests/config.test.ts:244
  status: ✅
- **S19.6** `h` / `hour` / `hours` — §Duration format (L1312)
  tests: tests/config.test.ts:249
  status: ✅
- **S19.7** `d` / `day` / `days` — §Duration format (L1313)
  tests: tests/config.test.ts:254
  status: ✅
- **S19.8** Duration unit names are case sensitive (lowercase only) — §Duration format (L1304)
  tests: —
  status: 🤷

## S20. Period format

- **S20.1** `d` / `day` / `days` — §Period Format (L1327)
  out-of-scope: Period Format mirrors `java.time.Period`, a JVM-specific type; the spec text (L1316-1318) explicitly references this Java API. None of the three implementations exposes a period parser/API.
  tests: —
  status: ➖
- **S20.2** `w` / `week` / `weeks` — §Period Format (L1328)
  out-of-scope: Period Format unsupported; see S20.1.
  tests: —
  status: ➖
- **S20.3** `m` / `mo` / `month` / `months` — §Period Format (L1329)
  out-of-scope: Period Format unsupported; see S20.1.
  tests: —
  status: ➖
- **S20.4** `y` / `year` / `years` — §Period Format (L1333)
  out-of-scope: Period Format unsupported; see S20.1.
  tests: —
  status: ➖

## S21. Size in bytes format

- **S21.1** `B` / `b` / `byte` / `bytes` — §Size in bytes format (L1361)
  tests: tests/config.test.ts:313
  status: ✅
- **S21.2** Powers of 10 (kB, MB, GB, TB, PB, EB, ZB, YB + long forms) — §Size in bytes format (L1365)
  tests: tests/config.test.ts:318; tests/config.test.ts:328
  status: ✅
- **S21.3** Powers of 2 (K/Ki/KiB, M/Mi/MiB, ...) — §Size in bytes format (L1376)
  tests: tests/config.test.ts:323; tests/config.test.ts:333
  status: ✅
- **S21.4** Single-letter abbreviations → powers of 2 (java -Xmx convention) — §Size in bytes format (L1385)
  tests: —
  status: 🤷
- **S21.5** Fractional values supported (`0.5M`) — §Units format (L1281-1294) + §Size in bytes (L1335-1342)
  tests: tests/config.test.ts:384
  status: ✅

## S22. Config object merging API

- **S22.1** `merge(A, B)` semantics = duplicate-key behavior — §Config object merging (L1402)
  tests: tests/config.test.ts:157
  status: ✅
- **S22.2** Intermediate non-object hides earlier object across files — §Config object merging (L1406)
  tests: —
  status: 🤷
- **S22.3** Setting key to null clears earlier object value — §Config object merging (L1436)
  tests: —
  status: 🤷

## S23. Java properties mapping

- **S23.1** Split key on `.` preserving empty strings — §Java properties (L1450)
  tests: tests/properties.test.ts:30
  status: ✅
- **S23.2** Empty path elements (leading/trailing) preserved — §Java properties (L1456)
  tests: —
  status: 🤷
- **S23.3** Properties values are always strings — §Java properties (L1471)
  tests: tests/properties.test.ts:37; tests/parse.test.ts:386
  status: ✅
- **S23.4** Object wins over string on conflicting key — §Java properties (L1485)
  tests: —
  status: 🤷
- **S23.5** Multi-line values (backslash continuation) — §Note on Java properties similarity (L1587)
  out-of-scope: declared in each implementation's README — the `.properties` reader supports only basic `key=value` syntax to avoid pulling a full Java properties parser into a non-JVM library.
  tests: —
  status: ➖
- **S23.6** Unicode escapes in `.properties` — §Note on Java properties similarity (L1587)
  out-of-scope: same rationale as S23.5.
  tests: —
  status: ➖

## S24. Conventional config files (JVM)

- **S24.1** `reference.conf` classpath merge — §Conventional configuration files (L1502)
  out-of-scope: relies on classpath resource resolution (see S14a.4).
  tests: —
  status: ➖
- **S24.2** `application.{conf,json,properties}` default load — §Conventional configuration files (L1506)
  out-of-scope: relies on classpath resource resolution (see S14a.4).
  tests: —
  status: ➖

## S25. System property override

- **S25.1** System properties override config file values — §Conventional override (L1530)
  out-of-scope: JVM system properties are a JVM-only mechanism; non-JVM runtimes use environment variables or library-specific overrides.
  tests: —
  status: ➖

## S26. Substitution fallback to environment variables

- **S26.1** Env var lookup when substitution not in config tree — §Substitution fallback (L1536)
  tests: tests/resolver.test.ts:130; tests/parse.test.ts:35
  status: ✅
- **S26.2** Empty env var preserved as empty string (not undefined) — §Substitution fallback (L1558)
  tests: —
  status: 🤷
- **S26.3** Env var SecurityException → treated as not present — §Substitution fallback (L1560)
  out-of-scope: `SecurityException` is a JVM-specific exception type; non-JVM runtimes have no equivalent guard at this layer.
  tests: —
  status: ➖
- **S26.4** Env vars always become strings (with auto type conversion) — §Substitution fallback (L1563)
  tests: tests/resolver.test.ts:113
  status: ✅
