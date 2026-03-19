// tests/parse.test.ts
import { describe, it, expect } from 'vitest'
import { parse, parseAsync } from '../src/parse.js'
import { ParseError, ResolveError } from '../src/errors.js'

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
