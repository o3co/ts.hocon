// tests/parse.test.ts
import { describe, it, expect } from 'vitest'
import { parse, parseAsync, parseFile, parseFileAsync } from '../src/parse.js'
import { ParseError, ResolveError } from '../src/errors.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('parse()', () => {
  it('parses basic config', () => {
    const c = parse('server { host = "localhost"\nport = 8080 }')
    expect(c.getString('server.host')).toBe('localhost')
    expect(c.getNumber('server.port')).toBe(8080)
  })

  it('resolves substitutions end-to-end', () => {
    const c = parse('base = "hello"\ngreeting = ${base}" world"')
    expect(c.getString('greeting')).toBe('hello world')
  })

  it('uses env option for substitution fallback', () => {
    const c = parse('val = ${MY_ENV}', { env: { MY_ENV: 'from-env' } })
    expect(c.getString('val')).toBe('from-env')
  })

  it('uses process.env as default env', () => {
    process.env['HOCON_TEST_VAR'] = 'test-value'
    const c = parse('val = ${HOCON_TEST_VAR}')
    expect(c.getString('val')).toBe('test-value')
    delete process.env['HOCON_TEST_VAR']
  })

  it('throws ParseError for syntax errors', () => {
    expect(() => parse('{ unclosed')).toThrow(ParseError)
  })

  it('throws ResolveError for unresolved substitution', () => {
    expect(() => parse('x = ${missing}')).toThrow(ResolveError)
  })
})

describe('parseAsync()', () => {
  it('parses basic config asynchronously', async () => {
    const c = await parseAsync('host = "localhost"')
    expect(c.getString('host')).toBe('localhost')
  })
})

describe('parseFile()', () => {
  it('parses a HOCON file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hocon-test-'))
    const file = path.join(dir, 'test.conf')
    fs.writeFileSync(file, 'app { name = "myapp" }')
    try {
      const c = parseFile(file)
      expect(c.getString('app.name')).toBe('myapp')
    } finally {
      fs.unlinkSync(file)
      fs.rmdirSync(dir)
    }
  })

  it('resolves includes relative to file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hocon-test-'))
    const base = path.join(dir, 'base.conf')
    const main = path.join(dir, 'main.conf')
    fs.writeFileSync(base, 'port = 3000')
    fs.writeFileSync(main, 'include "base.conf"\nhost = "localhost"')
    try {
      const c = parseFile(main)
      expect(c.getString('host')).toBe('localhost')
      expect(c.getNumber('port')).toBe(3000)
    } finally {
      fs.unlinkSync(base)
      fs.unlinkSync(main)
      fs.rmdirSync(dir)
    }
  })

  it('accepts custom readFileSync', () => {
    const c = parseFile('virtual.conf', {
      readFileSync: () => 'key = "from-custom-reader"',
      baseDir: os.tmpdir(),
    })
    expect(c.getString('key')).toBe('from-custom-reader')
  })
})

describe('parseFileAsync()', () => {
  it('parses a HOCON file asynchronously', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hocon-test-'))
    const file = path.join(dir, 'test.conf')
    fs.writeFileSync(file, 'db { host = "dbhost" }')
    try {
      const c = await parseFileAsync(file)
      expect(c.getString('db.host')).toBe('dbhost')
    } finally {
      fs.unlinkSync(file)
      fs.rmdirSync(dir)
    }
  })

  it('accepts custom readFile', async () => {
    const c = await parseFileAsync('virtual.conf', {
      readFile: async () => 'key = "async-reader"',
      baseDir: os.tmpdir(),
    })
    expect(c.getString('key')).toBe('async-reader')
  })
})
