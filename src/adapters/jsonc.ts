import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'

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
 * See docs/specs/format-ingestion-mapping.md items F3.x in the hocon scope.
 */
export function parseJsonc(input: string, originDescription?: string): Config {
  const doc: unknown = JSON.parse(stripTrailingCommas(stripComments(stripBom(input))), bigIntReviver)
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

/** Every character that ends a line: LF, CR, and the Unicode separators. */
function isLineTerminator(c: string | undefined): boolean {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029'
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
 * A `//` comment ends at **any** line terminator, not just LF. Stopping only at
 * LF lets a CR-terminated comment eat the rest of the line, and the
 * trailing-comma pass then tidies the remains into valid JSON — so
 * `{"a":1,//c\r"b":2,\n"c":3}` decoded as `{"a":1,"c":3}`, losing a key with no
 * error at all. That is the failure mode this project exists to avoid.
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
      while (i < src.length && !isLineTerminator(src[i])) i++
      // LF and CR are JSON whitespace, so leaving the terminator in the stream
      // both separates the tokens and keeps line numbers honest. U+2028/U+2029
      // are *not* JSON whitespace — emitting one would be a syntax error — so
      // they are consumed and replaced by a space.
      if (i < src.length && !(src[i] === '\n' || src[i] === '\r')) {
        out += ' '
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new ConfigError('jsonc: unterminated block comment', '')
      let newlines = ''
      for (const ch of src.slice(i, end + 2)) if (ch === '\n') newlines += '\n'
      out += newlines === '' ? ' ' : newlines
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
