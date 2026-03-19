import { describe, it, expect } from 'vitest'
import { ParseError, ResolveError, ConfigError } from '../src/errors.js'

describe('ParseError', () => {
  it('is an Error with line/col', () => {
    const e = new ParseError('unexpected token', 3, 10)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('unexpected token')
    expect(e.line).toBe(3)
    expect(e.col).toBe(10)
    expect(e.file).toBeUndefined()
  })

  it('accepts optional file path', () => {
    const e = new ParseError('bad syntax', 1, 1, 'app.conf')
    expect(e.file).toBe('app.conf')
  })
})

describe('ResolveError', () => {
  it('carries path and position', () => {
    const e = new ResolveError('unresolved substitution', 'server.host', 5, 3)
    expect(e).toBeInstanceOf(Error)
    expect(e.path).toBe('server.host')
    expect(e.line).toBe(5)
    expect(e.col).toBe(3)
  })

  it('line/col can be 0 (no position info)', () => {
    const e = new ResolveError('include failed', 'path', 0, 0, 'app.conf')
    expect(e.line).toBe(0)
    expect(e.col).toBe(0)
    expect(e.file).toBe('app.conf')
  })
})

describe('ConfigError', () => {
  it('carries path', () => {
    const e = new ConfigError('key not found', 'server.port')
    expect(e).toBeInstanceOf(Error)
    expect(e.path).toBe('server.port')
  })
})
