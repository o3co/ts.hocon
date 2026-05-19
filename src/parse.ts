import { tokenize } from './internal/lexer/lexer.js'
import { parseTokens } from './internal/parser/parser.js'
import { resolve, resolveAsync } from './internal/resolver/resolver.js'
import { Config } from './config.js'
import { ParseError } from './errors.js'
import type { ResolveOptions } from './internal/resolver/resolver.js'
import type { Token } from './internal/lexer/token.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Returns true iff the token stream contains at least one content token —
 * i.e. a token that is not 'eof' or 'newline'. The lexer does not emit
 * separate whitespace or comment tokens (they are consumed inline), so a
 * stream that is only eof/newline tokens came from an empty, whitespace-only,
 * or comment-only document.
 *
 * HOCON.md L130: "Empty files are invalid documents."
 */
function hasContentTokens(tokens: Token[]): boolean {
  return tokens.some(t => t.kind !== 'eof' && t.kind !== 'newline')
}

export type ParseOptions = {
  baseDir?: string
  env?: Record<string, string>
  readFile?: (filePath: string) => Promise<string>
  readFileSync?: (filePath: string) => string
}

function getEnv(opts: ParseOptions): Record<string, string> {
  if (opts.env !== undefined) return opts.env
  if (typeof process !== 'undefined' && process.env) return process.env as Record<string, string>
  return {}
}

function defaultReadFileSync(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

async function defaultReadFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8')
}

function buildResolveContext(input: string, opts: ParseOptions): { ast: ReturnType<typeof parseTokens>, resolveOpts: ResolveOptions } {
  const tokens = tokenize(input)
  // S3.1 — HOCON.md L130: empty files (including whitespace-only and comment-only) are invalid.
  // The lexer strips whitespace and comments inline without emitting tokens for them, so a stream
  // with only 'newline' and 'eof' tokens means the document has zero semantic content.
  if (!hasContentTokens(tokens)) {
    throw new ParseError('empty file is not a valid HOCON document (HOCON.md L130)', 1, 1)
  }
  const ast = parseTokens(tokens)
  const resolveOpts: ResolveOptions = {
    env: getEnv(opts),
    baseDir: opts.baseDir,
    readFileSync: opts.readFileSync ?? defaultReadFileSync,
    readFile: opts.readFile,
  }
  return { ast, resolveOpts }
}

export function parse(input: string, opts: ParseOptions = {}): Config {
  const { ast, resolveOpts } = buildResolveContext(input, opts)
  const value = resolve(ast, resolveOpts)
  if (value.kind !== 'object') throw new Error('resolved value is not an object')
  return new Config(value)
}

/**
 * Truly async version of `parse()`. Include directives are resolved
 * asynchronously via `readFile` when provided.
 */
export async function parseAsync(input: string, opts: ParseOptions = {}): Promise<Config> {
  const { ast, resolveOpts } = buildResolveContext(input, opts)
  const value = await resolveAsync(ast, resolveOpts)
  if (value.kind !== 'object') throw new Error('resolved value is not an object')
  return new Config(value)
}

export function parseFile(filePath: string, opts: ParseOptions = {}): Config {
  if (typeof process === 'undefined' && !opts.readFileSync) {
    throw new Error('parseFile is not supported in browser environments. Provide opts.readFileSync or use parse() instead.')
  }
  const resolvedPath = path.resolve(filePath)
  const readFileSync = opts.readFileSync ?? defaultReadFileSync
  const input = readFileSync(resolvedPath)
  return parse(input, {
    ...opts,
    baseDir: opts.baseDir ?? path.dirname(resolvedPath),
    readFileSync,
  })
}

export async function parseFileAsync(filePath: string, opts: ParseOptions = {}): Promise<Config> {
  if (typeof process === 'undefined' && !opts.readFile) {
    throw new Error('parseFileAsync is not supported in browser environments. Provide opts.readFile or use parseAsync() instead.')
  }
  const resolvedPath = path.resolve(filePath)
  const readFile = opts.readFile ?? defaultReadFile
  const input = await readFile(resolvedPath)
  return parseAsync(input, {
    ...opts,
    baseDir: opts.baseDir ?? path.dirname(resolvedPath),
    readFile,
    readFileSync: opts.readFileSync ?? defaultReadFileSync,
  })
}
