// Copyright 2026 1o1 Co. Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/*
 * `+=` array-append accumulation across include boundaries. Cross-impl
 * regression for go.hocon#134 (S13b.2).
 *
 * `a += b` ≡ `a = ${?a} [b]` (HOCON.md L732). Includes are inlined in document
 * order, so repeated `+=` across included files must accumulate:
 *
 *   include "first.conf"   # items += "first"
 *   include "second.conf"  # items += "second"
 *   items += "main"        # → ["first", "second", "main"]
 *
 * Pre-fix ts.hocon represented `+=` as an eager-snapshot AppendPlaceholder whose
 * `existing` was captured in each included file's isolated scope, so the
 * cross-include merge overwrote it. The fix desugars `+=` to the `${?key} [b]`
 * self-ref concat and splices the destination's pre-merge value into the
 * included chain's knownAbsent bottom (`foldKnownAbsentSelfRef`) in
 * `deepMergeResObjInto`. Reset semantics (an explicit `k = [...]` before a `k +=`)
 * are tracked via `ResObj.resetKeys` and correctly break the chain.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parse, parseFile } from '../src/parse.js'

function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
}

describe('#134 — += accumulation across includes (S13b.2)', () => {
  it('accumulates across includes', () => {
    withTempDir('issue134-acc-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "first"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items += "second"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"\nitems += "main"`)
      expect(parseFile(parent).getList('items')).toEqual(['first', 'second', 'main'])
    })
  })

  it('explicit reset in an include breaks the chain', () => {
    withTempDir('issue134-reset-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "first"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items = []\nitems += "second"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"\nitems += "main"`)
      expect(parseFile(parent).getList('items')).toEqual(['second', 'main'])
    })
  })

  it('within-file chain (no include) unchanged', () => {
    expect(parse(`items += "a"\nitems += "b"\nitems += "c"`).getList('items')).toEqual(['a', 'b', 'c'])
  })

  it('prior array seed then appends', () => {
    expect(parse(`items = ["seed"]\nitems += "a"\nitems += "b"`).getList('items')).toEqual(['seed', 'a', 'b'])
  })

  it('+= on a non-array prior errors', () => {
    expect(() => parse(`a = 42\na += 1`)).toThrow()
  })

  it('nested-key += accumulates across includes', () => {
    withTempDir('issue134-nested-', (dir) => {
      fs.writeFileSync(path.join(dir, 'a.conf'), `srv { items += "a" }`)
      fs.writeFileSync(path.join(dir, 'b.conf'), `srv { items += "b" }`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "a.conf"\ninclude "b.conf"\nsrv.items += "main"`)
      expect(parseFile(parent).getList('srv.items')).toEqual(['a', 'b', 'main'])
    })
  })

  it('prefix-mounted include relativizes the self-ref', () => {
    withTempDir('issue134-mount-', (dir) => {
      fs.writeFileSync(path.join(dir, 'inner.conf'), `items += "i1"\nitems += "i2"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `mount { include "inner.conf" }\nmount.items += "outer"`)
      expect(parseFile(parent).getList('mount.items')).toEqual(['i1', 'i2', 'outer'])
    })
  })

  it('parent reset after an include breaks the chain', () => {
    withTempDir('issue134-preset-', (dir) => {
      fs.writeFileSync(path.join(dir, 'c.conf'), `items += "c"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "c.conf"\nitems = ["reset"]\nitems += "after"`)
      expect(parseFile(parent).getList('items')).toEqual(['reset', 'after'])
    })
  })

  // The cases below exercise the path the rejected reset discriminator got
  // wrong: a within-file `+=` chain inside a LATER include merged onto a
  // non-empty destination (the within-file chain also records a src prior).

  it('within-file chain inside a later include accumulates', () => {
    withTempDir('issue134-wf-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "first"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items += "s1"\nitems += "s2"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"\nitems += "main"`)
      expect(parseFile(parent).getList('items')).toEqual(['first', 's1', 's2', 'main'])
    })
  })

  it('two multi-write includes accumulate', () => {
    withTempDir('issue134-two-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "a1"\nitems += "a2"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items += "b1"\nitems += "b2"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"\nitems += "main"`)
      expect(parseFile(parent).getList('items')).toEqual(['a1', 'a2', 'b1', 'b2', 'main'])
    })
  })

  it('reset in a multi-write later include breaks the chain', () => {
    withTempDir('issue134-rmw-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "first"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items = ["r1"]\nitems += "r2"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"\nitems += "main"`)
      expect(parseFile(parent).getList('items')).toEqual(['r1', 'r2', 'main'])
    })
  })

  it('three-level within-file chain inside an include', () => {
    withTempDir('issue134-3lvl-', (dir) => {
      fs.writeFileSync(path.join(dir, 'first.conf'), `items += "first"`)
      fs.writeFileSync(path.join(dir, 'second.conf'), `items += "s1"\nitems += "s2"\nitems += "s3"`)
      const parent = path.join(dir, 'parent.conf')
      fs.writeFileSync(parent, `include "first.conf"\ninclude "second.conf"`)
      expect(parseFile(parent).getList('items')).toEqual(['first', 's1', 's2', 's3'])
    })
  })

  it('+= [array] nests the RHS as a single element (not flattened)', () => {
    // `a += [3]` ≡ `a = ${?a} [[3]]`, so the RHS array is appended as ONE
    // element: a=[1,2]; a+=[3] → [1, 2, [3]]. Pins the spec-correct nesting
    // (cross-impl with go.hocon / rs.hocon).
    const c = parse(`a = [1, 2]\na += [3]`)
    expect(c.getList('a')).toEqual([1, 2, [3]])
  })
})
