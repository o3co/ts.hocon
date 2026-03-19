import { ParseError } from '../../errors.js'
import type { Token } from '../lexer/token.js'
import type { AstNode, AstField, Pos } from './ast.js'

export function parseTokens(tokens: Token[]): AstNode {
  let pos = 0

  function peek(): Token { return tokens[pos] ?? { kind: 'eof', value: '', line: 0, col: 0, isQuoted: false, precedingSpace: false } }
  function advance(): Token {
    const t = tokens[pos]
    if (pos < tokens.length) pos++
    return t ?? { kind: 'eof', value: '', line: 0, col: 0, isQuoted: false, precedingSpace: false }
  }
  function skip(...kinds: string[]): void {
    while (kinds.includes(peek().kind)) advance()
  }

  function currentPos(): Pos {
    const t = peek()
    return { line: t.line, col: t.col }
  }

  function parseObject(expectClosingBrace: boolean): AstNode {
    const p = currentPos()
    const fields: AstField[] = []

    while (true) {
      skip('newline')
      const t = peek()
      if (t.kind === 'eof' || t.kind === 'rbrace') break

      // include directive
      if (t.kind === 'unquoted' && t.value === 'include') {
        advance()
        fields.push(parseInclude())
        // trailing separator after include
        skip('newline')
        if (peek().kind === 'comma') advance()
        skip('newline')
        continue
      }

      // key
      const keyPos = currentPos()
      const key = parseKey()

      // value separator (optional)
      skip('newline')
      let append = false
      const sep = peek()
      if (sep.kind === 'equals') advance()
      else if (sep.kind === 'plus_equals') { advance(); append = true }
      else if (sep.kind === 'colon') advance()
      else if (sep.kind === 'lbrace') { /* key { ... } shorthand — no advance, value parser handles it */ }
      else if (sep.kind !== 'newline' && sep.kind !== 'eof') {
        throw new ParseError(`unexpected token after key: ${sep.kind}`, sep.line, sep.col)
      }

      skip('newline')
      const value = parseValue()
      fields.push({ key, value, append, pos: keyPos })

      // trailing separator
      skip('newline')
      if (peek().kind === 'comma') advance()
      skip('newline')
    }

    if (expectClosingBrace) {
      const t = peek()
      if (t.kind !== 'rbrace') throw new ParseError('expected }', t.line, t.col)
      advance()
    }

    return { kind: 'object', fields, pos: p }
  }

  function parseKey(): string[] {
    const segments: string[] = []
    let trailingDot = false
    while (true) {
      const t = peek()
      if (t.kind === 'string') {
        advance()
        segments.push(t.value) // quoted: no dot split
        trailingDot = false
      } else if (t.kind === 'unquoted') {
        advance()
        // Split unquoted key at dots
        const parts = t.value.split('.')
        const filtered = parts.filter(s => s.length > 0)
        segments.push(...filtered)
        // If the unquoted value ended with a dot, the next token continues the key
        trailingDot = t.value.endsWith('.')
      } else {
        if (segments.length === 0) throw new ParseError(`expected key, got ${t.kind}`, t.line, t.col)
        break
      }

      // If the last unquoted segment ended with a dot, continue to next token
      if (trailingDot) continue

      // Check for explicit dot separator between segments (e.g. "a"."b")
      // A lone dot as an unquoted token with no preceding space continues the key
      const next = peek()
      if (next.kind === 'unquoted' && next.value === '.' && !next.precedingSpace) {
        advance() // consume the dot separator
        trailingDot = true
        continue
      }

      break
    }
    return segments
  }

  function parseInclude(): AstField {
    const p = currentPos()
    skip('newline')
    const t = peek()
    let path: string

    if (t.kind === 'string') {
      // include "path"
      path = advance().value
    } else if (t.kind === 'unquoted' && (t.value === 'file(' || t.value === 'file')) {
      // include file("path")
      advance()
      // Skip tokens until we find the quoted path string
      while (peek().kind !== 'string' && peek().kind !== 'eof') advance()
      if (peek().kind === 'eof') throw new ParseError('expected include path', t.line, t.col)
      path = advance().value
      // Skip closing ) and anything else on this line
      while (peek().kind !== 'newline' && peek().kind !== 'rbrace' && peek().kind !== 'eof') advance()
    } else {
      throw new ParseError(`expected include path, got ${t.kind}`, t.line, t.col)
    }

    return {
      key: [],
      value: { kind: 'include', path, pos: p },
      append: false,
      pos: p,
    }
  }

  function parseValue(): AstNode {
    const p = currentPos()
    const parts: AstNode[] = []

    while (true) {
      const t = peek()
      if (t.kind === 'eof' || t.kind === 'newline' || t.kind === 'rbrace' || t.kind === 'rbracket' || t.kind === 'comma') break

      // If there was whitespace before this token and we already have parts,
      // insert a space node for proper string concatenation.
      const hadSpace = t.precedingSpace && parts.length > 0

      let node: AstNode
      if (t.kind === 'lbrace') {
        advance()
        node = parseObject(true)
      } else if (t.kind === 'lbracket') {
        advance()
        node = parseArray()
      } else if (t.kind === 'subst' || t.kind === 'opt_subst') {
        advance()
        node = { kind: 'subst', path: t.value, optional: t.kind === 'opt_subst', pos: { line: t.line, col: t.col } }
      } else if (t.kind === 'string' || t.kind === 'triple_string') {
        advance()
        node = { kind: 'scalar', value: t.value, pos: { line: t.line, col: t.col } }
      } else if (t.kind === 'unquoted') {
        advance()
        node = { kind: 'scalar', value: parseScalarValue(t.value), pos: { line: t.line, col: t.col } }
      } else if ((t.kind === 'colon' || t.kind === 'equals') && parts.length > 0) {
        // In value concat context, colon/equals after at least one part are plain string chars
        // e.g.  url = ${host}:/path  or  x = ${a}=b
        advance()
        node = { kind: 'scalar', value: t.value, pos: { line: t.line, col: t.col } }
      } else {
        break
      }
      if (hadSpace) {
        parts.push({ kind: 'scalar', value: ' ', pos: { line: t.line, col: t.col } })
      }
      parts.push(node)
    }

    if (parts.length === 0) throw new ParseError('expected value', peek().line, peek().col)
    if (parts.length === 1) return parts[0]!
    return { kind: 'concat', nodes: parts, pos: p }
  }

  function parseArray(): AstNode {
    const p = currentPos()
    const items: AstNode[] = []

    while (true) {
      skip('newline')
      if (peek().kind === 'rbracket' || peek().kind === 'eof') break
      items.push(parseValue())
      skip('newline')
      if (peek().kind === 'comma') advance()
      skip('newline')
    }

    const t = peek()
    if (t.kind !== 'rbracket') throw new ParseError('expected ]', t.line, t.col)
    advance()
    return { kind: 'array', items, pos: p }
  }

  function parseScalarValue(raw: string): string | number | boolean | null {
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (raw === 'null') return null
    const n = Number(raw)
    if (!isNaN(n) && raw.trim() !== '') return n
    return raw
  }

  skip('newline')
  const t = peek()
  if (t.kind === 'lbrace') {
    advance()
    return parseObject(true)
  }
  return parseObject(false)
}
