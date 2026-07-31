import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'
import { depthError, guardStackDepth } from '../internal/depth.js'

/**
 * Read JSON with comments and trailing commas — the dialect VS Code and
 * TypeScript use for their config files — as HOCON config.
 *
 * Plain JSON needs no adapter at all: HOCON is a JSON superset, so `parse`
 * already accepts a .json file. This exists for the two things HOCON does not
 * accept, block comments and trailing commas. (HOCON has `//` and `#` comments
 * of its own.)
 *
 * Comments and trailing commas are removed and `JSON.parse` does the rest, so
 * the accepted grammar is otherwise exactly the platform's JSON. A comment is
 * replaced by whitespace rather than deleted, so it separates the tokens around
 * it and `{"a":1/*x*\/2}` is a syntax error rather than `{"a":12}` (F3.2).
 *
 * Integers are ingested losslessly (F0.5): a literal too wide for a JS `number`
 * keeps its digits — `getString` returns them exactly — and one outside int64
 * is refused instead of being rounded. `getNumber` and `toObject` still apply
 * the JS number model, as they do for HOCON's own literals, so read large
 * identifiers with `getString`.
 *
 * **An unpaired `\uXXXX` surrogate is accepted here and refused by go.hocon,
 * py.hocon and rs.hocon** (F3.5). That is deliberate, and the same divergence
 * the properties adapter already carries under F2.8: a JavaScript string is
 * UTF-16, like Java's, so it holds a lone surrogate natively and round-trips it.
 * A Go or Rust string cannot hold one at all — Go silently substituted U+FFFD
 * until F3.5 — and a Python `str` can hold one but cannot encode it as UTF-8,
 * so all three refuse rather than defer the failure. Refusing here would mean
 * this spec overriding the host language rather than protecting the user; see
 * S1.2.6 for the class.
 *
 * See the F3.x items in the format-ingestion mapping spec:
 * https://github.com/o3co/xx.hocon/blob/main/docs/format-ingestion-mapping.md
 */
export function parseJsonc(input: string, originDescription?: string): Config {
  // JSON.parse recurses per level and gives out before anything here does, so
  // the guard has to wrap it rather than only the conversion below.
  const doc: unknown = guardStackDepth(
    () => JSON.parse(stripTrailingCommas(stripComments(stripBom(input))), bigIntReviver) as unknown,
    msg => depthError(`jsonc: ${msg}`),
  )
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ConfigError(
      `jsonc: document root is ${Array.isArray(doc) ? 'an array' : typeof doc}, but a config root must be an object (spec F0.3)`,
      '',
    )
  }
  return fromMap(doc as Record<string, unknown>, originDescription)
}

/**
 * The reviver's third argument, standard since ES2025 and present in Node 22
 * (this package's minimum). `source` is the literal's own source text, which is
 * the only place an integer past 2^53 still exists intact after decoding.
 */
type ParseContext = { source?: string }

/** A JSON number literal is an integer when it has no fraction and no exponent. */
function isIntegerLiteral(source: string): boolean {
  return !/[.eE]/.test(source)
}

/**
 * Whether this runtime hands the reviver the literal's source text (the
 * JSON.parse source-access proposal). True on Node ≥ 22, this package's
 * minimum; a browser without it exists, and `parse()` is documented as usable
 * in one, so the capability is measured rather than assumed.
 */
const HAS_SOURCE_TEXT_ACCESS: boolean = (() => {
  let seen: string | undefined
  JSON.parse('1', function (_k, v, context?: ParseContext) {
    seen = context?.source
    return v as unknown
  } as (this: unknown, key: string, value: unknown) => unknown)
  return seen !== undefined
})()

/**
 * Route an integer literal that a JS `number` cannot hold exactly into a
 * BigInt, so `fromMap` receives its digits rather than a rounded double
 * (spec F0.5: `Number`-only decoding is exactly the forbidden case). Values
 * past int64 are refused there; floats and safe integers pass through
 * untouched.
 *
 * Without source text there is no lossless path, and quietly returning the
 * rounded double would be the very thing F0.5 forbids — a snowflake ID silently
 * off by one. So the document is refused instead, and only when it actually
 * contains such a literal: a config with no oversized integer keeps working on
 * a runtime that lacks the proposal.
 */
function bigIntReviver(this: unknown, key: string, value: unknown, context?: ParseContext): unknown {
  if (typeof value !== 'number' || Number.isSafeInteger(value)) return value
  const source = context?.source
  if (source === undefined) {
    if (!Number.isInteger(value)) return value  // a float too large to be safe is still a float
    throw new ConfigError(
      `jsonc: the integer at "${key || '<root>'}" needs more precision than a JS number holds, and this runtime ` +
      `does not expose JSON.parse source text (${HAS_SOURCE_TEXT_ACCESS ? 'unexpected — the capability probe said otherwise' : 'requires Node >= 22 or an engine with JSON.parse source access'}), ` +
      `so it cannot be read losslessly (spec F0.5)`,
      key,
    )
  }
  if (!isIntegerLiteral(source)) return value
  return BigInt(source)
}

/**
 * A line break in the JSONC dialect: **LF or CR only**.
 *
 * U+2028/U+2029 deliberately do not end a comment (F3.2). They are line breaks
 * to ECMAScript and to most editors, but `node-jsonc-parser` \u2014 the
 * implementation that defines this dialect, and what VS Code reads its own
 * config with \u2014 recognizes only LF and CR, so a `//` comment there runs *through*
 * a U+2028 to the next real break. Ending early here would make
 * `{"a":1, // note\u2028"b":2,\n "c":3}` mean one thing in the editor that owns
 * the format and another in this library: same document, different data.
 * go.hocon, py.hocon and rs.hocon all scan for LF/CR alone.
 */
function isLineBreak(c: string | undefined): boolean {
  return c === '\n' || c === '\r'
}

/**
 * The line breaks contained in `span`, in order \u2014 the replacement text for a
 * removed comment.
 *
 * The invariant is that the stripped document has the *same line structure as
 * the source*, so a position `JSON.parse` reports still points at the line the
 * author wrote. Measured against V8: LF, CR and CRLF are all line breaks for its
 * reporting, and CRLF counts as **one**. So a CR is given back as a CR, and a
 * CRLF is emitted as the pair rather than as two breaks.
 *
 * U+2028/U+2029 are not line breaks in this dialect (see {@link isLineBreak}),
 * so inside a comment they are ordinary body text and contribute nothing here.
 * They could not be emitted anyway: V8 refuses them between tokens \u2014 they are
 * not JSON whitespace \u2014 so stripped output must never contain one.
 *
 * A U+2028 inside a *string literal* is data, preserved verbatim, and
 * `JSON.parse` does not count it as a break, so line numbers can trail an
 * editor's for such a document. That is a property of JSON itself, not of
 * comment stripping.
 */
function lineBreaksOf(span: string): string {
  let out = ''
  for (let i = 0; i < span.length; i++) {
    const c = span[i]
    if (c === '\r') {
      if (span[i + 1] === '\n') {
        out += '\r\n'
        i++
      } else {
        out += '\r'
      }
    } else if (c === '\n') {
      out += '\n'
    }
  }
  return out
}

/**
 * Remove `//` line comments and block comments, leaving string literals alone.
 *
 * F3.2: a comment is replaced by *whitespace*, never the empty string — it must
 * keep separating the tokens around it, so a `1`, a block comment and a `2` stay
 * two tokens and fail the JSON decode instead of silently reading as `12`.
 * Newlines inside a removed span are kept so JSON.parse still reports useful
 * positions; a span with no newline becomes a single space.
 *
 * A `//` comment ends at **LF or CR** (F3.2), and at nothing else. Stopping only
 * at LF let a CR-terminated comment eat the rest of the line, and the
 * trailing-comma pass then tidied the remains into valid JSON — so
 * `{"a":1,//c\r"b":2,\n"c":3}` decoded as `{"a":1,"c":3}`, losing a key with no
 * error at all. Stopping at U+2028/U+2029 would be the mirror-image mistake:
 * ending a comment the dialect's own parser is still inside, so the document
 * would mean something different here than in VS Code. See {@link isLineBreak}.
 */
export function stripComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      const end = endOfString(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && !isLineBreak(src[i])) i++
      // The terminator itself is left in the stream: LF and CR are JSON
      // whitespace, so it both separates the tokens and keeps the line count
      // right — CRLF included, since the loop copies both halves and V8 counts
      // the pair as one break. At EOF there is nothing left to separate.
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new ConfigError('jsonc: unterminated block comment', '')
      // Give back exactly the line breaks the span contained, or a space when it
      // contained none (a comment must still separate the tokens around it).
      out += lineBreaksOf(src.slice(i, end + 2)) || ' '
      i = end + 2
      continue
    }
    out += c
    i++
  }
  return out
}

/** Index just past the string literal starting at `i`. */
function endOfString(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++
    else if (src[j] === '"') return j + 1
  }
  throw new ConfigError('jsonc: unterminated string literal', '')
}

/** Drop a comma whose next meaningful character closes its object or array. */
function stripTrailingCommas(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      const end = endOfString(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < src.length && /\s/.test(src[j] as string)) j++
      if (src[j] === '}' || src[j] === ']') {
        i++
        continue
      }
    }
    out += c
    i++
  }
  return out
}
