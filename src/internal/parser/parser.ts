import { ParseError } from '../../errors.js'
import type { ScalarValueType } from '../../value.js'
import type { Token } from '../lexer/token.js'
import type { AstNode, AstField, Pos } from './ast.js'

const EOF_TOKEN: Token = { kind: 'eof', value: '', line: 0, col: 0, isQuoted: false, precedingSpace: false }

class Parser {
  private pos = 0

  constructor(private tokens: Token[]) {}

  parse(): AstNode {
    this.skip('newline')
    const t = this.peek()
    if (t.kind === 'lbrace') {
      // Braced root: parse first braced object, then continue parsing
      // any trailing content as additional root fields to merge (per HOCON spec,
      // root is always an object and content after } is still part of the root).
      this.advance()
      const first = this.parseObject(true)
      const allFields = first.kind === 'object' ? [...first.fields] : []

      // Merge any additional braced objects or unbraced key-value content
      while (true) {
        this.skip('newline')
        if (this.peek().kind === 'eof') break
        if (this.peek().kind === 'lbrace') {
          this.advance()
          const extra = this.parseObject(true)
          if (extra.kind === 'object') allFields.push(...extra.fields)
        } else {
          // Remaining tokens are unbraced root content (key-value pairs, includes)
          const rest = this.parseObject(false)
          if (rest.kind === 'object') allFields.push(...rest.fields)
          break
        }
      }

      // After merge loop, verify no remaining non-EOF tokens (e.g. stray `}`)
      this.skip('newline')
      const remaining = this.peek()
      if (remaining.kind !== 'eof') {
        throw new ParseError(`Unexpected token '${remaining.value}' after closing brace`, remaining.line, remaining.col)
      }

      return { kind: 'object', fields: allFields, pos: first.pos }
    }
    return this.parseObject(false)
  }

  private peek(offset = 0): Token { return this.tokens[this.pos + offset] ?? EOF_TOKEN }
  private advance(): Token {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length) this.pos++
    return t ?? EOF_TOKEN
  }
  private skip(...kinds: string[]): void {
    while (kinds.includes(this.peek().kind)) this.advance()
  }

  private currentPos(): Pos {
    const t = this.peek()
    return { line: t.line, col: t.col }
  }

  private parseObject(expectClosingBrace: boolean): AstNode {
    const p = this.currentPos()
    const fields: AstField[] = []

    while (true) {
      this.skip('newline')
      const t = this.peek()
      if (t.kind === 'eof' || t.kind === 'rbrace') break

      // include directive
      if (t.kind === 'unquoted' && t.value === 'include') {
        this.advance()
        fields.push(this.parseInclude())
        // trailing separator after include
        this.skip('newline')
        if (this.peek().kind === 'comma') this.advance()
        this.skip('newline')
        continue
      }

      // key
      const keyPos = this.currentPos()
      const key = this.parseKey()

      // value separator (optional)
      this.skip('newline')
      let append = false
      const sep = this.peek()
      if (sep.kind === 'equals') this.advance()
      else if (sep.kind === 'plus_equals') { this.advance(); append = true }
      else if (sep.kind === 'colon') this.advance()
      else if (sep.kind === 'lbrace') { /* key { ... } shorthand — no advance, value parser handles it */ }
      else if (sep.kind !== 'newline' && sep.kind !== 'eof') {
        throw new ParseError(`unexpected token after key: ${sep.kind}`, sep.line, sep.col)
      }

      this.skip('newline')
      const value = this.parseValue()
      fields.push({ key, value, append, pos: keyPos })

      // trailing separator
      this.skip('newline')
      if (this.peek().kind === 'comma') this.advance()
      this.skip('newline')
    }

    if (expectClosingBrace) {
      const t = this.peek()
      if (t.kind !== 'rbrace') throw new ParseError('expected }', t.line, t.col)
      this.advance()
    }

    return { kind: 'object', fields, pos: p }
  }

  private parseKey(): string[] {
    const segments: string[] = []
    let trailingDot = false
    while (true) {
      const t = this.peek()
      if (t.kind === 'string') {
        this.advance()
        segments.push(t.value) // quoted: no dot split
        trailingDot = false
      } else if (t.kind === 'unquoted') {
        this.advance()
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
      const next = this.peek()
      if (next.kind === 'unquoted' && next.value === '.' && !next.precedingSpace) {
        this.advance() // consume the dot separator
        trailingDot = true
        continue
      }

      break
    }
    return segments
  }

  private parseInclude(): AstField {
    const p = this.currentPos()
    this.skip('newline')
    const t = this.peek()
    let path: string
    let required = false

    if (t.kind === 'unquoted' && (t.value === 'required(' || t.value === 'required' ||
        t.value.startsWith('required('))) {
      // include required("path") or include required(file("path"))
      // The lexer may produce "required(" or "required(file(" as a single unquoted token
      // depending on whether there is whitespace before "file(".

      // Reject bare `required` without a following `(`: e.g. `include required "file.conf"`
      if (t.value === 'required') {
        const next = this.peek(1)
        if (next.kind !== 'unquoted' || !next.value.startsWith('(')) {
          throw new ParseError('include required must be followed by (', t.line, t.col)
        }
      }

      required = true
      this.advance()

      // Check for unsupported url/classpath forms inside required():
      // Case 1 (no space): lexer produced a single token like "required(url(" or "required(classpath("
      const innerPrefix = t.value.startsWith('required(') ? t.value.slice('required('.length) : ''
      if (innerPrefix.startsWith('url') || innerPrefix.startsWith('classpath')) {
        throw new ParseError('include url(...) and classpath(...) are not supported', t.line, t.col)
      }
      // Case 2 (with space): next token starts with url/classpath
      const next = this.peek()
      if (next.kind === 'unquoted' && (next.value === 'url' || next.value.startsWith('url(') ||
          next.value === 'classpath' || next.value.startsWith('classpath('))) {
        throw new ParseError('include url(...) and classpath(...) are not supported', next.line, next.col)
      }

      // Skip tokens until we find the quoted path string
      while (this.peek().kind !== 'string' && this.peek().kind !== 'eof') this.advance()
      if (this.peek().kind === 'eof') throw new ParseError('expected include path', t.line, t.col)
      path = this.advance().value
      // Skip closing ) and anything else on this line (but stop at comma — next field)
      while (this.peek().kind !== 'newline' && this.peek().kind !== 'rbrace' && this.peek().kind !== 'eof' && this.peek().kind !== 'comma') this.advance()
    } else if (t.kind === 'string') {
      // include "path"
      path = this.advance().value
    } else if (t.kind === 'unquoted' && (t.value === 'file(' || t.value === 'file')) {
      // include file("path")
      this.advance()
      // Skip tokens until we find the quoted path string
      while (this.peek().kind !== 'string' && this.peek().kind !== 'eof') this.advance()
      if (this.peek().kind === 'eof') throw new ParseError('expected include path', t.line, t.col)
      path = this.advance().value
      // Skip closing ) and anything else on this line (but stop at comma — next field)
      while (this.peek().kind !== 'newline' && this.peek().kind !== 'rbrace' && this.peek().kind !== 'eof' && this.peek().kind !== 'comma') this.advance()
    } else if (t.kind === 'unquoted' && (t.value === 'url' || t.value.startsWith('url('))) {
      throw new ParseError('include url(...) is not supported', t.line, t.col)
    } else if (t.kind === 'unquoted' && (t.value === 'classpath' || t.value.startsWith('classpath('))) {
      throw new ParseError('include classpath(...) is not supported', t.line, t.col)
    } else {
      throw new ParseError(`expected include path, got ${t.kind}`, t.line, t.col)
    }

    return {
      key: [],
      value: { kind: 'include', path, required, pos: p },
      append: false,
      pos: p,
    }
  }

  private parseValue(): AstNode {
    const p = this.currentPos()
    const parts: AstNode[] = []

    while (true) {
      const t = this.peek()
      if (t.kind === 'eof' || t.kind === 'newline' || t.kind === 'rbrace' || t.kind === 'rbracket' || t.kind === 'comma') break

      // If there was whitespace before this token and we already have parts,
      // insert a space node for proper string concatenation.
      const hadSpace = t.precedingSpace && parts.length > 0

      let node: AstNode
      if (t.kind === 'lbrace') {
        this.advance()
        node = this.parseObject(true)
      } else if (t.kind === 'lbracket') {
        this.advance()
        node = this.parseArray()
      } else if (t.kind === 'subst' || t.kind === 'opt_subst') {
        this.advance()
        node = { kind: 'subst', path: t.value, optional: t.kind === 'opt_subst', pos: { line: t.line, col: t.col } }
      } else if (t.kind === 'string' || t.kind === 'triple_string') {
        this.advance()
        node = { kind: 'scalar', raw: t.value, valueType: 'string', pos: { line: t.line, col: t.col } }
      } else if (t.kind === 'unquoted') {
        this.advance()
        node = { kind: 'scalar', raw: t.value, valueType: this.scalarValueType(t.value), pos: { line: t.line, col: t.col } }
      } else if ((t.kind === 'colon' || t.kind === 'equals') && parts.length > 0) {
        // In value concat context, colon/equals after at least one part are plain string chars
        // e.g.  url = ${host}:/path  or  x = ${a}=b
        this.advance()
        node = { kind: 'scalar', raw: t.value, valueType: 'string', pos: { line: t.line, col: t.col } }
      } else {
        break
      }
      if (hadSpace) {
        parts.push({ kind: 'scalar', raw: ' ', valueType: 'string', pos: { line: t.line, col: t.col }, _separator: true })
      }
      parts.push(node)
    }

    if (parts.length === 0) throw new ParseError('expected value', this.peek().line, this.peek().col)
    if (parts.length === 1) return parts[0]!
    return { kind: 'concat', nodes: parts, pos: p }
  }

  private parseArray(): AstNode {
    const p = this.currentPos()
    const items: AstNode[] = []

    while (true) {
      this.skip('newline')
      if (this.peek().kind === 'rbracket' || this.peek().kind === 'eof') break
      items.push(this.parseValue())
      this.skip('newline')
      if (this.peek().kind === 'comma') this.advance()
      this.skip('newline')
    }

    const t = this.peek()
    if (t.kind !== 'rbracket') throw new ParseError('expected ]', t.line, t.col)
    this.advance()
    return { kind: 'array', items, pos: p }
  }

  private scalarValueType(raw: string): ScalarValueType {
    if (raw === 'true' || raw === 'false') return 'boolean'
    if (raw === 'null') return 'null'
    const ch = raw.charCodeAt(0)
    // Lightbend-aligned: only tokens starting with 0-9 or '-' are numbers
    if ((ch >= 0x30 && ch <= 0x39) || ch === 0x2D) {
      if (!Number.isNaN(Number(raw))) return 'number'
    }
    return 'string'
  }
}

// Public API unchanged
export function parseTokens(tokens: Token[]): AstNode {
  return new Parser(tokens).parse()
}
