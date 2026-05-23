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
import { containsSubstByPath } from './fold-self-ref.js'
import {
  deepMergeHoconValues,
  lookupPath,
  lookupResObj,
  segmentsToKey,
} from './utils.js'

export class SubstitutionResolver {
  private resolving = new Set<string>()
  private cache = new Map<string, HoconValue>()
  // Tracks ConcatPlaceholder nodes currently being iterated by resolveConcat.
  // Used by isSelfRef detection: fires only when found === a concat currently
  // mid-iteration (i.e. we are inside found's own resolution), preventing the
  // "foofoo" double-count without misfiring when an external field looks up the
  // same concat via a substitution (multi-reviewer convergence fix).
  //
  // Spec deviation: the S13a.13 spec ★1 decision #1 specified path-equality
  // preservation for self-ref detection. Round-2 multi-agent-review surfaced a
  // false-positive on external lookups (`a = ${?a}foo; b = ${a}`), so the
  // criterion was tightened to node-membership-in-iterating-set — strictly
  // narrower than path-equality. Spec amendment deferred to a follow-up
  // xx.hocon PR (see Phase 6 #3f close-out notes).
  private resolvingConcats = new WeakSet<object>()
  // Path stack tracking the full dotted path of the field currently being
  // assigned in `resolveResObj`. Leaf keys are pushed on entry to each
  // `(key, val)` iteration and popped on exit, so nested objects build up
  // the full path (e.g. `["o", "history"]` while resolving `o.history`).
  //
  // Used to tighten self-ref detection at the L192 found-lookup site:
  // a substitution `${X}` whose looked-up value contains a Subst pointing
  // at `X` is only a true self-reference when the field currently being
  // assigned is `X` (or a descendant of `X`). Without this guard, an
  // external lookup like `b = ${o}` (where o has a self-referential
  // field) would mis-fire and short-circuit to o's prior, returning the
  // wrong value for b. The is_owner gate (rfp prefix-matches s.segments)
  // narrows the check to the owner case only.
  //
  // Cross-impl with rs.hocon v1.5.1's resolving_field_path (same purpose,
  // same prefix-match semantics).
  private resolvingFieldPath: string[] = []

  constructor(
    private root: ResObj,
    private opts: ResolveOptions,
  ) {}

  /** Returns a prefix for error messages, including origin info when set. */
  private originPrefix(): string {
    return this.opts.originDescription ? `${this.opts.originDescription}: ` : ''
  }

  resolve(): HoconValue {
    return this.resolveResObj(this.root)
  }

  private resolveResObj(obj: ResObj): HoconValue {
    const result = new Map<string, HoconValue>()
    for (const [key, val] of obj.fields) {
      this.resolvingFieldPath.push(key)
      let resolved: HoconValue | undefined
      try {
        resolved = this.resolveVal(val, obj)
      } finally {
        this.resolvingFieldPath.pop()
      }
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
    if (isConcat(v)) {
      // Mark this ConcatPlaceholder as mid-iteration so that resolveSubst can
      // detect a true self-ref (the substitution's found value IS this concat,
      // currently being iterated) vs an external lookup of the same field.
      this.resolvingConcats.add(v)
      try {
        const concatResult = this.resolveConcat(v.nodes, scope, v.line, v.col)
        return concatResult  // may be undefined (all-optional-undef or allowUnresolved)
      } finally {
        this.resolvingConcats.delete(v)
      }
    }
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
      // Use s.segments.length > 1 (same criterion as the resolvingConcats short-circuit
      // below) to correctly handle dotted-path-at-root (e.g. ${foo.a} where prefixLen=0
      // but segments.length=2).
      let prior: ResolverValue | undefined
      if (s.segments.length > 1) {
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
        this.originPrefix() + `circular substitution: ${key}`,
        key,
        s.line,
        s.col,
      )
    }

    this.resolving.add(key)
    try {
      const found = lookupPath(this.root, s.segments)
      if (found !== undefined) {
        // S13a.13 / spec L841: if `found` is a ConcatPlaceholder that is currently
        // mid-iteration (its nodes are being evaluated by an outer resolveConcat that
        // called resolveSubst on one of those nodes), then this substitution IS a
        // self-ref inside that concat.  Short-circuit to prior (or no-prior) to avoid
        // the outer concat double-counting its own literal suffix (e.g. "foofoo" instead
        // of "foo" for a = ${?a}foo with no prior a).
        //
        // Critically, resolvingConcats.has(found) is FALSE when an *external* field
        // (e.g. b = ${a}) looks up field a — found is not mid-iteration there, so
        // resolveVal(found) proceeds normally and the cycle guard inside handles any
        // internal self-ref correctly.  This is the multi-reviewer convergence fix
        // (go.hocon + rs.hocon independently flagged the regression).
        // #120-equivalent widening: the pre-fix check only fired when `found`
        // was a ConcatPlaceholder currently mid-iteration. For value-interior
        // self-references (array element or object field-value, e.g.
        // `a = [${a}, "x"]` or `o = { history = ${o}, v = 2 }`), `found` is
        // a HoconValue array or a ResObj — not a Concat — so the pre-fix
        // check missed them and the resolver fell through to resolveVal(found),
        // which recursively re-entered the same value and overflowed the
        // stack. The widening adds a path-based check (is_owner gate + walk
        // through Subst / Concat / array / object / ResObj for the same
        // target segments) that fires for any wrapping shape. The is_owner
        // gate preserves the Phase 6 #3f false-positive guard: only fire
        // when the field currently being resolved IS the substitution's
        // target (or a descendant). Cross-impl with rs.hocon v1.5.1.
        const rfp = this.resolvingFieldPath
        const isOwner =
          rfp.length >= s.segments.length &&
          s.segments.every((seg, i) => rfp[i] === seg.text)
        const isSelfRef =
          (isConcat(found) && this.resolvingConcats.has(found)) ||
          (isOwner && containsSubstByPath(found, s.segments))
        if (isSelfRef) {
          let prior: ResolverValue | undefined
          if (s.segments.length > 1) {
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
          // No prior: short-circuit (spec L841).
          if (s.optional) return undefined
          throw new ResolveError(
            `${this.originPrefix()}could not resolve substitution: \${${key}}`,
            key,
            s.line,
            s.col,
          )
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

      // S13c: env-var list expansion — gated on useSystemEnvironment (E12 gate)
      if (s.listSuffix && this.opts.useSystemEnvironment !== false) {
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
          `${this.originPrefix()}could not resolve substitution: \${${key}} (no environment variables ${envBase}_0, ${envBase}_1, … set)`,
          key,
          s.line,
          s.col,
        )
      } else if (s.listSuffix) {
        // useSystemEnvironment=false: treat listSuffix as unresolvable
        if (s.optional) return undefined
        if (this.opts.allowUnresolved) return s as unknown as HoconValue
        throw new ResolveError(
          `${this.originPrefix()}could not resolve substitution: \${${key}}`,
          key,
          s.line,
          s.col,
        )
      }

      // Env var fallback — use raw dot-join (no quoting) to match Lightbend behavior.
      // Only consulted when useSystemEnvironment is not explicitly false (E12 gate).
      if (this.opts.useSystemEnvironment !== false) {
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
      }

      if (s.optional) return undefined
      if (this.opts.allowUnresolved) {
        // Leave unresolved: return the placeholder as-is so the ResObj output
        // retains it for containsPlaceholders / later resolution passes.
        return s as unknown as HoconValue
      }
      throw new ResolveError(
        `${this.originPrefix()}could not resolve substitution: \${${key}}`,
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

  private resolveConcat(nodes: ResolverValue[], scope: ResObj, line = 0, col = 0): HoconValue | undefined {
    const rawResolved = nodes.map((n) => this.resolveVal(n, scope))

    // If allowUnresolved=true, any resolved "value" that is actually a SubstPlaceholder
    // (returned as `s as unknown as HoconValue`) means the concat cannot fully resolve.
    // Return the placeholder cast as HoconValue so stripPlaceholderFields can detect and
    // strip it — this correctly marks the whole concat field as unresolved
    // (hadPlaceholders=true, getter → NotResolvedError). Returning undefined would work
    // for NotResolvedError but would make isResolved() a false-positive (the field would
    // appear absent, not placeholder-marked).
    if (this.opts.allowUnresolved) {
      for (const v of rawResolved) {
        if (v !== undefined && isSubst(v as ResolverValue)) {
          return v  // placeholder cast as HoconValue — stripped by stripPlaceholderFields
        }
      }
    }

    const resolved = rawResolved.filter((v): v is HoconValue => v !== undefined)

    // All nodes were optional and all resolved to undefined → field omitted (HOCON spec).
    if (resolved.length === 0) return undefined
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
    // Critically, Object + Object produces an object (not an array), so overlapping numeric
    // keys in adjacent objects are merged before the object side meets an array partner.
    // A single-pass "classify first, then iterate" loop gets this wrong for overlapping keys.
    // Full type-pair matrix is enforced inside joinPair — see inline comments.
    // joinPair — full type-pair matrix (NORMATIVE per spec S10.4, S10.13, S10.19):
    //   Object + Object → deep-merge (S10.3)
    //   Array  + Object → try numericObjectToArray; if None → ERROR (S10.4/S10.19)
    //   Object + Array  → try numericObjectToArray; if None → ERROR (S10.4/S10.19)
    //   Array  + Array  → array-concat
    //   Array  + Scalar → ERROR (S10.13)
    //   Scalar + Array  → ERROR (S10.13)
    //   Object + Scalar → ERROR (S10.13)
    //   Scalar + Object → ERROR (S10.13)
    //   Scalar + Scalar → string-concat (S10)
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
        // Non-numeric-keyed object cannot convert — spec L385 forbids array+object mix
        throw new ResolveError(
          'cannot concatenate array with object: value concatenation requires same-kind operands (S10.4)',
          '',
          line,
          col,
        )
      }
      if (left.kind === 'object' && right.kind === 'array') {
        // S15.3: object + list — attempt numeric conversion on the object side
        const converted = numericObjectToArray(left)
        if (converted !== null) {
          return { kind: 'array', items: [...converted, ...right.items] }
        }
        // Non-numeric-keyed object cannot convert — spec L385 forbids object+array mix
        throw new ResolveError(
          'cannot concatenate object with array: value concatenation requires same-kind operands (S10.4)',
          '',
          line,
          col,
        )
      }
      if (left.kind === 'array' && right.kind === 'array') {
        return { kind: 'array', items: [...left.items, ...right.items] }
      }
      // Spec L373: arrays and objects cannot appear in string value concatenation (S10.13)
      if (left.kind === 'array' || right.kind === 'array') {
        throw new ResolveError(
          `cannot concatenate ${left.kind} with ${right.kind}: arrays and objects may not appear in string value concatenation (S10.13)`,
          '',
          line,
          col,
        )
      }
      if (left.kind === 'object' || right.kind === 'object') {
        throw new ResolveError(
          `cannot concatenate ${left.kind} with ${right.kind}: arrays and objects may not appear in string value concatenation (S10.13)`,
          '',
          line,
          col,
        )
      }
      // Scalar + Scalar — string concat per S10
      return { kind: 'scalar', raw: left.raw + right.raw, valueType: 'string' }
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
    // E12: under allowUnresolved, if the prior value of the appended key is
    // itself an unresolved placeholder (e.g. `x = ${missing}\nx += 1`),
    // defer the whole append by returning the AppendPlaceholder as-is. The
    // downstream stripPlaceholderFields detects `_kind === 'append-placeholder'`
    // and marks the field as having placeholders. A subsequent merge layer
    // supplying a resolved prior will retry resolution. Without this guard,
    // the prior-is-not-array check below would throw, violating the spec
    // L658 deferral contract under allowUnresolved.
    if (
      this.opts.allowUnresolved &&
      (isSubst(existing as ResolverValue) ||
        isConcat(existing as ResolverValue) ||
        isAppend(existing as ResolverValue))
    ) {
      return a as unknown as HoconValue
    }
    const elem = this.resolveVal(a.elem, scope)
    // S13b.2 (HOCON.md L732): `a += b` is sugar for `a = ${?a} [b]`. The
    // prior value must be an array (or undefined → empty array); a non-array
    // prior is a resolve-time error — "just as it would in the long form".
    //
    // The long form's concat path applies S15 numeric-keyed-object-to-array
    // conversion (joinPair Array×Object branch L428-432). To remain
    // behaviourally equivalent to the desugar, this path tries the same
    // conversion when the prior is an object; only a non-array, non-
    // numeric-object prior raises the spec-mandated error.
    let priorItems: HoconValue[]
    if (existing.kind === 'array') {
      priorItems = existing.items
    } else if (existing.kind === 'object') {
      const converted = numericObjectToArray(existing)
      if (converted === null) {
        throw new ResolveError(
          `'+=' on non-array value: prior value is object with non-numeric keys (spec L732)`,
          '',
          0,
          0,
        )
      }
      priorItems = converted
    } else {
      throw new ResolveError(
        `'+=' on non-array value: prior value is ${existing.kind} (spec L732)`,
        '',
        0,
        0,
      )
    }
    const items: HoconValue[] = [...priorItems]
    if (elem !== undefined) items.push(elem)
    return { kind: 'array', items }
  }
}
