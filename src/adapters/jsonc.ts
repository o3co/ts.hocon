import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'

/**
 * Read JSON with comments and trailing commas — the dialect VS Code and
 * TypeScript use for their config files — as HOCON config.
 *
 * Plain JSON needs no adapter at all: HOCON is a JSON superset, so `parse`
 * already accepts a .json file. This exists for the two things HOCON does not
 * accept, block comments and trailing commas. (HOCON has `//` and `#` comments
 * of its own.)
 *
 * Comments and trailing commas are removed and `JSON.parse` does the rest, so
 * the accepted grammar is otherwise exactly the platform's JSON.
 *
 * See docs/specs/format-ingestion-mapping.md items F3.x in the hocon scope.
 */
export function parseJsonc(input: string, originDescription?: string): Config {
  const doc: unknown = JSON.parse(stripTrailingCommas(stripComments(input)))
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ConfigError(
      `jsonc: document root is ${Array.isArray(doc) ? 'an array' : typeof doc}, but a config root must be an object (spec F0.3)`,
      '',
    )
  }
  return fromMap(doc as Record<string, unknown>, originDescription)
}

/**
 * Remove `//` line comments and block comments, leaving string literals alone.
 * Newlines inside removed spans are kept so JSON.parse still reports useful
 * positions.
 */
export function stripComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      const end = endOfString(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new ConfigError('jsonc: unterminated block comment', '')
      for (const ch of src.slice(i, end + 2)) if (ch === '\n') out += '\n'
      i = end + 2
      continue
    }
    out += c
    i++
  }
  return out
}

/** Index just past the string literal starting at `i`. */
function endOfString(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++
    else if (src[j] === '"') return j + 1
  }
  throw new ConfigError('jsonc: unterminated string literal', '')
}

/** Drop a comma whose next meaningful character closes its object or array. */
function stripTrailingCommas(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '"') {
      const end = endOfString(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < src.length && /\s/.test(src[j] as string)) j++
      if (src[j] === '}' || src[j] === ']') {
        i++
        continue
      }
    }
    out += c
    i++
  }
  return out
}
