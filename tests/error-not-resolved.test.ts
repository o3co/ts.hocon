// tests/error-not-resolved.test.ts
import { describe, expect, it } from 'vitest'
import { NotResolvedError, ConfigError } from '../src/errors.js'

describe('NotResolvedError', () => {
  it('is instance of ConfigError', () => {
    const e = new NotResolvedError('a.b')
    expect(e).toBeInstanceOf(NotResolvedError)
    expect(e).toBeInstanceOf(ConfigError)
    expect(e).toBeInstanceOf(Error)
  })

  it('message contains the path', () => {
    const e = new NotResolvedError('server.port')
    expect(e.message).toContain('server.port')
    expect(e.message).toContain('not resolved')
  })

  it('name is NotResolvedError', () => {
    const e = new NotResolvedError('x')
    expect(e.name).toBe('NotResolvedError')
  })

  it('path is accessible', () => {
    const e = new NotResolvedError('a.b.c')
    expect(e.path).toBe('a.b.c')
  })
})
