export type TokenKind =
  | 'lbrace' | 'rbrace'
  | 'lbracket' | 'rbracket'
  | 'comma' | 'colon' | 'equals' | 'plus_equals'
  | 'newline'
  | 'string'         // "..." quoted string
  | 'triple_string'  // """..."""
  | 'unquoted'       // bare word, number, true/false/null
  | 'subst'          // ${path}
  | 'opt_subst'      // ${?path}
  | 'eof'

export type Token = {
  kind: TokenKind
  value: string           // always string; parser converts to number/bool/null
  line: number
  col: number
  isQuoted: boolean       // true for "..." and """..."""
  precedingSpace: boolean // true if preceded by whitespace (concat detection)
}
