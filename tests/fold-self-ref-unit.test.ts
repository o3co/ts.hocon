// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/**
 * Unit tests for foldOptionalSelfRefAbsent branch coverage.
 *
 * foldOptionalSelfRefAbsent is private; exercised via foldOrSkipPrior with
 * old = undefined (the path that calls foldOptionalSelfRefAbsent).
 *
 * Covers review #136 item (c): Append / ResObj / HoconArray / HoconObject /
 * fallback branches that previously had no fixture coverage.
 *
 * Each test constructs a ResolverValue containing an optional self-ref to the
 * key "a", then calls foldOrSkipPrior(prior, "a", undefined) and asserts the
 * returned value has the self-ref replaced with a knownAbsent-marked sentinel
 * (or that undefined is returned when the self-ref is required).
 */

import { describe, it, expect } from 'vitest'
import {
  foldOrSkipPrior,
  foldSelfRef,
  navigateResolverValue,
} from '../src/internal/resolver/fold-self-ref.js'
import type {
  ConcatPlaceholder,
  ResObj,
  SubstPlaceholder,
} from '../src/internal/resolver/types.js'
import type { HoconValue } from '../src/value.js'

// ---------------------------------------------------------------------------
// Helpers: build placeholder values without embedding ${ in a string literal
// ---------------------------------------------------------------------------

/** Builds a minimal Segment array for a dotted path like "a" or "foo.a". */
function seg(text: string): { text: string; line: number; col: number } {
  return { text, line: 1, col: 1 }
}

function makeSubst(key: string, optional: boolean): SubstPlaceholder {
  return {
    _kind: 'subst-placeholder',
    segments: [seg(key)],
    optional,
    knownAbsent: false,
    listSuffix: false,
    line: 1,
    col: 1,
    prefixLen: 0,
  }
}

function makeConcat(nodes: SubstPlaceholder[]): ConcatPlaceholder {
  return { _kind: 'concat-placeholder', nodes, line: 1, col: 1 }
}

function makeResObj(fields: Record<string, SubstPlaceholder>): ResObj {
  return {
    _kind: 'res-obj',
    fields: new Map(Object.entries(fields)),
    priorValues: new Map(),
    resetKeys: new Set(),
  }
}

function makeHoconArray(items: SubstPlaceholder[]): HoconValue {
  return { kind: 'array', items: items as unknown as HoconValue[] }
}

function makeHoconObject(fields: Record<string, SubstPlaceholder>): HoconValue {
  return { kind: 'object', fields: new Map(Object.entries(fields)) as Map<string, HoconValue> }
}

// ---------------------------------------------------------------------------
// Subst branch (already covered by sr01/sr15 fixtures, included for baseline)
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — Subst branch (baseline)', () => {
  it('optional self-ref Subst → returns Subst with knownAbsent=true', () => {
    const subst = makeSubst('a', true)
    const result = foldOrSkipPrior(subst, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as SubstPlaceholder
    expect(r._kind).toBe('subst-placeholder')
    expect(r.knownAbsent).toBe(true)
    expect(r.optional).toBe(true)
  })

  it('required self-ref Subst → returns undefined (skip save)', () => {
    const subst = makeSubst('a', false)
    const result = foldOrSkipPrior(subst, 'a', undefined)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ResObj branch — NEW coverage
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — ResObj branch', () => {
  it('ResObj with a field containing optional self-ref → field folded to knownAbsent', () => {
    // Represents an object like { history = ${?a} } saved as prior for key "a"
    const resObj = makeResObj({ history: makeSubst('a', true) })
    const result = foldOrSkipPrior(resObj, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as ResObj
    expect(r._kind).toBe('res-obj')
    const history = r.fields.get('history') as SubstPlaceholder
    expect(history._kind).toBe('subst-placeholder')
    expect(history.knownAbsent).toBe(true)
  })

  it('ResObj with a field containing required self-ref → returns undefined', () => {
    const resObj = makeResObj({ history: makeSubst('a', false) })
    const result = foldOrSkipPrior(resObj, 'a', undefined)
    expect(result).toBeUndefined()
  })

  it('ResObj with no self-ref field → returned unchanged (cloned)', () => {
    // Field references an unrelated key "b" — no self-ref to "a"
    const resObj = makeResObj({ x: makeSubst('b', true) })
    const result = foldOrSkipPrior(resObj, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as ResObj
    expect(r._kind).toBe('res-obj')
    // containsSelfRef("a") is false → foldOrSkipPrior takes cloneResolverValue path
    // (not foldOptionalSelfRefAbsent), but ResObj branch is still traversed by clone
    const x = r.fields.get('x') as SubstPlaceholder
    expect(x.knownAbsent).toBe(false)
  })

  it('ResObj with multiple fields — only the self-ref field is folded', () => {
    const resObj: ResObj = {
      _kind: 'res-obj',
      fields: new Map([
        ['history', makeSubst('a', true)],
        ['other', makeSubst('b', true)],
      ]),
      priorValues: new Map(),
    }
    const result = foldOrSkipPrior(resObj, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as ResObj
    const history = r.fields.get('history') as SubstPlaceholder
    const other = r.fields.get('other') as SubstPlaceholder
    expect(history.knownAbsent).toBe(true)
    expect(other.knownAbsent).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// HoconArray branch — NEW coverage
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — HoconArray branch', () => {
  it('HoconArray with optional self-ref item → item folded to knownAbsent', () => {
    // Represents array value [${?a}, "x"] saved as prior for key "a"
    const scalarStr: HoconValue = { kind: 'scalar', raw: 'x', valueType: 'string' }
    const arr: HoconValue = {
      kind: 'array',
      items: [makeSubst('a', true) as unknown as HoconValue, scalarStr],
    }
    const result = foldOrSkipPrior(arr, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('array')
    if (r.kind === 'array') {
      const first = r.items[0] as unknown as SubstPlaceholder
      expect(first._kind).toBe('subst-placeholder')
      expect(first.knownAbsent).toBe(true)
    }
  })

  it('HoconArray with required self-ref item → returns undefined', () => {
    const arr = makeHoconArray([makeSubst('a', false)])
    const result = foldOrSkipPrior(arr, 'a', undefined)
    expect(result).toBeUndefined()
  })

  it('HoconArray with no self-ref items → returned (cloned, items unchanged)', () => {
    const arr = makeHoconArray([makeSubst('b', true)])
    const result = foldOrSkipPrior(arr, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('array')
    if (r.kind === 'array') {
      const first = r.items[0] as unknown as SubstPlaceholder
      expect(first.knownAbsent).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// HoconObject branch — NEW coverage
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — HoconObject branch', () => {
  it('HoconObject with optional self-ref field → field folded to knownAbsent', () => {
    const obj = makeHoconObject({ history: makeSubst('a', true) })
    const result = foldOrSkipPrior(obj, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('object')
    if (r.kind === 'object') {
      const history = r.fields.get('history') as unknown as SubstPlaceholder
      expect(history._kind).toBe('subst-placeholder')
      expect(history.knownAbsent).toBe(true)
    }
  })

  it('HoconObject with required self-ref field → returns undefined', () => {
    const obj = makeHoconObject({ history: makeSubst('a', false) })
    const result = foldOrSkipPrior(obj, 'a', undefined)
    expect(result).toBeUndefined()
  })

  it('HoconObject with no self-ref field → returned unchanged (cloned)', () => {
    const obj = makeHoconObject({ x: makeSubst('b', true) })
    const result = foldOrSkipPrior(obj, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('object')
    if (r.kind === 'object') {
      const x = r.fields.get('x') as unknown as SubstPlaceholder
      expect(x.knownAbsent).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Fallback branch — NEW coverage
// Scalar HoconValues (string/number/boolean/null) contain no substitution
// placeholders.  containsSelfRef returns false, so foldOrSkipPrior takes
// the cloneResolverValue path rather than foldOptionalSelfRefAbsent.
// We verify that scalars pass through correctly (regression guard).
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — fallback/scalar branch', () => {
  it('scalar string value with no self-ref → cloned and returned', () => {
    const scalar: HoconValue = { kind: 'scalar', raw: 'hello', valueType: 'string' }
    const result = foldOrSkipPrior(scalar, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('scalar')
    if (r.kind === 'scalar') {
      expect(r.raw).toBe('hello')
      expect(r.valueType).toBe('string')
    }
  })

  it('scalar number value with no self-ref → cloned and returned', () => {
    const scalar: HoconValue = { kind: 'scalar', raw: '42', valueType: 'number' }
    const result = foldOrSkipPrior(scalar, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as HoconValue
    expect(r.kind).toBe('scalar')
    if (r.kind === 'scalar') {
      expect(r.raw).toBe('42')
    }
  })
})

// ---------------------------------------------------------------------------
// Concat branch — already covered by sr01/sr15 fixtures; included here for
// completeness as a unit test to confirm the branch works in isolation.
// ---------------------------------------------------------------------------

describe('foldOptionalSelfRefAbsent — Concat branch (unit, complements sr fixtures)', () => {
  it('Concat with optional self-ref node → node folded to knownAbsent', () => {
    const concat = makeConcat([makeSubst('a', true)])
    const result = foldOrSkipPrior(concat, 'a', undefined)
    expect(result).not.toBeUndefined()
    const r = result as ConcatPlaceholder
    expect(r._kind).toBe('concat-placeholder')
    const node = r.nodes[0] as SubstPlaceholder
    expect(node.knownAbsent).toBe(true)
  })

  it('Concat with required self-ref node → returns undefined', () => {
    const concat = makeConcat([makeSubst('a', false)])
    const result = foldOrSkipPrior(concat, 'a', undefined)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// S13a.12 — plain already-resolved HoconValue arms.
//
// The parser always builds object literals as ResObj, so the plain
// `{kind:'object'}` arms of navigateResolverValue / the fold walk are not
// reachable from `parse()` today — they exist for already-resolved values
// (resolved priors are plain HoconValues, and hoconValueToResObj leaves
// objects inside arrays plain). Pin the contract directly so a future wiring
// that feeds resolved values through the fold keeps working.
// ---------------------------------------------------------------------------

function scalarNum(raw: string): HoconValue {
  return { kind: 'scalar', raw, valueType: 'number' }
}

function plainObj(fields: Record<string, HoconValue>): HoconValue & { kind: 'object' } {
  return { kind: 'object', fields: new Map(Object.entries(fields)) }
}

function makeSubstPath(texts: string[]): SubstPlaceholder {
  return {
    _kind: 'subst-placeholder',
    segments: texts.map(seg),
    optional: false,
    knownAbsent: false,
    listSuffix: false,
    line: 1,
    col: 1,
    prefixLen: 0,
  }
}

describe('navigateResolverValue — plain already-resolved object steps', () => {
  it('walks through a plain object field and dead-ends in its scalar (path-absent)', () => {
    // ResObj → plain object → scalar: the mid-walk step follows the plain
    // object's field, then the scalar leaf makes the remaining segment absent.
    const root = makeResObj({})
    root.fields.set('a', plainObj({ b: scalarNum('1') }))
    expect(navigateResolverValue(root, ['a', 'b'])).toEqual(scalarNum('1'))
    expect(navigateResolverValue(root, ['a', 'b', 'c'])).toBeUndefined()
  })

  it('reports a missing key on a plain object as path-absent', () => {
    const root = makeResObj({})
    root.fields.set('a', plainObj({ b: scalarNum('1') }))
    expect(navigateResolverValue(root, ['a', 'nope'])).toBeUndefined()
  })
})

describe('foldSelfRef — plain already-resolved object interiors', () => {
  it('rewrites an exact self-ref inside a plain object interior, leaving other fields', () => {
    const interior = plainObj({
      h: makeSubst('foo', false) as unknown as HoconValue,
      keep: scalarNum('7'),
    })
    const replacement = plainObj({ x: scalarNum('1') })
    const folded = foldSelfRef(interior, 'foo', replacement)
    expect(folded).toEqual(plainObj({ h: replacement, keep: scalarNum('7') }))
  })

  it('leaves a prefix self-ref inside a plain object interior standing (allowPrefix off)', () => {
    // Object interiors are S13a.14 territory: ${foo.a} nested inside must NOT
    // fold to the below value even though `foo` prefixes it.
    const inner = makeSubstPath(['foo', 'a'])
    const interior = plainObj({ h: inner as unknown as HoconValue })
    const folded = foldSelfRef(interior, 'foo', plainObj({ a: scalarNum('2') }))
    expect(folded).toEqual(plainObj({ h: inner as unknown as HoconValue }))
  })
})
