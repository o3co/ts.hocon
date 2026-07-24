import { describe, it, expect } from 'vitest'
import { parseStringWithOptions } from '../../src/index.js'
import { parsePropertiesConfig } from '../../src/adapters/properties.js'
import { loadEnv, parseDotEnv } from '../../src/adapters/env.js'
import { parseJsonc } from '../../src/adapters/jsonc.js'
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
