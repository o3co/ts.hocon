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

export type ResolveOptions = {
  env: Record<string, string>
  baseDir: string | undefined
  readFileSync: (filePath: string) => string
  readFile?: (filePath: string) => Promise<string>
  includeStack?: string[]
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
