// tests/s15-numeric-obj-array.test.ts
//
// S15 — Numerically-indexed object → array conversion.
// Issue #87: https://github.com/o3co/ts.hocon/issues/87
//
// Fixture-driven conformance tests against xx.hocon ground truth.
// Accessor tests assert the o3co canonical result (per spec §"Integer key parse rule").
// E-row fixtures (na08, na10a, na10b) diverge from Lightbend at accessor time — see
// the corresponding .divergence.md files in tests/lightbend/testdata/expected/numeric-obj-array/.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/index.js'
import { ConfigError } from '../src/errors.js'

const confDir = new URL('./lightbend/testdata/numeric-obj-array', import.meta.url).pathname

function loadFixture(name: string): ReturnType<typeof parse> {
  const content = readFileSync(join(confDir, name), 'utf-8')
  return parse(content)
}

// ---------------------------------------------------------------------------
// Parse-tree conformance (all 16 fixtures must parse without error and produce
// the correct resolved tree, identical between Lightbend and o3co).
// ---------------------------------------------------------------------------
describe('S15 — numeric-obj-array parse-tree conformance', () => {
  const expectedDir = new URL('./lightbend/testdata/expected/numeric-obj-array', import.meta.url).pathname

  const fixtures = [
    'na01-basic',
    'na02-lazy-getobject',
    'na03a-concat-left-list',
    'na03b-concat-right-list',
    'na03c-concat-two-objs',
    'na03d-concat-multi-piece',
    'na03e-multi-piece-overlap',
    'na04-empty',
    'na05-non-int-keys',
    'na06-gaps',
    'na07-sort',
    'na08-leading-zero',
    'na09-negative',
    'na10a-plus-sign',
    'na10b-minus-zero',
    'na11-overflow',
    'na12-no-eligible',
  ]

  for (const name of fixtures) {
    it(`${name}: parse tree matches expected JSON`, () => {
      const content = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const config = parse(content)
      const expectedContent = readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8')
      const expected = JSON.parse(expectedContent)
      expect(config.toObject()).toEqual(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// Accessor-side conversion (na01, na04-na12): getList() must invoke
// numericObjectToArray and return the o3co canonical result.
// ---------------------------------------------------------------------------
describe('S15 — accessor-side conversion (getList)', () => {
  // na01: basic conversion
  it('na01: getList("items") on {"0":"a","1":"b"} returns ["a","b"]', () => {
    const c = loadFixture('na01-basic.conf')
    expect(c.getList('items')).toEqual(['a', 'b'])
  })

  // na02: laziness — get() and getConfig() must NOT trigger conversion
  it('na02: get("items") returns the object (no eager conversion)', () => {
    const c = loadFixture('na02-lazy-getobject.conf')
    expect(c.get('items')).toEqual({ '0': 'a', '1': 'b' })
  })

  it('na02: getConfig("items").getString("0") works (object access preserved)', () => {
    const c = loadFixture('na02-lazy-getobject.conf')
    expect(c.getConfig('items').getString('0')).toBe('a')
  })

  // na04: empty object NOT converted → type error
  it('na04: getList("items") on {} throws (empty object not converted)', () => {
    const c = loadFixture('na04-empty.conf')
    expect(() => c.getList('items')).toThrow(ConfigError)
  })

  // na05: non-integer keys ignored
  it('na05: getList("items") ignores "foo" key → ["a","c"]', () => {
    const c = loadFixture('na05-non-int-keys.conf')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // na06: gap compaction
  it('na06: getList("items") compacts gap between "0" and "2" → ["a","c"]', () => {
    const c = loadFixture('na06-gaps.conf')
    expect(c.getList('items')).toEqual(['a', 'c'])
  })

  // na07: sort by integer key
  it('na07: getList("items") sorts {"1":"b","0":"a"} → ["a","b"]', () => {
    const c = loadFixture('na07-sort.conf')
    expect(c.getList('items')).toEqual(['a', 'b'])
  })

  // na08: E2 — leading zero "00" rejected; only "0" eligible → ["b"]
  it('na08: getList("items") rejects "00" key (E2 leading-zero rule) → ["b"]', () => {
    const c = loadFixture('na08-leading-zero.conf')
    expect(c.getList('items')).toEqual(['b'])
  })

  // na09: negative key ineligible; only "0" eligible → ["b"]
  it('na09: getList("items") rejects "-1" key → ["b"]', () => {
    const c = loadFixture('na09-negative.conf')
    expect(c.getList('items')).toEqual(['b'])
  })

  // na10a: E3 — leading "+" rejected; only "0" eligible → ["b"]
  it('na10a: getList("items") rejects "+1" key (E3 leading-sign rule) → ["b"]', () => {
    const c = loadFixture('na10a-plus-sign.conf')
    expect(c.getList('items')).toEqual(['b'])
  })

  // na10b: E4 — leading "-" on zero rejected; only "0" eligible → ["b"]
  it('na10b: getList("items") rejects "-0" key (E4 minus-zero rule) → ["b"]', () => {
    const c = loadFixture('na10b-minus-zero.conf')
    expect(c.getList('items')).toEqual(['b'])
  })

  // na11: overflow (>i32) rejected; only "0" eligible → ["b"]
  it('na11: getList("items") rejects "99999999999" (overflow) → ["b"]', () => {
    const c = loadFixture('na11-overflow.conf')
    expect(c.getList('items')).toEqual(['b'])
  })

  // na12: all keys ineligible → no conversion → type error
  it('na12: getList("items") on {"foo":"a","bar":"b"} throws (no eligible keys)', () => {
    const c = loadFixture('na12-no-eligible.conf')
    expect(() => c.getList('items')).toThrow(ConfigError)
  })
})

// ---------------------------------------------------------------------------
// Concat-side conversion (na03a-na03d): resolver pairwise join must invoke
// numericObjectToArray when one side is Array and the other is Object.
// ---------------------------------------------------------------------------
describe('S15 — concat-side conversion (resolver pairwise join)', () => {
  // na03a: literal array on left, numeric-keyed object on right
  it('na03a: [a] ${obj} produces ["a","x","y"]', () => {
    const c = loadFixture('na03a-concat-left-list.conf')
    expect(c.getList('arr')).toEqual(['a', 'x', 'y'])
  })

  // na03b: numeric-keyed object on left, literal array on right (symmetric)
  it('na03b: ${obj} [a] produces ["x","y","a"]', () => {
    const c = loadFixture('na03b-concat-right-list.conf')
    expect(c.getList('arr')).toEqual(['x', 'y', 'a'])
  })

  // na03c: both sides are objects → S10.3 object merge (no concat-time conversion)
  // Subsequent getList triggers accessor-side conversion.
  it('na03c: ${obj1} ${obj2} merges to object; getList triggers accessor conversion → ["x","y","z","w"]', () => {
    const c = loadFixture('na03c-concat-two-objs.conf')
    // parse tree: arr is an object
    expect(c.get('arr')).toEqual({ '0': 'x', '1': 'y', '2': 'z', '3': 'w' })
    // accessor-side conversion fires when getList is called
    expect(c.getList('arr')).toEqual(['x', 'y', 'z', 'w'])
  })

  // na03d: NORMATIVE multi-piece concat — left-to-right pairwise fold
  // join(obj1, obj2) → merged object; join(merged, [a]) → numericObjectToArray → concat
  it('na03d: ${obj1} ${obj2} [a] (multi-piece, left-to-right) produces ["x","y","z","w","a"]', () => {
    const c = loadFixture('na03d-concat-multi-piece.conf')
    expect(c.getList('arr')).toEqual(['x', 'y', 'z', 'w', 'a'])
  })

  // na03e: NORMATIVE overlapping keys — distinguishes pairwise fold from single-pass loop.
  // obj1={"0":"x","1":"y"}, obj2={"0":"z"}
  // join(obj1, obj2) → object-merge → {"0":"z","1":"y"} (later "0" wins)
  // join(merged, [a]) → numericObjectToArray → ["z","y","a"]
  // Single-pass loop (wrong) would produce ["x","y","z","a"].
  it('na03e: ${obj1} ${obj2} [a] with overlapping keys produces ["z","y","a"] (pairwise fold)', () => {
    const c = loadFixture('na03e-multi-piece-overlap.conf')
    expect(c.getList('arr')).toEqual(['z', 'y', 'a'])
  })
})
