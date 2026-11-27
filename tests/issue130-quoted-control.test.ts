/**
 * xx.hocon#130 — S1.2.4: a raw C0 control character (U+0000–U+001F) inside a
 * double-quoted string is a parse error, as in JSON and Lightbend. The lexer
 * rejected only LF; tab, CR, U+0001, U+001F and NUL were accepted in value,
 * key, substitution-path and include position. Triple-quoted (S9.1) and
 * unquoted (S8.8) strings keep controls verbatim, and DEL / C1 are legal.
 *
 * The emitter half (E18 decision 5) is in render-hocon.test.ts.
 *
 * Fixtures (xx.hocon, fetched by `make testdata`):
 *   tests/lightbend/testdata/hocon/quoted-control/qc01-qc12
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ParseError } from '../src/errors.js'
import { parse } from '../src/index.js'

const qcDir = fileURLToPath(new URL('./lightbend/testdata/hocon/quoted-control', import.meta.url))
const qcExpectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/quoted-control', import.meta.url))

const readConf = (name: string) => readFileSync(join(qcDir, `${name}.conf`), 'utf-8')
const readExpected = (name: string) => JSON.parse(readFileSync(join(qcExpectedDir, `${name}-expected.json`), 'utf-8'))

const hex4 = (code: number) => code.toString(16).padStart(4, '0')

describe('S1.2.4 — raw C0 control inside a quoted string (xx.hocon#130)', () => {
  for (let code = 0; code < 0x20; code++) {
    if (code === 0x0a) continue // reported as an unterminated string, pinned elsewhere
    it(`U+${hex4(code).toUpperCase()} in a quoted value is rejected`, () => {
      const src = `a = "x${String.fromCharCode(code)}y"\n`
      expect(() => parse(src)).toThrow(
        `unescaped control character U+${hex4(code).toUpperCase()} in quoted string; use a backslash escape (\\u${hex4(code)})`,
      )
    })
  }

  const positions: Record<string, string> = {
    key: '"a\tb" = 1\n',
    'dotted-key-segment': 'a."b\x01" = 1\n',
    'quoted-dotted-key': '"a"."b\tc" = 1\n',
    'space-joined-key': 'a "b\tc" = 1\n',
    'adjacent-key': 'a"b\tc" = 1\n',
    'numeric-tail-key': '123abc."x\t= 1\n',
    'nested-key': 'o { "a\tb" = 1 }\n',
    'array-element': 'a = ["x\x00"]\n',
    // The key exists (written with an escape), so only the lexer can fail.
    'subst-path': '"x\\t" = 1\na = ${"x\t"}\n',
    'optional-subst': 'a = ${?"x\x1f"}\n',
    concat: 'a = foo "x\x01" bar\n',
    append: 'a = [1]\na += "x\ty"\n',
    include: 'include "x\ty"\n',
    'include-required': 'include required("x\ty")\n',
    'include-file': 'include file("x\ty")\n',
    'include-package-id': 'include package("p\tq", "f.conf")\n',
    'include-package-file': 'include package("p", "f\td.conf")\n',
    'include-nested': 'a { include "x\ty" }\n',
  }
  for (const [name, src] of Object.entries(positions)) {
    it(`${name} position is rejected with the control-character error`, () => {
      expect(() => parse(src)).toThrow(/^unescaped control character U\+00[01][0-9A-F] in quoted string/)
    })
  }

  it('subst-path guard: with the tab escaped in the path too, it resolves', () => {
    expect(parse('"x\\t" = 1\na = ${"x\\t"}\n').getNumber('a')).toBe(1)
  })

  it('covers all 18 positions', () => {
    expect(Object.keys(positions)).toHaveLength(18)
  })

  it('the error points at the control character, not the opening quote', () => {
    let err: unknown
    try {
      parse('k = 1\na = "xy\tz"\n')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ParseError)
    expect((err as ParseError).line).toBe(2)
    expect((err as ParseError).col).toBe(8)
  })

  const legal: ReadonlyArray<readonly [string, string, string]> = [
    ['escaped', 'a = "x\\u0000\\u0001\\t\\u001fy"\n', 'x\x00\x01\t\x1fy'],
    ['del-c1', 'a = "x\x7f\u0085\u009fy"\n', 'x\x7f\u0085\u009fy'],
    ['triple-quoted', 'a = """x\x00\x01\t\r\x1fy"""\n', 'x\x00\x01\t\r\x1fy'],
    ['unquoted', 'a = x\x01y\x00z\n', 'x\x01y\x00z'],
  ]
  for (const [name, src, want] of legal) {
    it(`${name}: control characters outside double quotes stay legal`, () => {
      expect(parse(src).getString('a')).toBe(want)
    })
  }
})

describe('xx.hocon#130 fixture conformance (qc01-qc12)', () => {
  // Auto-discovered from the fetched corpus, as in issue68-path-empty-segment.
  const names = existsSync(qcDir)
    ? readdirSync(qcDir).filter(f => f.endsWith('.conf')).map(f => f.slice(0, -'.conf'.length)).sort()
    : []
  const errorNames = names.filter(n => existsSync(join(qcExpectedDir, `${n}.error`)))
  const successNames = names.filter(n => existsSync(join(qcExpectedDir, `${n}-expected.json`)))

  it('discovered the fixtures (testdata present)', () => {
    expect(errorNames.length).toBeGreaterThanOrEqual(8)
    expect(successNames.length).toBeGreaterThanOrEqual(4)
    expect(errorNames.length + successNames.length).toBe(names.length)
  })

  for (const name of errorNames) {
    it(`${name}: rejected (.error sidecar)`, () => {
      expect(() => parse(readConf(name))).toThrow(/unescaped control character/)
    })
  }

  for (const name of successNames) {
    it(`${name}: parses to expected JSON`, () => {
      expect(parse(readConf(name)).toObject()).toEqual(readExpected(name))
    })
  }
})
