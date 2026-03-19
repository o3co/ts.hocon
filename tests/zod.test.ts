import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { validate, getValidated } from '../src/zod.js'

const cfg = parse(`
  server {
    host = "localhost"
    port = 8080
  }
  debug = false
`)

describe('validate()', () => {
  it('validates and returns typed object', () => {
    const Schema = z.object({
      server: z.object({
        host: z.string(),
        port: z.number().int(),
      }),
      debug: z.boolean(),
    })
    const result = validate(cfg, Schema)
    expect(result.server.host).toBe('localhost')
    expect(result.server.port).toBe(8080)
    expect(result.debug).toBe(false)
  })

  it('throws ZodError on schema mismatch', () => {
    const Schema = z.object({ server: z.object({ host: z.number() }) })
    expect(() => validate(cfg, Schema)).toThrow()
  })

  it('supports Zod transforms (e.g., coerce)', () => {
    const c = parse('timeout = "30"')
    const Schema = z.object({ timeout: z.coerce.number() })
    const result = validate(c, Schema)
    expect(result.timeout).toBe(30)
  })
})

describe('getValidated()', () => {
  it('returns typed value at path', () => {
    const port = getValidated(cfg, 'server.port', z.number().int())
    expect(port).toBe(8080)
    // TypeScript should infer `port` as `number`
    const _check: number = port
  })

  it('throws ZodError on schema mismatch at path', () => {
    expect(() => getValidated(cfg, 'server.host', z.number())).toThrow()
  })

  it('throws on missing path', () => {
    expect(() => getValidated(cfg, 'missing.path', z.string())).toThrow()
  })
})
