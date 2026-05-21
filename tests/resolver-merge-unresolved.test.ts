import { describe, expect, it } from 'vitest'
import {
  getPrior,
  isResObj,
  makeResObj,
  mergeUnresolved,
  setPrior,
  type ResObj,
  type ResolverValue,
} from '../src/internal/resolver/types.js'
import type { HoconValue } from '../src/value.js'

function scalar(raw: string, valueType: 'string' | 'number' = 'string'): HoconValue {
  return { kind: 'scalar', raw, valueType }
}

function obj(entries: Array<[string, ResolverValue]>): ResObj {
  const o = makeResObj()
  for (const [k, v] of entries) o.fields.set(k, v)
  return o
}

function asScalar(v: ResolverValue | undefined): { kind: 'scalar'; raw: string } {
  if (v === undefined || (v as HoconValue).kind !== 'scalar') {
    throw new Error(`expected scalar, got ${JSON.stringify(v)}`)
  }
  return v as { kind: 'scalar'; raw: string }
}

describe('setPrior / getPrior', () => {
  it('records prior value distinct from current', () => {
    const o = makeResObj()
    o.fields.set('a', scalar('current'))
    setPrior(o, 'a', scalar('old'))
    expect(asScalar(getPrior(o, 'a')).raw).toBe('old')
    expect(asScalar(o.fields.get('a')).raw).toBe('current')
  })
})

describe('mergeUnresolved', () => {
  it('non-object receiver wins; fallback captured as prior', () => {
    // receiver: { a = "current" }
    // fallback: { a = "old" }
    // merged:   receiver wins; "old" stored as prior for self-ref lookback.
    const receiver = obj([['a', scalar('current')]])
    const fallback = obj([['a', scalar('old')]])
    const merged = mergeUnresolved(receiver, fallback)
    expect(asScalar(merged.fields.get('a')).raw).toBe('current')
    expect(asScalar(getPrior(merged, 'a')).raw).toBe('old')
  })

  it('both-object collision deep-merges', () => {
    const receiver = obj([['a', obj([['x', scalar('1', 'number')]])]])
    const fallback = obj([['a', obj([['y', scalar('2', 'number')]])]])
    const merged = mergeUnresolved(receiver, fallback)
    const a = merged.fields.get('a')
    expect(a !== undefined && isResObj(a)).toBe(true)
    if (a && isResObj(a)) {
      expect(asScalar(a.fields.get('x')).raw).toBe('1')
      expect(asScalar(a.fields.get('y')).raw).toBe('2')
    }
  })

  it('non-object receiver blocks fallback object', () => {
    // receiver: { a = 42 }       — non-object
    // fallback: { a = { y = 2 } } — object; blocked by receiver
    // merged:   { a = 42 }, fallback object stored as prior.
    const receiver = obj([['a', scalar('42', 'number')]])
    const fallback = obj([['a', obj([['y', scalar('2', 'number')]])]])
    const merged = mergeUnresolved(receiver, fallback)
    const v = merged.fields.get('a')
    expect(v !== undefined && isResObj(v)).toBe(false)
    expect(asScalar(v).raw).toBe('42')
  })

  it('composition barrier: receiver with non-object prior discards fallback object', () => {
    // This is the dr10 scenario, expressed via the binary primitive:
    //   r0:  { a = { x = 1 } }       object
    //   fb1: { a = "scalar" }         non-object — barrier
    //   fb2: { a = { y = 2 } }        object — blocked
    // After r0.withFallback(fb1): receiver.a is r0's object {x:1}, but the
    // mergeUnresolved captures fb1.a "scalar" as a prior on the result.
    // After (result).withFallback(fb2): inside mergeUnresolved we see receiver
    // has a non-object prior at "a" → discard fb2.a object (no recurse).
    const r0Then1 = obj([['a', obj([['x', scalar('1', 'number')]])]])
    setPrior(r0Then1, 'a', scalar('scalar')) // simulating the barrier from a prior merge
    const fb2 = obj([['a', obj([['y', scalar('2', 'number')]])]])
    const merged = mergeUnresolved(r0Then1, fb2)
    const a = merged.fields.get('a')
    expect(a !== undefined && isResObj(a)).toBe(true)
    if (a && isResObj(a)) {
      expect(a.fields.has('x')).toBe(true)
      expect(a.fields.has('y')).toBe(false) // fb2.y discarded by barrier
    }
  })

  it('both-object collision WITHOUT non-object prior deep-merges normally', () => {
    // Sanity: receiver.priorValues['a'] is unset → no barrier → deep-merge.
    const receiver = obj([['a', obj([['x', scalar('1', 'number')]])]])
    const fallback = obj([['a', obj([['y', scalar('2', 'number')]])]])
    const merged = mergeUnresolved(receiver, fallback)
    const a = merged.fields.get('a')
    if (a && isResObj(a)) {
      expect(a.fields.has('x')).toBe(true)
      expect(a.fields.has('y')).toBe(true)
    } else {
      throw new Error('expected merged.a to be ResObj')
    }
  })
})
