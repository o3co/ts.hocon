import type { HoconValue } from '../../value.js'
import {
  type ResObj,
  type ResolverValue,
  isResObj,
  makeResObj,
} from './types.js'

/**
 * Parse a substitution path that may contain quoted segments.
 * E.g. `"a.b.c"` → ["a.b.c"], `a.b.c` → ["a","b","c"],
 * `"".""."""` → ["","",""]
 */
export function parseSubstPath(raw: string): string[] {
  const segments: string[] = []
  let i = 0
  while (i < raw.length) {
    // Skip whitespace
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++
    if (i >= raw.length) break

    if (raw[i] === '"') {
      // Quoted segment
      i++ // skip opening quote
      let seg = ''
      while (i < raw.length && raw[i] !== '"') {
        seg += raw[i]
        i++
      }
      if (i < raw.length) i++ // skip closing quote
      segments.push(seg)
      // Skip whitespace and dot separator
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++
      if (i < raw.length && raw[i] === '.') i++
    } else if (raw[i] === '.') {
      // Dot at start or after dot means empty-string segment
      segments.push('')
      i++
    } else {
      // Unquoted segment - read until dot or end
      let seg = ''
      while (i < raw.length && raw[i] !== '.') {
        seg += raw[i]
        i++
      }
      segments.push(seg.trim())
      if (i < raw.length && raw[i] === '.') i++
    }
  }
  return segments
}

export function segmentsToKey(segments: string[]): string {
  return segments
    .map(s => (s === '' || s.includes('.') || s.includes('"')) ? `"${s}"` : s)
    .join('.')
}

export function lookupPath(root: ResObj, segments: string[]): ResolverValue | undefined {
  const [head, ...tail] = segments
  if (head === undefined || head === '') {
    // For empty-string keys like "", try direct lookup
    if (segments.length > 0) {
      const val = root.fields.get('')
      if (val === undefined) return undefined
      if (tail.length === 0) return val
      if (isResObj(val)) return lookupPath(val, tail)
      return undefined
    }
    return undefined
  }
  const val = root.fields.get(head)
  if (val === undefined) return undefined
  if (tail.length === 0) return val
  if (isResObj(val)) return lookupPath(val, tail)
  return undefined
}

/** Walk from root to find a ResObj at the given path (not the value, but the container). */
export function lookupResObj(root: ResObj, segments: string[]): ResObj | undefined {
  let cur: ResObj = root
  for (const seg of segments) {
    const val = cur.fields.get(seg)
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

export function deepMergeResObjInto(dst: ResObj, src: ResObj): void {
  for (const [k, srcVal] of src.fields) {
    const dstVal = dst.fields.get(k)
    if (dstVal !== undefined && isResObj(dstVal) && isResObj(srcVal)) {
      deepMergeResObjInto(dstVal, srcVal)
    } else {
      if (dstVal !== undefined) dst.priorValues.set(k, dstVal)
      dst.fields.set(k, srcVal)
    }
  }
  // Carry over priorValues from src that dst doesn't already have
  for (const [k, srcPrior] of src.priorValues) {
    if (!dst.priorValues.has(k)) {
      dst.priorValues.set(k, srcPrior)
    }
  }
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
