// tests/deferred-resolution.test.ts
// Layer-1 programmatic tests for E12 spec edges not expressible in YAML.
// These tests use the public API directly (no YAML harness).
import { describe, expect, it } from 'vitest'
import { parse, parseStringWithOptions } from '../src/parse.js'
import { fromMap, empty } from '../src/value-factory.js'
import { NotResolvedError, ResolveError } from '../src/errors.js'

// ─── isResolved basic ────────────────────────────────────────────────────────

describe('Config.isResolved', () => {
  it('fused parse() is resolved', () => {
    expect(parse('a = 1').isResolved()).toBe(true)
  })

  it('parseStringWithOptions(resolveSubstitutions=false) with subst is not resolved', () => {
    const c = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    expect(c.isResolved()).toBe(false)
  })

  it('parseStringWithOptions(resolveSubstitutions=false) without subst is resolved', () => {
    const c = parseStringWithOptions('a = 1', { resolveSubstitutions: false })
    expect(c.isResolved()).toBe(true)
  })
})

// ─── getter NotResolved ───────────────────────────────────────────────────────

describe('getter on unresolved path', () => {
  it('getString throws NotResolvedError', () => {
    const c = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    expect(() => c.getString('a')).toThrow(NotResolvedError)
  })

  it('getString on resolved-literal path in partially-unresolved Config succeeds', () => {
    const c = parseStringWithOptions('lit = "ok"\nsub = ${MISSING}', { resolveSubstitutions: false })
    expect(c.getString('lit')).toBe('ok')
  })
})

// ─── withFallback ─────────────────────────────────────────────────────────────

describe('Config.withFallback (unresolved-aware)', () => {
  it('both resolved — preserves existing semantics', () => {
    const a = parse('a = 1\nb = 2')
    const b = parse('b = 99\nc = 3')
    const m = a.withFallback(b)
    expect(m.isResolved()).toBe(true)
    expect(m.getNumber('a')).toBe(1)
    expect(m.getNumber('b')).toBe(2)
    expect(m.getNumber('c')).toBe(3)
  })

  it('receiver unresolved + resolved fallback → result unresolved', () => {
    const r = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    const f = parse('b = 7')
    const m = r.withFallback(f)
    expect(m.isResolved()).toBe(false)
  })
})

// ─── S13a × WithFallback — dr04-06 ───────────────────────────────────────────

describe('S13a × WithFallback — optional self-ref across fallback (dr04)', () => {
  it('a = ${?a} extra, fallback a = base → a = "base extra"', () => {
    const r = parseStringWithOptions('a = ${?a} extra', { resolveSubstitutions: false })
    const f = parseStringWithOptions('a = base', { resolveSubstitutions: false })
    const resolved = r.withFallback(f).resolve({ useSystemEnvironment: false })
    expect(resolved.getString('a')).toBe('base extra')
  })
})

describe('S13a × WithFallback — required self-ref with prior (dr05)', () => {
  it('a = ${a} extra, fallback a = base → a = "base extra"', () => {
    const r = parseStringWithOptions('a = ${a} extra', { resolveSubstitutions: false })
    const f = parseStringWithOptions('a = base', { resolveSubstitutions: false })
    const resolved = r.withFallback(f).resolve({ useSystemEnvironment: false })
    expect(resolved.getString('a')).toBe('base extra')
  })
})

describe('S13a × WithFallback — required self-ref without prior (dr06)', () => {
  it('required self-ref with no fallback prior must error', () => {
    const r = parseStringWithOptions('a = ${a} extra', { resolveSubstitutions: false })
    expect(() => r.resolve({ useSystemEnvironment: false })).toThrow()
  })
})

// ─── Transitive cross-layer — dr21 ───────────────────────────────────────────

describe('Transitive cross-layer substitution (dr21)', () => {
  it('a = ${b}, b = ${c}, c = 1 → a = 1', () => {
    const r = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    const f1 = parseStringWithOptions('b = ${c}', { resolveSubstitutions: false })
    const f2 = parseStringWithOptions('c = 1', { resolveSubstitutions: false })
    const resolved = r.withFallback(f1).withFallback(f2).resolve({ useSystemEnvironment: false })
    expect(resolved.getNumber('a')).toBe(1)
  })
})

// ─── Hidden substitutions — dr23 ─────────────────────────────────────────────

describe('Hidden substitution across layers (dr23)', () => {
  it('receiver foo = 42, fallback foo = ${nonexist} → { foo: 42 } (no error)', () => {
    const r = parseStringWithOptions('foo = 42', { resolveSubstitutions: false })
    const f = parseStringWithOptions('foo = ${nonexist}', { resolveSubstitutions: false })
    const resolved = r.withFallback(f).resolve({ useSystemEnvironment: false })
    expect(resolved.getNumber('foo')).toBe(42)
  })
})

// ─── Cross-layer cycle — dr18 ────────────────────────────────────────────────

describe('Cross-layer cycle (dr18)', () => {
  it('a = ${b}, b = ${a} across layers → ResolveError', () => {
    const r = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    const f = parseStringWithOptions('b = ${a}', { resolveSubstitutions: false })
    expect(() => r.withFallback(f).resolve({ useSystemEnvironment: false })).toThrow(ResolveError)
  })
})

// ─── Optional substitution materialisation ────────────────────────────────────

describe('Optional substitution materialisation — standalone (dr24)', () => {
  it('a = ${?x}, x absent → field a is omitted', () => {
    const r = parseStringWithOptions('a = ${?x}', { resolveSubstitutions: false })
    const resolved = r.resolve({ useSystemEnvironment: false })
    expect(resolved.has('a')).toBe(false)
  })
})

describe('Optional substitution materialisation — string concat (dr25)', () => {
  it('a = ${?x} "tail", x absent → a = " tail" (leading space preserved)', () => {
    const r = parseStringWithOptions('a = ${?x} "tail"', { resolveSubstitutions: false })
    const resolved = r.resolve({ useSystemEnvironment: false })
    expect(resolved.getString('a')).toBe(' tail')
  })
})

// ─── Composition barrier — dr10 ──────────────────────────────────────────────

describe('Composition barrier (dr10)', () => {
  it('receiver a{x=1}, fb1 a="scalar", fb2 a{y=2} → a.y absent in result', () => {
    const r = parseStringWithOptions('a { x = 1 }', { resolveSubstitutions: false })
    const fb1 = parseStringWithOptions('a = "scalar"', { resolveSubstitutions: false })
    const fb2 = parseStringWithOptions('a { y = 2 }', { resolveSubstitutions: false })
    const resolved = r.withFallback(fb1).withFallback(fb2).resolve({ useSystemEnvironment: false })
    expect(resolved.getNumber('a.x')).toBe(1)
    expect(resolved.getConfig('a').has('y')).toBe(false)
  })
})

// ─── fromMap + empty ─────────────────────────────────────────────────────────

describe('fromMap — scalar types', () => {
  it('round-trips multiple types', () => {
    const c = fromMap({ flag: true, count: 42, ratio: 3.14, label: 'hello' })
    expect(c.getBoolean('flag')).toBe(true)
    expect(c.getNumber('count')).toBe(42)
    expect(c.getNumber('ratio')).toBeCloseTo(3.14)
    expect(c.getString('label')).toBe('hello')
    expect(c.isResolved()).toBe(true)
  })
})

describe('empty as fallback', () => {
  it('c.withFallback(empty()) is no-op', () => {
    const c = parse('a = 1')
    const m = c.withFallback(empty())
    expect(m.getNumber('a')).toBe(1)
  })

  it('empty().withFallback(c) exposes c keys', () => {
    const c = parse('a = 1\nb = 2')
    const m = empty().withFallback(c)
    expect(m.getNumber('a')).toBe(1)
    expect(m.getNumber('b')).toBe(2)
  })
})

// ─── _renderJSONForTest helper ────────────────────────────────────────────────

describe('Config._renderJSONForTest', () => {
  it('renders scalars and objects to canonical JSON', () => {
    const c = parse('a = 1\nb = "hello"\nc {\n  x = true\n  y = null\n}\nd = [1, 2, 3]')
    const got = c._renderJSONForTest()
    const expected = JSON.stringify({ a: 1, b: 'hello', c: { x: true, y: null }, d: [1, 2, 3] })
    // Parse both to compare structurally (key order may differ from JSON.stringify)
    expect(JSON.parse(got)).toEqual(JSON.parse(expected))
  })
})

// ─── E11 package include with deferred (dr17, programmatic) ──────────────────
// YAML runner cannot register packages, so this is covered programmatically only.
// Skipped here since E11 package registry is not in ts.hocon's current scope.
// Un-skip when ts.hocon gains package include support.
it.skip('dr17: E11 package-include + deferred — programmatic (package registry not yet in ts.hocon)', () => {
  // TODO: implement when ts.hocon gains RegisterPackage / UnregisterPackage
})
