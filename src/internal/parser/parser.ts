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
    while (true) {
      const t = peek()
      if (t.kind === 'string') {
        advance()
        segments.push(t.value) // quoted: no dot split
      } else if (t.kind === 'unquoted') {
        advance()
        // Split unquoted key at dots
        segments.push(...t.value.split('.').filter(s => s.length > 0))
      } else {
        if (segments.length === 0) throw new ParseError(`expected key, got ${t.kind}`, t.line, t.col)
        break
      }

      // Check for explicit dot separator between segments (e.g. "a"."b")
      // A lone dot as an unquoted token with no preceding space continues the key
      const next = peek()
      if (next.kind === 'unquoted' && next.value === '.' && !next.precedingSpace) {
        advance() // consume the dot separator
        continue
      }

      break
    }
    return segments
  }

  function parseInclude(): AstField {
    const p = currentPos()
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
