// tests/spec-s23-4-properties-object-wins.test.ts
//
// S23.4 — Object wins over string in .properties key conflict (HOCON.md L1485)
// RED tests — must FAIL before the fix is applied to src/internal/properties/properties.ts.
//
// Spec: "the object must always win" when a key conflict exists between a
// scalar value ("a=hello") and an object-expanded value ("a.b=world").
//
// Fix: (1) sort keys before calling setNested, (2) last-segment write guards
// on existing-object presence (object wins — do not overwrite).

import { describe, it, expect } from 'vitest'
import { parseProperties } from '../src/internal/properties/properties.js'

describe('S23.4 — object wins over string in .properties conflict (HOCON.md L1485)', () => {
  // Forward order: scalar set first, then dotted-key
  it('S23.4: forward order a=hello;a.b=world → { a: { b: "world" } } (object wins)', () => {
    const result = parseProperties('a=hello\na.b=world')
    expect(result).toEqual({ a: { b: 'world' } })
  })

  // Reverse order: dotted-key set first, then scalar — THIS IS THE BUG
  it('S23.4: reverse order a.b=world;a=hello → { a: { b: "world" } } (object must still win)', () => {
    const result = parseProperties('a.b=world\na=hello')
    expect(result).toEqual({ a: { b: 'world' } })
  })

  // Deep nesting: a.b.c=v1 and a.b=v2 — object at a.b.c wins over scalar at a.b
  it('S23.4: a.b.c=v1;a.b=v2 → { a: { b: { c: "v1" } } } (object wins at nested level)', () => {
    const result = parseProperties('a.b.c=v1\na.b=v2')
    expect(result).toEqual({ a: { b: { c: 'v1' } } })
  })

  // Deep reverse: a.b=v1 set first, then a.b.c=v2 (scalar replaced by object)
  it('S23.4: a.b=v1;a.b.c=v2 → { a: { b: { c: "v2" } } } (scalar at non-last segment replaced by object)', () => {
    const result = parseProperties('a.b=v1\na.b.c=v2')
    expect(result).toEqual({ a: { b: { c: 'v2' } } })
  })

  // Verify sort discipline: result is input-order independent
  it('S23.4: sort discipline — both orderings of a.b.c=v1/a.b=v2 give identical output', () => {
    const r1 = parseProperties('a.b.c=v1\na.b=v2')
    const r2 = parseProperties('a.b=v2\na.b.c=v1')
    expect(r1).toEqual(r2)
  })
})
