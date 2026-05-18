import { ParseError } from '../../errors.js'
import type { Segment, SubstPayload, Token, TokenKind } from './token.js'

/**
 * Returns true if `ch` is a HOCON whitespace character per spec §Whitespace
 * (HOCON.md L165-184). This is the canonical single-source predicate; all
 * lexer call sites route through it: the main loop whitespace-skip, the
 * substitution body inter-segment whitespace skip, `isUnquotedSubstChar`,
 * `isUnquotedStart`, and `isUnquotedContinue`.
 *
 * HOCON_WS = Java Character.isWhitespace set
 *          ∪ { 0x00A0, 0x2007, 0x202F }   (NBSP variants Java excludes)
 *          ∪ { 0xFEFF }                    (BOM)
 *
 * NOTE: 0x0A (LF) is included here but isHoconNewline takes priority in the
 * main loop — the caller must check isHoconNewline BEFORE isHoconWhitespace.
 * NOTE: Do NOT use regex /\s/ (misses 0x1C-0x1F) or stdlib unicode.IsSpace
 * (includes NEL 0x0085 which HOCON does not list). Hardcode the set.
 */
function isHoconWhitespace(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? -1
  // ASCII control whitespace: tab, LF, VT, FF, CR
  if (cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D) return true
  // File/group/record/unit separators (0x1C-0x1F)
  if (cp >= 0x1C && cp <= 0x1F) return true
  // ASCII space, NBSP (0x00A0), BOM (0xFEFF) — fast path
  if (cp === 0x20 || cp === 0xA0 || cp === 0xFEFF) return true
  // Ogham space mark (Zs)
  if (cp === 0x1680) return true
  // En quad through hair space (Zs, 0x2000-0x200A)
  if (cp >= 0x2000 && cp <= 0x200A) return true
  // Line separator (Zl), paragraph separator (Zp), narrow no-break space (Zs),
  // medium mathematical space (Zs)
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F) return true
  // Ideographic space (Zs)
  if (cp === 0x3000) return true
  return false
}

/**
 * Returns true only for ASCII LF (0x0A), the sole HOCON newline character.
 * Per HOCON.md L182-184: "newline refers only and specifically to ASCII
 * newline 0x000A". Zl (0x2028) and Zp (0x2029) are whitespace, NOT newlines.
 * Must be checked BEFORE isHoconWhitespace in the main lexer loop.
 */
function isHoconNewline(ch: string): boolean {
  return ch === '\n'
}

const SINGLE_CHAR_TOKENS: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  ',': 'comma',
  ':': 'colon',
}

class Lexer {
  private pos = 0
  private line = 1
  private col = 1
  private hadSpace = false
  private tokens: Token[] = []

  constructor(private input: string) {
    if (input.charCodeAt(0) === 0xfeff) this.input = input.slice(1)
  }

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      const sl = this.line, sc = this.col
      const ch = this.peek()

      // Newline — must be checked before isHoconWhitespace because
      // isHoconWhitespace returns true for 0x0A (LF); if whitespace were
      // checked first, LF would be silently consumed and no newline token emitted.
      if (isHoconNewline(ch)) {
        this.advance()
        if (this.tokens[this.tokens.length - 1]?.kind !== 'newline') {
          this.push('newline', '\n', sl, sc)
        }
        continue
      }

      // Whitespace (not newline) — expanded to full HOCON_WS set per spec §Whitespace
      if (isHoconWhitespace(ch)) {
        this.advance(); this.hadSpace = true; continue
      }

      // Comments
      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.input.length && this.peek() !== '\n') this.advance()
        this.hadSpace = true; continue
      }
      if (ch === '#') {
        while (this.pos < this.input.length && this.peek() !== '\n') this.advance()
        this.hadSpace = true; continue
      }

      // Single-char punctuation
      if (ch in SINGLE_CHAR_TOKENS) { this.advance(); this.push(SINGLE_CHAR_TOKENS[ch] as TokenKind, ch, sl, sc); continue }

      // = and +=
      if (ch === '=') { this.advance(); this.push('equals', '=', sl, sc); continue }
      if (ch === '+' && this.peek(1) === '=') { this.advance(); this.advance(); this.push('plus_equals', '+=', sl, sc); continue }

      // Substitution ${...} or ${?...}
      if (ch === '$' && this.peek(1) === '{') {
        this.advance(); this.advance() // consume '$' and '{'
        const payload = this.parseSubstBody(sl, sc)
        // Reconstruct canonical value string from segments (mirrors rs.hocon logic)
        const value = payload.segments
          .map(s => {
            const t = s.text
            if (
              t === '' ||
              t.includes('.') ||
              t.includes(' ') ||
              t.includes('\t') ||
              t.includes('"') ||
              t.includes('\\') ||
              t !== t.trim()
            ) {
              const escaped = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
              return `"${escaped}"`
            }
            return t
          })
          .join('.')
        this.pushSubst(payload, value, sl, sc)
        continue
      }

      // Triple-quoted string
      if (ch === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.advance(); this.advance(); this.advance()
        let value = ''
        let closed = false
        while (this.pos < this.input.length) {
          if (this.peek() === '"') {
            // Count consecutive quotes
            let quoteCount = 0
            while (this.pos < this.input.length && this.peek() === '"') {
              quoteCount++
              this.advance()
            }
            if (quoteCount >= 3) {
              // Last 3 quotes are the closing delimiter; extras are content
              for (let i = 0; i < quoteCount - 3; i++) value += '"'
              closed = true
              break
            }
            // Fewer than 3 quotes — they are content
            for (let i = 0; i < quoteCount; i++) value += '"'
            continue
          }
          value += this.advance()
        }
        if (!closed) {
          throw new ParseError('unterminated triple-quoted string', sl, sc)
        }
        if (value.startsWith('\n')) value = value.slice(1)
        this.push('triple_string', value, sl, sc, true)
        continue
      }

      // Quoted string
      if (ch === '"') {
        this.advance() // consume opening '"'
        const value = this.readQuotedStringBody(sl, sc)
        this.push('string', value, sl, sc, true)
        continue
      }

      // Unquoted string (stops at terminators and $)
      if (isUnquotedStart(ch)) {
        // S8.6 (HOCON.md L270–276): an unquoted string starting with '-' MUST
        // be followed by a digit (so the run BEGINS what could be a number
        // literal — full number validity is not enforced here; e.g. '-1foo'
        // is permitted as a single unquoted token because '-1' starts a valid
        // number prefix). Bare '-' and '-foo' / '-bar' inputs are lex errors.
        // Digit-leading runs (e.g. '123abc') intentionally remain a single
        // unquoted token — ts.hocon has no separate number token, so spec
        // compliance for digit-leading runs is provided behaviorally via
        // value coercion (the resolved string value matches Lightbend's
        // value-concat result). See docs/spec-compliance.md §S8.6.
        if (ch === '-' && !isDecimalDigit(this.peek(1))) {
          const after = this.peek(1) === '' ? 'EOF' : JSON.stringify(this.peek(1))
          throw new ParseError(
            `unquoted string cannot begin with '-' unless followed by a digit (got '-' then ${after}, HOCON.md L270-276)`,
            sl, sc
          )
        }
        let value = ''
        while (this.pos < this.input.length && isUnquotedContinue(this.peek(), () => this.peek(1))) {
          value += this.advance()
        }
        this.push('unquoted', value.trimEnd(), sl, sc)
        continue
      }

      throw new ParseError(`unexpected character: ${JSON.stringify(ch)}`, sl, sc)
    }

    this.tokens.push({ kind: 'eof', value: '', line: this.line, col: this.col, isQuoted: false, precedingSpace: false })
    return this.tokens
  }

  private peek(offset = 0): string { return this.input[this.pos + offset] ?? '' }

  private advance(): string {
    const ch = this.input[this.pos++] ?? ''
    if (ch === '\n') { this.line++; this.col = 1 } else { this.col++ }
    return ch
  }

  private push(kind: TokenKind, value: string, l: number, c: number, isQuoted = false): void {
    this.tokens.push({ kind, value, line: l, col: c, isQuoted, precedingSpace: this.hadSpace })
    this.hadSpace = false
  }

  private pushSubst(payload: SubstPayload, value: string, l: number, c: number): void {
    this.tokens.push({ kind: 'subst', value, line: l, col: c, isQuoted: false, precedingSpace: this.hadSpace, subst: payload })
    this.hadSpace = false
  }

  /**
   * Read body of a quoted string. Opening `"` must already be consumed.
   * Returns decoded string. Throws ParseError on unterminated/invalid-escape.
   * openLine/openCol are the position of the opening `"` for error reporting.
   */
  private readQuotedStringBody(openLine: number, openCol: number): string {
    let value = ''
    while (this.pos < this.input.length && this.peek() !== '"') {
      if (this.peek() === '\n') throw new ParseError('unterminated string', openLine, openCol)
      if (this.peek() === '\\') {
        const escCol = this.col
        this.advance() // consume '\'
        if (this.pos >= this.input.length) {
          throw new ParseError('unterminated string', openLine, openCol)
        }
        const esc = this.advance()
        switch (esc) {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'r': value += '\r'; break
          case '"': value += '"'; break
          case '\\': value += '\\'; break
          case '/': value += '/'; break
          case 'b': value += '\b'; break
          case 'f': value += '\f'; break
          case 'u': {
            if (this.pos + 4 > this.input.length) {
              throw new ParseError('invalid unicode escape', openLine, escCol)
            }
            const hex = this.input.slice(this.pos, this.pos + 4)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new ParseError('invalid unicode escape', openLine, escCol)
            }
            const code = parseInt(hex, 16)
            // Accept all \uXXXX escapes including surrogate code units (0xD800–0xDFFF).
            // TypeScript strings are sequences of UTF-16 code units (same as Java/Lightbend),
            // so surrogate code units are valid string contents — paired or lone.
            // This intentionally diverges from rs.hocon, which rejects surrogates because
            // Rust's `char` cannot represent them. See spec "Surrogate codepoint divergence" note.
            value += String.fromCharCode(code)
            for (let i = 0; i < 4; i++) this.advance()
            break
          }
          default:
            throw new ParseError(`unknown escape sequence: \\${esc}`, openLine, escCol)
        }
      } else {
        value += this.advance()
      }
    }
    if (this.pos >= this.input.length || this.peek() !== '"') {
      throw new ParseError('unterminated string', openLine, openCol)
    }
    this.advance() // consume closing '"'
    return value
  }

  /**
   * Parse the body of a `${...}` substitution (called after `${` has been consumed).
   * Implements Appendix A state machine from the cross-language spec.
   *
   * S13c extension: if the segment-collection loop encounters `[`, it delegates to
   * `parseListSuffix()` which consumes the literal `[]` and sets `listSuffix=true`.
   * ASCII space/tab before `[` is buffered in `pendingWs` and discarded (E7).
   */
  private parseSubstBody(startLine: number, startCol: number): SubstPayload {
    // Check for optional sigil
    let optional = false
    if (this.peek() === '?') {
      this.advance()
      optional = true
    }

    // Current segment accumulation state
    let curText = ''
    let curStarted = false
    let curLine = 0
    let curCol = 0

    let pendingWs = ''
    const segments: Segment[] = []
    // Track last-seen dot position for trailing-dot error reporting
    let lastDot: [number, number] | null = null
    let listSuffix = false

    while (true) {
      if (this.pos >= this.input.length) {
        throw new ParseError('unterminated substitution', startLine, startCol)
      }
      const ch = this.peek()

      if (ch === '}') {
        this.advance()
        pendingWs = '' // trailing WS discarded
        break // goto END
      } else if (ch === '[') {
        // S13c: `[]` suffix arm — fires at segment boundary (before `}`).
        // `isUnquotedSubstChar` rejects `[` so mid-segment `[` never reaches here;
        // this arm only fires when we are between segments or after the path text.
        if (!curStarted && segments.length === 0) {
          throw new ParseError('empty segment before \'[]\' suffix in substitution path', startLine, this.col)
        }
        // Flush in-progress segment (mirrors the `}` flush path).
        if (curStarted) {
          segments.push({ text: curText, line: curLine, col: curCol })
        }
        pendingWs = '' // discard E7 inter-token whitespace before `[`
        listSuffix = this.parseListSuffix(startLine)
        break // goto END (closing `}` is consumed next)
      } else if (ch === '"') {
        // QUOTED token
        const qLine = startLine // substitutions cannot span newlines, so same line
        const qCol = this.col
        if (curStarted) {
          curText += pendingWs
        }
        pendingWs = ''
        this.advance() // consume opening '"'
        const decoded = this.readQuotedStringBody(qLine, qCol)
        curText += decoded
        if (!curStarted) {
          curLine = qLine
          curCol = qCol
          curStarted = true
        }
      } else if (isUnquotedSubstChar(ch)) {
        // S8.6 (HOCON.md L270–276) also applies to unquoted path segments
        // inside ${...}: a segment beginning with '-' must be followed by a
        // digit. Gate on `!curStarted` so the check fires only at segment
        // start — a `-` that follows a quoted fragment in the same segment
        // (e.g. ${"a"-foo} resolving the key "a-foo" via quoted/unquoted
        // concat) is not policed, mirroring how the existing ${"a"x} flow
        // builds "ax". Digit-leading segments are not policed here either
        // (consistent with the value-position rule and ts.hocon's unquoted-
        // only token model — see docs/spec-compliance.md §S8.6).
        if (ch === '-' && !curStarted && !isDecimalDigit(this.peek(1))) {
          const after = this.peek(1) === '' ? 'EOF' : JSON.stringify(this.peek(1))
          throw new ParseError(
            `unquoted path segment cannot begin with '-' unless followed by a digit (got '-' then ${after}, HOCON.md L270-276)`,
            startLine, this.col
          )
        }
        // UNQUOTED token: read a run of unquoted chars
        const uCol = this.col
        if (curStarted) {
          curText += pendingWs
        }
        pendingWs = ''
        if (!curStarted) {
          curLine = startLine // always same line as ${; no newlines allowed
          curCol = uCol
          curStarted = true
        }
        while (this.pos < this.input.length && isUnquotedSubstChar(this.peek())) {
          curText += this.advance()
        }
      } else if (ch === '.') {
        // DOT: flush current segment (or error if not started)
        const dotCol = this.col
        pendingWs = ''
        if (!curStarted) {
          throw new ParseError('empty segment in path', startLine, dotCol)
        }
        segments.push({ text: curText, line: curLine, col: curCol })
        curText = ''
        curStarted = false
        curLine = 0
        curCol = 0
        lastDot = [startLine, dotCol]
        this.advance()
      } else if (isHoconNewline(ch)) {
        // LF inside ${...} is an error: substitutions cannot span newlines
        throw new ParseError('unterminated substitution', startLine, startCol)
      } else if (isHoconWhitespace(ch)) {
        // Non-newline HOCON whitespace (incl. NBSP, Zs/Zl/Zp, vtab, FS-US, BOM):
        // buffer into pendingWs; col advances in this.advance() per §F.
        // CR is whitespace, not newline — it is buffered here, not an error.
        pendingWs += ch
        this.advance()
      } else {
        throw new ParseError(`unexpected character in substitution path: ${JSON.stringify(ch)}`, startLine, this.col)
      }
    }

    // END validation (only reached via `}` break; `[` break guarantees curStarted flush)
    if (!listSuffix) {
      if (curStarted) {
        segments.push({ text: curText, line: curLine, col: curCol })
      } else if (segments.length === 0) {
        // ${}
        throw new ParseError('empty substitution path', startLine, startCol)
      } else {
        // trailing dot: ${foo.} — report at the offending dot position
        const [errLine, errCol] = lastDot ?? [startLine, startCol]
        throw new ParseError('empty segment in path', errLine, errCol)
      }
    }

    return { segments, optional, listSuffix }
  }

  /**
   * Consume the literal `[]` suffix inside a substitution body.
   * Called after the `[` has been detected (but not yet consumed).
   * Requires the next character to be `[`, then exactly `]`, then `}`.
   * Whitespace inside `[]` is not permitted (per spec Decision §1).
   * Returns true (always — only called when listSuffix path is taken).
   */
  private parseListSuffix(startLine: number): boolean {
    // consume `[`
    this.advance()
    const afterBracket = this.peek()
    if (afterBracket !== ']') {
      const desc = afterBracket === '' ? 'EOF' : JSON.stringify(afterBracket)
      throw new ParseError(
        `expected ']' after '[' in substitution list suffix (got ${desc})`,
        startLine, this.col
      )
    }
    // consume `]`
    this.advance()
    // The caller's loop has broken; next must be `}` which is consumed by the
    // parent `}` arm on the *next* iteration — but since we broke out of the
    // loop, the parent code must consume `}`. We require it here directly.
    if (this.peek() !== '}') {
      const desc = this.peek() === '' ? 'EOF' : JSON.stringify(this.peek())
      throw new ParseError(
        `expected '}' after '[]' in substitution list suffix (got ${desc})`,
        startLine, this.col
      )
    }
    this.advance() // consume `}`
    return true
  }
}

export function tokenize(input: string): Token[] {
  return new Lexer(input).tokenize()
}

/**
 * Returns true if `ch` is a valid unquoted character inside a `${...}` body.
 * Forbidden: whitespace (full HOCON_WS set), `"`, `\`, structural chars,
 * operators, sigils.
 */
function isUnquotedSubstChar(ch: string): boolean {
  if (ch === '' || isHoconWhitespace(ch)) return false
  if ('"\\'.includes(ch)) return false
  if ('{}[]'.includes(ch)) return false
  if (':=,+#`^?!@*&$.'.includes(ch)) return false
  return true
}

function isDecimalDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isUnquotedStart(ch: string): boolean {
  if (ch === '' || isHoconWhitespace(ch)) return false
  if ('{}[],:=+#"$?!@*&^\\'.includes(ch)) return false
  return true
}

function isUnquotedContinue(ch: string, nextFn: () => string): boolean {
  if (ch === '' || isHoconWhitespace(ch)) return false
  if ('{}[],:=#"$?!@*&^\\'.includes(ch)) return false
  if (ch === '+' && nextFn() === '=') return false
  if (ch === '/' && nextFn() === '/') return false
  return true
}
