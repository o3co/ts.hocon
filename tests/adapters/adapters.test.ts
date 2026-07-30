import { describe, it, expect, vi } from 'vitest'
import { parseStringWithOptions } from '../../src/index.js'
import { parsePropertiesConfig } from '../../src/adapters/properties.js'
import { loadEnv, parseDotEnv } from '../../src/adapters/env.js'
import { parseJsonc, stripComments } from '../../src/adapters/jsonc.js'
import { parseTomlConfig } from '../../src/adapters/toml.js'
import { parseYaml } from '../../src/adapters/yaml.js'

describe('properties adapter', () => {
  it('nests dotted keys and shares the include syntax layer', () => {
    const cfg = parsePropertiesConfig('db.host = db.internal\ndb.port = 5432\na = one\\\ntwo\n')
    expect(cfg.getString('db.host')).toBe('db.internal')
    expect(cfg.getString('a')).toBe('onetwo')
  })

  it('leaves ${...} literal (F0.2)', () => {
    expect(parsePropertiesConfig('a = ${foo.bar}').getString('a')).toBe('${foo.bar}')
  })
})

describe('env adapter', () => {
  const env = {
    APP_DB__HOST: 'db.internal',
    APP_DB__MAX_CONN: '10',
    APP_NAME: 'svc',
    PATH: '/usr/bin',
  }

  it('mounts a prefixed namespace, __ as separator, lowercased (F1.2/F1.3)', () => {
    const cfg = loadEnv({ prefix: 'APP_', env })
    expect(cfg.getString('db.host')).toBe('db.internal')
    expect(cfg.getString('db.max_conn')).toBe('10')
    expect(cfg.getString('name')).toBe('svc')
    expect(cfg.has('path')).toBe(false)
  })

  it('requires a prefix (F1.1)', () => {
    expect(() => loadEnv({ env })).toThrow(/F1\.1/)
  })

  it('refuses a collision, the environment having no order (F1.6)', () => {
    expect(() => loadEnv({ prefix: 'APP_', env: { APP_A__B: '1', APP_a__b: '2' } })).toThrow(/both map to/)
  })

  it('reads a .env file in the small dialect (F1.7)', () => {
    const cfg = parseDotEnv([
      '# comment',
      'export FOO=bar',
      'DB__HOST=db.internal',
      'QUOTED="a\\nb"',
      "SINGLE='raw ${x} #hash'",
      'HASH=#fff',
    ].join('\n'))
    expect(cfg.getString('foo')).toBe('bar')
    expect(cfg.getString('db.host')).toBe('db.internal')
    expect(cfg.getString('quoted')).toBe('a\nb')
    expect(cfg.getString('single')).toBe('raw ${x} #hash')
    expect(cfg.getString('hash')).toBe('#fff')
  })

  it('refuses an ambiguous trailing # rather than guessing (F1.7)', () => {
    expect(() => parseDotEnv('FOO=bar # comment')).toThrow(/quote the value/)
  })

  // F1.2: only `__` creates hierarchy. A literal dot in a variable name is key
  // text, so the path has to travel as a segment list — joining on "." and
  // re-splitting manufactures a boundary the environment never had.
  it('keeps a literal dot in a name as key text, not a path boundary (F1.2)', () => {
    const cfg = loadEnv({ prefix: 'APP_', env: { 'APP_FOO.BAR': 'v' } })
    expect(cfg.keys()).toEqual(['foo.bar'])
    expect(cfg.getString('"foo.bar"')).toBe('v')
    expect(cfg.has('foo')).toBe(false)
  })

  it('lets the literal-dot and __ spellings coexist (F1.2/F1.6)', () => {
    const cfg = loadEnv({ prefix: 'APP_', env: { 'APP_FOO.BAR': 'dotted', APP_FOO__BAR: 'nested' } })
    expect(cfg.getString('"foo.bar"')).toBe('dotted')
    expect(cfg.getString('foo.bar')).toBe('nested')
  })

  it('a .env file gets the same treatment (F1.2)', () => {
    const cfg = parseDotEnv('FOO.BAR=dotted\nFOO__BAR=nested\n')
    expect(cfg.getString('"foo.bar"')).toBe('dotted')
    expect(cfg.getString('foo.bar')).toBe('nested')
  })

  // F1.3: ASCII-only case folding. JS's full Unicode lowercasing turns İ
  // (U+0130) into "i" + U+0307 while Go's simple mapping produces plain "i" —
  // which decides whether APP_İ collides with APP_I under F1.6. Pinning the
  // mapping is what keeps the four implementations agreeing.
  it('lowercases ASCII only, leaving other codepoints alone (F1.3)', () => {
    expect(loadEnv({ prefix: 'APP_', env: { 'APP_İ': 'x' } }).keys()).toEqual(['İ'])
    expect(loadEnv({ prefix: 'APP_', env: { APP_MiXeD__KeY: 'x' } }).keys()).toEqual(['mixed'])
    // …so it does not collide with the ASCII I, which would be nondeterministic.
    const both = loadEnv({ prefix: 'APP_', env: { 'APP_İ': 'dotted', APP_I: 'ascii' } })
    expect(both.getString('"İ"')).toBe('dotted')
    expect(both.getString('i')).toBe('ascii')
  })

  // F2.9: no key denylist — these are ordinary variable names, and dropping
  // them is data loss. Safety comes from how the tree is built. (`__proto__`
  // itself cannot be spelled as an env segment, `__` being the separator; the
  // properties adapter covers that one.)
  it('preserves constructor / prototype names (F2.9)', () => {
    const cfg = loadEnv({
      prefix: 'APP_',
      env: { APP_CONSTRUCTOR__Y: 'b', APP_PROTOTYPE: 'c' },
    })
    expect(cfg.getString('constructor.y')).toBe('b')
    expect(cfg.getString('prototype')).toBe('c')
  })
})

describe('jsonc adapter', () => {
  it('accepts comments and trailing commas', () => {
    const cfg = parseJsonc(`{
      // line
      "a": 1, /* block */
      "b": [1, 2,],
      "c": { "d": true, },
    }`)
    expect(cfg.getNumber('a')).toBe(1)
    expect(cfg.getBoolean('c.d')).toBe(true)
  })

  it('leaves comment markers inside strings alone', () => {
    const cfg = parseJsonc('{"url": "https://example.com/a//b", "note": "a /* b */ c"}')
    expect(cfg.getString('url')).toBe('https://example.com/a//b')
    expect(cfg.getString('note')).toBe('a /* b */ c')
  })

  it('refuses a non-object root (F0.3)', () => {
    expect(() => parseJsonc('[1, 2]')).toThrow(/F0\.3/)
  })

  // F3.2: a comment is replaced by whitespace, never the empty string — a
  // comment between two token halves must not weld them into one token.
  it('a block comment separates tokens rather than joining them (F3.2)', () => {
    expect(() => parseJsonc('{"a":1/*x*/2}')).toThrow()
    expect(() => parseJsonc('{"a":tr/*x*/ue}')).toThrow()
  })

  // A `//` comment must end at ANY line terminator, not just LF. Ending only at
  // LF makes a CR-terminated comment swallow the rest of the line — and the
  // trailing-comma stripper then tidies the wreckage into valid JSON, so keys
  // disappear with no error at all. This is the same shape as the
  // gurkankaymak/hocon bug that motivated this project's library-preference
  // rule, and py.hocon was found with it too.
  it('a // comment ends at CR and CRLF, not only LF (F3.2)', () => {
    expect(parseJsonc('{"a":1,//c\r"b":2,\n"c":3}').toObject()).toEqual({ a: 1, b: 2, c: 3 })
    expect(parseJsonc('{"a":1,//c\r\n"b":2}').toObject()).toEqual({ a: 1, b: 2 })
    // A CR-only document whose comment runs to EOF is still just a comment.
    expect(parseJsonc('{"a":1}//trailing\r').toObject()).toEqual({ a: 1 })
  })

  // …and at nothing else. U+2028/U+2029 are line breaks to ECMAScript and to
  // most editors, but not to node-jsonc-parser, which defines this dialect and
  // is what VS Code reads its own config with: a `//` comment there runs THROUGH
  // a U+2028 to the next real break. Ending early would make the same file mean
  // different things in the editor that owns the format and in this library —
  // a cross-implementation divergence in data, not diagnostics. go.hocon,
  // py.hocon and rs.hocon all scan for LF/CR alone (F3.2).
  it('a // comment runs through U+2028/U+2029 to the next real break (F3.2)', () => {
    // "b":2 is comment body here, exactly as VS Code reads it.
    expect(parseJsonc('{"a":1, // note\u2028"b":2,\n "c":3}').toObject()).toEqual({ a: 1, c: 3 })
    expect(parseJsonc('{"a":1, // note\u2029"b":2,\n "c":3}').toObject()).toEqual({ a: 1, c: 3 })
    // With no later break the comment reaches EOF, so the document is truncated
    // and rejected — not silently reinterpreted.
    expect(() => parseJsonc('{"a":1,//c\u2028"b":2}')).toThrow()
  })

  it('keeps a // marker inside a string with a CR nearby', () => {
    expect(parseJsonc('{"u":"http://x/y",\r"b":2}').toObject()).toEqual({ u: 'http://x/y', b: 2 })
  })

  // F0.5: `Number`-only decoding is the forbidden case — an integer literal
  // past 2^53 must reach the value model through its source text.
  it('ingests an integer past the safe range losslessly (F0.5)', () => {
    expect(parseJsonc('{"big": 9007199254740993}').getString('big')).toBe('9007199254740993')
    expect(parseJsonc('{"big": -9007199254740993}').getString('big')).toBe('-9007199254740993')
    // getNumber still rounds — the JS number model does, and the core parser
    // rounds the same literal identically. The ingest is what must be lossless.
    expect(parseJsonc('{"big": 9007199254740993}').getNumber('big')).toBe(9007199254740992)
  })

  it('refuses an integer beyond int64 (F0.5 overflow = error)', () => {
    expect(() => parseJsonc('{"huge": 9223372036854775808}')).toThrow(/int64/)
  })

  // F0.5 again: a silent fall back to the rounded double IS the forbidden case,
  // so on a runtime without source-text access the document is refused rather
  // than mangled. Simulated by dropping the reviver's third argument.
  it('refuses, rather than rounds, when the runtime hides JSON.parse source text (F0.5)', () => {
    const real = JSON.parse.bind(JSON)
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(((text: string, reviver?: unknown) =>
      real(text, reviver === undefined
        ? undefined
        : function (this: unknown, k: string, v: unknown) {
            return (reviver as (this: unknown, k: string, v: unknown) => unknown).call(this, k, v)
          })) as typeof JSON.parse)
    try {
      expect(() => parseJsonc('{"id": 9007199254740993}')).toThrow(/losslessly|source text/)
      // A document without an oversized integer still parses on such a runtime.
      expect(parseJsonc('{"id": 42, "f": 1.5}').getNumber('id')).toBe(42)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps the sign of -0, as the core parser does', () => {
    expect(parseJsonc('{"z": -0}').getString('z')).toBe('-0')
    expect(parseStringWithOptions('z = -0', {}).getString('z')).toBe('-0')
  })

  it('leaves floats and safe integers alone', () => {
    const cfg = parseJsonc('{"f": 1.5, "n": 42, "neg": -7, "exp": 1e3, "big_float": 9007199254740993.5}')
    expect(cfg.getNumber('f')).toBe(1.5)
    expect(cfg.getString('f')).toBe('1.5')
    expect(cfg.getNumber('n')).toBe(42)
    expect(cfg.getNumber('neg')).toBe(-7)
    expect(cfg.getNumber('exp')).toBe(1000)
    expect(cfg.getNumber('big_float')).toBe(9007199254740994)
  })

  // The lossless path depends on the reviver's third argument, standard since
  // Node 22 (the package's minimum). Asserted directly so a regression in the
  // runtime is not mistaken for a bug in the adapter.
  it('the runtime exposes JSON.parse reviver source text (node >= 22)', () => {
    let source: unknown
    JSON.parse('{"a": 9007199254740993}', function (key, value, context?: { source?: string }) {
      if (key === 'a') source = context?.source
      return value as unknown
    } as (this: unknown, key: string, value: unknown) => unknown)
    expect(source).toBe('9007199254740993')
  })

  it('keeps newlines inside a block comment for line positions (F3.2)', () => {
    // The dangling comma after the removed span is a syntax error whose
    // reported line must still be 3, not collapsed onto line 1.
    expect(() => parseJsonc('{"a": 1, /* spans\ntwo lines */\n,}')).toThrow(/line 3/)
  })

  // The invariant is that the stripped text keeps the source's line structure,
  // as JSON.parse counts it: LF, CR and CRLF (one break, not two) are all line
  // breaks to V8, so a removed span must give each of them back in its own
  // spelling.
  //
  // The trailing `,}` is the error: V8 reports a line number for that form, and
  // it sits on the source's line 4 in the first two cases below.
  it('reports the source line after a CR- or CRLF-delimited comment (F3.2)', () => {
    expect(() => parseJsonc('{"a": 1,\r/* c\rc2 */\r,}')).toThrow(/line 4/)
    expect(() => parseJsonc('{"a": 1,\r\n/* c\r\nc2 */\r\n,}')).toThrow(/line 4/)
    // A line comment's own terminator counts the same way.
    expect(() => parseJsonc('{"a": 1,//c\r,}')).toThrow(/line 2/)
  })

  // A U+2028 inside a comment is body text, not a break, so it adds no line —
  // and it must never be emitted into the stripped output either, V8 refusing it
  // between tokens as a non-whitespace character.
  it('counts no line for a U+2028 inside a block comment (F3.2)', () => {
    expect(() => parseJsonc('{"a": 1,\n/* c\u2028c2 */\n,}')).toThrow(/line 3/)
    expect(stripComments('{"a": 1,/* c\u2028c2 */}')).not.toContain('\u2028')
  })

  it('does not turn a CRLF inside a comment into two lines', () => {
    // Copying both characters of each break separately would report line 5.
    expect(() => parseJsonc('{"a": 1,/* x\r\ny\r\nz */,}')).toThrow(/line 3/)
  })

  it('still separates tokens when a comment has no line break at all', () => {
    expect(parseJsonc('{"a": 1/* c */, "b": 2}').getNumber('b')).toBe(2)
    expect(() => parseJsonc('{"a":1/* c */2}')).toThrow()
  })
})

describe('toml adapter', () => {
  it('maps scalars, tables and arrays of tables', () => {
    const cfg = parseTomlConfig(`
name = "svc"
port = 8080
[db]
host = "localhost"
[[db.replicas]]
id = 1
[[db.replicas]]
id = 2
`)
    expect(cfg.getString('name')).toBe('svc')
    expect(cfg.getNumber('port')).toBe(8080)
    expect(cfg.getString('db.host')).toBe('localhost')
    expect(cfg.getList('db.replicas')).toEqual([{ id: 1 }, { id: 2 }])
  })

  // F4.2 — and the fractional part keeps the source's precision rather than
  // the library's: smol-toml always writes milliseconds, so a bare 07:32:00
  // would otherwise come back as 07:32:00.000 and disagree with the other
  // implementations. Caught by the shared fixtures, not by this test.
  it('renders all four date-time types as strings (F4.2)', () => {
    const cfg = parseTomlConfig(
      'a = 1979-05-27T07:32:00Z\nb = 1979-05-27\nc = 07:32:00\nd = 07:32:00.500\n',
    )
    expect(cfg.getString('a')).toBe('1979-05-27T07:32:00Z')
    expect(cfg.getString('b')).toBe('1979-05-27')
    expect(cfg.getString('c')).toBe('07:32:00')
    expect(cfg.getString('d')).toBe('07:32:00.5')
  })

  it('refuses infinity (F0.6)', () => {
    expect(() => parseTomlConfig('a = inf')).toThrow(/F0\.6/)
  })
  // F2.9's principle — safety by construction, never by dropping keys —
  // applies to every adapter, not only the two the item names. smol-toml hands
  // over an own `__proto__` property; the loss was ours, in a `{}` carrier
  // written through [[Set]].
  it('preserves a __proto__ table (F2.9 principle)', () => {
    const cfg = parseTomlConfig('normal = 1\n[a.__proto__]\nx = 1\n')
    expect(cfg.getNumber('normal')).toBe(1)
    expect(cfg.getNumber('a.__proto__.x')).toBe(1)
    const obj = cfg.toObject() as { a: Record<string, unknown> }
    expect(Object.getOwnPropertyDescriptor(obj.a, '__proto__')?.value).toEqual({ x: 1 })
    expect(({} as { x?: unknown }).x).toBeUndefined()
  })
})

describe('yaml adapter', () => {
  it('maps scalars, mappings and sequences', () => {
    const cfg = parseYaml('name: svc\nport: 8080\ntags: [a, b]\ndb:\n  host: localhost\n')
    expect(cfg.getString('name')).toBe('svc')
    expect(cfg.getNumber('port')).toBe(8080)
    expect(cfg.getList('tags')).toEqual(['a', 'b'])
    expect(cfg.getString('db.host')).toBe('localhost')
  })

  // F5.1 — the Norway problem does not arise under the 1.2 core schema.
  it('keeps no/yes/on/off as strings', () => {
    const cfg = parseYaml('no: no\nyes: yes\non: on\noff: off\nreal: true\n')
    for (const k of ['no', 'yes', 'on', 'off']) expect(cfg.getString(`"${k}"`)).toBe(k)
    expect(cfg.getBoolean('real')).toBe(true)
  })

  it('resolves anchors, aliases and merge keys (F5.2)', () => {
    const cfg = parseYaml('d: &d\n  host: h\n  port: 1\np:\n  <<: *d\n  port: 2\n')
    expect(cfg.getString('p.host')).toBe('h')
    expect(cfg.getNumber('p.port')).toBe(2)
  })

  it('refuses a multi-document stream (F5.7)', () => {
    expect(() => parseYaml('a: 1\n---\nb: 2\n')).toThrow(/F5\.7/)
  })

  it('treats an empty document as the empty object (F5.9)', () => {
    expect(parseYaml('').keys()).toEqual([])
  })

  it('refuses NaN and a sequence root', () => {
    expect(() => parseYaml('a: .nan')).toThrow()
    expect(() => parseYaml('- 1\n- 2')).toThrow(/F0\.3/)
  })

  // F0.5, same rule as the JSONC adapter: decoding into a JS number only would
  // silently round 9007199254740993 down to ...992.
  it('ingests an integer past the safe range losslessly (F0.5)', () => {
    expect(parseYaml('big: 9007199254740993').getString('big')).toBe('9007199254740993')
    expect(parseYaml('big: -9007199254740993').getString('big')).toBe('-9007199254740993')
  })

  it('refuses an integer beyond int64 (F0.5 overflow = error)', () => {
    expect(() => parseYaml('huge: 9223372036854775808')).toThrow(/int64/)
  })

  it('leaves floats and safe integers as plain numbers', () => {
    const cfg = parseYaml('f: 1.5\nn: 42\nneg: -7\nlist: [1, 2]\n')
    expect(cfg.getNumber('f')).toBe(1.5)
    expect(cfg.getString('f')).toBe('1.5')
    expect(cfg.getNumber('n')).toBe(42)
    expect(cfg.getNumber('neg')).toBe(-7)
    expect(cfg.getList('list')).toEqual([1, 2])
    expect(cfg.toObject()).toEqual({ f: 1.5, n: 42, neg: -7, list: [1, 2] })
  })

  // F5.5 — !!binary keeps its base64 text. The conversion used to spread the
  // bytes into String.fromCharCode, which blows the argument limit somewhere
  // around a megabyte: a config with an embedded certificate or image threw
  // RangeError instead of parsing. The fixture is generated here rather than
  // committed, a 1 MiB blob having no business in the repo.
  it('converts a 1 MiB !!binary scalar without a RangeError (F5.5)', () => {
    const bytes = new Uint8Array(1024 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const base64 = Buffer.from(bytes).toString('base64')
    // yaml wraps long !!binary scalars; a folded block scalar is how the
    // library itself emits them.
    const wrapped = (base64.match(/.{1,76}/g) ?? []).join('\n  ')
    const cfg = parseYaml(`blob: !!binary |\n  ${wrapped}\n`)
    expect(cfg.getString('blob')).toBe(base64)
  })

  it('converts a small !!binary scalar to its base64 text (F5.5)', () => {
    expect(parseYaml('blob: !!binary aGk=').getString('blob')).toBe('aGk=')
  })

  // The yaml library's toJS gives us an own `__proto__` property; dropping it
  // was our doing. Covers both input shapes of the public injection point.
  it('preserves a __proto__ key, including via fromYamlValue (F2.9 principle)', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    const cfg = parseYaml('__proto__:\n  polluted: true\nsafe: 1\n')
    expect(cfg.keys().sort()).toEqual(['__proto__', 'safe'])
    expect(cfg.getBoolean('__proto__.polluted')).toBe(true)
    const obj = cfg.toObject() as Record<string, unknown>
    expect(Object.getOwnPropertyDescriptor(obj, '__proto__')?.value).toEqual({ polluted: true })

    // injected plain-object tree
    const injected = fromYamlValue(JSON.parse('{"__proto__": {"x": 1}, "safe": 2}'))
    expect(injected.keys().sort()).toEqual(['__proto__', 'safe'])
    // injected Map tree (eemeli's mapAsMap shape)
    const viaMap = fromYamlValue(new Map<unknown, unknown>([['__proto__', 'v'], ['safe', 2]]))
    expect(viaMap.getString('__proto__')).toBe('v')

    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('normalizes a bigint in an injected tree too (F0.5)', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    expect(fromYamlValue({ big: 9007199254740993n }).getString('big')).toBe('9007199254740993')
    expect(fromYamlValue({ n: 42n }).getNumber('n')).toBe(42)
    expect(() => fromYamlValue({ huge: 9223372036854775808n })).toThrow(/int64/)
  })

  // F5.3 — two source keys with one string form used to be last-wins, and the
  // loser's value was gone with nothing to show for it. Which forms actually
  // coincide is the library's business (`1.0` resolves to the number 1 here, so
  // it does *not* meet the string "1.0"); what this pins is that a coincidence
  // is an error rather than a silent loss.
  it.each([
    ['int and string', "1: a\n'1': b\n", '"1"'],
    ['string and int', "'1': b\n1: a\n", '"1"'],
    ['null and "null"', "~: a\n'null': b\n", '"null"'],
    ['bool and "true"', "true: a\n'true': b\n", '"true"'],
    ['hex and its decimal string', "0x10: a\n'16': b\n", '"16"'],
  ])('refuses sibling keys that coincide — %s (F5.3)', (_name, src, key) => {
    expect(() => parseYaml(src)).toThrow(/F5\.3/)
    expect(() => parseYaml(src)).toThrow(new RegExp(`both give the key ${key}`))
  })

  it('reports the path of a nested collision (F5.3)', () => {
    expect(() => parseYaml("outer:\n  1: a\n  '1': b\n")).toThrow(/at "outer"/)
  })

  // The other half: a key that only *looks* like it might collide still parses,
  // and a non-string scalar key keeps its string form.
  it('stringifies lone non-string keys instead of refusing them (F5.3)', () => {
    expect(parseYaml('1: a\n').getString('"1"')).toBe('a')
    expect(parseYaml('~: a\n').getString('"null"')).toBe('a')
    expect(parseYaml('true: a\n').getString('"true"')).toBe('a')
  })

  // A null key used to reach the config as "" — the object form of toJS spells
  // it that way — where go.hocon, rs.hocon and py.hocon all produce "null".
  it('spells a null key "null", as the sibling implementations do (F5.3)', () => {
    expect(parseYaml('~: a\n').keys()).toEqual(['null'])
  })

  it('detects a collision in an injected Map tree too (F5.3)', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    expect(() => fromYamlValue(new Map<unknown, unknown>([[1, 'a'], ['1', 'b']]))).toThrow(/F5\.3/)
    // A Map whose keys have distinct string forms is still fine.
    expect(fromYamlValue(new Map<unknown, unknown>([[1, 'a'], [2, 'b']])).keys().sort()).toEqual([
      '1',
      '2',
    ])
  })
})

describe('use as a substitution source under HOCON', () => {
  it('resolves ${...} against a YAML fallback', () => {
    const base = parseYaml('services:\n  db:\n    image: postgres:16\n')
    const cfg = parseStringWithOptions('image = ${services.db.image}', { resolveSubstitutions: false })
    expect(cfg.withFallback(base).resolve().getString('image')).toBe('postgres:16')
  })
})

describe('yaml fromYamlValue — bring your own parser', () => {
  it('accepts a tree decoded by another library', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    const jsy = (await import('js-yaml')).default
    const cfg = fromYamlValue(jsy.load('db:\n  host: h\n  port: 5432\n'), 'via-js-yaml')
    expect(cfg.getString('db.host')).toBe('h')
    expect(cfg.getNumber('db.port')).toBe(5432)
  })

  it('normalizes Date and Map leaves from foreign trees', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    const cfg = fromYamlValue({
      at: new Date(Date.UTC(2002, 11, 14)),
      m: new Map<unknown, unknown>([[1, 'one'], [true, 'yes-key']]),
    })
    expect(cfg.getString('at')).toBe('2002-12-14T00:00:00.000Z')
    expect(cfg.getString('m."1"')).toBe('one')
    expect(cfg.getString('m."true"')).toBe('yes-key')
  })

  it('still refuses NaN and non-object roots from injected trees', async () => {
    const { fromYamlValue } = await import('../../src/adapters/yaml.js')
    expect(() => fromYamlValue({ a: Number.NaN })).toThrow(/F0\.6/)
    expect(() => fromYamlValue([1, 2])).toThrow(/F0\.3/)
  })
})
