import type { HoconValue } from '../../value.js'
import type { Segment } from '../lexer/token.js'

// ---- Internal placeholder types ----
export type SubstPlaceholder = {
  _kind: 'subst-placeholder'
  segments: Segment[]
  optional: boolean
  listSuffix: boolean  // true when the substitution ends with '[]' (S13c)
  line: number
  col: number
  prefixLen: number  // 0 for normal, >0 for relativized (number of prefix segments)
}
export type ConcatPlaceholder = {
  _kind: 'concat-placeholder'
  nodes: ResolverValue[]
  /** 1-based line of the concat value in the source file (from AST Concat pos). */
  line: number
  /** 1-based column of the concat value in the source file (from AST Concat pos). */
  col: number
}
export type AppendPlaceholder = {
  _kind: 'append-placeholder'
  existing: ResolverValue
  elem: ResolverValue
}
export type ResObj = {
  _kind: 'res-obj'
  fields: Map<string, ResolverValue>
  priorValues: Map<string, ResolverValue>
}

export type ResolverValue = HoconValue | SubstPlaceholder | ConcatPlaceholder | AppendPlaceholder | ResObj

/**
 * Custom resolver for `include package("id", "file")`.
 * Receives the identifier, the file argument, and (if known) the absolute path
 * of the including `.conf` file. Must return an absolute path or throw.
 *
 * When not provided, the default resolver uses `createRequire(import.meta.url)`
 * which works in both CJS and ESM Node contexts.
 */
export type PackageResolver = (
  identifier: string,
  file: string,
  includingFile: string | undefined,
) => string

export type ResolveOptions = {
  env: Record<string, string>
  baseDir: string | undefined
  readFileSync: (filePath: string) => string
  readFile?: (filePath: string) => Promise<string>
  includeStack?: string[]
  /** Override the starting directory for `require.resolve` used by the default package resolver. */
  resolveFrom?: string | string[]
  /** Custom resolver for `include package(...)`. When provided, takes full control; `resolveFrom` is ignored. */
  packageResolver?: PackageResolver
}

// Track parser-inserted separator whitespace values without leaking _separator
// into the public HoconValue type. Uses WeakSet so values can be GC'd normally.
export const separatorValues = new WeakSet<HoconValue>()

export function isSubst(v: ResolverValue): v is SubstPlaceholder {
  return (v as SubstPlaceholder)._kind === 'subst-placeholder'
}
export function isConcat(v: ResolverValue): v is ConcatPlaceholder {
  return (v as ConcatPlaceholder)._kind === 'concat-placeholder'
}
export function isAppend(v: ResolverValue): v is AppendPlaceholder {
  return (v as AppendPlaceholder)._kind === 'append-placeholder'
}
export function isResObj(v: ResolverValue): v is ResObj {
  return (v as ResObj)._kind === 'res-obj'
}

export function makeResObj(): ResObj {
  return { _kind: 'res-obj', fields: new Map(), priorValues: new Map() }
}
