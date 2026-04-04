import { ResolveError } from '../../errors.js'
import type { HoconValue } from '../../value.js'
import type { AstNode } from '../parser/ast.js'
import {
  type SubstPlaceholder,
  type AppendPlaceholder,
  type ResObj,
  type ResolverValue,
  type ResolveOptions,
  separatorValues,
  isSubst,
  isConcat,
  isAppend,
  isResObj,
} from './types.js'
import {
  deepMergeHoconValues,
  lookupPath,
  lookupResObj,
  parseSubstPath,
} from './utils.js'
import { StructureBuilder } from './structure-builder.js'

export type { ResolveOptions } from './types.js'

// ---- Public entry point ----

export function resolve(ast: AstNode, opts: ResolveOptions): HoconValue {
  // Pass 1
  const root = new StructureBuilder(opts).build(ast)
  // Pass 2
  const resolving = new Set<string>()
  const resolvedCache = new Map<string, HoconValue>()
  return resolveResObj(root, root, resolving, resolvedCache, opts)
}

export async function resolveAsync(ast: AstNode, opts: ResolveOptions): Promise<HoconValue> {
  // Pass 1 (async — awaits file reads for includes)
  const root = await new StructureBuilder(opts).buildAsync(ast)
  // Pass 2 (sync — no I/O needed for substitution resolution)
  const resolving = new Set<string>()
  const resolvedCache = new Map<string, HoconValue>()
  return resolveResObj(root, root, resolving, resolvedCache, opts)
}

// ---- Pass 2: substitution resolution ----

function resolveResObj(
  obj: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const result = new Map<string, HoconValue>()
  for (const [key, val] of obj.fields) {
    const resolved = resolveVal(val, obj, root, resolving, resolvedCache, opts)
    if (resolved !== undefined) {
      // Delayed merge: if both current and prior resolve to objects, deep merge
      if (resolved.kind === 'object') {
        const prior = obj.priorValues.get(key)
        if (prior !== undefined) {
          const priorResolved = resolveVal(prior, obj, root, resolving, resolvedCache, opts)
          if (priorResolved !== undefined && priorResolved.kind === 'object') {
            result.set(key, deepMergeHoconValues(
              priorResolved as HoconValue & { kind: 'object' },
              resolved as HoconValue & { kind: 'object' },
            ))
            continue
          }
        }
      }
      result.set(key, resolved)
    } else {
      // Unresolved optional substitution: fall back to prior value per HOCON spec
      const prior = obj.priorValues.get(key)
      if (prior !== undefined) {
        const priorResolved = resolveVal(prior, obj, root, resolving, resolvedCache, opts)
        if (priorResolved !== undefined) result.set(key, priorResolved)
      }
    }
  }
  return { kind: 'object', fields: result }
}

function resolveVal(
  v: ResolverValue,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue | undefined {
  if (isSubst(v)) return resolveSubst(v, scope, root, resolving, resolvedCache, opts)
  if (isConcat(v)) return resolveConcat(v.nodes, scope, root, resolving, resolvedCache, opts)
  if (isAppend(v)) return resolveAppend(v, scope, root, resolving, resolvedCache, opts)
  if (isResObj(v)) return resolveResObj(v, root, resolving, resolvedCache, opts)
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return {
      kind: 'array',
      items: hv.items.map((item: HoconValue) =>
        resolveVal(item as ResolverValue, scope, root, resolving, resolvedCache, opts)
        ?? ({ kind: 'scalar', value: null } satisfies HoconValue)
      ),
    }
  }
  return hv
}

function resolveSubst(
  s: SubstPlaceholder,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue | undefined {
  if (resolvedCache.has(s.path)) return resolvedCache.get(s.path)!

  if (resolving.has(s.path)) {
    // Cycle detected: try prior value for self-referential substitutions.
    const segments = parseSubstPath(s.path)
    let prior: ResolverValue | undefined
    if (s.prefixLen > 0) {
      const leafSeg = segments[segments.length - 1] ?? ''
      const parentScope = lookupResObj(root, segments.slice(0, segments.length - 1))
      prior = parentScope?.priorValues.get(leafSeg)
    } else {
      const rootSeg = segments[0] ?? ''
      prior = scope.priorValues.get(rootSeg) ?? root.priorValues.get(rootSeg)
    }
    if (prior !== undefined) {
      // Resolve prior with a fresh resolving set to avoid re-triggering the cycle check
      return resolveVal(prior, scope, root, new Set(resolving), resolvedCache, opts)
    }
    if (s.optional) return undefined
    throw new ResolveError(`circular substitution: ${s.path}`, s.path, s.line, s.col)
  }

  resolving.add(s.path)
  try {
    const found = lookupPath(root, parseSubstPath(s.path))
    if (found !== undefined) {
      // Only fall back to prior value for actual self-referential substitutions
      // (e.g. b=${b}), not for any substitution found during lookup.
      if (isSubst(found) || isConcat(found)) {
        const isSelfRef = isSubst(found)
          ? found.path === s.path
          : isConcat(found) && found.nodes.some(
              (n: ResolverValue) => isSubst(n) && n.path === s.path
            )
        if (isSelfRef) {
          const selfSegments = parseSubstPath(s.path)
          let prior: ResolverValue | undefined
          if (s.prefixLen > 0) {
            const leafSeg = selfSegments[selfSegments.length - 1] ?? ''
            const parentScope = lookupResObj(root, selfSegments.slice(0, selfSegments.length - 1))
            prior = parentScope?.priorValues.get(leafSeg)
          } else {
            const rootSeg = selfSegments[0] ?? ''
            prior = scope.priorValues.get(rootSeg) ?? root.priorValues.get(rootSeg)
          }
          if (prior !== undefined) {
            const result = resolveVal(prior, scope, root, resolving, resolvedCache, opts)
            if (result !== undefined) resolvedCache.set(s.path, result)
            return result
          }
        }
      }
      let result = resolveVal(found, scope, root, resolving, resolvedCache, opts)
      // Delayed merge in substitution context: if the resolved value is an object
      // and there's a prior value for the leaf segment that also resolves to an object,
      // deep merge them (prior as base, current on top).
      // For non-relativized paths: only single-segment (e.g. ${a}), not multi-segment
      // (e.g. ${a.b}) which would incorrectly merge the prior of "a".
      // For relativized paths: effective segment count (after prefix) must be 1.
      const segments = parseSubstPath(s.path)
      const effectiveLen = segments.length - s.prefixLen
      if (effectiveLen === 1 && result !== undefined && result.kind === 'object') {
        const leafSeg = segments[segments.length - 1] ?? ''
        // Find the prior value: for relativized paths, walk from root to the parent scope
        let prior: ResolverValue | undefined
        if (s.prefixLen > 0) {
          const parentScope = lookupResObj(root, segments.slice(0, segments.length - 1))
          prior = parentScope?.priorValues.get(leafSeg)
        } else {
          prior = scope.priorValues.get(leafSeg) ?? root.priorValues.get(leafSeg)
        }
        if (prior !== undefined) {
          const priorResolved = resolveVal(prior, scope, root, resolving, resolvedCache, opts)
          if (priorResolved !== undefined && priorResolved.kind === 'object') {
            result = deepMergeHoconValues(
              priorResolved as HoconValue & { kind: 'object' },
              result as HoconValue & { kind: 'object' },
            )
          }
        }
      }
      if (result !== undefined) resolvedCache.set(s.path, result)
      return result
    }

    // Env var fallback — also try the original (non-relativized) path
    const envVal = opts.env[s.path] ?? (
      s.prefixLen > 0
        ? opts.env[parseSubstPath(s.path).slice(s.prefixLen).join('.')]
        : undefined
    )
    if (envVal !== undefined) {
      const result: HoconValue = { kind: 'scalar', value: envVal }
      resolvedCache.set(s.path, result)
      return result
    }

    if (s.optional) return undefined
    throw new ResolveError(`could not resolve substitution: \${${s.path}}`, s.path, s.line, s.col)
  } finally {
    resolving.delete(s.path)
  }
}

function resolveConcat(
  nodes: ResolverValue[],
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const resolved = nodes
    .map(n => resolveVal(n, scope, root, resolving, resolvedCache, opts))
    .filter((v): v is HoconValue => v !== undefined)

  if (resolved.length === 0) return { kind: 'scalar', value: null }
  if (resolved.length === 1) return resolved[0]!

  // Object concatenation: if all non-separator elements are objects, deep-merge them.
  // Only filter parser-inserted separator whitespace (tracked via separatorValues WeakSet),
  // NOT user-authored values like "" or " " which should prevent object merging.
  const nonSep = resolved.filter(v => !separatorValues.has(v))
  if (nonSep.length > 0 && nonSep.every(v => v.kind === 'object')) {
    const merged = new Map<string, HoconValue>()
    for (const v of nonSep) {
      if (v.kind === 'object') {
        for (const [k, val] of v.fields) {
          const existing = merged.get(k)
          if (existing?.kind === 'object' && val.kind === 'object') {
            merged.set(k, deepMergeHoconValues(existing, val))
          } else {
            merged.set(k, val)
          }
        }
      }
    }
    return { kind: 'object', fields: merged }
  }

  // Array concatenation: if any element is an array, treat all as array elements
  if (resolved.some(v => v.kind === 'array')) {
    const items: HoconValue[] = []
    for (const v of resolved) {
      if (v.kind === 'array') items.push(...v.items)
      else items.push(v)
    }
    return { kind: 'array', items }
  }

  // String concatenation
  const str = resolved.map(v => v.kind === 'scalar' ? String(v.value) : JSON.stringify(v)).join('')
  return { kind: 'scalar', value: str }
}

function resolveAppend(
  a: AppendPlaceholder,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const existing = resolveVal(a.existing, scope, root, resolving, resolvedCache, opts)
    ?? ({ kind: 'array', items: [] } satisfies HoconValue)
  const elem = resolveVal(a.elem, scope, root, resolving, resolvedCache, opts)
  const items: HoconValue[] = existing.kind === 'array' ? [...existing.items] : [existing]
  if (elem !== undefined) items.push(elem)
  return { kind: 'array', items }
}
