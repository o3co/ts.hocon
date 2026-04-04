import { ResolveError } from '../../errors.js'
import type { HoconValue } from '../../value.js'
import {
  type AppendPlaceholder,
  isAppend,
  isConcat,
  isResObj,
  isSubst,
  type ResObj,
  type ResolveOptions,
  type ResolverValue,
  type SubstPlaceholder,
  separatorValues,
} from './types.js'
import {
  deepMergeHoconValues,
  lookupPath,
  lookupResObj,
  parseSubstPath,
} from './utils.js'

export class SubstitutionResolver {
  private resolving = new Set<string>()
  private cache = new Map<string, HoconValue>()

  constructor(
    private root: ResObj,
    private opts: ResolveOptions,
  ) {}

  resolve(): HoconValue {
    return this.resolveResObj(this.root)
  }

  private resolveResObj(obj: ResObj): HoconValue {
    const result = new Map<string, HoconValue>()
    for (const [key, val] of obj.fields) {
      const resolved = this.resolveVal(val, obj)
      if (resolved !== undefined) {
        // Delayed merge: if both current and prior resolve to objects, deep merge
        if (resolved.kind === 'object') {
          const prior = obj.priorValues.get(key)
          if (prior !== undefined) {
            const priorResolved = this.resolveVal(prior, obj)
            if (
              priorResolved !== undefined &&
              priorResolved.kind === 'object'
            ) {
              result.set(
                key,
                deepMergeHoconValues(
                  priorResolved as HoconValue & { kind: 'object' },
                  resolved as HoconValue & { kind: 'object' },
                ),
              )
              continue
            }
          }
        }
        result.set(key, resolved)
      } else {
        // Unresolved optional substitution: fall back to prior value per HOCON spec
        const prior = obj.priorValues.get(key)
        if (prior !== undefined) {
          const priorResolved = this.resolveVal(prior, obj)
          if (priorResolved !== undefined) result.set(key, priorResolved)
        }
      }
    }
    return { kind: 'object', fields: result }
  }

  private resolveVal(v: ResolverValue, scope: ResObj): HoconValue | undefined {
    if (isSubst(v)) return this.resolveSubst(v, scope)
    if (isConcat(v)) return this.resolveConcat(v.nodes, scope)
    if (isAppend(v)) return this.resolveAppend(v, scope)
    if (isResObj(v)) return this.resolveResObj(v)
    const hv = v as HoconValue
    if (hv.kind === 'array') {
      return {
        kind: 'array',
        items: hv.items.map(
          (item: HoconValue) =>
            this.resolveVal(item as ResolverValue, scope) ??
            ({ kind: 'scalar', value: null } satisfies HoconValue),
        ),
      }
    }
    return hv
  }

  private resolveSubst(
    s: SubstPlaceholder,
    scope: ResObj,
  ): HoconValue | undefined {
    if (this.cache.has(s.path)) return this.cache.get(s.path)!

    if (this.resolving.has(s.path)) {
      // Cycle detected: try prior value for self-referential substitutions.
      const segments = parseSubstPath(s.path)
      let prior: ResolverValue | undefined
      if (s.prefixLen > 0) {
        const leafSeg = segments[segments.length - 1] ?? ''
        const parentScope = lookupResObj(
          this.root,
          segments.slice(0, segments.length - 1),
        )
        prior = parentScope?.priorValues.get(leafSeg)
      } else {
        const rootSeg = segments[0] ?? ''
        prior =
          scope.priorValues.get(rootSeg) ?? this.root.priorValues.get(rootSeg)
      }
      if (prior !== undefined) {
        // Clone the resolving set so that resolving the prior value can re-resolve
        // other paths currently in the set, while s.path (still present in the clone)
        // continues to guard against infinite recursion on the same path.
        const saved = this.resolving
        this.resolving = new Set(saved)
        try {
          return this.resolveVal(prior, scope)
        } finally {
          this.resolving = saved
        }
      }
      if (s.optional) return undefined
      throw new ResolveError(
        `circular substitution: ${s.path}`,
        s.path,
        s.line,
        s.col,
      )
    }

    this.resolving.add(s.path)
    try {
      const found = lookupPath(this.root, parseSubstPath(s.path))
      if (found !== undefined) {
        // Only fall back to prior value for actual self-referential substitutions
        // (e.g. b=${b}), not for any substitution found during lookup.
        if (isSubst(found) || isConcat(found)) {
          const isSelfRef = isSubst(found)
            ? found.path === s.path
            : isConcat(found) &&
              found.nodes.some(
                (n: ResolverValue) => isSubst(n) && n.path === s.path,
              )
          if (isSelfRef) {
            const selfSegments = parseSubstPath(s.path)
            let prior: ResolverValue | undefined
            if (s.prefixLen > 0) {
              const leafSeg = selfSegments[selfSegments.length - 1] ?? ''
              const parentScope = lookupResObj(
                this.root,
                selfSegments.slice(0, selfSegments.length - 1),
              )
              prior = parentScope?.priorValues.get(leafSeg)
            } else {
              const rootSeg = selfSegments[0] ?? ''
              prior =
                scope.priorValues.get(rootSeg) ??
                this.root.priorValues.get(rootSeg)
            }
            if (prior !== undefined) {
              const result = this.resolveVal(prior, scope)
              if (result !== undefined) this.cache.set(s.path, result)
              return result
            }
          }
        }
        let result = this.resolveVal(found, scope)
        // Delayed merge in substitution context: if the resolved value is an object
        // and there's a prior value for the leaf segment that also resolves to an object,
        // deep merge them (prior as base, current on top).
        // For non-relativized paths: only single-segment (e.g. ${a}), not multi-segment
        // (e.g. ${a.b}) which would incorrectly merge the prior of 'a'.
        // For relativized paths: effective segment count (after prefix) must be 1.
        const segments = parseSubstPath(s.path)
        const effectiveLen = segments.length - s.prefixLen
        if (
          effectiveLen === 1 &&
          result !== undefined &&
          result.kind === 'object'
        ) {
          const leafSeg = segments[segments.length - 1] ?? ''
          // Find the prior value: for relativized paths, walk from root to the parent scope
          let prior: ResolverValue | undefined
          if (s.prefixLen > 0) {
            const parentScope = lookupResObj(
              this.root,
              segments.slice(0, segments.length - 1),
            )
            prior = parentScope?.priorValues.get(leafSeg)
          } else {
            prior =
              scope.priorValues.get(leafSeg) ??
              this.root.priorValues.get(leafSeg)
          }
          if (prior !== undefined) {
            const priorResolved = this.resolveVal(prior, scope)
            if (
              priorResolved !== undefined &&
              priorResolved.kind === 'object'
            ) {
              result = deepMergeHoconValues(
                priorResolved as HoconValue & { kind: 'object' },
                result as HoconValue & { kind: 'object' },
              )
            }
          }
        }
        if (result !== undefined) this.cache.set(s.path, result)
        return result
      }

      // Env var fallback — also try the original (non-relativized) path
      const envVal =
        this.opts.env[s.path] ??
        (s.prefixLen > 0
          ? this.opts.env[parseSubstPath(s.path).slice(s.prefixLen).join('.')]
          : undefined)
      if (envVal !== undefined) {
        const result: HoconValue = { kind: 'scalar', value: envVal }
        this.cache.set(s.path, result)
        return result
      }

      if (s.optional) return undefined
      throw new ResolveError(
        `could not resolve substitution: \${${s.path}}`,
        s.path,
        s.line,
        s.col,
      )
    } finally {
      this.resolving.delete(s.path)
    }
  }

  private resolveConcat(nodes: ResolverValue[], scope: ResObj): HoconValue {
    const resolved = nodes
      .map((n) => this.resolveVal(n, scope))
      .filter((v): v is HoconValue => v !== undefined)

    if (resolved.length === 0) return { kind: 'scalar', value: null }
    if (resolved.length === 1) return resolved[0]!

    // Object concatenation: if all non-separator elements are objects, deep-merge them.
    // Only filter parser-inserted separator whitespace (tracked via separatorValues WeakSet),
    // NOT user-authored values like '' or ' ' which should prevent object merging.
    const nonSep = resolved.filter((v) => !separatorValues.has(v))
    if (nonSep.length > 0 && nonSep.every((v) => v.kind === 'object')) {
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
    if (resolved.some((v) => v.kind === 'array')) {
      const items: HoconValue[] = []
      for (const v of resolved) {
        if (v.kind === 'array') items.push(...v.items)
        else items.push(v)
      }
      return { kind: 'array', items }
    }

    // String concatenation
    const str = resolved
      .map((v) => (v.kind === 'scalar' ? String(v.value) : JSON.stringify(v)))
      .join('')
    return { kind: 'scalar', value: str }
  }

  private resolveAppend(a: AppendPlaceholder, scope: ResObj): HoconValue {
    const existing =
      this.resolveVal(a.existing, scope) ??
      ({ kind: 'array', items: [] } satisfies HoconValue)
    const elem = this.resolveVal(a.elem, scope)
    const items: HoconValue[] =
      existing.kind === 'array' ? [...existing.items] : [existing]
    if (elem !== undefined) items.push(elem)
    return { kind: 'array', items }
  }
}
