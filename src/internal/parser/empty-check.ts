import type { Token } from '../lexer/token.js'
import { ParseError } from '../../errors.js'

/**
 * Returns true iff the token stream contains at least one content token —
 * i.e. a token that is not 'eof' or 'newline'. The lexer does not emit
 * separate whitespace or comment tokens (they are consumed inline), so a
 * stream that is only eof/newline tokens came from an empty, whitespace-only,
 * or comment-only document.
 *
 * HOCON.md L130: "Empty files are invalid documents."
 */
export function hasContentTokens(tokens: Token[]): boolean {
  return tokens.some(t => t.kind !== 'eof' && t.kind !== 'newline')
}

/**
 * Asserts that the token stream contains at least one content token.
 * Throws ParseError if the stream is empty (empty file, whitespace-only,
 * or comment-only), including a source descriptor in the message.
 *
 * @param tokens         The tokenized stream to check.
 * @param sourceDescriptor  Human-readable source name (e.g. include path or
 *                           "input") to embed in the error message.
 */
export function assertNonEmptyDocument(tokens: Token[], sourceDescriptor: string): void {
  if (!hasContentTokens(tokens)) {
    throw new ParseError(
      `empty file is not a valid HOCON document (HOCON.md L130): ${sourceDescriptor}`,
      1,
      1,
    )
  }
}
