// S13a.12 (HOCON.md L791) — a substitution whose target lies INSIDE the field
// being defined (`foo : ${foo.a}`) resolves against the field's "below" value
// (the merge of the stack beneath the substitution), never the final tree.
//
// Found 2026-08-18 by probing all four sibling implementations: every one
// resolved the spec example against the final tree ("above"), yielding {a:2}
// instead of {a:2, c:1}. The recorded ts ✅ was a misclassification (stale
// test pointer); rs's cited lightbend_test06 cannot discriminate (its later
// object overrides every key the substitution contributes). Root cause was a
// missing prefix-direction case in self-reference detection: isOwner required
// the resolving-field path to be at least as LONG as the target path, which
// excludes `foo` ⊏ `foo.a`.
//
// The fix has two halves, mirrored across the siblings:
//  - fold-self-ref: prefix self-refs fold at prior-save time (navigate the
//    remainder into the old prior; standalone occurrences form a merge LAYER
//    that keeps the below layer's other keys).
//  - resolveSubst: a standing prefix self-ref resolves via the field's saved
//    prior + remainder navigation, with undefined semantics on a miss.

import { describe, expect, it } from 'vitest'

import { parse, ResolveError } from '../src/index'

// '$' via charcode to avoid IDE template-string lint on ${...} literals.
const D = String.fromCharCode(36)

function foo(src: string): unknown {
  return (parse(src).toObject() as Record<string, unknown>)['foo']
}

describe('S13a.12 — prefix self-reference resolves to "below"', () => {
  it('spec L791 example: foo:{a:{c:1}}; foo:${foo.a}; foo:{a:2} → {a:2, c:1}', () => {
    expect(
      foo('foo : { a : { c : 1 } }\nfoo : ' + D + '{foo.a}\nfoo : { a : 2 }'),
    ).toEqual({ a: 2, c: 1 })
  })

  it('two layers, substitution last: merges the navigated object over the below', () => {
    expect(foo('foo : { a : { c : 1 } }\nfoo : ' + D + '{foo.a}')).toEqual({
      a: { c: 1 },
      c: 1,
    })
  })

  it('below layer keys not touched by the sandwich survive', () => {
    expect(
      foo(
        'foo : { a : { c : 1 }, keep : 9 }\nfoo : ' + D + '{foo.a}\nfoo : { a : 2 }',
      ),
    ).toEqual({ a: 2, keep: 9, c: 1 })
  })

  it('navigating to a scalar resets the stack (later object wins alone)', () => {
    expect(foo('foo : { a : 5 }\nfoo : ' + D + '{foo.a}\nfoo : { b : 2 }')).toEqual({
      b: 2,
    })
  })

  it('optional prefix self-ref with nothing below vanishes transparently', () => {
    expect(
      foo('foo : { a : 1 }\nfoo : ' + D + '{?foo.nope}\nfoo : { b : 2 }'),
    ).toEqual({ a: 1, b: 2 })
  })

  it('required prefix self-ref with nothing below is an undefined-substitution error', () => {
    expect(() =>
      foo('foo : { a : 1 }\nfoo : ' + D + '{foo.nope}\nfoo : { b : 2 }'),
    ).toThrow(ResolveError)
    expect(() =>
      foo('foo : { a : 1 }\nfoo : ' + D + '{foo.nope}\nfoo : { b : 2 }'),
    ).toThrow(/could not resolve substitution/)
  })

  it('works on nested paths (prior lives on the parent scope)', () => {
    const v = parse(
      'srv : { foo : { a : { c : 1 } } }\nsrv : { foo : ' +
        D +
        '{srv.foo.a} }\nsrv : { foo : { a : 2 } }',
    ).toObject() as Record<string, Record<string, unknown>>
    expect(v['srv']!['foo']).toEqual({ a: 2, c: 1 })
  })

  it('regression: non-self-ref delayed merge sandwich is unchanged', () => {
    expect(
      foo(
        'd = { x : { c : 1 } }\nfoo : { a : { c : 9 } }\nfoo : ' +
          D +
          '{d.x}\nfoo : { a : 2 }',
      ),
    ).toEqual({ c: 1, a: 2 })
  })

  it("regression: a sibling reference in a deeper field's prior still sees the final tree", () => {
    // `a`'s prior holds ${bar.nested.x} — NOT a self-ref of a — and must
    // resolve via the final tree even though [bar, nested] prefixes the
    // target. Guarded by the rfp push/pop span covering prior resolution.
    const v = parse(
      'bar { nested { x = { q: 10 }\na = ' + D + '{bar.nested.x}\na = { c: 3 } } }',
    ).toObject() as Record<string, Record<string, Record<string, unknown>>>
    expect(v['bar']!['nested']!['a']).toEqual({ q: 10, c: 3 })
  })
})
