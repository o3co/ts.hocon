import { ParseError } from '../../errors.js'
import type { Token, TokenKind } from './token.js'

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

      // Whitespace (not newline)
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance(); this.hadSpace = true; continue
      }

      // Newline
      if (ch === '\n') {
        this.advance()
        if (this.tokens[this.tokens.length - 1]?.kind !== 'newline') {
          this.push('newline', '\n', sl, sc)
        }
        continue
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
      if (ch in SINGLE_CHAR_TOKENS) { this.advance(); this.push(SINGLE_CHAR_TOKENS[ch], ch, sl, sc); continue }

      // = and +=
      if (ch === '=') { this.advance(); this.push('equals', '=', sl, sc); continue }
      if (ch === '+' && this.peek(1) === '=') { this.advance(); this.advance(); this.push('plus_equals', '+=', sl, sc); continue }

      // Substitution ${...} or ${?...}
      if (ch === '$' && this.peek(1) === '{') {
        this.advance(); this.advance()
        const optional = this.peek() === '?'
        if (optional) this.advance()
        let path = ''
        while (this.pos < this.input.length && this.peek() !== '}') {
          if (this.peek() === '\n') throw new ParseError('unterminated substitution', sl, sc)
          path += this.advance()
        }
        if (this.peek() !== '}') throw new ParseError('unterminated substitution', sl, sc)
        this.advance()
        this.push(optional ? 'opt_subst' : 'subst', path.trim(), sl, sc)
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
        this.advance()
        let value = ''
        while (this.pos < this.input.length && this.peek() !== '"') {
          if (this.peek() === '\n') throw new ParseError('unterminated string', sl, sc)
          if (this.peek() === '\\') {
            this.advance()
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
                  throw new ParseError('Invalid unicode escape: not enough characters', this.line, this.col)
                }
                const hex = this.input.slice(this.pos, this.pos + 4)
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                  throw new ParseError(`Invalid unicode escape: \\u${hex}`, this.line, this.col)
                }
                value += String.fromCharCode(parseInt(hex, 16))
                for (let i = 0; i < 4; i++) this.advance()
                break
              }
              default:
                throw new ParseError(`Unknown escape sequence: \\${esc}`, this.line, this.col)
            }
          } else {
            value += this.advance()
          }
        }
        if (this.peek() !== '"') throw new ParseError('unterminated string', sl, sc)
        this.advance()
        this.push('string', value, sl, sc, true)
        continue
      }

      // Unquoted string (stops at terminators and $)
      if (isUnquotedStart(ch)) {
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
}

export function tokenize(input: string): Token[] {
  return new Lexer(input).tokenize()
}

function isUnquotedStart(ch: string): boolean {
  return ch !== '' && !'{}[],:=+#\n\r\t "$?!@*&^\\'.includes(ch)
}

function isUnquotedContinue(ch: string, nextFn: () => string): boolean {
  if (ch === '' || '{}[],:=\n\r\t #"$?!@*&^\\'.includes(ch) || ch === ' ') return false
  if (ch === '+' && nextFn() === '=') return false
  if (ch === '/' && nextFn() === '/') return false
  return true
}
