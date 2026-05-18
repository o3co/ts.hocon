import { ResolveError } from '../../errors.js'
import { numericObjectToArray } from '../../value/numeric-array.js'
import type { HoconValue } from '../../value.js'
import type { Segment } from '../lexer/token.js'
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
  segmentsToKey,
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
            ({ kind: 'scalar', raw: 'null', valueType: 'null' } satisfies HoconValue),
        ),
      }
    }
    return hv
  }

  private segmentsEqual(a: Segment[], b: Segment[]): boolean {
    return a.length === b.length && a.every((seg, i) => seg.text === b[i]?.text)
  }

  private resolveSubst(
    s: SubstPlaceholder,
    scope: ResObj,
  ): HoconValue | undefined {
    // Cache key includes listSuffix to prevent `${X}` and `${X[]}` collisions:
    // both resolve via different code paths (scalar fallback vs resolveEnvList)
    // and can produce different values, so they must occupy distinct cache slots.
    // Pin: tests/env-var-list.test.ts S13c cache-disambiguation regression.
    const key = s.listSuffix
      ? `${segmentsToKey(s.segments)}[]`
      : segmentsToKey(s.segments)

    if (this.cache.has(key)) return this.cache.get(key)!

    if (this.resolving.has(key)) {
      // Cycle detected: try prior value for self-referential substitutions.
      let prior: ResolverValue | undefined
      if (s.prefixLen > 0) {
        const leafSeg = s.segments[s.segments.length - 1]?.text ?? ''
        const parentScope = lookupResObj(
          this.root,
          s.segments.slice(0, s.segments.length - 1),
        )
        prior = parentScope?.priorValues.get(leafSeg)
      } else {
        const rootSeg = s.segments[0]?.text ?? ''
        prior =
          scope.priorValues.get(rootSeg) ?? this.root.priorValues.get(rootSeg)
      }
      if (prior !== undefined) {
        // Clone the resolving set so that resolving the prior value can re-resolve
        // other paths currently in the set, while key (still present in the clone)
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
        `circular substitution: ${key}`,
        key,
        s.line,
        s.col,
      )
    }

    this.resolving.add(key)
    try {
      const found = lookupPath(this.root, s.segments)
      if (found !== undefined) {
        // Only fall back to prior value for actual self-referential substitutions
        // (e.g. b=${b}), not for any substitution found during lookup.
        if (isSubst(found) || isConcat(found)) {
          const isSelfRef = isSubst(found)
            ? this.segmentsEqual(found.segments, s.segments)
            : isConcat(found) &&
              found.nodes.some(
                (n: ResolverValue) => isSubst(n) && this.segmentsEqual(n.segments, s.segments),
              )
          if (isSelfRef) {
            let prior: ResolverValue | undefined
            if (s.prefixLen > 0) {
              const leafSeg = s.segments[s.segments.length - 1]?.text ?? ''
              const parentScope = lookupResObj(
                this.root,
                s.segments.slice(0, s.segments.length - 1),
              )
              prior = parentScope?.priorValues.get(leafSeg)
            } else {
              const rootSeg = s.segments[0]?.text ?? ''
              prior =
                scope.priorValues.get(rootSeg) ??
                this.root.priorValues.get(rootSeg)
            }
            if (prior !== undefined) {
              const result = this.resolveVal(prior, scope)
              if (result !== undefined) this.cache.set(key, result)
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
        const effectiveLen = s.segments.length - s.prefixLen
        if (
          effectiveLen === 1 &&
          result !== undefined &&
          result.kind === 'object'
        ) {
          const leafSeg = s.segments[s.segments.length - 1]?.text ?? ''
          // Find the prior value: for relativized paths, walk from root to the parent scope
          let prior: ResolverValue | undefined
          if (s.prefixLen > 0) {
            const parentScope = lookupResObj(
              this.root,
              s.segments.slice(0, s.segments.length - 1),
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
        if (result !== undefined) this.cache.set(key, result)
        return result
      }

      // S13c: env-var list expansion — when listSuffix=true, scan NAME_0, NAME_1, …
      // This branch runs BEFORE the scalar env fallback and suppresses it (S13c.5).
      if (s.listSuffix) {
        const result = this.resolveEnvList(s)
        if (result !== undefined) {
          this.cache.set(key, result)
          return result
        }
        // No _0 found in any candidate base — do NOT fall through to scalar fallback.
        if (s.optional) return undefined
        // Don't append `[]` to `key` — after the listSuffix-aware cache key
        // change (Codex C1 fix), `key` already ends in `[]`. Build the env-base
        // name once from segments for the "(no environment variables …)" hint.
        const envBase = s.segments.map((seg: Segment) => seg.text).join('.')
        throw new ResolveError(
          `could not resolve substitution: \${${key}} (no environment variables ${envBase}_0, ${envBase}_1, … set)`,
          key,
          s.line,
          s.col,
        )
      }

      // Env var fallback — use raw dot-join (no quoting) to match Lightbend behavior
      const envKey = s.segments.map((seg: Segment) => seg.text).join('.')
      const envVal =
        this.opts.env[envKey] ??
        (s.prefixLen > 0
          ? this.opts.env[s.segments.slice(s.prefixLen).map((seg: Segment) => seg.text).join('.')]
          : undefined)
      if (envVal !== undefined) {
        const result: HoconValue = { kind: 'scalar', raw: envVal, valueType: 'string' }
        this.cache.set(key, result)
        return result
      }

      if (s.optional) return undefined
      throw new ResolveError(
        `could not resolve substitution: \${${key}}`,
        key,
        s.line,
        s.col,
      )
    } finally {
      this.resolving.delete(key)
    }
  }

  /**
   * S13c: scan environment for NAME_0, NAME_1, … and return an Array<Scalar(String)>.
   *
   * Candidate bases follow the same fully-qualified→bare order used by the scalar
   * env fallback. The first base whose _0 key is present wins entirely — no
   * cross-base merging (spec §Relativized fallback precedence rules).
   *
   * Returns the HoconValue Array if any candidate base has _0, or undefined if
   * none do (caller applies optional/required handling).
   */
  private resolveEnvList(s: SubstPlaceholder): HoconValue | undefined {
    const bases = this.candidateBases(s)
    for (const base of bases) {
      const key0 = base + '_0'
      if (!(key0 in this.opts.env)) continue
      // _0 is present — scan _0, _1, … until first absent index
      const items: HoconValue[] = []
      for (let i = 0; ; i++) {
        const k = base + '_' + i
        if (!(k in this.opts.env)) break
        items.push({ kind: 'scalar', raw: this.opts.env[k] as string, valueType: 'string' })
      }
      return { kind: 'array', items }
    }
    return undefined
  }

  /**
   * Return the candidate base names for env-var-list lookup, in precedence order.
   * Mirrors the fully-qualified→bare fallback used by the scalar env path.
   */
  private candidateBases(s: SubstPlaceholder): string[] {
    const full = s.segments.map((seg: Segment) => seg.text).join('.')
    if (s.prefixLen === 0) return [full]
    const bare = s.segments.slice(s.prefixLen).map((seg: Segment) => seg.text).join('.')
    return [full, bare]
  }

  private resolveConcat(nodes: ResolverValue[], scope: ResObj): HoconValue {
    const resolved = nodes
      .map((n) => this.resolveVal(n, scope))
      .filter((v): v is HoconValue => v !== undefined)

    if (resolved.length === 0) return { kind: 'scalar', raw: 'null', valueType: 'null' }
    if (resolved.length === 1) return resolved[0] as HoconValue

    // Filter parser-inserted separator whitespace (tracked via separatorValues WeakSet),
    // NOT user-authored values like '' or ' ' which should prevent object merging.
    const nonSep = resolved.filter((v) => !separatorValues.has(v))

    if (nonSep.length === 0) {
      // All resolved values are parser-inserted separators (e.g. concat collapsed to
      // whitespace tokens after optional substitutions resolved away). Concatenate the
      // raw scalars rather than dropping all but the first separator value.
      const str = resolved
        .map((v) => (v.kind === 'scalar' ? v.raw : JSON.stringify(v)))
        .join('')
      return { kind: 'scalar', raw: str, valueType: 'string' }
    }

    // True left-to-right pairwise fold per spec §"Multi-piece concat is left-to-right pairwise
    // (NORMATIVE)". This matches Lightbend ConfigConcatenation.consolidate semantics.
    //
    // join_pair handles each type-pair:
    //   Object + Object  → deep object-merge (S10.3)
    //   Array  + Object  → numericObjectToArray on right, then array-concat (S15.3)
    //   Object + Array   → numericObjectToArray on left, then array-concat (S15.3)
    //   Array  + Array   → array-concat
    //   others           → string concat (fallthrough)
    //
    // Critically, Object + Object produces an object (not an array), so overlapping numeric
    // keys in adjacent objects are merged before the object side meets an array partner.
    // A single-pass "classify first, then iterate" loop gets this wrong for overlapping keys.
    const joinPair = (left: HoconValue, right: HoconValue): HoconValue => {
      if (left.kind === 'object' && right.kind === 'object') {
        // S10.3: both objects — deep-merge (later value wins on duplicate keys)
        return deepMergeHoconValues(left, right)
      }
      if (left.kind === 'array' && right.kind === 'object') {
        // S15.3: list + object — attempt numeric conversion on the object side
        const converted = numericObjectToArray(right)
        if (converted !== null) {
          return { kind: 'array', items: [...left.items, ...converted] }
        }
        // No eligible keys — treat as array+object mix (S10.4 path: push object as element)
        return { kind: 'array', items: [...left.items, right] }
      }
      if (left.kind === 'object' && right.kind === 'array') {
        // S15.3: object + list — attempt numeric conversion on the object side
        const converted = numericObjectToArray(left)
        if (converted !== null) {
          return { kind: 'array', items: [...converted, ...right.items] }
        }
        // No eligible keys — treat as object+array mix (S10.4 path: push object as element)
        return { kind: 'array', items: [left, ...right.items] }
      }
      if (left.kind === 'array' && right.kind === 'array') {
        return { kind: 'array', items: [...left.items, ...right.items] }
      }
      // Array + non-array (scalar/other) — preserve prior "array context wins" behavior:
      // push the non-array element into the array. S10.13 (array+scalar → error) is a
      // separate cluster (Phase 6 #?) and is out of scope here.
      if (left.kind === 'array') {
        return { kind: 'array', items: [...left.items, right] }
      }
      if (right.kind === 'array') {
        return { kind: 'array', items: [left, ...right.items] }
      }
      // String concat (scalars, or scalar+object — the obj+scalar case keeps prior
      // string-concat behavior since prior code reached string-concat too when no array
      // was present).
      const leftStr = left.kind === 'scalar' ? left.raw : JSON.stringify(left)
      const rightStr = right.kind === 'scalar' ? right.raw : JSON.stringify(right)
      return { kind: 'scalar', raw: leftStr + rightStr, valueType: 'string' }
    }

    // Pairwise left-to-right reduce over non-separator elements.
    // For the string-concat case we must include separator whitespace tokens (they are
    // user-meaningful in string context), so fall back to the full `resolved` list when the
    // fold result is a scalar to preserve whitespace joining.
    const [head, ...tail] = nonSep
    const folded = tail.reduce(joinPair, head as HoconValue)

    // If the result is scalar and there were separator tokens, re-run as plain string concat
    // over all resolved values so whitespace is preserved (scalars are concatenated verbatim).
    if (folded.kind === 'scalar') {
      const str = resolved
        .map((v) => (v.kind === 'scalar' ? v.raw : JSON.stringify(v)))
        .join('')
      return { kind: 'scalar', raw: str, valueType: 'string' }
    }

    return folded
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
