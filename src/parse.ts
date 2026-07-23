import * as fs from 'node:fs'
import * as path from 'node:path'
import { Config } from './config.js'
import { ConfigError } from './errors.js'
import { tokenize } from './internal/lexer/lexer.js'
import { parseTokens } from './internal/parser/parser.js'
import { buildTree, containsPlaceholders, resolve, resolveAsync } from './internal/resolver/resolver.js'
import type { ResolveOptions as InternalResolveOptions } from './internal/resolver/resolver.js'
import type { PackageResolver } from './internal/resolver/types.js'

export type ParseOptions = {
  baseDir?: string
  env?: Record<string, string>
  readFile?: (filePath: string) => Promise<string>
  readFileSync?: (filePath: string) => string
  /** When true (default), run substitution resolution after parse. When false,
   *  return an unresolved Config with placeholders intact. E12 §"ParseOptions". */
  resolveSubstitutions?: boolean
  /** Source name surfaced in error messages when no file path is available. E12. */
  originDescription?: string
  /**
   * Override the starting directory (or directories) used when resolving
   * `include package("id", "file")` via Node module resolution.
   *
   * Default: `path.dirname(includingConfFile)` when known, `process.cwd()` otherwise.
   * Ignored when `packageResolver` is also provided.
   */
  resolveFrom?: string | string[]
  /**
   * Custom resolver for `include package("id", "file")`.
   * See {@link PackageResolver} for the full callback signature and contract
   * (parameters, lookup-starting-path priority, error semantics).
   *
   * When provided, takes full control of resolution; `resolveFrom` is ignored.
   * Use this for Yarn Berry PnP, bundler contexts, edge runtimes, or test isolation.
   *
   * Note: on macOS/Windows (case-insensitive filesystems), the default resolver may
   * resolve case-insensitively for intermediate path segments. Use a custom
   * `packageResolver` for strict cross-platform enforcement.
   */
  packageResolver?: PackageResolver
}

export type ResolveOptions = {
  /** When true (default), env var lookups are available during resolve. E12. */
  useSystemEnvironment?: boolean
  /** When true, leaves unresolved non-optional substitutions in place instead
   *  of throwing ResolveError. Default false. E12. */
  allowUnresolved?: boolean
}

/** Returns a ParseOptions object with Lightbend-aligned defaults:
 *  resolveSubstitutions=true, originDescription=undefined. */
export function defaultParseOptions(): Required<Pick<ParseOptions, 'resolveSubstitutions'>> & ParseOptions {
  return { resolveSubstitutions: true }
}

/** Returns a ResolveOptions object with Lightbend-aligned defaults:
 *  useSystemEnvironment=true, allowUnresolved=false. */
export function defaultResolveOptions(): Required<ResolveOptions> {
  return { useSystemEnvironment: true, allowUnresolved: false }
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

function buildResolveContext(input: string, opts: ParseOptions): { ast: ReturnType<typeof parseTokens>; resolveOpts: InternalResolveOptions } {
  const tokens = tokenize(input)
  // S3.1 — HOCON.md L134-136: a document that does not begin with `[` or `{`
  // is parsed as if enclosed in `{}`, so an empty / whitespace-only /
  // comment-only document parses to the empty object. (L130-132 is the JSON
  // baseline, not HOCON-normative — see xx.hocon E10, corrected 2026-07-23.)
  const ast = parseTokens(tokens)
  // S3.5 — HOCON.md L989-991: an array-root document is valid syntax, but the
  // object-rooted Config API rejects it at the Config boundary with a TYPE
  // error, matching Lightbend's Parseable.forceParsedToObject
  // (ConfigException.WrongType "has type LIST rather than object at file root").
  if (ast.kind === 'array') {
    throw new ConfigError(
      'document has type array rather than object at file root (HOCON.md L989-991); the Config API requires an object root',
      '',
    )
  }
  const resolveOpts: InternalResolveOptions = {
    env: getEnv(opts),
    baseDir: opts.baseDir,
    readFileSync: opts.readFileSync ?? defaultReadFileSync,
    readFile: opts.readFile,
    originDescription: opts.originDescription,
    resolveFrom: opts.resolveFrom,
    packageResolver: opts.packageResolver,
  }
  return { ast, resolveOpts }
}

export function parse(input: string, opts: ParseOptions = {}): Config {
  const { ast, resolveOpts } = buildResolveContext(input, opts)
  const value = resolve(ast, resolveOpts)
  if (value.kind !== 'object') throw new Error('resolved value is not an object')
  return new Config(value, { resolved: true, originDescription: opts.originDescription })
}

/** Lightbend-aligned alias for parse(). Produces a fully resolved Config. */
export const parseString = parse

/** Parse a HOCON string with explicit options. When opts.resolveSubstitutions
 *  is false, returns an unresolved Config with substitution placeholders intact.
 *  Use Config.resolve() or Config.resolveWith() to complete resolution later. */
export function parseStringWithOptions(input: string, opts: ParseOptions = {}): Config {
  const resolveSubstitutions = opts.resolveSubstitutions ?? true
  const { ast, resolveOpts } = buildResolveContext(input, opts)
  if (resolveSubstitutions) {
    const value = resolve(ast, resolveOpts)
    if (value.kind !== 'object') throw new Error('resolved value is not an object')
    return new Config(value, { resolved: true, originDescription: opts.originDescription })
  }
  // Deferred path: phase 1 only — leave substitution placeholders in place.
  const tree = buildTree(ast, resolveOpts)
  const hasPlaceholders = containsPlaceholders(tree)
  return Config._fromUnresolvedResObj(tree, {
    parseBaseDir: opts.baseDir,
    originDescription: opts.originDescription,
    resolved: !hasPlaceholders,
    resolveOpts,
  })
}

/** Parse a HOCON file with explicit options. */
export function parseFileWithOptions(filePath: string, opts: ParseOptions = {}): Config {
  if (typeof process === 'undefined' && !opts.readFileSync) {
    throw new Error('parseFileWithOptions is not supported in browser environments without opts.readFileSync.')
  }
  const resolvedPath = path.resolve(filePath)
  const readFileSync = opts.readFileSync ?? defaultReadFileSync
  const input = readFileSync(resolvedPath)
  return parseStringWithOptions(input, {
    ...opts,
    baseDir: opts.baseDir ?? path.dirname(resolvedPath),
    readFileSync,
  })
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
