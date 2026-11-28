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
      expect(() => parse(src)).toThrow(/resolved value too large: o\.y\.\S+ keeps growing/)
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
