import { DECIMAL_NUMBER_RE } from '../../coerce.js'
import { ParseError } from '../../errors.js'
import type { ScalarValueType } from '../../value.js'
import type { Token, TokenKind } from '../lexer/token.js'
import type { AstNode, AstField, IncludeQualifier, Pos } from './ast.js'

const EOF_TOKEN: Token = { kind: 'eof', value: '', line: 0, col: 0, isQuoted: false, precedingSpace: false, precedingWhitespace: '', subst: undefined }

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
    if (t.kind === 'lbracket') {
      // S3.5 (HOCON.md L989-991): "both JSON and HOCON allow arrays as root
      // values in a document" — an array-root document is valid syntax. The
      // object-rooted Config API rejects it AFTER the parse, at the Config
      // boundary (see buildResolveContext / IncludeLoader), matching
      // Lightbend's Parseable.forceParsedToObject (WrongType, not a syntax
      // error). Malformed arrays and trailing content remain syntax errors.
      this.advance()
      const arr = this.parseArray()
      this.skip('newline')
      const remaining = this.peek()
      if (remaining.kind !== 'eof') {
        throw new ParseError(`Unexpected token '${remaining.value}' after root array`, remaining.line, remaining.col)
      }
      // Anchor the root array's pos at the opening `[` (parseArray records the
      // first element's position) so the Config-boundary type error can point
      // at the bracket that opened the array root.
      return { ...arr, pos: { line: t.line, col: t.col } }
    }
    return this.parseObject(false)
  }

  private peek(offset = 0): Token { return this.tokens[this.pos + offset] ?? EOF_TOKEN }
  private advance(): Token {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length) this.pos++
    return t ?? EOF_TOKEN
  }
  private skip(...kinds: TokenKind[]): void {
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
        // S12.5: bare `include` followed by a key-value separator is a key-path reservation error,
        // not an include statement. Fire BEFORE advance() so we throw with the right message.
        const next = this.peek(1)
        if (
          next.kind === 'equals' || next.kind === 'colon' ||
          next.kind === 'plus_equals' || next.kind === 'lbrace'
        ) {
          throw new ParseError(
            "'include' is reserved at the start of a key path expression; use \"include\" (quoted) to use it as a key",
            t.line, t.col
          )
        }
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
      const { segments: key, firstWasQuoted } = this.parseKey()

      // S12.5: 'include' may not begin a key path expression (HOCON.md L570-572).
      // Fires post-PathParser so it catches both `include = 1` (bare) and
      // `include.foo = 1` (dotted, emitted as single unquoted token then split).
      // Only triggers when the first segment came from an unquoted token (quoted
      // "include" = 1 is allowed — firstWasQuoted bypasses this check).
      if (key[0] === 'include' && !firstWasQuoted) {
        throw new ParseError(
          "'include' is reserved at the start of a key path expression; use \"include\".foo (quoted) or rename the key",
          keyPos.line, keyPos.col
        )
      }

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

  private parseKey(): { segments: string[]; firstWasQuoted: boolean } {
    const segments: string[] = []
    let trailingDot = false
    let firstWasQuoted = false
    // S10.8 (HOCON.md L317 + L553-560): "path expressions work like value
    // concatenations" — when the next key token has whitespace before it (and
    // no preceding dot separator), it is a space-concat continuation that
    // merges into the LAST existing segment using the LITERAL whitespace from
    // the source (precedingWhitespace, not a hardcoded ' '):
    //   `a b = 1`         → key ['a b']
    //   `a b c : 42`      → key ['a b c']        (spec L556 example)
    //   `a.b c = 1`       → key ['a', 'b c']     (concat into last segment)
    //   `"a" b = 1`       → key ['a b']          (quoted + unquoted)
    // E13 (xx.hocon#42) — path-expression whitespace is preserved verbatim
    // around dots, including the tab variant pw07:
    //   `a b. c = 1`      → ['a b', ' c']        (leading space on " c" preserved)
    //   `a b.\tc = 1`     → ['a b', '\tc']       (HOCON_WS tab uniformly preserved)
    //   `a .b = 1`        → ['a ', 'b']          (trailing space on prev,
    //                                              leading dot still separator)
    //   `a . b = 1`       → ['a ', ' b']         (both sides preserved)
    // Newlines break the chain (S10.7): the lexer emits a `newline` token
    // between fields which falls through to the loop's else branch and exits.
    //
    // S8.6 (HOCON.md L270-276) is NOT enforced on key path segments per E13
    // (xx.hocon#42): the rule is value-position lexer-disambiguation, not a
    // key-parser rule. Lightbend accepts `foo -bar = 1`, `foo.-bar = 1`, etc.
    let spaceConcat = false
    // Captured WS from a trailing-dot continuation: the next post-dot segment's
    // first piece gets this WS prepended (E13 path-WS preservation rule).
    let postDotPrefix = ''
    while (true) {
      const t = this.peek()
      if (t.kind === 'string') {
        this.advance()
        if (segments.length === 0) firstWasQuoted = true
        if (spaceConcat) {
          // E13: preceding WS verbatim, then quoted content merged into last segment.
          segments[segments.length - 1] = `${segments[segments.length - 1]}${t.precedingWhitespace}${t.value}`
        } else if (postDotPrefix !== '') {
          // post-dot WS becomes leading prefix on the new quoted segment
          segments.push(`${postDotPrefix}${t.value}`)
          postDotPrefix = ''
        } else {
          segments.push(t.value) // quoted: no dot split
        }
        trailingDot = false
      } else if (t.kind === 'unquoted') {
        this.advance()
        // If this unquoted token starts with '.' and we already have segments (no preceding space),
        // the leading dot is the separator that followed the previous quoted segment.
        // e.g. key `a."b.c".d` → after "b.c" the lexer emits unquoted ".d"; strip the leading dot.
        const raw = (t.value.startsWith('.') && segments.length > 0 && !t.precedingSpace)
          ? t.value.slice(1)
          : t.value
        // Split unquoted key at dots
        const parts = raw.split('.')
        // S11.7 (HOCON.md L515-519): an empty path element must be written as a
        // quoted "" — `a..b`, `.a` and `a...c` are BadPath errors, not paths
        // whose empty elements silently collapse away. Two empty pieces are NOT
        // empty segments and are exempt:
        //   - the LAST piece, when `raw` ends with `.` — that dot is the
        //     continuation separator carried by `trailingDot` below (consumed by
        //     the next token, or rejected by the end-of-key check);
        //   - the FIRST piece, when the leading `.` is acting as a separator
        //     after an already-complete segment (`a .b`, `a. .b` — the E13
        //     path-WS forms). In the no-space forms the separator dot was
        //     already removed by the strip above, so a leading `.` that survives
        //     there really is an empty segment (`a."b"..c`).
        // Quoted segments never reach here, so `a."".b` stays legal (S11.6).
        const leadingDotIsSeparator = spaceConcat || postDotPrefix !== ''
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] !== '') continue
          if (i === parts.length - 1) continue
          if (i === 0 && leadingDotIsSeparator) continue
          throw new ParseError(
            `path has ${i === 0 ? 'a leading' : 'two adjacent'} period '.' — ` +
              `empty key segment not allowed, use quoted "" (HOCON.md path rules)`,
            t.line, t.col,
          )
        }
        const filtered = parts.filter(s => s.length > 0)
        if (spaceConcat) {
          // E13 path-WS preservation: the literal preceding whitespace becomes
          // trailing on the PREVIOUS segment, uniformly across:
          //   `a b = 1`     → ['a b']     (filtered=['b'], no leading dot — merge)
          //   `a .b = 1`    → ['a ', 'b'] (leading dot — push as new segment)
          //   `a . b = 1`   → ['a ', …]   (lone dot — trailing WS on prev, then dot separator)
          //   `a b.\tc = 1` → trailing '\t' preserved verbatim (tab variant pw07)
          segments[segments.length - 1] = `${segments[segments.length - 1]}${t.precedingWhitespace}`
          if (raw.startsWith('.')) {
            // leading '.' is a path separator (S11.1); filtered pieces (if any)
            // become new segments. Lone dot (filtered empty) just sets trailingDot.
            segments.push(...filtered)
          } else if (filtered.length > 0) {
            // first piece merges into the just-extended segment; remaining
            // pieces become new segments.
            const [head, ...tail] = filtered
            segments[segments.length - 1] = `${segments[segments.length - 1]}${head}`
            segments.push(...tail)
          }
        } else if (postDotPrefix !== '' && raw.startsWith('.')) {
          // E13 dot-WS-dot case (e.g. `a. .b = 1`): after a trailing dot from
          // the previous token, the WS-then-dot sequence means the WS becomes
          // its OWN path segment (between the two dot separators), and the
          // leading dot starts a new segment chain. Lightbend: `a. .b = 1` →
          // {"a":{" ":{"b":1}}} = ['a', ' ', 'b']. Empirically verified via
          // typesafe-config 1.4.3 probe (see PR review history).
          segments.push(postDotPrefix)
          postDotPrefix = ''
          segments.push(...filtered)
        } else if (postDotPrefix !== '' && filtered.length > 0) {
          // post-dot WS becomes leading prefix on the new segment (E13)
          const [head, ...tail] = filtered
          segments.push(`${postDotPrefix}${head}`, ...tail)
          postDotPrefix = ''
        } else {
          segments.push(...filtered)
        }
        // If the unquoted value ended with a dot, the next token continues the key
        trailingDot = raw.endsWith('.')
      } else {
        if (segments.length === 0) throw new ParseError(`expected key, got ${t.kind}`, t.line, t.col)
        break
      }
      // The continuation we just took has been consumed.
      spaceConcat = false

      // If the last unquoted segment ended with a dot, the NEXT token's
      // precedingWhitespace becomes the leading prefix of the next segment.
      if (trailingDot) {
        const next = this.peek()
        if ((next.kind === 'unquoted' || next.kind === 'string') && next.precedingWhitespace.length > 0) {
          postDotPrefix = next.precedingWhitespace
        } else {
          postDotPrefix = ''
        }
        continue
      }

      // Check for explicit dot separator between segments (e.g. "a"."b")
      // A lone dot as an unquoted token with no preceding space continues the key
      const next = this.peek()
      if (next.kind === 'unquoted' && next.value === '.' && !next.precedingSpace) {
        this.advance() // consume the dot separator
        trailingDot = true
        // After consuming the separator, check WS on the token AFTER it for
        // post-dot prefix preservation.
        const afterDot = this.peek()
        if ((afterDot.kind === 'unquoted' || afterDot.kind === 'string') && afterDot.precedingWhitespace.length > 0) {
          postDotPrefix = afterDot.precedingWhitespace
        }
        continue
      }
      // After a quoted segment, the next unquoted token may start with '.' acting as the
      // dot separator (e.g. key `a."b.c".d` → next token is unquoted ".d").
      // Mark trailingDot so the next iteration's unquoted branch strips the leading dot.
      if (next.kind === 'unquoted' && next.value.startsWith('.') && !next.precedingSpace) {
        trailingDot = true
        continue
      }

      // S10.8 space-concat continuation: an unquoted-or-quoted token separated
      // from the previous key token by whitespace is part of the same key.
      if ((next.kind === 'unquoted' || next.kind === 'string') && next.precedingSpace) {
        spaceConcat = true
        continue
      }

      break
    }
    // E13 pw06: a key path ending with `.` (e.g. `a b. = 1`) creates an empty
    // trailing segment. Lightbend throws BadPath here; we match — loosening
    // S8.6-in-key and preserving path-WS does NOT cascade into accepting empty
    // path segments.
    if (trailingDot) {
      const here = this.peek()
      throw new ParseError(
        `path has a trailing period '.' — empty key segment not allowed (HOCON.md path rules)`,
        here.line, here.col,
      )
    }
    return { segments, firstWasQuoted }
  }

  private parseInclude(): AstField {
    const p = this.currentPos()
    this.skip('newline')
    const t = this.peek()

    // ---- required(...) wrapper ----
    if (t.kind === 'unquoted' && (t.value === 'required(' || t.value === 'required' ||
        t.value.startsWith('required('))) {
      // include required("path") or include required(file("path")) or include required(package("id","file"))
      // The lexer may produce "required(" or "required(file(" as a single unquoted token
      // depending on whether there is whitespace before the inner qualifier.

      // Reject bare `required` without a following `(`: e.g. `include required "file.conf"`
      if (t.value === 'required') {
        const next = this.peek(1)
        if (next.kind !== 'unquoted' || !next.value.startsWith('(')) {
          throw new ParseError('include required must be followed by (', t.line, t.col)
        }
      }

      this.advance()

      // innerPrefix is the content after "required(" when the lexer bundles them.
      // Valid shapes: "", "file(", "package(", "url(", "classpath(", or a bare-path
      // form where the next token is the quoted string. Anything else (e.g. "fileX(",
      // "packagex(", ")") is an unknown qualifier name and must be rejected.
      const innerPrefix = t.value.startsWith('required(') ? t.value.slice('required('.length) : ''
      if (innerPrefix === 'url' || innerPrefix.startsWith('url(') ||
          innerPrefix === 'classpath' || innerPrefix.startsWith('classpath(')) {
        throw new ParseError('include url(...) and classpath(...) are not supported', t.line, t.col)
      }

      const nextTok = this.peek()

      if (innerPrefix === 'package' || innerPrefix.startsWith('package(') ||
          (innerPrefix === '' && nextTok.kind === 'unquoted' && (nextTok.value === 'package(' || nextTok.value.startsWith('package(')))) {
        // required(package("id", "file"))
        const consumePackageToken = innerPrefix === ''
        const { qualifier, path } = this.parsePackageArgs(consumePackageToken)
        return this.makeIncludeField(qualifier, path, true, p)
      }

      if (innerPrefix === 'file' || innerPrefix.startsWith('file(') ||
          (innerPrefix === '' && nextTok.kind === 'unquoted' && (nextTok.value === 'file(' || nextTok.value === 'file'))) {
        // required(file("path")) — consume the unbundled `file` keyword here so the
        // path-skip helper does not have to allow qualifier names in its allowlist
        // (Copilot review thread on PR #118).
        if (innerPrefix === '') {
          this.advance()
        }
        const path = this.parseQuotedPathSkipWrapper(t)
        return this.makeIncludeField({ kind: 'file' }, path, true, p)
      }

      if (innerPrefix === '' && nextTok.kind === 'unquoted' && (nextTok.value === 'url' || nextTok.value.startsWith('url(') ||
          nextTok.value === 'classpath' || nextTok.value.startsWith('classpath('))) {
        throw new ParseError('include url(...) and classpath(...) are not supported', nextTok.line, nextTok.col)
      }

      // After all qualifier branches: any leftover innerPrefix is malformed.
      // Common shapes we reject:
      //   - "required()" → innerPrefix=")" (empty required, no path)
      //   - "required(fileX(" / "required(packagex(" → innerPrefix=unknown qualifier name
      if (innerPrefix !== '') {
        if (innerPrefix === ')') {
          throw new ParseError('include required(...) must contain a path', t.line, t.col)
        }
        const name = innerPrefix.replace(/\(.*$/, '').replace(/\).*$/, '')
        throw new ParseError(`unknown include qualifier inside required(): "${name}"`, t.line, t.col)
      }

      // required("path") — bare with wrapper
      const path = this.parseQuotedPathSkipWrapper(t)
      return this.makeIncludeField({ kind: 'bare' }, path, true, p)
    }

    // ---- bare include "path" ----
    if (t.kind === 'string') {
      const path = this.advance().value
      return this.makeIncludeField({ kind: 'bare' }, path, false, p)
    }

    // ---- file(...) qualifier ----
    if (t.kind === 'unquoted' && (t.value === 'file(' || t.value === 'file')) {
      this.advance()
      const path = this.parseQuotedPathSkipWrapper(t)
      return this.makeIncludeField({ kind: 'file' }, path, false, p)
    }

    // ---- package(...) qualifier ----
    if (t.kind === 'unquoted' && (t.value === 'package(' || t.value.startsWith('package('))) {
      const { qualifier, path } = this.parsePackageArgs()
      return this.makeIncludeField(qualifier, path, false, p)
    }

    if (t.kind === 'unquoted' && (t.value === 'url' || t.value.startsWith('url('))) {
      throw new ParseError('include url(...) is not supported', t.line, t.col)
    }
    if (t.kind === 'unquoted' && (t.value === 'classpath' || t.value.startsWith('classpath('))) {
      throw new ParseError('include classpath(...) is not supported', t.line, t.col)
    }
    throw new ParseError(`expected include path, got ${t.kind}`, t.line, t.col)
  }

  private makeIncludeField(qualifier: IncludeQualifier, path: string, required: boolean, pos: ReturnType<typeof this.currentPos>): AstField {
    return { key: [], value: { kind: 'include', qualifier, path, required, pos }, append: false, pos }
  }

  /**
   * Skip past include-syntax wrapper tokens to find the quoted path string.
   * Strict: only allows `(`, `)`, and bare qualifier keywords (file / file( /
   * package / package( / url / url( / classpath / classpath() between the
   * directive and the quoted path. Anything else is a parse error rather than
   * silently swallowed (see ts#113).
   */
  private parseQuotedPathSkipWrapper(errTok: Token): string {
    while (this.isIncludeWrapperToken(this.peek())) this.advance()
    if (this.peek().kind !== 'string') {
      const tok = this.peek()
      if (tok.kind === 'eof') throw new ParseError('expected include path', errTok.line, errTok.col)
      const desc = tok.kind === 'unquoted' ? `unquoted "${tok.value}"` : tok.kind
      throw new ParseError(`expected quoted include path, got ${desc}`, tok.line, tok.col)
    }
    const path = this.advance().value
    // After the path, only closing `)` wrapper tokens are valid before the
    // statement boundary (newline/comma/rbrace/eof).
    while (this.peek().kind === 'unquoted' && (this.peek().value === ')' || this.peek().value === '))')) {
      this.advance()
    }
    const after = this.peek()
    if (after.kind !== 'newline' && after.kind !== 'rbrace' && after.kind !== 'eof' && after.kind !== 'comma') {
      const desc = after.kind === 'unquoted' ? `unquoted "${after.value}"` : after.kind
      throw new ParseError(`unexpected token after include path: ${desc}`, after.line, after.col)
    }
    return path
  }

  private isIncludeWrapperToken(tok: Token): boolean {
    // Pre-path only allows bare `(` — the lexer-split form of `qualifier(`
    // contributes its own paren. Qualifier keywords are consumed at the
    // call site (file branch advances them explicitly; bare-required has
    // no qualifier). Allowing qualifier names or `)` here would let
    // malformed inputs slip past the path-skip loop silently.
    return tok.kind === 'unquoted' && tok.value === '('
  }

  /**
   * Parse the body of `package("identifier", "file")`.
   *
   * @param consumePackageToken - When true (default), the current token is `package(` and
   *   must be consumed first. When false, the lexer already bundled `package(` into the
   *   preceding token (e.g. `required(package("`), so we are already positioned at the
   *   first string argument.
   */
  private parsePackageArgs(consumePackageToken = true): { qualifier: IncludeQualifier & { kind: 'package' }; path: string } {
    const pkgTok = consumePackageToken ? this.advance() : this.peek()
    this.skip('newline')

    // First argument: quoted identifier
    const idTok = this.peek()
    if (idTok.kind !== 'string') {
      throw new ParseError('include package: expected quoted identifier as first argument', pkgTok.line, pkgTok.col)
    }
    const identifier = this.advance().value

    // Separator: comma between args is REQUIRED
    this.skip('newline')
    if (this.peek().kind !== 'comma') {
      const after = this.peek()
      throw new ParseError(
        after.kind === 'string'
          ? 'include package: missing comma between identifier and file arguments'
          : 'include package: requires exactly two arguments (identifier, file) — one-arg form is not supported',
        pkgTok.line, pkgTok.col,
      )
    }
    this.advance() // consume comma
    this.skip('newline')

    // Second argument: quoted file path
    const fileTok = this.peek()
    if (fileTok.kind !== 'string') {
      throw new ParseError(
        'include package: requires exactly two arguments (identifier, file) — one-arg form is not supported',
        pkgTok.line, pkgTok.col,
      )
    }
    const filePath = this.advance().value

    // Skip closing ) and anything else to end-of-statement
    while (this.peek().kind !== 'newline' && this.peek().kind !== 'rbrace' && this.peek().kind !== 'eof' && this.peek().kind !== 'comma') {
      this.advance()
    }

    return { qualifier: { kind: 'package', identifier }, path: filePath }
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
      } else if (t.kind === 'subst') {
        this.advance()
        if (!t.subst) {
          throw new ParseError(`internal: subst token missing payload`, t.line, t.col)
        }
        const payload = t.subst
        node = { kind: 'subst', segments: payload.segments, optional: payload.optional, listSuffix: payload.listSuffix, pos: { line: t.line, col: t.col } }
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
        // S10.5 (go.hocon#132): inner whitespace between simple values is
        // preserved verbatim, so emit the literal whitespace run rather than a
        // collapsed single space. Fall back to a single space if the lexer
        // reported precedingSpace but captured no chars (comment-only shape,
        // which cannot occur mid-value-concat — the loop breaks on newline).
        const sep = t.precedingWhitespace.length > 0 ? t.precedingWhitespace : ' '
        parts.push({ kind: 'scalar', raw: sep, valueType: 'string', pos: { line: t.line, col: t.col }, _separator: true })
      }
      parts.push(node)
    }

    if (parts.length === 0) throw new ParseError('expected value', this.peek().line, this.peek().col)
    if (parts.length === 1) {
      // length === 1 guarantees parts[0] exists; the array access is safe
      return parts[0] as AstNode
    }
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
    // Number detection: first char must be 0-9 or - (Lightbend-aligned)
    // Use strict decimal regex matching coerceNumber to ensure consistency
    if (raw.length > 0 && (raw.charCodeAt(0) >= 0x30 && raw.charCodeAt(0) <= 0x39 || raw.charCodeAt(0) === 0x2d)) {
      if (DECIMAL_NUMBER_RE.test(raw)) return 'number'
    }
    return 'string'
  }
}

// Public API unchanged
export function parseTokens(tokens: Token[]): AstNode {
  return new Parser(tokens).parse()
}
