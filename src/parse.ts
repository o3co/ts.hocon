import { tokenize } from './internal/lexer/lexer.js'
import { parseTokens } from './internal/parser/parser.js'
import { resolve } from './internal/resolver/resolver.js'
import { Config } from './config.js'
import type { ResolveOptions } from './internal/resolver/resolver.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

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

export function parse(input: string, opts: ParseOptions = {}): Config {
  const tokens = tokenize(input)
  const ast = parseTokens(tokens)
  const resolveOpts: ResolveOptions = {
    env: getEnv(opts),
    baseDir: opts.baseDir,
    readFileSync: opts.readFileSync ?? defaultReadFileSync,
  }
  const value = resolve(ast, resolveOpts)
  if (value.kind !== 'object') throw new Error('resolved value is not an object')
  return new Config(value)
}

/**
 * Async wrapper around `parse()`. Returns a resolved Promise — the parsing
 * itself is synchronous. Use `parseFileAsync()` for async file I/O.
 * Note: `include` directives in string input are resolved synchronously
 * via `readFileSync`; `readFile` is not used by this function.
 */
export async function parseAsync(input: string, opts: ParseOptions = {}): Promise<Config> {
  return Promise.resolve(parse(input, opts))
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
  return parse(input, {
    ...opts,
    baseDir: opts.baseDir ?? path.dirname(resolvedPath),
    readFileSync: opts.readFileSync ?? defaultReadFileSync,
  })
}
