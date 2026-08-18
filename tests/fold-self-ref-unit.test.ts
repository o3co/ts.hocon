// Unit contract tests for fold-self-ref's plain-HoconValue handling (S13a.12).
//
// The parser always builds object literals as ResObj, so the plain
// `{kind:'object'}` arms of navigateResolverValue / foldSelfRefInner are not
// reachable from `parse()` today — they exist for already-resolved values
// (the documented contract: hoconValueToResObj leaves objects inside arrays
// plain, and resolved priors are plain HoconValues). Pin the contract
// directly so a future wiring that feeds resolved values through the fold
// keeps working.

import { describe, expect, it } from 'vitest'

import type { Segment } from '../src/internal/lexer/token'
import {
  foldSelfRef,
  navigateResolverValue,
} from '../src/internal/resolver/fold-self-ref'
import { makeResObj } from '../src/internal/resolver/types'
import type { ResolverValue, SubstPlaceholder } from '../src/internal/resolver/types'
import type { HoconValue } from '../src/value'

function seg(text: string): Segment {
  return { text, line: 1, col: 1 }
}

function subst(path: string[], optional = false): SubstPlaceholder {
  return {
    _kind: 'subst-placeholder',
    segments: path.map(seg),
    optional,
    knownAbsent: false,
    listSuffix: false,
    line: 1,
    col: 1,
    prefixLen: 0,
  }
}

function scalar(raw: string): HoconValue {
  return { kind: 'scalar', raw, valueType: 'number' }
}

function plainObj(fields: Record<string, HoconValue>): HoconValue & { kind: 'object' } {
  return { kind: 'object', fields: new Map(Object.entries(fields)) }
}

describe('navigateResolverValue — plain already-resolved object steps', () => {
  it('walks through a plain object field and dead-ends in its scalar (path-absent)', () => {
    // ResObj → plain object → scalar: the mid-walk step follows the plain
    // object's field, then the scalar leaf makes the remaining segment absent.
    const root = makeResObj()
    root.fields.set('a', plainObj({ b: scalar('1') }))
    expect(navigateResolverValue(root, ['a', 'b'])).toEqual(scalar('1'))
    expect(navigateResolverValue(root, ['a', 'b', 'c'])).toBeUndefined()
  })

  it('reports a missing key on a plain object as path-absent', () => {
    const root = makeResObj()
    root.fields.set('a', plainObj({ b: scalar('1') }))
    expect(navigateResolverValue(root, ['a', 'nope'])).toBeUndefined()
  })
})

describe('foldSelfRef — plain already-resolved object interiors', () => {
  it('rewrites an exact self-ref inside a plain object interior, leaving other fields', () => {
    // A plain object whose field holds a live substitution — the shape an
    // already-resolved value takes after partial resolution. The interior
    // walk runs with the prefix rule off, so only the exact self-ref folds.
    const interior = {
      kind: 'object',
      fields: new Map<string, HoconValue>([
        ['h', subst(['foo']) as unknown as HoconValue],
        ['keep', scalar('7')],
      ]),
    } satisfies HoconValue
    const replacement = plainObj({ x: scalar('1') })
    const folded = foldSelfRef(interior as ResolverValue, 'foo', replacement)
    expect(folded).toEqual(plainObj({ h: replacement, keep: scalar('7') }))
  })

  it('leaves a prefix self-ref inside a plain object interior standing (allowPrefix off)', () => {
    // Object interiors are S13a.14 territory: ${foo.a} nested inside must NOT
    // fold to the below value even though `foo` prefixes it.
    const inner = subst(['foo', 'a'])
    const interior = {
      kind: 'object',
      fields: new Map<string, HoconValue>([['h', inner as unknown as HoconValue]]),
    } satisfies HoconValue
    const folded = foldSelfRef(interior as ResolverValue, 'foo', plainObj({ a: scalar('2') }))
    expect(folded).toEqual({
      kind: 'object',
      fields: new Map<string, HoconValue>([['h', inner as unknown as HoconValue]]),
    })
  })
})
