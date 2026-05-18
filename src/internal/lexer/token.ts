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
  precedingSpace: boolean // true if preceded by whitespace (concat detection)
  subst?: SubstPayload    // populated only when kind === 'subst'
}
