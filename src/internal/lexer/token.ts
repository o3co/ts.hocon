export interface Segment {
  readonly text: string
  readonly line: number
  readonly col: number
}

export interface SubstPayload {
  readonly segments: Segment[]
  readonly optional: boolean
  readonly listSuffix: boolean  // true when the substitution body ends with '[]' (S13c)
}

export type TokenKind =
  | 'lbrace' | 'rbrace'
  | 'lbracket' | 'rbracket'
  | 'comma' | 'colon' | 'equals' | 'plus_equals'
  | 'newline'
  | 'string'         // "..." quoted string
  | 'triple_string'  // """..."""
  | 'unquoted'       // bare word, number, true/false/null
  | 'subst'          // ${path} and ${?path} — check subst.optional for optional
  | 'eof'

export type Token = {
  kind: TokenKind
  value: string           // always string; parser converts to number/bool/null
  line: number
  col: number
  isQuoted: boolean       // true for "..." and """..."""
  precedingSpace: boolean // true if preceded by whitespace OR a comment
  // Literal preceding-whitespace chars consumed since the previous token.
  // Used by parseKey to preserve path-expression whitespace per E13 — for
  // `a b. c = 1` the ' ' before `c` becomes a leading-space prefix on the
  // post-dot segment.
  //
  // Note: precedingSpace may be true while precedingWhitespace is empty when
  // the token is preceded only by a comment (no literal WS chars). The
  // boolean is the right signal for concat detection (S10.5 / S10.8); the
  // string is the right signal for path-WS preservation (E13). They are NOT
  // strictly equivalent at the contract level — they answer different
  // questions.
  //
  // The comment-only shape (precedingSpace=true, precedingWhitespace="")
  // DOES occur in current grammar for the `newline` token that follows a
  // `// foo\n` or `# foo\n` line — that newline is the one token type
  // that can carry this state. Non-newline tokens that participate in
  // concat / path-WS contexts are always either preceded by literal WS
  // chars OR follow a newline that resets the buffer, so consumers of
  // precedingWhitespace (parseKey path-WS preservation) can rely on the
  // string alone without re-checking precedingSpace. The structural
  // distinction also future-proofs against grammar changes that might
  // introduce other token shapes preceded only by a comment.
  precedingWhitespace: string
  subst?: SubstPayload    // populated only when kind === 'subst'
}
