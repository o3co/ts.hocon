import type { HoconValue } from '../../value.js'
import type { AstNode } from '../parser/ast.js'
import { StructureBuilder } from './structure-builder.js'
import { SubstitutionResolver } from './substitution-resolver.js'
import {
  type ResolveOptions,
  type ResObj,
  isSubst,
  isConcat,
  isAppend,
  isResObj,
  makeResObj,
} from './types.js'

export type { ResolveOptions } from './types.js'

/**
 * buildTree — phase 1. Builds a ResObj tree from AST with substitution/concat
 * placeholders left unresolved. Includes are fully expanded. Phase 2
 * (resolveTree) replaces the placeholders.
 */
export function buildTree(ast: AstNode, opts: ResolveOptions): ResObj {
  return new StructureBuilder(opts).build(ast)
}

/**
 * resolveTree — phase 2. Replaces substitution and concat placeholders in a
 * ResObj tree produced by buildTree (or merged via mergeUnresolved). Returns a
 * fully-resolved HoconValue.
 *
 * opts.useSystemEnvironment controls env var fallback (false = no env lookup).
 * opts.allowUnresolved controls whether unresolved substitutions throw or are
 * left in place (default false = throw).
 */
export function resolveTree(tree: ResObj, opts: ResolveOptions): HoconValue {
  return new SubstitutionResolver(tree, opts).resolve()
}

/**
 * containsPlaceholders — returns true if the ResObj tree contains any
 * unresolved SubstPlaceholder, ConcatPlaceholder, or AppendPlaceholder.
 * Used by Config.isResolved (added in T5).
 */
export function containsPlaceholders(tree: ResObj): boolean {
  for (const val of tree.fields.values()) {
    if (valContainsPlaceholders(val)) return true
  }
  return false
}

export function valContainsPlaceholders(v: unknown): boolean {
  const rv = v as import('./types.js').ResolverValue
  if (isSubst(rv) || isConcat(rv) || isAppend(rv)) return true
  if (isResObj(rv)) return containsPlaceholders(rv)
  const hv = v as HoconValue
  if (hv?.kind === 'array') {
    return hv.items.some((item) => valContainsPlaceholders(item))
  }
  return false
}

/**
 * buildPartialHoconFromResObj — extract resolved (non-placeholder) fields from
 * a ResObj into a plain HoconValue object. Placeholder-valued fields are omitted
 * from the partial result; Config.lookupNode will return undefined for them,
 * which triggers NotResolvedError in requireScalar (T7).
 */
export function buildPartialHoconFromResObj(tree: ResObj): HoconValue & { kind: 'object' } {
  const fields = new Map<string, HoconValue>()
  for (const [k, v] of tree.fields) {
    if (!isSubst(v) && !isConcat(v) && !isAppend(v)) {
      if (isResObj(v)) {
        fields.set(k, buildPartialHoconFromResObj(v))
      } else {
        // T1: also omit fields whose HoconValue (e.g. array) contains placeholder
        // elements — otherwise getList would silently return undefined for those
        // elements instead of throwing NotResolvedError (array placeholder leak).
        if (!valContainsPlaceholders(v)) {
          fields.set(k, v as HoconValue)
        }
        // Fields with array-contained placeholders are omitted so lookupNode returns
        // undefined → getters throw NotResolvedError.
      }
    }
    // Placeholder fields are intentionally omitted so lookupNode returns undefined.
  }
  return { kind: 'object', fields }
}

/**
 * hoconValueToResObj — converts a fully-resolved HoconValue object into a ResObj.
 * Used by withFallback to obtain a uniform ResObj for mergeUnresolved even when
 * the input was parsed via the fused (resolved) path.
 */
export function hoconValueToResObj(value: HoconValue & { kind: 'object' }): ResObj {
  const obj = makeResObj()
  for (const [k, v] of value.fields) {
    if (v.kind === 'object') {
      obj.fields.set(k, hoconValueToResObj(v))
    } else {
      obj.fields.set(k, v)
    }
  }
  return obj
}

/**
 * resolve — fused phase 1 + phase 2 (existing behaviour, backward compat).
 * Equivalent to buildTree followed by resolveTree with useSystemEnvironment=true.
 */
export function resolve(ast: AstNode, opts: ResolveOptions): HoconValue {
  const tree = buildTree(ast, opts)
  return resolveTree(tree, { ...opts, useSystemEnvironment: true, allowUnresolved: false })
}

/**
 * resolveAsync — async fused phase 1 + phase 2 (existing behaviour).
 */
export async function resolveAsync(
  ast: AstNode,
  opts: ResolveOptions,
): Promise<HoconValue> {
  const root = await new StructureBuilder(opts).buildAsync(ast)
  return resolveTree(root, { ...opts, useSystemEnvironment: true, allowUnresolved: false })
}
