// tests/render-hocon.test.ts
//
// Config.renderHocon() — E18 HOCON emitter, ported from go.hocon's
// render_hocon_test.go (v1.11.0). The correctness contract is the round trip:
// parse(render(tree)) yields the same value tree, compared as canonical JSON
// (sorted keys), never as text.
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors.js'
import { parseString, parseStringWithOptions } from '../src/parse.js'
import { fromMap } from '../src/value-factory.js'

/**
 * Renders a config to HOCON, parses it back, and returns the re-parsed
 * config's canonical JSON alongside the original's. Equal JSON means the
 * emit → parse round trip preserved the value tree, which is the emitter's
 * correctness contract.
 */
function roundTrip(values: Record<string, unknown>): { before: string; after: string; text: string } {
  const cfg = fromMap(values, 'test')
  const before = cfg._renderJSONForTest()
  const text = cfg.renderHocon()
  let reparsed
  try {
    reparsed = parseString(text)
  } catch (e) {
    throw new Error(`parseString of emitted HOCON failed: ${String(e)}\n--- emitted ---\n${text}`)
  }
  const after = reparsed._renderJSONForTest()
  return { before, after, text }
}

function assertRoundTrip(values: Record<string, unknown>): void {
  const { before, after, text } = roundTrip(values)
  expect(after, `round trip changed the tree\n--- emitted ---\n${text}`).toBe(before)
}

describe('renderHocon round trip', () => {
  it('scalars', () => {
    assertRoundTrip({ s: 'hello', n: 8080, f: 1.5, b: true, z: false, nul: null })
  })

  it('nested-objects', () => {
    assertRoundTrip({
      db: { host: 'localhost', port: 5432, opts: { ssl: true } },
    })
  })

  it('arrays', () => {
    assertRoundTrip({
      tags: ['a', 'b', 'c'],
      nums: [1, 2, 3],
      objs: [{ id: 1 }, { id: 2 }],
      nested: [[1, 2], [3, 4]],
      'empty-a': [],
    })
  })

  // Strings that would re-parse as another type MUST stay strings.
  it('ambiguous-strings', () => {
    assertRoundTrip({
      'looks-num': '8080',
      'looks-float': '1.5',
      'looks-bool': 'true',
      'looks-null': 'null',
      norway: 'no',
      neg: '-5',
    })
  })

  // Strings needing quoting for their content.
  it('special-strings', () => {
    assertRoundTrip({
      spaces: 'hello world',
      empty: '',
      reserved: 'a:b=c,d',
      leading: '  padded  ',
      url: 'https://example.com/a?b=1',
      substish: '${foo.bar}',
    })
  })

  it('multiline', () => {
    assertRoundTrip({
      block: 'line1\nline2\nline3',
      crlf: 'a\r\nb',
      tab: 'a\tb',
    })
  })

  // Keys that cannot be bare.
  it('awkward-keys', () => {
    assertRoundTrip({
      'a.b': 'dotted key',
      'has space': 1,
      '': 'empty key',
      'a=b': true,
      '123': 'numeric key ok',
      include: 'reserved word must be quoted to round-trip',
    })
  })

  it('empty-object', () => {
    assertRoundTrip({ outer: { inner: {} } })
  })

  it('unicode', () => {
    assertRoundTrip({ jp: 'こんにちは', emoji: '😀', mixed: 'a😀b' })
  })

  // Strings that defeat triple-quoting (embedded """, a trailing ") must fall
  // through to escaped double quotes and still round-trip.
  it('quote-heavy', () => {
    assertRoundTrip({
      'embedded-triple': 'a"""b\nc',
      'trailing-quote': 'ends"',
      'lone-quote': 'a"b',
      'multiline-quote': 'x\ny"',
      backslash: 'a\\b\\\\c',
    })
  })

  // Empty object as an array element and as a direct value exercise the
  // value-position empty-object branch (distinct from a nested key).
  it('empty-object-positions', () => {
    assertRoundTrip({
      'in-array': [{}, { a: 1 }],
      direct: {},
    })
  })
})

// An unresolved config has no textual round trip through a value tree, so
// renderHocon must refuse it rather than emit a broken document. The
// placeholders sit at three depths so the whole-config gate covers the nested
// object and array shapes, not only the top level.
describe('renderHocon rejects unresolved', () => {
  const cases: Record<string, string> = {
    'top-level': 'a = 1\nb = ${a}\n',
    nested: 'a = 1\nb { c = ${a} }\n',
    'in-array': 'a = 1\nb = [1, ${a}, 3]\n',
    'obj-in-arr': 'a = 1\nb = [{ c = ${a} }]\n',
  }
  for (const [name, src] of Object.entries(cases)) {
    it(name, () => {
      const cfg = parseStringWithOptions(src, { resolveSubstitutions: false })
      expect(() => cfg.renderHocon()).toThrow(ConfigError)
      expect(() => cfg.renderHocon()).toThrow(/config must be resolved data/)
    })
  }
})

// The emitted text should be idiomatic where it is safe: a plain identifier
// value and key stay bare, a number is not quoted.
describe('renderHocon idiomatic output', () => {
  it('keeps safe scalars bare', () => {
    const cfg = fromMap({ name: 'svc', port: 8080, enabled: true })
    const got = cfg.renderHocon()
    for (const want of ['name = svc\n', 'port = 8080\n', 'enabled = true\n']) {
      expect(got, `emitted HOCON missing ${JSON.stringify(want)}`).toContain(want)
    }
  })
})

// A parsed HOCON document (not from fromMap) also round-trips once resolved.
describe('renderHocon from parsed document', () => {
  it('round-trips a resolved parse', () => {
    const src = 'a = 1\nb { c = "x", d = [1, 2, "three"] }\ne = ${a}\n'
    const cfg = parseString(src)
    const text = cfg.renderHocon()
    let reparsed
    try {
      reparsed = parseString(text)
    } catch (e) {
      throw new Error(`re-parse failed: ${String(e)}\n--- emitted ---\n${text}`)
    }
    expect(
      reparsed._renderJSONForTest(),
      `parsed-doc round trip diverged\n--- emitted ---\n${text}`,
    ).toBe(cfg._renderJSONForTest())
  })
})

// xx.hocon#130 / S1.2.4: a raw C0 control inside double quotes is a parse
// error, so renderHocon must escape every one it writes there (E18 decision 5).
describe('renderHocon escapes control characters', () => {
  let allC0 = ''
  for (let code = 0; code < 0x20; code++) allC0 += String.fromCharCode(code)
  const tree = {
    'all-c0': allC0,
    'bare-but-control': 'abc\x01def',
    'k\x01ey': 'key quotes only because of the control',
    '\x00': 'nul key',
    'multi-ctrl': 'line1\x01\nline2\x00',
    'multi-tab': 'col1\tcol2\nrow2',
    'del-c1': 'x\x7f\u0085y',
  }

  it('round-trips every C0 control in values and keys', () => {
    assertRoundTrip(tree)
  })

  it('writes no raw C0 control other than LF and TAB', () => {
    const out = fromMap(tree, 'test').renderHocon()
    for (let i = 0; i < out.length; i++) {
      const code = out.charCodeAt(i)
      if (code < 0x20 && code !== 0x0a && code !== 0x09) {
        throw new Error(`raw control U+${code.toString(16).padStart(4, '0')} at ${i} in:\n${out}`)
      }
    }
    // Short forms where JSON has one, lowercase \u00xx otherwise.
    for (const want of ['\\b', '\\f', '\\u0000', '\\u001f', '\\u0001']) expect(out).toContain(want)
    // A multi-line string with only LF and TAB keeps the triple-quoted form.
    expect(out).toContain('"""col1\tcol2\nrow2"""')
    // DEL and C1 are legal in quotes and stay verbatim.
    expect(out).toContain('x\x7f\u0085y')
  })

  it('a key containing LF takes the escaped form, never triple quotes (E18 decision 3)', () => {
    const tree = { 'multi\nline key': 1, 'k\n\x01': 2, value: 'multi\nline' }
    const out = fromMap(tree, 'test').renderHocon()
    expect(out).toContain('"multi\\nline key" = 1')
    expect(out).toContain('"k\\n\\u0001" = 2')
    // Values keep the triple-quote branch.
    expect(out).toContain('value = """multi\nline"""')
    expect(out).not.toMatch(/"""multi\nline key"""/)
    assertRoundTrip(tree)
  })
})
