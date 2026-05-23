// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/*
 * Regression tests for ts.hocon#131 (cross-impl with go.hocon#118 — chained
 * self-referential append) and ts.hocon-equivalent of go.hocon#120
 * (value-interior self-references inside HoconValue arrays / objects). Both
 * bug classes are fixed by the same change set (foldSelfRef module +
 * foldOrSkipPrior at structure-builder save sites + path-aware
 * deepMergeResObjInto), so a single regression file covers them.
 *
 * Each scenario ran as a stack-overflow on ts.hocon v1.5.0 before the fix.
 * Cross-impl with rs.hocon v1.5.1.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parse, parseFile } from '../src/parse.js'

describe('#131 + #120-equivalent: chained / value-interior self-referential substitution', () => {
  // ---- #131 — chained self-referential append (cross-impl with go.hocon#118) ----

  it('flat array chain (length 3)', () => {
    const c = parse(`
branches = ["main"]
branches = \${branches} ["dev"]
branches = \${branches} ["release"]
`)
    expect(c.getList('branches')).toEqual(['main', 'dev', 'release'])
  })

  it('flat array chain (length 4)', () => {
    const c = parse(`
a = ["a"]
a = \${a} ["b"]
a = \${a} ["c"]
a = \${a} ["d"]
`)
    expect(c.getList('a')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('chained include — 3-file fixture from go.hocon#118 report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue131-'))
    try {
      fs.writeFileSync(path.join(dir, 'common.conf'), `branches = ["main"]`)
      fs.writeFileSync(
        path.join(dir, 'child.conf'),
        `branches = \${branches} ["dev"]`,
      )
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(
        parent,
        `include "common.conf"
include "child.conf"
branches = \${branches} ["release"]`,
      )
      const c = parseFile(parent)
      expect(c.getList('branches')).toEqual(['main', 'dev', 'release'])
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('object-concat chain (length 3)', () => {
    const c = parse(`
obj = { a = 1 }
obj = \${obj} { b = 2 }
obj = \${obj} { c = 3 }
`)
    expect(c.getNumber('obj.a')).toBe(1)
    expect(c.getNumber('obj.b')).toBe(2)
    expect(c.getNumber('obj.c')).toBe(3)
  })

  it('multi-segment chain (r.x = ${r.x} [...] × 3)', () => {
    const c = parse(`
r.x = ["a"]
r.x = \${r.x} ["b"]
r.x = \${r.x} ["c"]
`)
    expect(c.getList('r.x')).toEqual(['a', 'b', 'c'])
  })

  it('multi-segment chain (r.x = ${r.x} [...] × 4)', () => {
    // Codex review on rs.hocon#119: induction must hold beyond length 3.
    // Length 4 stresses fold + path-aware deepMerge at the synthetic-object
    // path (each `r.x = ...` is parsed as nested key, wraps to r=Obj{x=...}
    // and deepMerges into the previous r-Obj).
    const c = parse(`
r.x = ["a"]
r.x = \${r.x} ["b"]
r.x = \${r.x} ["c"]
r.x = \${r.x} ["d"]
`)
    expect(c.getList('r.x')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('nested-object scoped chain (length 3)', () => {
    const c = parse(`
r {
  x = ["a"]
  x = \${r.x} ["b"]
  x = \${r.x} ["c"]
}
`)
    expect(c.getList('r.x')).toEqual(['a', 'b', 'c'])
  })

  it('nested-object scoped chain (length 4)', () => {
    const c = parse(`
r {
  x = ["a"]
  x = \${r.x} ["b"]
  x = \${r.x} ["c"]
  x = \${r.x} ["d"]
}
`)
    expect(c.getList('r.x')).toEqual(['a', 'b', 'c', 'd'])
  })

  // ---- #120-equivalent — value-interior self-reference ----

  it('array element chain (a = [${a}, "x"] × N)', () => {
    // `a = [${a}, "x"]` repeated — substitution as an array element.
    // Expected nesting:
    //   step 1: a = ["init"]
    //   step 2: a = [["init"], "x"]
    //   step 3: a = [[["init"], "x"], "y"]
    const c = parse(`
a = ["init"]
a = [\${a}, "x"]
a = [\${a}, "y"]
`)
    const v = c.getList('a') as unknown as [unknown, unknown]
    expect(v).toHaveLength(2)
    expect(v[1]).toBe('y')
    const inner = v[0] as [unknown, unknown]
    expect(inner).toHaveLength(2)
    expect(inner[1]).toBe('x')
    expect(inner[0]).toEqual(['init'])
  })

  it('object field-value self-ref (chain length 2)', () => {
    // `o = { history = ${o}, v = 2 }` over `o = { v = 1 }`.
    const c = parse(`
o = { v = 1 }
o = { history = \${o}, v = 2 }
`)
    expect(c.getNumber('o.v')).toBe(2)
    expect(c.getNumber('o.history.v')).toBe(1)
  })

  it('object field-value self-ref (chain length 3)', () => {
    const c = parse(`
o = { v = 1 }
o = { history = \${o}, v = 2 }
o = { history = \${o}, v = 3 }
`)
    expect(c.getNumber('o.v')).toBe(3)
    expect(c.getNumber('o.history.v')).toBe(2)
    expect(c.getNumber('o.history.history.v')).toBe(1)
  })

  it('object field-value self-ref with retained key (chain length 2)', () => {
    const c = parse(`
o = { a = 1, v = 1 }
o = { history = \${o}, v = 2 }
`)
    expect(c.getNumber('o.a')).toBe(1)
    expect(c.getNumber('o.v')).toBe(2)
    expect(c.getNumber('o.history.a')).toBe(1)
    expect(c.getNumber('o.history.v')).toBe(1)
  })

  it('nested path object merge (r.s = ${r.s}, ...)', () => {
    const c = parse(`
r.s = { v = 1 }
r.s = { history = \${r.s}, v = 2 }
`)
    expect(c.getNumber('r.s.v')).toBe(2)
    expect(c.getNumber('r.s.history.v')).toBe(1)
  })

  it('include-merge object form', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue131-inc-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'inc.conf'),
        `o = { history = \${o}, v = 2 }`,
      )
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(
        parent,
        `o = { v = 1 }
include "inc.conf"`,
      )
      const c = parseFile(parent)
      expect(c.getNumber('o.v')).toBe(2)
      expect(c.getNumber('o.history.v')).toBe(1)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('nested include-merge under an object', () => {
    // Parent has `r { s = { v = 1 } }`, then a second `r { include "inc.conf" }`
    // where inc has `s = { history = ${s}, v = 2 }`. After include
    // relativization the substitution becomes ${r.s}.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue131-nested-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'inc.conf'),
        `s = { history = \${s}, v = 2 }`,
      )
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(
        parent,
        `r { s = { v = 1 } }
r { include "inc.conf" }`,
      )
      const c = parseFile(parent)
      expect(c.getNumber('r.s.v')).toBe(2)
      expect(c.getNumber('r.s.history.v')).toBe(1)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('mixed ${a} substitution and += append chain', () => {
    // Surfaced by Claude review on PR #131 — the Append walker / AppendPlaceholder
    // wrapping shape had been omitted from the original fold scope (containsSelfRef
    // / foldSelfRef / containsSubstByPath / foldNestedSelfRefs walked Subst /
    // Concat / array / object / ResObj only). Empirical pre-fix output for this
    // exact input was `["init","x","y","y","z","y","z"]` (duplicated "y" because
    // the Append's `existing` retained an unfolded ${a} that resolved against
    // the post-overwrite priorValues at step-4 resolve time).
    const c = parse(`
a = ["init"]
a += "x"
a = \${a} ["y"]
a += "z"
`)
    expect(c.getList('a')).toEqual(['init', 'x', 'y', 'z'])
  })

  it('nested include relativization with substitution in priorValues', () => {
    // Codex review on PR #131 — Subst/Concat are mutated in place by
    // relativizeResObj, which walks BOTH `fields` AND `priorValues`. A
    // shared Subst reference (e.g. cloneResolverValue passing through the
    // same Subst by reference) would get its prefix applied twice. Forces
    // cloneResolverValue to structurally copy Subst.segments and Concat.nodes
    // when used for prior-save.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue131-relativize-'))
    try {
      fs.writeFileSync(
        path.join(dir, 'inner.conf'),
        `base = [1]
items = \${base}
items += 2`,
      )
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `outer { include "inner.conf" }`)
      const c = parseFile(parent)
      expect(c.getList('outer.base')).toEqual([1])
      expect(c.getList('outer.items')).toEqual([1, 2])
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('long-form ${a} followed by repeated +=', () => {
    // Codex review on PR #131 — stresses the Append walker scope. The prior
    // saved at step-3 is the step-2 Concat[${a}, [1]] (folded against
    // step-1's [0]). At step-3 `a += 2`, the new Append's existing is the
    // step-2 Concat — but our structure-builder change folds that against
    // the prior, so the Append.existing is self-ref-free. Then at step-4
    // `a += 3`, the prior is folded again. Without Append branches in
    // containsSelfRef / foldSelfRef / containsSubstByPath, the step-4 save
    // would treat the Append-typed dst as no-self-ref (incorrect — its
    // .existing contains nothing self-ref at this point, but if it did,
    // the walker would miss it).
    const c = parse(`
a = [0]
a = \${a} [1]
a += 2
a += 3
`)
    expect(c.getList('a')).toEqual([0, 1, 2, 3])
  })

  it('mixed concat/array chain (concat → array-element)', () => {
    // step 2 uses concat-substitution (#131 path); step 3 uses array-element
    // substitution (#120-equivalent path).
    const c = parse(`
a = ["init"]
a = \${a} ["x"]
a = [\${a}, "y"]
`)
    const v = c.getList('a') as unknown as [unknown, unknown]
    expect(v).toHaveLength(2)
    expect(v[1]).toBe('y')
    expect(v[0]).toEqual(['init', 'x'])
  })
})
