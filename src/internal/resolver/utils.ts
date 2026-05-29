import type { HoconValue } from '../../value.js'
import type { Segment } from '../lexer/token.js'
import { foldKnownAbsentSelfRef, foldOrSkipPrior, stringSegmentsToKey } from './fold-self-ref.js'
import {
  type ResObj,
  type ResolverValue,
  isResObj,
  makeResObj,
} from './types.js'

export function segmentsToKey(segments: Segment[]): string {
  return segments
    .map(s => {
      const t = s.text
      if (t === '' || /[^a-zA-Z0-9\-_]/.test(t)) {
        return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      }
      return t
    })
    .join('.')
}

export function lookupPath(root: ResObj, segments: Segment[]): ResolverValue | undefined {
  const [head, ...tail] = segments
  if (head === undefined) return undefined
  const key = head.text
  const val = root.fields.get(key)
  if (val === undefined) return undefined
  if (tail.length === 0) return val
  if (isResObj(val)) return lookupPath(val, tail)
  return undefined
}

/** Walk from root to find a ResObj at the given path (not the value, but the container). */
export function lookupResObj(root: ResObj, segments: Segment[]): ResObj | undefined {
  let cur: ResObj = root
  for (const seg of segments) {
    const val = cur.fields.get(seg.text)
    if (val === undefined || !isResObj(val)) return undefined
    cur = val
  }
  return cur
}

export function deepMergeHoconValues(
  base: HoconValue & { kind: 'object' },
  overlay: HoconValue & { kind: 'object' },
): HoconValue & { kind: 'object' } {
  const merged = new Map(base.fields)
  for (const [k, v] of overlay.fields) {
    const existing = merged.get(k)
    if (existing?.kind === 'object' && v.kind === 'object') {
      merged.set(k, deepMergeHoconValues(existing as HoconValue & { kind: 'object' }, v as HoconValue & { kind: 'object' }))
    } else {
      merged.set(k, v)
    }
  }
  return { kind: 'object', fields: merged }
}

export function deepMergeResObjInto(dst: ResObj, src: ResObj, pathPrefix: string[] = []): void {
  for (const [k, srcVal] of src.fields) {
    // Full dotted path of this field (`pathPrefix + k`). The fold uses this
    // so a self-reference `${fullKey}` (e.g. `${r.x}` while merging inside
    // an `r` object) is correctly detected — the pre-fix code used bare
    // leaf `k` and missed full-key self-refs, causing chain-length-≥3
    // dotted-form chains (`r.x = ${r.x} [...]` × N) to overflow the stack
    // at resolve time. Cross-impl with rs.hocon v1.5.1 path-aware deep_merge.
    const childPrefix = [...pathPrefix, k]
    const fullKey = stringSegmentsToKey(childPrefix)
    const dstVal = dst.fields.get(k)
    if (dstVal !== undefined && isResObj(dstVal) && isResObj(srcVal)) {
      // #120 cross-impl: save dst's pre-merge value as the prior at the
      // OUTER level even when both sides are objects and we recurse —
      // otherwise a `${k}` in the merged result (e.g. `o = { history =
      // ${o}, v = 2 }` included into a parent `o = { v = 1 }`) has no
      // lookback target.
      const priorExisting = dst.priorValues.get(k)
      const prior = foldOrSkipPrior(dstVal, fullKey, priorExisting)
      if (prior !== undefined) dst.priorValues.set(k, prior)
      deepMergeResObjInto(dstVal, srcVal, childPrefix)
    } else {
      // Non-object collision: distinguish how src's value for `k` composes with
      // dst's pre-merge value (go.hocon#134, S13b.2 `+=` accumulation across
      // includes). Three cases:
      //   (1) src reset `k` (explicit non-self-ref `k = [...]`) → src replaces
      //       dst; drop dst's stale prior, let src's prior carry over.
      //   (2a) src is a within-file `+=` chain (has its own prior for `k`) →
      //        splice dst's value into the chain's knownAbsent bottom so the
      //        included chain accumulates onto dst across the include boundary.
      //   (2b) src is a bare `+=` (no in-file prior) → dst's value becomes the
      //        prior that src's field-level `${?k}` chains off.
      // Cases 2a/2b keep the same fold-or-skip / self-ref-free-prior discipline
      // (#118/#120 chain-class invariant) as the both-objects branch above.
      if (dstVal !== undefined) {
        if (src.resetKeys.has(k)) {
          dst.priorValues.delete(k)
        } else {
          const dstFolded = foldOrSkipPrior(dstVal, fullKey, dst.priorValues.get(k))
          if (dstFolded !== undefined) {
            const srcPrior = src.priorValues.get(k)
            if (srcPrior !== undefined) {
              dst.priorValues.set(k, foldKnownAbsentSelfRef(srcPrior, fullKey, dstFolded))
            } else {
              dst.priorValues.set(k, dstFolded)
            }
          }
          // dstFolded === undefined only for a required self-ref with no prior,
          // unreachable through `+=`; leave src's prior to carry over.
        }
      }
      dst.fields.set(k, srcVal)
    }
  }
  // Carry over priorValues from src that dst doesn't already have (and, for a
  // reset key whose dst prior was dropped above, install src's own prior).
  for (const [k, srcPrior] of src.priorValues) {
    if (!dst.priorValues.has(k)) {
      dst.priorValues.set(k, srcPrior)
    }
  }
  // go.hocon#134: propagate reset origin so a future merge that treats this
  // object as an included source composes correctly (union: if either side
  // reset `k`, the merged value traces back to a reset).
  for (const k of src.resetKeys) dst.resetKeys.add(k)
}

export function hoconValueToResObj(hv: HoconValue): ResObj {
  const obj = makeResObj()
  if (hv.kind !== 'object') return obj
  for (const [key, val] of hv.fields) {
    if (val.kind === 'object') {
      obj.fields.set(key, hoconValueToResObj(val))
    } else {
      obj.fields.set(key, val)
    }
  }
  return obj
}

export function isFileNotFoundError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'MODULE_NOT_FOUND') return true
  // Fallback for custom readFile implementations that don't set .code
  const msg = e.message.toLowerCase()
  return msg.includes('not found') || msg.includes('no such file') || msg.includes('enoent')
}
