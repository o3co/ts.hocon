// tests/adapters/json5.test.ts
//
// Port of go.hocon's adapters/json5 test battery (json5_test.go), with the
// same inputs and expected values. Divergences forced by the host language are
// pinned explicitly below: integers past 2^53 are read back via getString (the
// repo's F0.5 convention, as in the jsonc tests), -0 keeps its sign (as the
// core parser and fromMap do), and go's invalid-UTF-8 rejection has no ts
// equivalent — a lone surrogate CODE UNIT in source is host string data and
// passes through, while a lone surrogate \uXXXX ESCAPE is refused (F3.5).

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseJson5 } from '../../src/adapters/json5.js'
import { parseStringWithOptions } from '../../src/index.js'
import { ConfigError } from '../../src/errors.js'

const parse5 = (src: string) => parseJson5(src, 'test.json5')
const parseErr = (src: string, wantSubstr: string): void => {
  expect(() => parseJson5(src, 'test.json5'), src).toThrow(wantSubstr)
}

// ─── The json5.org front-page example, minus Infinity/NaN (spec F0.6 rejects
//     those — pinned separately below) ─────────────────────────────────────────

describe('json5 front-page example', () => {
  const cfg = parse5(`{
  // comments
  unquoted: 'and you can quote me on that',
  singleQuotes: 'I can use "double quotes" here',
  lineBreaks: "Look, Mom! \\
No \\\\n's!",
  hexadecimal: 0xdecaf,
  leadingDecimalPoint: .8675309, andTrailing: 8675309.,
  positiveSign: +1,
  trailingComma: 'in objects', andIn: ['arrays',],
  "backwardsCompatible": "with JSON",
}`)

  it('reads every string member', () => {
    expect(cfg.getString('unquoted')).toBe('and you can quote me on that')
    expect(cfg.getString('singleQuotes')).toBe('I can use "double quotes" here')
    expect(cfg.getString('lineBreaks')).toBe("Look, Mom! No \\n's!")
    expect(cfg.getString('trailingComma')).toBe('in objects')
    expect(cfg.getString('backwardsCompatible')).toBe('with JSON')
  })

  it('reads the number members', () => {
    expect(cfg.getNumber('hexadecimal')).toBe(0xdecaf)
    expect(cfg.getNumber('leadingDecimalPoint')).toBe(0.8675309)
    expect(cfg.getNumber('andTrailing')).toBe(8675309.0)
    expect(cfg.getNumber('positiveSign')).toBe(1)
  })

  it('reads the trailing-comma array', () => {
    expect(cfg.getList('andIn')).toEqual(['arrays'])
  })
})

// ─── Identifier keys (ES5 IdentifierName) ─────────────────────────────────────

describe('json5 identifier keys', () => {
  it('accepts $, _, digits after the first character, and Unicode letters', () => {
    const cfg = parse5('{a: 1, $b: 2, _c: 3, é: 4, a1: 5}')
    for (const [path, want] of [['a', 1], ['$b', 2], ['_c', 3], ['é', 4], ['a1', 5]] as const) {
      expect(cfg.getNumber(path), path).toBe(want)
    }
  })

  it('honours \\uXXXX escapes inside a key', () => {
    // \u0061 = 'a'; ES5 allows \u escapes inside IdentifierName.
    expect(parse5('{\\u0061\\u0062: 7}').getNumber('ab')).toBe(7)
  })

  it('rejects illegal identifier starts and non-\\u escapes', () => {
    parseErr('{1a: 1}', 'expected an object key')
    // \u0031 = '1' — a legal escape, but not a legal identifier START.
    parseErr('{\\u0031x: 1}', 'not a valid identifier character')
    parseErr('{\\x61: 1}', 'only \\uXXXX escapes')
  })
})

// ─── Strings ──────────────────────────────────────────────────────────────────

describe('json5 strings', () => {
  it('decodes the JSON5 escape set', () => {
    const cfg = parse5(`{
  hex: "\\x41\\x42",
  vtab: "a\\vb",
  nul: "a\\0b",
  self: "\\q\\'\\"",
  astral: "\\uD83D\\uDE00",
}`)
    expect(cfg.getString('hex')).toBe('AB')
    expect(cfg.getString('vtab')).toBe('a\vb')
    expect(cfg.getString('nul')).toBe('a\x00b')
    expect(cfg.getString('self')).toBe('q\'"')
    expect(cfg.getString('astral')).toBe('😀')
  })

  it('treats LF, CRLF, and LS line continuations as nothing', () => {
    const cfg = parse5("{a: 'x\\\ny', b: 'x\\\r\ny', c: 'x\\\u2028y'}")
    for (const path of ['a', 'b', 'c']) {
      expect(cfg.getString(path), path).toBe('xy')
    }
  })

  it('allows unescaped LS/PS inside a string (the ES5 quirk)', () => {
    expect(parse5("{a: 'x\u2028y'}").getString('a')).toBe('x\u2028y')
  })

  it('rejects malformed strings and escapes', () => {
    parseErr("{a: 'x\ny'}", 'unescaped line terminator')
    parseErr("{a: 'oops}", 'unterminated string')
    parseErr("{a: '\\01'}", 'octal escape')
    parseErr("{a: '\\7'}", 'digits cannot be escaped')
    // F3.5: a lone surrogate escape is an error, high or low, paired-wrong or
    // alone.
    parseErr('{a: "\\uD800"}', 'spec F3.5')
    parseErr('{a: "\\uD800\\u0041"}', 'spec F3.5')
    parseErr('{a: "\\uDE00"}', 'spec F3.5')
  })

  // go.hocon's counterpart check rejects invalid UTF-8 bytes, which a
  // JavaScript string cannot contain. Its nearest analogue — a lone surrogate
  // CODE UNIT raw in the source — is host string data here, kept exactly as
  // the jsonc adapter keeps it (the S1.2.6 class, documented under F3.5). Only
  // the \uXXXX escape spelling is refused, above.
  it('keeps a raw lone surrogate code unit in source as data', () => {
    expect(parse5("{a: '\ud800'}").getString('a')).toBe('\ud800')
  })
})

// ─── Numbers ──────────────────────────────────────────────────────────────────

describe('json5 numbers', () => {
  it('reads hex, signs, leading/trailing points, exponents', () => {
    const cfg = parse5(`{
  hex: 0xFF, hexneg: -0x10, hexplus: +0xA,
  min: -0x8000000000000000, max: 0x7FFFFFFFFFFFFFFF,
  lead: .5, trail: 5., plus: +5, exp: 1e3, negzero: -0,
}`)
    expect(cfg.getNumber('hex')).toBe(255)
    expect(cfg.getNumber('hexneg')).toBe(-16)
    expect(cfg.getNumber('hexplus')).toBe(10)
    // int64 min/max are past 2^53, so the digits travel as a bigint and come
    // back exact through getString (the repo's F0.5 convention — same as the
    // jsonc adapter; go's GetInt64 asserts the same values).
    expect(cfg.getString('min')).toBe('-9223372036854775808')
    expect(cfg.getString('max')).toBe('9223372036854775807')
    expect(cfg.getNumber('lead')).toBe(0.5)
    expect(cfg.getNumber('trail')).toBe(5.0)
    expect(cfg.getNumber('plus')).toBe(5)
    expect(cfg.getNumber('exp')).toBe(1000.0)
    // go's int64 model reads -0 as 0; the JS number model has a signed zero
    // and this repo's convention (core parser, fromMap, jsonc) preserves it.
    expect(cfg.getString('negzero')).toBe('-0')
    expect(cfg.getNumber('negzero') === 0).toBe(true)
  })

  it('ingests an integer past the safe range losslessly (F0.5)', () => {
    expect(parse5('{big: 9007199254740993}').getString('big')).toBe('9007199254740993')
    expect(parse5('{big: -9007199254740993}').getString('big')).toBe('-9007199254740993')
    // getNumber still rounds — the JS number model does, and the core parser
    // rounds the same literal identically. The ingest is what must be lossless.
    expect(parse5('{big: 9007199254740993}').getNumber('big')).toBe(9007199254740992)
  })

  it('rejects integers past int64, empty hex, and out-of-range floats', () => {
    // F0.5: integers that do not fit in int64 are errors, not silent floats.
    parseErr('{a: 0x10000000000000000}', 'spec F0.5')
    parseErr('{a: -0x8000000000000001}', 'spec F0.5')
    parseErr('{a: 9223372036854775808}', 'spec F0.5')
    parseErr('{a: 0x}', 'hex literal needs at least one digit')
  })

  it('rejects Infinity and NaN in every spelling (F0.6)', () => {
    for (const lit of ['Infinity', '-Infinity', '+Infinity', 'NaN', '-NaN', '+NaN']) {
      parseErr(`{a: ${lit}}`, 'spec F0.6')
    }
  })

  it('treats identifiers merely starting with Infinity/NaN as ordinary junk', () => {
    // A longer identifier that merely STARTS with those spellings is not the
    // F0.6 case — it errors as an unexpected token / malformed number.
    parseErr('{a: Infinityx}', 'unexpected character')
    parseErr('{a: NaNx}', 'unexpected character')
    parseErr('{a: -Infinityx}', 'malformed number')
  })
})

// ─── Comments, whitespace, structure ──────────────────────────────────────────

describe('json5 comments, whitespace, structure', () => {
  it('accepts both comment forms and JSON5 whitespace (NBSP, EM SPACE, LS)', () => {
    // The LS after "line comment" TERMINATES the // comment — deliberately
    // different from the jsonc dialect, whose owner ends comments at LF/CR
    // only — so `a: 1,` is live content, not comment body.
    const cfg = parse5('{\n  // line comment\u2028 a: 1,\n  /* block\n comment */ b: 2,\u00a0c:\u20033\n}')
    expect(cfg.getNumber('a')).toBe(1)
    expect(cfg.getNumber('b')).toBe(2)
    expect(cfg.getNumber('c')).toBe(3)
  })

  it('PS terminates a // comment too', () => {
    expect(parse5('{// c\u2029a: 1\n}').getNumber('a')).toBe(1)
  })

  it('rejects structural errors with named expectations', () => {
    parseErr('{a: 1} /* open', 'unterminated /* comment')
    parseErr('{a: 1} }', 'unexpected content after top-level value')
    parseErr('{a: 1', 'unterminated object')
    parseErr('[1, 2', 'unterminated array')
    parseErr('[,1]', 'unexpected character')
    parseErr('[1,,2]', 'unexpected character')
    parseErr('{a 1}', "expected ':'")
    parseErr('{a: nullx}', 'unexpected character')
    parseErr('', 'unexpected end of input')
    // F0.3: the root must be an object.
    parseErr('[1, 2]', 'spec F0.3')
    parseErr('"just a string"', 'spec F0.3')
  })

  // Trailing whitespace and comments after the value are fine (only content is
  // an error).
  it('accepts trailing trivia after the top-level value', () => {
    expect(parse5('{a: 1} // done\n/* and a block */\n\n').getNumber('a')).toBe(1)
  })
})

// ─── Duplicate keys (spec F0.7) ───────────────────────────────────────────────

describe('json5 duplicate keys follow HOCON semantics (F0.7)', () => {
  it('deep-merges two objects', () => {
    const cfg = parse5('{a: {x: 1, shared: {p: 1}}, a: {y: 2, shared: {q: 2}}}')
    expect(cfg.getNumber('a.x')).toBe(1)
    expect(cfg.getNumber('a.y')).toBe(2)
    expect(cfg.getNumber('a.shared.p')).toBe(1)
    expect(cfg.getNumber('a.shared.q')).toBe(2)
  })

  it('is last-wins for anything else', () => {
    expect(parse5('{a: 1, a: 2}').getNumber('a')).toBe(2)
    expect(parse5('{a: {x: 1}, a: 2}').getNumber('a')).toBe(2)
  })
})

// ─── BOM (spec F0.9) ──────────────────────────────────────────────────────────

describe('json5 BOM handling', () => {
  it('strips a leading BOM and treats an interior U+FEFF as whitespace', () => {
    expect(parseJson5('\ufeff{a: \ufeff1}', 'test.json5').getNumber('a')).toBe(1)
  })
})

// ─── ts-specific hardening (repo conventions, not in the go battery) ─────────

describe('json5 ts-specific hardening', () => {
  // F2.9 principle: safety by construction, never by dropping keys. The
  // object carrier is null-prototype, so `__proto__` lands as an own property.
  it('preserves a __proto__ key without polluting prototypes', () => {
    const cfg = parse5('{__proto__: {x: 1}, safe: 2}')
    expect(cfg.keys().sort()).toEqual(['__proto__', 'safe'])
    expect(cfg.getNumber('__proto__.x')).toBe(1)
    expect(({} as { x?: unknown }).x).toBeUndefined()
  })

  // The hand-rolled parser recurses once per level, so the depth guard has to
  // wrap it — same contract as the other adapters (#177).
  it('reports a too-deep document as a ConfigError', () => {
    expect(parse5(`${'{a:'.repeat(100)}1${'}'.repeat(100)}`).has('a')).toBe(true)
    expect(() => parse5(`${'{a:'.repeat(50000)}1${'}'.repeat(50000)}`)).toThrow(ConfigError)
  })
})

// ─── Merge with a HOCON document (the adapter's purpose) ─────────────────────

describe('json5 as a substitution source under HOCON', () => {
  it('resolves ${...} through withFallback into the json5 layer', () => {
    const base = parseJson5("{db: {host: 'localhost', port: 5432}}", 'base.json5')
    const cfg = parseStringWithOptions('db { host = db.example.com }\nurl = ${db.host}', {
      resolveSubstitutions: false,
    })
    const merged = cfg.withFallback(base).resolve()
    expect(merged.getString('db.host')).toBe('db.example.com')
    expect(merged.getNumber('db.port')).toBe(5432)
    expect(merged.getString('url')).toBe('db.example.com')
  })
})

// ─── Origin naming ────────────────────────────────────────────────────────────

describe('json5 origin naming', () => {
  // The adapters read text rather than paths (the repo convention — see the
  // properties adapter's doc), so go's ParseFile test becomes: read the file,
  // pass its path as the origin, and the error must name it.
  it('names the source file in errors when the path is the origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-hocon-json5-'))
    const path = join(dir, 'conf.json5')
    writeFileSync(path, '{a: [}')
    expect(() => parseJson5(readFileSync(path, 'utf-8'), path)).toThrow('conf.json5')
  })

  it('falls back to "document" with no origin', () => {
    expect(() => parseJson5('{a: [}')).toThrow('json5: document:')
  })
})

it('S: -0x0 preserves the sign like decimal -0 (Copilot review pin)', () => {
  const cfg = parseJson5('{a: -0x0}')
  expect(Object.is((cfg.toObject() as Record<string, unknown>).a, -0)).toBe(true)
})

// ── codecov patch-coverage pins (branches the ported battery missed) ─────────

it('S: whitespace forms TAB/VT/FF separate tokens', () => {
  expect(parseJson5('{a:\t1,\u000bb:\u000c2}').toObject()).toEqual({ a: 1, b: 2 })
})

it('S: bare true/false/null values', () => {
  expect(parseJson5('{t: true, f: false, n: null}').toObject()).toEqual({ t: true, f: false, n: null })
})

it('S: missing separator errors in objects and arrays', () => {
  expect(() => parseJson5('{a: 1 b: 2}')).toThrow(/expected ',' or '}'/)
  expect(() => parseJson5('[1 2]')).toThrow(/expected ',' or ']'/)
})

it('S: invalid \\u quad is rejected', () => {
  expect(() => parseJson5('{a: "\\uZZZZ"}')).toThrow(/invalid \\u escape/)
})

it('S: the single-character escape set decodes', () => {
  const cfg = parseJson5(`{a: "\\n\\t\\r\\b\\f"}`)
  expect((cfg.toObject() as Record<string, unknown>).a).toBe('\n\t\r\b\f')
})

it('S: digit escapes \\1–\\9 are rejected', () => {
  for (const d of ['1', '5', '9']) {
    expect(() => parseJson5(`{a: "\\${d}"}`)).toThrow(/digits cannot be escaped/)
  }
})

it('S: a plain BMP \\u escape decodes', () => {
  expect((parseJson5('{a: "\\u0041"}').toObject() as Record<string, unknown>).a).toBe('A')
})

it('S: float overflow is malformed, not Infinity', () => {
  expect(() => parseJson5('{a: 1e999}')).toThrow(/malformed number/)
})
