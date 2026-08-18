// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/*
 * Helpers for chained / value-interior self-referential-substitution support.
 *
 * Port of go.hocon's `internal/resolver/foldselfref.go` (PRs #121 and #123,
 * covering issues #118 and #120) and rs.hocon's `src/resolver/fold_self_ref.rs`.
 * Cross-impl with go.hocon v1.5.2 and rs.hocon v1.5.1.
 *
 * The chain bug: when a key is self-referentially appended N≥3 times
 * (`a = ${a} [...]` repeated, or `a = [${a}, ...]` repeated, or
 * `o = { history = ${o}, ... }` repeated) — directly, via includes, or
 * across nested paths — the resolver's `priorValues` map (one-deep per key)
 * gets overwritten with a self-referentially-malformed value, and
 * `resolveSubst`'s prior-resolution branch loops forever.
 *
 * The fix folds occurrences of `${key}` inside the value about to be saved
 * as `priorValues[key]` against the OLD prior, so by induction every saved
 * prior is self-ref-free.
 *
 * Scope: walks SubstPlaceholder / ConcatPlaceholder / HoconValue array /
 * HoconValue object / ResObj recursively. Covers the union of #118
 * (Subst/Concat patterns) and #120 (array-element / object-field patterns).
 * (`+=` is desugared to a `${?key} [...]` self-ref concat upstream — go.hocon#134
 * — so it flows through the Concat path; there is no longer an Append shape.)
 */

import type { HoconValue } from '../../value.js'
import type { Segment } from '../lexer/token.js'
import {
  type ConcatPlaceholder,
  type ResObj,
  type ResolverValue,
  type SubstPlaceholder,
  isConcat,
  isResObj,
  isSubst,
} from './types.js'

/** Dotted-path key of a substitution placeholder's segments. Already
 * relativized at this point if the placeholder lives inside an included
 * file under a nested path prefix.
 *
 * Implemented inline (not via utils.segmentsToKey) to avoid a circular
 * import — utils.ts depends on this module for foldOrSkipPrior. */
export function substFullKey(s: SubstPlaceholder): string {
  return stringSegmentsToKey(s.segments.map(seg => seg.text))
}

/** Same quoting/escaping rules as `segmentsToKey` but for string segments
 * (e.g. `pathPrefix + head` at structure-builder save sites). The output is
 * directly comparable to a `segmentsToKey` result on a Segment[] of the
 * same texts. */
export function stringSegmentsToKey(segments: string[]): string {
  return segments
    .map(t => {
      if (t === '' || /[^a-zA-Z0-9\-_]/.test(t)) {
        return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      }
      return t
    })
    .join('.')
}

/** S13a.12: remainder segment texts when `fullKey` is a PROPER segment-wise
 * prefix of the subst's path (`foo` ⊏ `foo.a` → `["a"]`), else null.
 *
 * The boundary check works on the dotted keys because both sides use the same
 * quoting (`stringSegmentsToKey`): a literal dotted segment renders quoted
 * (`"foo.a"`), so it can never string-prefix `foo.` — only a genuine segment
 * boundary matches. The remainder is recovered by finding the segment count
 * whose prefix key equals `fullKey`. */
export function prefixSelfRefRemainder(s: SubstPlaceholder, fullKey: string): string[] | null {
  const texts = s.segments.map(seg => seg.text)
  if (!stringSegmentsToKey(texts).startsWith(fullKey + '.')) return null
  for (let n = 1; n < texts.length; n++) {
    if (stringSegmentsToKey(texts.slice(0, n)) === fullKey) return texts.slice(n)
  }
  return null
}

/** Structural navigation of `remainder` into a resolver value, following
 * ResObj fields and already-resolved object fields.
 *
 * Returns the reached node, `undefined` when a segment is missing (or the
 * walk dead-ends in a scalar/array — path semantics treat both as absent),
 * and `null` when it hits a node it cannot see through structurally
 * (a substitution or concat placeholder). */
export function navigateResolverValue(
  v: ResolverValue,
  remainder: string[],
): ResolverValue | undefined | null {
  let cur: ResolverValue = v
  for (const seg of remainder) {
    if (isSubst(cur) || isConcat(cur)) return null
    if (isResObj(cur)) {
      const next = cur.fields.get(seg)
      if (next === undefined) return undefined
      cur = next
      continue
    }
    const hv = cur as HoconValue
    if (hv.kind === 'object') {
      const next = hv.fields.get(seg)
      if (next === undefined) return undefined
      cur = next as ResolverValue
      continue
    }
    return undefined
  }
  return cur
}

/** Fold one prefix self-reference (`${fullKey.rest}`) against the below value:
 * navigate `rest` into `replacement`. A missing path folds to the undefined
 * classification — a `knownAbsent` placeholder that disappears when optional
 * and errors at resolve time when required. An unnavigable path (a live
 * substitution mid-walk) leaves the subst unchanged; the resolve-time guard
 * covers it. */
function foldPrefixSelfRef(
  s: SubstPlaceholder,
  replacement: ResolverValue,
  remainder: string[],
): ResolverValue {
  const navigated = navigateResolverValue(replacement, remainder)
  if (navigated === null) return s
  if (navigated === undefined) {
    return {
      _kind: 'subst-placeholder',
      segments: s.segments.map(seg => ({ text: seg.text, line: seg.line, col: seg.col })),
      optional: s.optional,
      knownAbsent: true,
      listSuffix: s.listSuffix,
      line: s.line,
      col: s.col,
      prefixLen: s.prefixLen,
    } satisfies SubstPlaceholder
  }
  return cloneResolverValue(navigated)
}

/** Prior-layer object merge for the standalone-prefix-self-ref save case
 * (S13a.12): the below layer as base, the navigated value on top. A local,
 * bookkeeping-free merge — deliberately NOT utils.deepMergeResObjInto, which
 * would create an import cycle and re-run prior-save logic that has already
 * happened for these (cloned) layers. */
function mergeResObjLayers(base: ResObj, top: ResObj): ResObj {
  const fields = new Map(base.fields)
  for (const [k, tv] of top.fields) {
    const bv = fields.get(k)
    if (bv !== undefined && isResObj(bv) && isResObj(tv)) {
      fields.set(k, mergeResObjLayers(bv, tv))
    } else {
      fields.set(k, tv)
    }
  }
  // Carry BOTH layers' bookkeeping: top's priorValues (its keys' own
  // delayed-merge chains) win per key over base's, and resetKeys union so
  // reset markers from either layer survive the splice.
  const priorValues = new Map(base.priorValues)
  for (const [k, pv] of top.priorValues) priorValues.set(k, pv)
  const resetKeys = new Set(base.resetKeys)
  for (const k of top.resetKeys) resetKeys.add(k)
  return {
    _kind: 'res-obj',
    fields,
    priorValues,
    resetKeys,
  }
}

/** Returns true if `v` contains at least one `Subst` whose dotted-path key
 * equals `fullKey` — or, per S13a.12, whose path has `fullKey` as a proper
 * segment-wise prefix (`${foo.a}` inside the stack of `foo`). Walks Subst /
 * Concat / Append / ResObj / HoconValue array / HoconValue object — all six
 * wrapping shapes that can carry a substitution placeholder post-parse. */
export function containsSelfRef(v: ResolverValue, fullKey: string): boolean {
  return containsSelfRefInner(v, fullKey, true)
}

/** `allowPrefix` narrows the S13a.12 prefix rule to value-stack positions: it
 * stays true through concat nodes and array elements (the value chain of the
 * field itself) but turns false when descending into object interiors — a
 * substitution nested inside an object literal that references a sibling
 * branch of the same field (`a = { x = ${a.p.v} }`) is a lazy final-tree
 * lookup (S13a.14), NOT a below-lookback. */
function containsSelfRefInner(v: ResolverValue, fullKey: string, allowPrefix: boolean): boolean {
  if (isSubst(v))
    return (
      !v.knownAbsent &&
      (substFullKey(v) === fullKey ||
        (allowPrefix && prefixSelfRefRemainder(v, fullKey) !== null))
    )
  if (isConcat(v)) return v.nodes.some(n => containsSelfRefInner(n, fullKey, allowPrefix))
  if (isResObj(v)) {
    for (const f of v.fields.values()) {
      if (containsSelfRefInner(f, fullKey, false)) return true
    }
    return false
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return hv.items.some(item => containsSelfRefInner(item as ResolverValue, fullKey, allowPrefix))
  }
  if (hv.kind === 'object') {
    for (const f of hv.fields.values()) {
      if (containsSelfRefInner(f as ResolverValue, fullKey, false)) return true
    }
    return false
  }
  return false
}

/** Returns a copy of `v` with every `Subst` whose dotted-path key equals
 * `fullKey` replaced by `replacement`. If `v` contains no such reference,
 * returns `v` unchanged.
 *
 * Scope matches `containsSelfRef`. */
export function foldSelfRef(
  v: ResolverValue,
  fullKey: string,
  replacement: ResolverValue,
): ResolverValue {
  return foldSelfRefInner(v, fullKey, replacement, true)
}

/** See `containsSelfRefInner` for the `allowPrefix` narrowing rule. */
function foldSelfRefInner(
  v: ResolverValue,
  fullKey: string,
  replacement: ResolverValue,
  allowPrefix: boolean,
): ResolverValue {
  if (isSubst(v)) {
    if (substFullKey(v) === fullKey) return replacement
    if (allowPrefix) {
      const remainder = prefixSelfRefRemainder(v, fullKey)
      if (remainder !== null) return foldPrefixSelfRef(v, replacement, remainder)
    }
    return v
  }
  if (isConcat(v)) {
    return {
      _kind: 'concat-placeholder',
      nodes: v.nodes.map(n => foldSelfRefInner(n, fullKey, replacement, allowPrefix)),
      line: v.line,
      col: v.col,
    } satisfies ConcatPlaceholder
  }
  if (isResObj(v)) {
    const newFields = new Map<string, ResolverValue>()
    for (const [k, val] of v.fields) {
      newFields.set(k, foldSelfRefInner(val, fullKey, replacement, false))
    }
    // Preserve priorValues from the original so per-object look-back continues
    // to find them post-fold.
    return { _kind: 'res-obj', fields: newFields, priorValues: new Map(v.priorValues), resetKeys: new Set(v.resetKeys) }
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return {
      kind: 'array',
      items: hv.items.map(
        item => foldSelfRefInner(item as ResolverValue, fullKey, replacement, allowPrefix) as HoconValue,
      ),
    }
  }
  if (hv.kind === 'object') {
    const newFields = new Map<string, HoconValue>()
    for (const [k, val] of hv.fields) {
      newFields.set(k, foldSelfRefInner(val as ResolverValue, fullKey, replacement, false) as HoconValue)
    }
    return { kind: 'object', fields: newFields }
  }
  return v
}

/** Replace every `knownAbsent` self-reference to `fullKey` with `replacement`.
 *
 * Counterpart to `foldSelfRef`, which targets the NON-absent self-refs. An
 * included file's bare `+=` chain folds its bottom-most `${?key}` to
 * `knownAbsent` while building in isolation (no in-file prior). When that file
 * is merged into a destination that already has a value for `key`, this
 * re-opens the absent bottom so the included chain accumulates onto the
 * destination's value across the include boundary (go.hocon#134). Walks the
 * same Subst / Concat / ResObj / array / object shapes as `foldSelfRef`. */
export function foldKnownAbsentSelfRef(
  v: ResolverValue,
  fullKey: string,
  replacement: ResolverValue,
): ResolverValue {
  if (isSubst(v)) {
    return v.knownAbsent && substFullKey(v) === fullKey ? replacement : v
  }
  if (isConcat(v)) {
    return {
      _kind: 'concat-placeholder',
      nodes: v.nodes.map(n => foldKnownAbsentSelfRef(n, fullKey, replacement)),
      line: v.line,
      col: v.col,
    } satisfies ConcatPlaceholder
  }
  if (isResObj(v)) {
    const newFields = new Map<string, ResolverValue>()
    for (const [k, val] of v.fields) {
      newFields.set(k, foldKnownAbsentSelfRef(val, fullKey, replacement))
    }
    return { _kind: 'res-obj', fields: newFields, priorValues: new Map(v.priorValues), resetKeys: new Set(v.resetKeys) }
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return {
      kind: 'array',
      items: hv.items.map(item => foldKnownAbsentSelfRef(item as ResolverValue, fullKey, replacement) as HoconValue),
    }
  }
  if (hv.kind === 'object') {
    const newFields = new Map<string, HoconValue>()
    for (const [k, val] of hv.fields) {
      newFields.set(k, foldKnownAbsentSelfRef(val as ResolverValue, fullKey, replacement) as HoconValue)
    }
    return { kind: 'object', fields: newFields }
  }
  return v
}

/**
 * Three-way decision at a prior-save site:
 *
 *   * `prior` has no self-ref to `fullKey`           → save a deep-clone → clonedPrior
 *   * `prior` has self-ref AND `old` is defined      → fold against old  → folded
 *   * optional self-ref AND `old` is undefined       → fold to absent    → folded
 *   * required self-ref AND `old` is undefined       → skip save         → undefined
 *
 * The no-prior optional case preserves S13a.13's "optional self-ref with no
 * prior resolves to undefined" rule while still saving concat literal pieces
 * for the next overwrite.
 *
 * The "save a deep-clone" semantics for the no-fold case prevents a
 * subtle bug: `deepMergeResObjInto` mutates `dst.fields[k]` in place when
 * the both-objects branch recurses. If the prior reference shared the
 * same ResObj, the saved prior would reflect the post-merge state instead
 * of the pre-merge snapshot — making the self-ref cycle never resolve.
 * Cross-impl with rs.hocon's `prior.clone()` (Rust derives a deep clone
 * for `ResolverValue::Obj`).
 */
export function foldOrSkipPrior(
  prior: ResolverValue,
  fullKey: string,
  old: ResolverValue | undefined,
): ResolverValue | undefined {
  if (!containsSelfRef(prior, fullKey)) return cloneResolverValue(prior)
  if (old === undefined) return foldOptionalSelfRefAbsent(prior, fullKey)
  // S13a.12: a STANDALONE prefix self-ref in field-value position is a merge
  // LAYER — an object it navigates to merges over the stack below it, so the
  // saved prior must keep the below layer's other keys (`foo:{a:{c:1},keep:9};
  // foo:${foo.a}` → prior {a:{c:1},keep:9,c:1}, not just {c:1}). Nested
  // occurrences (inside concat/array/object) substitute in place instead —
  // they are not merge layers — and take the generic fold below.
  if (isSubst(prior)) {
    const remainder = prefixSelfRefRemainder(prior, fullKey)
    if (remainder !== null) {
      const navigated = navigateResolverValue(old, remainder)
      // Optional prefix self-ref with nothing below at the navigated path:
      // the layer vanishes, and a vanished layer is transparent — the below
      // layer itself is the surviving prior.
      if (navigated === undefined && prior.optional) return cloneResolverValue(old)
      if (navigated !== null && navigated !== undefined && isResObj(navigated) && isResObj(old)) {
        return mergeResObjLayers(
          cloneResolverValue(old) as ResObj,
          cloneResolverValue(navigated) as ResObj,
        )
      }
    }
  }
  // foldSelfRef already constructs new ResObj/array/object/Concat nodes
  // along the path it traverses, so the result is a fresh tree wherever
  // mutation could matter. No additional clone needed.
  return foldSelfRef(prior, fullKey, old)
}

function foldOptionalSelfRefAbsent(v: ResolverValue, fullKey: string): ResolverValue | undefined {
  return foldOptionalSelfRefAbsentInner(v, fullKey, true)
}

/** See `containsSelfRefInner` for the `allowPrefix` narrowing rule. */
function foldOptionalSelfRefAbsentInner(
  v: ResolverValue,
  fullKey: string,
  allowPrefix: boolean,
): ResolverValue | undefined {
  if (
    isSubst(v) &&
    (substFullKey(v) === fullKey ||
      (allowPrefix && prefixSelfRefRemainder(v, fullKey) !== null))
  ) {
    if (!v.optional) return undefined
    return {
      _kind: 'subst-placeholder',
      segments: v.segments.map(seg => ({ text: seg.text, line: seg.line, col: seg.col })),
      optional: v.optional,
      knownAbsent: true,
      listSuffix: v.listSuffix,
      line: v.line,
      col: v.col,
      prefixLen: v.prefixLen,
    } satisfies SubstPlaceholder
  }
  if (isConcat(v)) {
    const nodes: ResolverValue[] = []
    for (const node of v.nodes) {
      const folded = foldOptionalSelfRefAbsentInner(node, fullKey, allowPrefix)
      if (folded === undefined) return undefined
      nodes.push(folded)
    }
    return { _kind: 'concat-placeholder', nodes, line: v.line, col: v.col }
  }
  if (isResObj(v)) {
    const fields = new Map<string, ResolverValue>()
    for (const [key, value] of v.fields) {
      const folded = foldOptionalSelfRefAbsentInner(value, fullKey, false)
      if (folded === undefined) return undefined
      fields.set(key, folded)
    }
    return { _kind: 'res-obj', fields, priorValues: new Map(v.priorValues), resetKeys: new Set(v.resetKeys) }
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    const items: HoconValue[] = []
    for (const item of hv.items) {
      const folded = foldOptionalSelfRefAbsentInner(item as ResolverValue, fullKey, allowPrefix)
      if (folded === undefined) return undefined
      items.push(folded as HoconValue)
    }
    return { kind: 'array', items }
  }
  if (hv.kind === 'object') {
    const fields = new Map<string, HoconValue>()
    for (const [key, value] of hv.fields) {
      const folded = foldOptionalSelfRefAbsentInner(value as ResolverValue, fullKey, false)
      if (folded === undefined) return undefined
      fields.set(key, folded as HoconValue)
    }
    return { kind: 'object', fields }
  }
  return cloneResolverValue(v)
}

/** Deep-clone a ResolverValue. Used at prior-save sites so subsequent
 * in-place mutation of the source tree does not leak into the saved
 * prior. The mutation hazards this guards against:
 *
 *   - `deepMergeResObjInto` mutates `ResObj.fields` / `priorValues` maps
 *     when the both-objects branch recurses. Without ResObj cloning, the
 *     saved prior would reflect post-merge state.
 *   - `StructureBuilder.relativizeSubstPaths` mutates `SubstPlaceholder.
 *     segments` and `prefixLen` in place when an included file is
 *     mounted into a nested path. Because `relativizeResObj` walks BOTH
 *     `fields` AND `priorValues`, a shared `Subst` reference between the
 *     two would get its prefix applied twice. So `Subst` and `Concat`
 *     also need structural copies — their identity is observable to
 *     resolver state (`resolvingConcats` WeakSet membership) but the
 *     prior-save tree is a separate identity from the fields tree
 *     anyway, so cloning is safe.
 *
 * Scalar HoconValue (the only truly immutable variant) shares its
 * reference. */
export function cloneResolverValue(v: ResolverValue): ResolverValue {
  if (isSubst(v)) {
    return {
      _kind: 'subst-placeholder',
      segments: v.segments.map(seg => ({ text: seg.text, line: seg.line, col: seg.col })),
      optional: v.optional,
      knownAbsent: v.knownAbsent,
      listSuffix: v.listSuffix,
      line: v.line,
      col: v.col,
      prefixLen: v.prefixLen,
    } satisfies SubstPlaceholder
  }
  if (isConcat(v)) {
    return {
      _kind: 'concat-placeholder',
      nodes: v.nodes.map(n => cloneResolverValue(n)),
      line: v.line,
      col: v.col,
    } satisfies ConcatPlaceholder
  }
  if (isResObj(v)) {
    const newFields = new Map<string, ResolverValue>()
    for (const [k, val] of v.fields) newFields.set(k, cloneResolverValue(val))
    const newPriors = new Map<string, ResolverValue>()
    for (const [k, val] of v.priorValues) newPriors.set(k, cloneResolverValue(val))
    return { _kind: 'res-obj', fields: newFields, priorValues: newPriors, resetKeys: new Set(v.resetKeys) }
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return {
      kind: 'array',
      items: hv.items.map(item => cloneResolverValue(item as ResolverValue) as HoconValue),
    }
  }
  if (hv.kind === 'object') {
    const newFields = new Map<string, HoconValue>()
    for (const [k, val] of hv.fields) {
      newFields.set(k, cloneResolverValue(val as ResolverValue) as HoconValue)
    }
    return { kind: 'object', fields: newFields }
  }
  return hv
}

/** Recursively folds nested self-references inside a ResObj tree using each
 * enclosing ResObj's `priorValues` as the substitution target. For every
 * ResObj encountered, each field `k` is examined: if the field's value
 * contains a `Subst` pointing at `pathPrefix + k` AND the ResObj has a
 * `priorValues[k]` entry, the substitution is folded against the prior.
 *
 * Why this exists alongside the path-aware deepMerge fix: ts.hocon's
 * structure-builder saves an Obj-typed existing into the OUTER scope's
 * priorValues when a nested-object assignment overrides another. That
 * existing may contain nested self-refs (e.g. `o.history = ${o}` inside a
 * `o = {...}` Obj being saved at root.priorValues["o"]) which the outer
 * save site only fold-checks against the outer full key. The pre-pass
 * walks the inner ResObjs and folds against each level's own priorValues
 * so the saved Obj is self-ref-free at every depth.
 *
 * Cross-impl note: covers the multi-segment object-merge (#120-class) on
 * ts.hocon. Called from `structure-builder::applyField` before saving an
 * Obj-typed existing as the parent's prior. */
export function foldNestedSelfRefs(v: ResolverValue, pathPrefix: string[]): ResolverValue {
  if (!isResObj(v)) return v
  const newFields = new Map<string, ResolverValue>()
  for (const [k, fieldVal] of v.fields) {
    const childPath = [...pathPrefix, k]
    const fullKey = stringSegmentsToKey(childPath)
    const folded = foldNestedSelfRefs(fieldVal, childPath)
    let finalVal = folded
    if (containsSelfRef(folded, fullKey)) {
      const leafPrior = v.priorValues.get(k)
      if (leafPrior !== undefined) {
        const leafPriorFolded = foldNestedSelfRefs(leafPrior, childPath)
        finalVal = foldSelfRef(folded, fullKey, leafPriorFolded)
      }
    }
    newFields.set(k, finalVal)
  }
  return { _kind: 'res-obj', fields: newFields, priorValues: new Map(v.priorValues), resetKeys: new Set(v.resetKeys) }
}

/** Path-equality walk: returns true if `v` contains a `Subst` whose
 * segments text-equal `target`. Used by self-ref detection where a lookup
 * returns a value containing the same placeholder being currently resolved.
 *
 * Cross-impl note: rs.hocon used path equality already; ts.hocon's pre-fix
 * `resolvingConcats` mechanism was pointer-identity. This helper preserves
 * the pre-#120 single-Concat detection and widens the scope to Concat /
 * array / object / ResObj interiors. */
export function containsSubstByPath(v: ResolverValue, target: Segment[]): boolean {
  if (isSubst(v)) return !v.knownAbsent && segmentsTextEqual(v.segments, target)
  if (isConcat(v)) return v.nodes.some(n => containsSubstByPath(n, target))
  if (isResObj(v)) {
    for (const f of v.fields.values()) {
      if (containsSubstByPath(f, target)) return true
    }
    return false
  }
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return hv.items.some(item => containsSubstByPath(item as ResolverValue, target))
  }
  if (hv.kind === 'object') {
    for (const f of hv.fields.values()) {
      if (containsSubstByPath(f as ResolverValue, target)) return true
    }
    return false
  }
  return false
}

function segmentsTextEqual(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined || bi === undefined || ai.text !== bi.text) return false
  }
  return true
}
