import type { HoconValue } from '../../value.js'
import type { Segment } from '../lexer/token.js'
// NB: fold-self-ref.ts imports value-level helpers (isConcat/isResObj/isSubst)
// from this module, so this is a cyclic import. It is safe because both sides
// reference the other's bindings only inside function bodies (never at module
// top-level), which ES modules resolve correctly.
import { foldOrSkipPrior } from './fold-self-ref.js'

// ---- Internal placeholder types ----
export type SubstPlaceholder = {
  _kind: 'subst-placeholder'
  segments: Segment[]
  optional: boolean
  /** Internal sentinel for a folded optional self-ref with no prior value. */
  knownAbsent: boolean
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
export type ResObj = {
  _kind: 'res-obj'
  fields: Map<string, ResolverValue>
  priorValues: Map<string, ResolverValue>
  /**
   * Keys whose net value in THIS object was established by an explicit
   * non-self-referential assignment (`k = [...]`), i.e. a reset rather than a
   * `+=`/self-ref append. Used by `deepMergeResObjInto` to decide whether an
   * included file's `k` chains off the destination's pre-merge value (append
   * origin → splice) or replaces it (reset origin → discard). See go.hocon#134.
   */
  resetKeys: Set<string>
}

export type ResolverValue = HoconValue | SubstPlaceholder | ConcatPlaceholder | ResObj

/**
 * Custom resolver for `include package("id", "file")`.
 *
 * Receives:
 * - `identifier`, `file`: the qualifier arguments (post HOCON unescape, byte-exact)
 * - `includingFile`: absolute path of the including `.conf` file when known
 *   (currently always `undefined`; reserved for future threading from a future
 *   `parseFile` integration)
 * - `baseDir`: the directory context active when the include is resolved
 *   (typically `path.dirname(includingFile)` of the parent, or the caller-set
 *   `baseDir` parse option). Set when known, `undefined` for parses of literal
 *   input strings without a directory context.
 *
 * Must return an absolute path or throw.
 *
 * When not provided, the default resolver uses `createRequire(import.meta.url)`
 * which works in both CJS and ESM Node contexts. The default resolver picks the
 * lookup starting paths in priority order:
 *   `resolveFrom` > `baseDir` > `path.dirname(includingFile)` > `process.cwd()`
 */
export type PackageResolver = (
  identifier: string,
  file: string,
  includingFile: string | undefined,
  baseDir: string | undefined,
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
  /**
   * When false (default), env var lookups inside SubstitutionResolver are
   * suppressed. Set to true to preserve the current fused-resolve behaviour
   * where process.env is consulted as fallback. Phase-2 callers (resolveTree)
   * receive this flag explicitly; the fused resolve() path passes true for
   * backward compat.
   *
   * E12 ResolveOptions.useSystemEnvironment.
   */
  useSystemEnvironment?: boolean
  /**
   * When true, leaves unresolved (non-optional) substitution placeholders in
   * place instead of throwing ResolveError. Phase 2 only; ignored by buildTree.
   *
   * E12 ResolveOptions.allowUnresolved.
   */
  allowUnresolved?: boolean
  /**
   * Human-readable origin for error messages (e.g. file name or description).
   * When set, ResolveError messages include this as a prefix to help callers
   * identify which config source caused the error.
   *
   * E12 origin preservation.
   */
  originDescription?: string
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
export function isResObj(v: ResolverValue): v is ResObj {
  return (v as ResObj)._kind === 'res-obj'
}

export function makeResObj(): ResObj {
  return { _kind: 'res-obj', fields: new Map(), priorValues: new Map(), resetKeys: new Set() }
}

/**
 * Records a "prior value" for key. Used by E12 withFallback to propagate
 * fallback values as priors for self-reference lookback in phase 2.
 */
export function setPrior(o: ResObj, key: string, v: ResolverValue): void {
  o.priorValues.set(key, v)
}

/**
 * Returns the prior value associated with key, if any.
 */
export function getPrior(o: ResObj, key: string): ResolverValue | undefined {
  return o.priorValues.get(key)
}

/**
 * mergeUnresolved performs the E12 withFallback merge of two unresolved trees.
 * Receiver's keys win; on non-object collision the fallback's value is
 * recorded as a prior on the result for cross-layer self-reference lookback
 * in phase 2. Both-object collisions recurse, UNLESS the receiver has a
 * non-object prior at the path — in that case the fallback's object is
 * discarded (composition barrier per HOCON.md L1485).
 */
export function mergeUnresolved(receiver: ResObj, fallback: ResObj): ResObj {
  const result = makeResObj()
  // 1. Seed with fallback keys (so receiver-only / new fallback-only keys
  //    co-exist).
  for (const [k, v] of fallback.fields) {
    result.fields.set(k, v)
  }
  // Carry fallback's priorValues.
  for (const [k, v] of fallback.priorValues) {
    result.priorValues.set(k, v)
  }
  // 2. Apply receiver: receiver wins; on non-object collision capture
  //    fallback's value as prior.
  for (const [k, rv] of receiver.fields) {
    const existing = result.fields.get(k)
    if (existing !== undefined) {
      // Composition barrier: if receiver carries a non-object prior at
      // this key (from a previous merge round), discard the fallback's
      // object — do NOT recurse.
      const recPrior = receiver.priorValues.get(k)
      if (recPrior !== undefined && !isResObj(recPrior)) {
        result.fields.set(k, rv)
        continue
      }
      // Both objects → recurse.
      if (isResObj(rv) && isResObj(existing)) {
        result.fields.set(k, mergeUnresolved(rv, existing))
        continue
      }
      // Non-object collision: receiver wins; capture fallback's value
      // (existing) as prior for cross-layer self-ref lookback.
      //
      // go.hocon#134: `existing` is the fallback's live field value, which —
      // after the `+=` desugar — can be a self-referential concat (`${?k}
      // [...]`). Recording it raw would make the receiver's `${?k}` resolve to
      // a prior that still contains `${?k}`, recursing forever
      // (`items += "r"`.withFallback(`items += "f"`) → stack overflow). Fold it
      // self-ref-free first, the same discipline deepMergeResObjInto applies on
      // the include path. `k` is the full key here (top-level merge, no prefix).
      const foldedPrior = foldOrSkipPrior(existing, k, undefined)
      if (foldedPrior !== undefined) result.priorValues.set(k, foldedPrior)
    }
    result.fields.set(k, rv)
  }
  // 3. Receiver's own priorValues take precedence (in case the same key was
  //    already a prior on both sides — receiver's history wins).
  for (const [k, v] of receiver.priorValues) {
    if (receiver.fields.has(k)) {
      result.priorValues.set(k, v)
    }
  }
  return result
}
