// S9.2 + S13.12 — two Lightbend-conformance fixes surfaced by the py.hocon
// spec-verification wave (2026-08-18). Both were shared ts/py/rs port bugs;
// go.hocon conformed all along. Expected values verified against the
// Lightbend oracle (typesafe-config 1.4.6 probes):
//   - `"""<LF>hello"""` → "\nhello" (every character between the quotes is
//     preserved; the lexer used to strip a leading newline)
//   - `[1, ${?missing}, 3]` → [1, 3] (an undefined optional substitution in
//     element position is NOT added; the resolver used to null-fill it).
//     The prior ✅ cited equiv04/missing-substitutions.conf, which contains
//     no array-element case — a stale citation.

import { describe, expect, it } from 'vitest'

import { parse } from '../src/index'

const D = String.fromCharCode(36)

describe('S9.2 — triple-quoted strings preserve every character', () => {
  it('preserves a leading newline', () => {
    expect(parse('x = """\nhello"""').toObject()).toEqual({ x: '\nhello' })
  })

  it('still preserves inner newlines and whitespace', () => {
    expect(parse('x = """a\n  b"""').toObject()).toEqual({ x: 'a\n  b' })
  })
})

describe('S13.12 — undefined optional substitution in array element position', () => {
  it('omits the element instead of null-filling it', () => {
    expect(parse('arr = [1, ' + D + '{?missing}, 3]').toObject()).toEqual({ arr: [1, 3] })
  })

  it('keeps a literal null element', () => {
    expect(parse('arr = [1, null, 3]').toObject()).toEqual({ arr: [1, null, 3] })
  })

  it('drops nested-array elements independently', () => {
    expect(parse('arr = [[' + D + '{?m}], [1]]').toObject()).toEqual({ arr: [[], [1]] })
  })

  it('a concat element with an undefined optional keeps the literal remainder', () => {
    // S13.13 semantics inside the element: the optional contributes an empty
    // string, so the element itself survives as the concatenated remainder.
    expect(parse('arr = [' + D + '{?m} foo]').toObject()).toEqual({ arr: [' foo'] })
  })
})
