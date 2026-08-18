import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'
import { depthError, guardStackDepth } from '../internal/depth.js'

/**
 * Read JSON5 (https://json5.org, spec 1.0.0) as HOCON config.
 *
 * Unlike the jsonc adapter — which strips comments and hands the rest to
 * `JSON.parse` — JSON5 changes the token grammar itself (unquoted identifier
 * keys, single-quoted strings with line continuations, hex integers, leading
 * and trailing decimal points, an explicit plus sign), so this adapter is a
 * hand-rolled scanner and recursive-descent parser. Zero dependencies, like
 * every adapter in this package; it is a port of go.hocon's `adapters/json5`.
 *
 * The accepted grammar is JSON5 1.0.0 as defined by the reference
 * implementation (the json5 npm package), the dialect owner this spec item
 * tracks — the same ownership rule F3.2 applies to JSONC. That is why a `//`
 * comment here ends at LS/PS as well as LF/CR, while the jsonc adapter's runs
 * through them: each dialect's owner decides. Where the mapping spec is
 * stricter than JSON5, the spec wins:
 *
 *   - `Infinity` and `NaN` (signed or bare) are errors, not values (spec F0.6).
 *   - Integers — decimal or hex — must fit in int64 (spec F0.5); a number
 *     written with `.`, `e` or `E` is a float, all other decimal forms and
 *     every hex form are integers. An integer past 2^53 is carried as a
 *     `bigint` so its digits survive verbatim (`getString` returns them
 *     exactly); `getNumber` and `toObject` still apply the JS number model,
 *     as they do for HOCON's own literals.
 *   - An unpaired `\uXXXX` surrogate **escape** is an error, and a valid pair
 *     combines into the astral codepoint (spec F3.5). This deliberately
 *     differs from the jsonc adapter, which accepts one: there `JSON.parse` —
 *     the host language's own decoder — owns the escape, and refusing would be
 *     the spec overriding the platform (the S1.2.6 class). Here the scanner is
 *     ours, so the four implementations can and do agree. A lone surrogate
 *     *code unit* sitting raw in the source string is still accepted as data —
 *     a JavaScript string is UTF-16 and holds it natively; go.hocon's
 *     equivalent check rejects invalid UTF-8 bytes, a case that cannot arise
 *     in a JS string.
 *   - Duplicate keys follow HOCON semantics: objects merge, otherwise the
 *     later value wins (spec F0.7).
 *   - The document holds exactly one value; whitespace and comments may follow
 *     it, anything else is an error (the F3.2 strictness rule).
 *
 * See the F3.x items in the format-ingestion mapping spec:
 * https://github.com/o3co/xx.hocon/blob/main/docs/format-ingestion-mapping.md
 */
export function parseJson5(input: string, originDescription?: string): Config {
  // F0.9: a leading BOM is not data. (JSON5 additionally treats U+FEFF as
  // whitespace anywhere, which the scanner handles; stripping here keeps the
  // origin column of the first token honest.)
  const p = new Parser(stripBom(input), originDescription)
  // The parser recurses once per nesting level, so the guard has to wrap it —
  // fromMap below carries its own.
  const doc = guardStackDepth(
    () => p.parseDocument(),
    msg => depthError(`json5: ${describe(originDescription)}: ${msg}`),
  )
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ConfigError(
      `json5: ${describe(originDescription)}: document root is ${rootKind(doc)}, but a config root must be an object (spec F0.3)`,
      '',
    )
  }
  return fromMap(doc, originDescription)
}

function describe(origin: string | undefined): string {
  return origin === undefined || origin === '' ? 'document' : origin
}

function rootKind(doc: Json5Value): string {
  if (doc === null) return 'null'
  if (Array.isArray(doc)) return 'an array'
  return typeof doc
}

// ─── Scanner / parser ─────────────────────────────────────────────────────────

type Json5Value = null | boolean | string | number | bigint | Json5Value[] | Json5Object
type Json5Object = { [key: string]: Json5Value }

/** HOCON integers are int64-wide (spec F0.5); past these bounds is an error. */
const INT64_MAX = 9223372036854775807n
const INT64_MIN = -9223372036854775808n

/**
 * The JSON5 LineTerminator set: LF, CR, LS, PS. This deliberately differs from
 * the jsonc adapter (F3.2), whose dialect owner ends `//` comments at LF/CR
 * only — the JSON5 spec includes LS and PS.
 */
function isLineTerminator(cp: number): boolean {
  return cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029
}

const ZS_RE = /^\p{Zs}$/u

/** The JSON5 WhiteSpace set: TAB, VT, FF, SP, NBSP, BOM, and any Unicode Zs. */
function isJson5Space(cp: number): boolean {
  switch (cp) {
    case 0x09:
    case 0x0b:
    case 0x0c:
    case 0x20:
    case 0xa0:
    case 0xfeff:
      return true
    default:
      return ZS_RE.test(String.fromCodePoint(cp))
  }
}

// isIdentStart / isIdentPart implement ES5 IdentifierName characters, the key
// grammar the JSON5 spec adopts: start = UnicodeLetter (Lu Ll Lt Lm Lo Nl) |
// '$' | '_'; part adds Mn Mc Nd Pc and ZWNJ/ZWJ.
const IDENT_START_RE = /^[\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Nl}]$/u
const IDENT_PART_EXTRA_RE = /^[\p{Mn}\p{Mc}\p{Nd}\p{Pc}]$/u

function isIdentStart(cp: number): boolean {
  return cp === 0x24 || cp === 0x5f || IDENT_START_RE.test(String.fromCodePoint(cp))
}

function isIdentPart(cp: number): boolean {
  return (
    isIdentStart(cp) || cp === 0x200c || cp === 0x200d ||
    IDENT_PART_EXTRA_RE.test(String.fromCodePoint(cp))
  )
}

/**
 * Whether `s` continues with an identifier character at index `i` — used to
 * reject tokens like `nullx`, and to keep `Infinityx` an unexpected token
 * rather than the F0.6 case.
 */
function continuesIdentifier(s: string, i: number): boolean {
  if (i >= s.length) return false
  return isIdentPart(s.codePointAt(i) as number)
}

function isHexDigit(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

const hex4 = (cp: number): string => cp.toString(16).toUpperCase().padStart(4, '0')

/** Whether this parsed value is an object (for F0.7 duplicate-key merging). */
function isPlainObject(v: Json5Value): v is Json5Object {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Merge `src` over `dst` per HOCON duplicate-key semantics (F0.7), returning a
 * new object. Carriers are null-prototype so a `__proto__` key stays an own
 * property (the F2.9 principle: safety by construction, never by dropping keys).
 */
function mergeObjects(dst: Json5Object, src: Json5Object): Json5Object {
  const out = Object.create(null) as Json5Object
  for (const [k, v] of Object.entries(dst)) out[k] = v
  for (const [k, v] of Object.entries(src)) {
    const prev = k in out ? out[k] : undefined
    if (prev !== undefined && isPlainObject(prev) && isPlainObject(v)) {
      out[k] = mergeObjects(prev, v)
    } else {
      out[k] = v
    }
  }
  return out
}

class Parser {
  private pos = 0 // UTF-16 code unit offset
  private line = 0 // 0-based; reported 1-based
  private lineAt = 0 // code unit offset where the current line starts

  constructor(
    private readonly src: string,
    private readonly origin: string | undefined,
  ) {}

  private errf(msg: string): ConfigError {
    const col = [...this.src.slice(this.lineAt, this.pos)].length + 1
    return new ConfigError(
      `json5: ${describe(this.origin)}: line ${this.line + 1} col ${col}: ${msg}`,
      '',
    )
  }

  /** The code point at `pos` (caller guarantees `pos < src.length`). */
  private rune(): { cp: number; size: number } {
    const cp = this.src.codePointAt(this.pos) as number
    return { cp, size: cp > 0xffff ? 2 : 1 }
  }

  private advance(cp: number, size: number): void {
    this.pos += size
    if (isLineTerminator(cp)) {
      // Treat CRLF as one terminator for line counting.
      if (cp === 0x0d && this.src[this.pos] === '\n') this.pos++
      this.line++
      this.lineAt = this.pos
    }
  }

  /**
   * Parse exactly one JSON5 value, allowing only whitespace and comments after
   * it (the F3.2 strictness rule).
   */
  parseDocument(): Json5Value {
    this.skipSpace()
    const v = this.parseValue()
    this.skipSpace()
    if (this.pos < this.src.length) {
      throw this.errf('unexpected content after top-level value')
    }
    return v
  }

  /** Consume whitespace, line terminators, and both comment forms. */
  private skipSpace(): void {
    while (this.pos < this.src.length) {
      const { cp, size } = this.rune()
      if (isJson5Space(cp) || isLineTerminator(cp)) {
        this.advance(cp, size)
        continue
      }
      if (cp === 0x2f && this.src[this.pos + 1] === '/') {
        this.pos += 2
        // A // comment ends at ANY JSON5 line terminator — LS/PS included,
        // unlike the jsonc dialect. The terminator itself is left for the
        // outer loop, which counts the line.
        while (this.pos < this.src.length) {
          const cp2 = this.src.codePointAt(this.pos) as number
          if (isLineTerminator(cp2)) break
          this.pos += cp2 > 0xffff ? 2 : 1
        }
        continue
      }
      if (cp === 0x2f && this.src[this.pos + 1] === '*') {
        this.pos += 2
        let closed = false
        while (this.pos < this.src.length) {
          const r2 = this.rune()
          if (r2.cp === 0x2a && this.src[this.pos + 1] === '/') {
            this.pos += 2
            closed = true
            break
          }
          this.advance(r2.cp, r2.size)
        }
        if (!closed) throw this.errf('unterminated /* comment')
        continue
      }
      return
    }
  }

  private parseValue(): Json5Value {
    if (this.pos >= this.src.length) {
      throw this.errf('unexpected end of input, expected a value')
    }
    const c = this.src[this.pos] as string
    if (c === '{') return this.parseObject()
    if (c === '[') return this.parseArray()
    if (c === '"' || c === "'") return this.parseString(c)
    if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) return this.parseNumber()
    return this.parseKeyword()
  }

  /**
   * Handle true/false/null, and reject Infinity/NaN by name so the error
   * explains itself (spec F0.6).
   */
  private parseKeyword(): Json5Value {
    const rest = this.src.slice(this.pos)
    for (const [kw, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (rest.startsWith(kw) && !continuesIdentifier(rest, kw.length)) {
        this.pos += kw.length
        return v
      }
    }
    for (const kw of ['Infinity', 'NaN']) {
      if (rest.startsWith(kw) && !continuesIdentifier(rest, kw.length)) {
        throw this.errf(`${kw} is not representable in the HOCON number model (spec F0.6)`)
      }
    }
    const first = String.fromCodePoint(rest.codePointAt(0) as number)
    throw this.errf(`unexpected character ${JSON.stringify(first)}`)
  }

  // ── Objects and arrays ──────────────────────────────────────────────────────

  private parseObject(): Json5Object {
    this.pos++ // '{'
    // Null-prototype carrier: `__proto__` must land as an own property, never
    // through the inherited setter (the F2.9 principle).
    const obj = Object.create(null) as Json5Object
    for (;;) {
      this.skipSpace()
      if (this.pos >= this.src.length) throw this.errf("unterminated object, expected '}'")
      if (this.src[this.pos] === '}') {
        this.pos++
        return obj
      }
      const key = this.parseMemberName()
      this.skipSpace()
      if (this.pos >= this.src.length || this.src[this.pos] !== ':') {
        throw this.errf(`expected ':' after object key ${JSON.stringify(key)}`)
      }
      this.pos++
      this.skipSpace()
      let val = this.parseValue()
      // F0.7: duplicate keys follow HOCON semantics — two objects merge, any
      // other combination is last-wins.
      if (key in obj) {
        const prev = obj[key] as Json5Value
        if (isPlainObject(prev) && isPlainObject(val)) val = mergeObjects(prev, val)
      }
      obj[key] = val
      this.skipSpace()
      if (this.pos >= this.src.length) throw this.errf("unterminated object, expected ',' or '}'")
      const c = this.src[this.pos]
      if (c === ',') {
        this.pos++ // trailing comma before '}' is legal; loop handles it
      } else if (c === '}') {
        this.pos++
        return obj
      } else {
        throw this.errf("expected ',' or '}' in object")
      }
    }
  }

  private parseArray(): Json5Value[] {
    this.pos++ // '['
    const arr: Json5Value[] = []
    for (;;) {
      this.skipSpace()
      if (this.pos >= this.src.length) throw this.errf("unterminated array, expected ']'")
      if (this.src[this.pos] === ']') {
        this.pos++
        return arr
      }
      arr.push(this.parseValue())
      this.skipSpace()
      if (this.pos >= this.src.length) throw this.errf("unterminated array, expected ',' or ']'")
      const c = this.src[this.pos]
      if (c === ',') {
        this.pos++ // trailing comma before ']' is legal; loop handles it
      } else if (c === ']') {
        this.pos++
        return arr
      } else {
        throw this.errf("expected ',' or ']' in array")
      }
    }
  }

  // ── Member names (quoted or ES5 IdentifierName) ─────────────────────────────

  private parseMemberName(): string {
    const c = this.src[this.pos]
    if (c === '"' || c === "'") return this.parseString(c)
    return this.parseIdentifier()
  }

  /**
   * Scan an ES5 IdentifierName, honouring `\uXXXX` escapes in the name (the
   * escaped codepoint must itself be a legal identifier character for its
   * position, per ES5 — `1` cannot start a key).
   */
  private parseIdentifier(): string {
    let name = ''
    let first = true
    while (this.pos < this.src.length) {
      const r = this.rune()
      let cp = r.cp
      let escaped = false
      if (cp === 0x5c /* backslash */) {
        if (this.src[this.pos + 1] !== 'u') {
          throw this.errf('only \\uXXXX escapes are allowed in identifiers')
        }
        this.pos += 2
        cp = this.readHex4()
        escaped = true
      }
      const legal = first ? isIdentStart(cp) : isIdentPart(cp)
      if (!legal) {
        if (escaped) {
          throw this.errf(`escape \\u${hex4(cp)} is not a valid identifier character here`)
        }
        if (first) {
          throw this.errf(`expected an object key, got ${JSON.stringify(String.fromCodePoint(cp))}`)
        }
        break
      }
      name += String.fromCodePoint(cp)
      if (!escaped) this.pos += r.size
      first = false
    }
    if (name.length === 0) throw this.errf('expected an object key')
    return name
  }

  /** Read exactly four hex digits at `pos` and return the code point. */
  private readHex4(): number {
    if (this.pos + 4 > this.src.length) throw this.errf('truncated \\u escape')
    const quad = this.src.slice(this.pos, this.pos + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(quad)) {
      throw this.errf(`invalid \\u escape ${JSON.stringify('\\u' + quad)}`)
    }
    this.pos += 4
    return parseInt(quad, 16)
  }

  // ── Strings ─────────────────────────────────────────────────────────────────

  /**
   * Scan a single- or double-quoted JSON5 string. `quote` is the opening quote
   * character. JSON5 differences from JSON: either quote character, `\xHH`
   * escapes, `\v`, `\0`, line continuations (backslash before a line
   * terminator, including CRLF as one), any other non-digit character escaping
   * to itself, and unescaped LS/PS allowed inside the string.
   */
  private parseString(quote: string): string {
    this.pos++ // opening quote
    let out = ''
    for (;;) {
      if (this.pos >= this.src.length) throw this.errf('unterminated string')
      const { cp, size } = this.rune()
      if (this.src[this.pos] === quote) {
        this.pos++
        return out
      }
      if (cp === 0x0a || cp === 0x0d) {
        throw this.errf('unescaped line terminator in string')
      }
      if (cp === 0x5c /* backslash */) {
        this.pos++
        out += this.readEscape()
        continue
      }
      // LS/PS are legal unescaped inside JSON5 strings; advance() still counts
      // them as line breaks for positions. A lone surrogate code unit is host
      // string data and passes through untouched (see the module doc).
      out += this.src.slice(this.pos, this.pos + size)
      this.advance(cp, size)
    }
  }

  /**
   * Consume one escape sequence (the backslash is already consumed) and return
   * its value.
   */
  private readEscape(): string {
    if (this.pos >= this.src.length) throw this.errf('unterminated escape sequence')
    const { cp, size } = this.rune()
    // Line continuation: backslash before a line terminator joins the lines,
    // contributing nothing. CRLF counts as one terminator.
    if (isLineTerminator(cp)) {
      this.advance(cp, size)
      return ''
    }
    const ch = String.fromCodePoint(cp)
    switch (ch) {
      case 'n':
        this.pos++
        return '\n'
      case 't':
        this.pos++
        return '\t'
      case 'r':
        this.pos++
        return '\r'
      case 'b':
        this.pos++
        return '\b'
      case 'f':
        this.pos++
        return '\f'
      case 'v':
        this.pos++
        return '\v'
      case '0': {
        // \0 is NUL unless followed by a decimal digit (octal escapes are not
        // part of JSON5).
        const next = this.src[this.pos + 1]
        if (next !== undefined && next >= '0' && next <= '9') {
          throw this.errf('octal escape sequences are not allowed')
        }
        this.pos++
        return '\0'
      }
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        throw this.errf(`escape \\${ch} is not allowed (digits cannot be escaped)`)
      case 'x': {
        this.pos++
        if (this.pos + 2 > this.src.length) throw this.errf('truncated \\x escape')
        const hh = this.src.slice(this.pos, this.pos + 2)
        if (!/^[0-9a-fA-F]{2}$/.test(hh)) throw this.errf('invalid \\x escape')
        this.pos += 2
        return String.fromCharCode(parseInt(hh, 16))
      }
      case 'u': {
        this.pos++
        const hi = this.readHex4()
        // F3.5: a lone surrogate escape is an error; a valid pair combines.
        if (hi >= 0xd800 && hi <= 0xdfff) {
          if (
            this.pos + 6 <= this.src.length &&
            this.src[this.pos] === '\\' &&
            this.src[this.pos + 1] === 'u'
          ) {
            this.pos += 2
            const lo = this.readHex4()
            if (hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) {
              return String.fromCodePoint(0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00))
            }
            throw this.errf(`unpaired \\u${hex4(hi)} surrogate (spec F3.5)`)
          }
          throw this.errf(`unpaired \\u${hex4(hi)} surrogate (spec F3.5)`)
        }
        return String.fromCharCode(hi)
      }
      default:
        // Any other character escapes to itself (JSON5 SingleEscapeCharacter
        // and NonEscapeCharacter collapse to this rule).
        this.advance(cp, size)
        return ch
    }
  }

  // ── Numbers ─────────────────────────────────────────────────────────────────

  /**
   * Scan a JSON5 numeric literal: optional sign, then a hex integer or a
   * decimal with optional leading/trailing point and exponent. Signed
   * Infinity/NaN are routed to the F0.6 error here.
   */
  private parseNumber(): number | bigint {
    const start = this.pos
    let neg = false
    const sign = this.src[this.pos]
    if (sign === '+' || sign === '-') {
      neg = sign === '-'
      this.pos++
    }
    const rest = this.src.slice(this.pos)
    for (const kw of ['Infinity', 'NaN']) {
      if (rest.startsWith(kw) && !continuesIdentifier(rest, kw.length)) {
        throw this.errf(`${kw} is not representable in the HOCON number model (spec F0.6)`)
      }
    }
    if (rest.startsWith('0x') || rest.startsWith('0X')) {
      this.pos += 2
      const ds = this.pos
      while (this.pos < this.src.length && isHexDigit(this.src[this.pos] as string)) this.pos++
      if (this.pos === ds) throw this.errf('hex literal needs at least one digit')
      const mag = BigInt('0x' + this.src.slice(ds, this.pos))
      const limit = neg ? 1n << 63n : (1n << 63n) - 1n
      if (mag > limit) {
        throw this.errf(`integer ${this.src.slice(start, this.pos)} does not fit in int64 (spec F0.5)`)
      }
      return integerValue(neg ? -mag : mag)
    }

    let sawDigit = false
    let sawDot = false
    let sawExp = false
    while (this.pos < this.src.length) {
      const c = this.src[this.pos] as string
      if (c >= '0' && c <= '9') {
        sawDigit = true
      } else if (c === '.' && !sawDot && !sawExp) {
        sawDot = true
      } else if ((c === 'e' || c === 'E') && sawDigit && !sawExp) {
        sawExp = true
        const n = this.src[this.pos + 1]
        if (n === '+' || n === '-') this.pos++
      } else {
        break
      }
      this.pos++
    }
    const text = this.src.slice(start, this.pos)
    if (!sawDigit) throw this.errf(`malformed number ${JSON.stringify(text)}`)
    // F0.5: '.', 'e', 'E' make a float; everything else is an integer or an
    // error. Number() accepts a leading '+' in both paths.
    if (sawDot || sawExp) {
      const f = Number(text)
      // An exponent past float range is what Go's strconv reports as an error
      // rather than a silent ±Inf; mirrored here so F0.6 stays unreachable.
      if (Number.isNaN(f) || !Number.isFinite(f)) {
        throw this.errf(`malformed number ${JSON.stringify(text)}`)
      }
      return f
    }
    const digits = text.startsWith('+') ? text.slice(1) : text
    const i = BigInt(digits)
    if (i > INT64_MAX || i < INT64_MIN) {
      throw this.errf(`integer ${text} does not fit in int64 (spec F0.5)`)
    }
    // Within the safe range the value travels as a JS number — Number("-0")
    // keeps the sign, which fromMap preserves like the core parser does; past
    // it, a bigint carries the digits verbatim (spec F0.5).
    if (i >= -9007199254740991n && i <= 9007199254740991n) return Number(digits)
    return i
  }
}

/** An int64-checked integer as a JS number when safe, else a lossless bigint. */
function integerValue(v: bigint): number | bigint {
  if (v >= -9007199254740991n && v <= 9007199254740991n) return Number(v)
  return v
}
