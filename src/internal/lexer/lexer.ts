import { ParseError } from '../../errors.js'
import type { Token, TokenKind } from './token.js'

export function tokenize(input: string): Token[] {
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1)

  const tokens: Token[] = []
  let pos = 0
  let line = 1
  let col = 1
  let hadSpace = false

  function peek(offset = 0): string { return input[pos + offset] ?? '' }

  function advance(): string {
    const ch = input[pos++] ?? ''
    if (ch === '\n') { line++; col = 1 } else { col++ }
    return ch
  }

  function push(kind: TokenKind, value: string, l: number, c: number, isQuoted = false): void {
    tokens.push({ kind, value, line: l, col: c, isQuoted, precedingSpace: hadSpace })
    hadSpace = false
  }

  while (pos < input.length) {
    const sl = line, sc = col
    const ch = peek()

    // Whitespace (not newline)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(); hadSpace = true; continue
    }

    // Newline
    if (ch === '\n') {
      advance()
      if (tokens[tokens.length - 1]?.kind !== 'newline') {
        push('newline', '\n', sl, sc)
      }
      continue
    }

    // Comments
    if (ch === '/' && peek(1) === '/') {
      while (pos < input.length && peek() !== '\n') advance()
      hadSpace = true; continue
    }
    if (ch === '#') {
      while (pos < input.length && peek() !== '\n') advance()
      hadSpace = true; continue
    }

    // Single-char punctuation
    const single: Record<string, TokenKind> = { '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket', ',': 'comma', ':': 'colon' }
    if (ch in single) { advance(); push(single[ch] as TokenKind, ch, sl, sc); continue }

    // = and +=
    if (ch === '=') { advance(); push('equals', '=', sl, sc); continue }
    if (ch === '+' && peek(1) === '=') { advance(); advance(); push('plus_equals', '+=', sl, sc); continue }

    // Substitution ${...} or ${?...}
    if (ch === '$' && peek(1) === '{') {
      advance(); advance()
      const optional = peek() === '?'
      if (optional) advance()
      let path = ''
      while (pos < input.length && peek() !== '}') {
        if (peek() === '\n') throw new ParseError('unterminated substitution', sl, sc)
        path += advance()
      }
      if (peek() !== '}') throw new ParseError('unterminated substitution', sl, sc)
      advance()
      push(optional ? 'opt_subst' : 'subst', path.trim(), sl, sc)
      continue
    }

    // Triple-quoted string
    if (ch === '"' && peek(1) === '"' && peek(2) === '"') {
      advance(); advance(); advance()
      let value = ''
      while (pos < input.length) {
        if (peek() === '"') {
          // Count consecutive quotes
          let quoteCount = 0
          while (pos < input.length && peek() === '"') {
            quoteCount++
            advance()
          }
          if (quoteCount >= 3) {
            // Last 3 quotes are the closing delimiter; extras are content
            for (let i = 0; i < quoteCount - 3; i++) value += '"'
            break
          }
          // Fewer than 3 quotes — they are content
          for (let i = 0; i < quoteCount; i++) value += '"'
          continue
        }
        value += advance()
      }
      if (value.startsWith('\n')) value = value.slice(1)
      push('triple_string', value, sl, sc, true)
      continue
    }

    // Quoted string
    if (ch === '"') {
      advance()
      let value = ''
      while (pos < input.length && peek() !== '"') {
        if (peek() === '\n') throw new ParseError('unterminated string', sl, sc)
        if (peek() === '\\') {
          advance()
          const esc = advance()
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
              const hex = input.slice(pos, pos + 4)
              value += String.fromCharCode(parseInt(hex, 16))
              for (let i = 0; i < 4; i++) advance()
              break
            }
            default: value += esc
          }
        } else {
          value += advance()
        }
      }
      if (peek() !== '"') throw new ParseError('unterminated string', sl, sc)
      advance()
      push('string', value, sl, sc, true)
      continue
    }

    // Unquoted string (stops at terminators and $)
    if (isUnquotedStart(ch)) {
      let value = ''
      while (pos < input.length && isUnquotedContinue(peek(), () => peek(1))) {
        value += advance()
      }
      push('unquoted', value.trimEnd(), sl, sc)
      continue
    }

    throw new ParseError(`unexpected character: ${JSON.stringify(ch)}`, sl, sc)
  }

  tokens.push({ kind: 'eof', value: '', line, col, isQuoted: false, precedingSpace: false })
  return tokens
}

function isUnquotedStart(ch: string): boolean {
  return ch !== '' && !'{}[],:=+#\n\r\t "$'.includes(ch)
}

function isUnquotedContinue(ch: string, nextFn: () => string): boolean {
  if (ch === '' || '{}[],:=\n\r\t #"$'.includes(ch) || ch === ' ') return false
  if (ch === '+' && nextFn() === '=') return false
  if (ch === '/' && nextFn() === '/') return false
  return true
}
