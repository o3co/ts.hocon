/**
 * The ts counterpart of go.hocon#218 / rs.hocon#199 — a substitution cycle
 * written twice (`a = ${?b}` / `b = ${?a}` twice). go and rs overflowed the
 * stack; ts survived only because the recursion limit (src/internal/depth.ts)
 * turned it into a ParseError, where Lightbend 1.4.9 gives `{}`. The interim
 * guard (`priorReentry` in substitution-resolver.ts) treats a re-entry in an
 * unchanged state as an unbreakable cycle; the full fix is the resolver
 * redesign in o3co/xx.hocon#67 / #125. Expected values are Lightbend 1.4.9.
 *
 * Fixtures (o3co/xx.hocon#136; the .conf files are tracked, the expected
 * sidecars are fetched by `make testdata` — the fixture block skips when
 * they are absent):
 *   tests/lightbend/testdata/hocon/optional-cycle-repeat/oc01-oc06
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ResolveError } from '../src/errors.js'
import { parse, parseFile } from '../src/index.js'
import { documentStats } from '../src/internal/resolver/substitution-resolver.js'
import { makeResObj, type ResObj } from '../src/internal/resolver/types.js'

const ocDir = fileURLToPath(new URL('./lightbend/testdata/hocon/optional-cycle-repeat', import.meta.url))
const ocExpectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/optional-cycle-repeat', import.meta.url))

describe('a cycle through saved priors written twice (go.hocon#218 / rs.hocon#199)', () => {
  const cases: ReadonlyArray<readonly [string, string, unknown]> = [
    ['optional twice', 'a = ${?b}\nb = ${?a}\na = ${?b}\nb = ${?a}\n', {}],
    ['optional thrice', 'a = ${?b}\nb = ${?a}\na = ${?b}\nb = ${?a}\na = ${?b}\nb = ${?a}\n', {}],
    ['three keys twice', 'a = ${?b}\nb = ${?c}\nc = ${?a}\na = ${?b}\nb = ${?c}\nc = ${?a}\n', {}],
    ['nested path', 'o.a = ${?o.b}\no.b = ${?o.a}\no.a = ${?o.b}\no.b = ${?o.a}\n', { o: {} }],
    ['referenced in a concat', 'a = ${?b}\nb = ${?a}\na = ${?b}\nb = ${?a}\nc = ${?a}x\n', { c: 'x' }],
    ['a later value breaks it', 'a = ${?b}\nb = ${?a}\na = ${?b}\nb = ${?a}\na = 1\n', { a: 1, b: 1 }],
    // Legal re-entries the guard must let through: the second pass through a
    // prior sees new keys in progress and stops on its own.
    ['legal re-entry', 'o = { y = ${?a} }\na = ${o.y}\no.x = 5\no.y += [3]\n', { a: [[3]], o: { x: 5, y: [[3]] } }],
    ['self-ref chain', 'a = 1\na = ${a}x\na = ${a}y\nb = ${a}\n', { a: '1xy', b: '1xy' }],
    ['cycle once', 'a = ${?b}\nb = ${?a}\na = ${?b}\n', {}],
    // Re-entries that terminate only because the prefix-prior guard set or
    // the field path changed in between (found by review in go/rs): a guard
    // keyed on the in-progress set alone turned these into errors.
    ['prefix-prior state', 'o = ${?k}z\no.y = ${?o.y}\nk = ${?o.x}\nk = ${k}z\n', { k: 'z', o: {} }],
    ['prefix-prior state, deeper', 'o = ${?k}z\no.y.z = ${?o.y.z}\nk = ${?o.x}\nk = ${k}z\n', { k: 'z', o: { y: {} } }],
    ['field-path state', 'o = { y = ${?k} }\nk = [${?o.y}]\nk = ${?m}\nm = ${?k}\no = ${?k}\n', { k: [[]], m: [[]], o: [[]] }],
    ['field-path state, two elements', 'o = { y = ${?k} }\nk = [${?o.y}, 1]\nk = ${?m}\nm = ${?k}\no = ${?k}\n', { k: [[1], 1], m: [[1], 1], o: [[1], 1] }],
  ]
  for (const [name, src, want] of cases) {
    it(`${name}: ${JSON.stringify(want)}`, () => {
      expect(parse(src).toObject()).toEqual(want)
    })
  }

  for (const [name, src] of [
    ['required twice', 'a = ${b}\nb = ${a}\na = ${b}\nb = ${a}\n'],
    ['mixed twice', 'a = ${?b}\nb = ${a}\na = ${?b}\nb = ${a}\n'],
  ] as const) {
    it(`${name}: a ResolveError, not the recursion-limit ParseError`, () => {
      expect(() => parse(src)).toThrow(ResolveError)
    })
  }

  // Also hit the recursion limit before and now terminate. The value still
  // differs from Lightbend's ({"a":"yxyx","b":"yxy"}); that is the resolver
  // redesign, so only termination without the limit error is asserted.
  it('a cycle through concatenation terminates', () => {
    expect(() => parse('a = ${?b}x\nb = ${?a}y\na = ${?b}x\nb = ${?a}y\n')).not.toThrow()
  })
})

// A cycle through nested objects can nest its value exponentially before the
// guard stops it. The value budget (VALUE_NODES_PER_SOURCE_NODE) turns that
// into an error instead of seconds of CPU and megabytes of value. Both inputs
// hit the recursion limit before the guard; no time is asserted.
describe('value budget for a cycle through nested objects (rs.hocon#199)', () => {
  for (const [name, src] of [
    ['r3d (r3b with o.y.q written twice)', "o.x = 2\no.x = ${?o}\no.y = { z = ${?o.y.z} }\no.y.z = ${?o}\no.x = ${?o.x}\no.y = { x = ${?o.y} }\no.y = ${?o.y.z}\no.y.q = ${?o.x}\no.y.q = ${?o.x}\n"],
    ['r3c', "o.x = 2\no.x = ${?o}\no.y = { z = ${?o.y.z} }\no.y.z = ${?o}\no.x = ${?o.x}\no.y = { x = ${?o.y} }\no.y = { q = ${?o.y.z} }\n"],
  ] as const) {
    it(`${name}: resolved value too large`, () => {
      expect(() => parse(src)).toThrow(/resolved value too large: \S+ keeps growing/)
    })
  }
})

// The budget is charged only after the guard has cut a cycle, so acyclic
// input is never charged however large its value: deep nesting, a long
// path, and repeated references (billion-laughs) load exactly as before.
describe('value budget leaves acyclic input alone', () => {
  const depthOf = (v: unknown, k: string): number => {
    let n = 0
    for (let cur = v as Record<string, unknown>; cur && typeof cur === 'object' && k in cur; cur = cur[k] as Record<string, unknown>) n++
    return n
  }
  it('500 nested objects', () => {
    const obj = parse(`${'a { '.repeat(500)}x = 1${' }'.repeat(500)}`).toObject()
    expect(depthOf(obj, 'a')).toBe(500)
  })
  // Slow by nature (the path is re-walked per segment), not by the budget;
  // the timeout only keeps a loaded CI runner from failing it.
  it('a 1000-segment path', () => {
    const obj = parse(`${Array(1000).fill('a').join('.')} = 1`).toObject()
    expect(depthOf(obj, 'a')).toBe(1000)
  }, 60_000)
  it('billion-laughs, 12 levels (4096 leaves)', () => {
    const lines = ['a0 = {v = 1}']
    for (let n = 1; n <= 12; n++) lines.push(`a${n} = { x = \${a${n - 1}}, y = \${a${n - 1}} }`)
    const obj = parse(lines.join('\n')).toObject() as Record<string, unknown>
    const leaves = (v: unknown): number =>
      v && typeof v === 'object' ? Object.values(v as object).reduce((n: number, c) => n + leaves(c), 0) : 1
    expect(leaves(obj.a12)).toBe(4096)
  })
})

// The budget tests do bounded but non-trivial work before the bound hits; a
// generous timeout keeps a loaded runner from failing them. No time is asserted.
const BUDGET_TEST_TIMEOUT = 60_000

// A ring of 16 keys, every line written twice, whose value doubles on every
// lap. The value budget is charged as each substitution result is produced
// and the work budget counts substitutions after a cut, so either stops it
// while the value is being built rather than after exhausting memory
// (go.hocon#223 / rs.hocon#203 review). No time or memory is asserted.
describe('doubling rings (go.hocon#223 / rs.hocon#203 review)', () => {
  const ring = (element: (next: number) => string): string => {
    const n = 16
    const lines = Array.from({ length: n }, (_, i) => `a${i} = ${element((i + 1) % n)}`).join('\n')
    return `${lines}\n${lines}\n`
  }
  it('array ring: stopped by a budget', () => {
    expect(() => parse(ring(j => `[\${?a${j}}, \${?a${j}}]`))).toThrow(/resolved value too large|substitution cycle too complex/)
  }, BUDGET_TEST_TIMEOUT)
  it('string ring: stopped by a budget', () => {
    expect(() => parse(ring(j => `\${?a${j}}\${?a${j}}x`))).toThrow(/resolved value too large|substitution cycle too complex/)
  }, BUDGET_TEST_TIMEOUT)
})

// Post-cut bounds (rs.hocon memory review): wide references that re-explore
// cut subtrees, a dense cycle, and a string ring padded to inflate the
// per-node budget. Whichever bound hits first is accepted. No time or memory
// is asserted.
describe('post-cut bounds', () => {
  const stopped = /resolved value too large|substitution cycle too complex/
  const twice = (lines: string[]): string => `${lines.join('\n')}\n${lines.join('\n')}\n`
  it('wide references (8 per line)', () => {
    const refs = (k: string) => Array(8).fill(`\${?${k}}`).join('')
    expect(() => parse(twice([`a = ${refs('b')}`, `b = ${refs('a')}`]))).toThrow(stopped)
  }, BUDGET_TEST_TIMEOUT)
  it('a dense cycle (10 keys, each referencing all 10)', () => {
    const all = Array.from({ length: 10 }, (_, i) => `\${?k${i + 1}}`).join('')
    expect(() => parse(twice(Array.from({ length: 10 }, (_, i) => `k${i + 1} = ${all}`)))).toThrow(stopped)
  }, BUDGET_TEST_TIMEOUT)
  it('a padded string ring (16 keys, 10,000-element pad)', () => {
    const ring = Array.from({ length: 16 }, (_, i) => `a${i} = \${?a${(i + 1) % 16}}\${?a${(i + 1) % 16}}x`)
    const pad = `pad = [${Array(10_000).fill(1).join(',')}]`
    expect(() => parse(`${pad}\n${twice(ring)}`)).toThrow(stopped)
  }, BUDGET_TEST_TIMEOUT)
})

// documentStats walks fields and saved priors; current values and priors
// share children, so without an identity check a chain whose every level
// reaches the next level twice walks 2^depth paths.
describe('documentStats visits a shared container once', () => {
  it('a 60-level chain shared through fields and priorValues', () => {
    let child: ResObj = makeResObj()
    child.fields.set('s', { _kind: 'subst-placeholder', segments: [{ text: 'a' }, { text: 'b' }], optional: true, knownAbsent: false, listSuffix: false, line: 1, col: 1, prefixLen: 0 } as never)
    for (let i = 0; i < 60; i++) {
      const o = makeResObj()
      o.fields.set('k', child)
      o.priorValues.set('k', child)
      child = o
    }
    const stats = documentStats(child)
    expect(stats.maxSubstLen).toBe(2)
    expect(stats.sourceNodes).toBe(62)
  })
})

// ts-specific steering state (ts guard review). These configs load today
// and go through a cut; a snapshot without the concat-iteration set or the
// scope identity changed their result. Expected values are ts base (5793e00).
describe('re-entry state includes the concat set and the scope', () => {
  const cases: ReadonlyArray<readonly [string, string, unknown]> = [
    ['cx1', "a.a = ${?b}\nc.b { b { a += x, b += ${?a}, a += [${?c}] } }\nc.b { b { a += [] } }\na = ${c}\na = ${?a}\n", {"a": {"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}], []], "b": [["x"], ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}]]]}}}, "c": {"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], {"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}], []], "b": [["x"], ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}]]]}}}]}}}], []], "b": [["x"], {"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}], []], "b": [["x"], ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}]]]}}}]}}}], []], "b": [{"b": {"b": {"a": ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}], []], "b": [["x"], ["x", [{"b": {"b": {"a": ["x", []], "b": [["x"], ["x"]]}}}]]]}}}]}}}}],
    ['cx2', "b += { b { a { a = ${?c} }, a += [{ a = 1 }] }, b += { b { b { a = 1 } ${?a}, a { a = 1 } } } } { b += 2, b = [[${?c}]] }\nc = [${?b}]\nc = ${?b}\na.a.a = ${?c}\nb += { b { a { a { a = 1 } }, a += [{ a = 1 }] }, b += { b { b { a = 1 } { a = 1 } } } }\n", {"a": {"a": {"a": [{"b": [[[{"b": [[[[2]]]]}]]]}, {"b": [{"b": {"b": {"a": 1}}}]}]}}, "b": [{"b": [[[{"b": [[[[2]]]]}]]]}, {"b": [{"b": {"b": {"a": 1}}}]}], "c": [{"b": [[[{"b": [[[[2]]]]}]]]}, {"b": [{"b": {"b": {"a": 1}}}]}]}],
  ]
  for (const [name, text, expected] of cases) {
    it(`${name} loads as before`, () => {
      expect(parse(text).toObject()).toEqual(expected)
    })
  }
})

// One config per state component: a build whose snapshot omits that
// component changes its result (found by differential over the review
// corpora). c1 loads in base too, with this value. The others hit the
// recursion limit in base, so their expected value is this fix's; no
// base-loadable input in the corpora depends on the field path or the
// concat set alone (cx1 / cx2 above need the concat set or the scope).
describe('each re-entry state component is load-bearing', () => {
  const cases: ReadonlyArray<readonly [string, string, string, unknown]> = [
    ["the field path", "h03845.conf", "o.y.z = { y += 7, z = ${?o.x} ${p.q} }\np.q += ${?p}\no.y.z = { y += 7, z = ${?o.x} ${p.q} }\np.q += ${?p}\n", {"o": {"y": {"z": {"y": [7, 7], "z": [{"q": [{"q": [{"q": []}]}, {"q": [{"q": []}]}]}, {"q": [{"q": [{"q": []}]}, {"q": [{"q": []}]}]}]}}}, "p": {"q": [{"q": [{"q": [{"q": []}]}]}, {"q": [{"q": [{"q": []}]}]}]}}],
    ["the prefix-prior set", "c1.conf", "x = ${a}\nx = ${a}\na = ${?x.y}\na = ${?a}ok\n", {"a": "ok", "x": "ok"}],
    ["the concat set", "u00187.conf", "a = 5\na.a += { a = ${?a} }\na.a += ${?b.a}\n", {"a": {"a": [{"a": {"a": [{"a": {"a": [{"a": {"a": [{"a": 5}]}}, {"a": 5}]}}]}}]}}],
    ["the scope", "t19411.conf", "o.x = ${?o.y}\no.y = ${?o}\no.y.z = [${?o.y}]\n", {"o": {"x": {"x": {"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}, "z": [{"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}]}, "z": [{"x": {"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}, "z": [{"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}]}}]}, "y": {"x": {"x": {"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}, "z": [{"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}]}}, "y": {"x": {"x": {"y": {}}, "y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}, "z": [{"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}]}, "z": [{"x": {"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}, "z": [{"x": {"y": {"x": {"y": {}}}}, "y": {"x": {"x": {"y": {}}, "y": {}}}}]}}]}}}],
  ]
  for (const [component, name, text, expected] of cases) {
    it(`${component}: ${name}`, () => {
      expect(parse(text).toObject()).toEqual(expected)
    })
  }
})

// After a cut the guard lets each re-entry in a new state through, and the
// states can multiply exponentially. Base answered these quickly (an error);
// the work budget keeps the answer an error instead of minutes of CPU. No
// time is asserted.
describe('work budget after a cut (ts guard review)', () => {
  it('s16427: the base error', () => {
    expect(() => parse("o.o = { o = ${?o.a} ${?o.o} }\no.b = ${o.b}x\no.o.a = ${o.o.a} y\no.o.a += ${?o}[1]\no.o.a = x${?o.o}\no.a = ${o.o.a}y\no.o.a = ${o.o.a} y\no.o.a += ${?o}[1]\no.o.a = x${?o.o}\no.a = ${o.o.a}y\no.o.a = x${?o.o}\no.o.a = ${o.o.a} y\no.o.a += ${?o}[1]\no.o.a = x${?o.o}\no.a = ${o.o.a}y\n")).toThrow(/circular substitution: o\.o\.a/)
  })
  it('h04998: an error', () => {
    expect(() => parse("o.y = ${o.y} ${o.y}\nb = ${a}${b}\no.y.z = ${?o.y.z}${?o}\no.x = ${o.x} y\no.y.z += ${?o.y.z} ${?c}\no.x = ${o.x}\no.y.z = ${?o.y.z}${?o}\no.x = ${o.x} y\no.y.z += ${?o.y.z} ${?c}\no.x = ${o.x}\no.y.z = ${?o.y.z}${?o}\no.x = ${o.x} y\no.y.z += ${?o.y.z} ${?c}\no.x = ${o.x}\no.x = ${o.x}x\no.y.z = ${o.y.z} y\n")).toThrow(ResolveError)
  })
})

describe('o3co/xx.hocon#136 fixture conformance (oc01-oc06)', () => {
  // `-inner.conf` files are include targets, not fixtures.
  const names = existsSync(ocDir)
    ? readdirSync(ocDir)
        .filter(f => f.endsWith('.conf') && !f.endsWith('-inner.conf'))
        .map(f => f.slice(0, -'.conf'.length))
        .sort()
    : []
  const errorNames = names.filter(n => existsSync(join(ocExpectedDir, `${n}.error`)))
  const successNames = names.filter(n => existsSync(join(ocExpectedDir, `${n}-expected.json`)))
  const present = errorNames.length + successNames.length > 0

  it.skipIf(!present)('discovered the fixtures (testdata present)', () => {
    expect(errorNames.length + successNames.length).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(6)
  })

  for (const name of errorNames) {
    it(`${name}: rejected with a ResolveError (.error sidecar)`, () => {
      expect(() => parseFile(join(ocDir, `${name}.conf`))).toThrow(ResolveError)
    })
  }

  for (const name of successNames) {
    it(`${name}: parses to expected JSON`, () => {
      const want = JSON.parse(readFileSync(join(ocExpectedDir, `${name}-expected.json`), 'utf-8'))
      expect(parseFile(join(ocDir, `${name}.conf`)).toObject()).toEqual(want)
    })
  }
})
