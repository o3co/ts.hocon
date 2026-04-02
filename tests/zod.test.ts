import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/parse.js'
import { validate, getValidated, parseWithSchema, parseFileWithSchema } from '../src/zod.js'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'

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

describe('validate() HOCON-aware coercion', () => {
  it('coerces string "true" to boolean for z.boolean()', () => {
    const c = parse('debug = "true"')
    const schema = z.object({ debug: z.boolean() })
    const result = validate(c, schema)
    expect(result.debug).toBe(true)
  })

  it('coerces string "false" to boolean for z.boolean()', () => {
    const c = parse('debug = "false"')
    const schema = z.object({ debug: z.boolean() })
    const result = validate(c, schema)
    expect(result.debug).toBe(false)
  })

  it('coerces "yes"/"no"/"on"/"off" to boolean', () => {
    const c = parse(`
      a = "yes"
      b = "no"
      c = "on"
      d = "off"
    `)
    const schema = z.object({
      a: z.boolean(),
      b: z.boolean(),
      c: z.boolean(),
      d: z.boolean(),
    })
    const result = validate(c, schema)
    expect(result.a).toBe(true)
    expect(result.b).toBe(false)
    expect(result.c).toBe(true)
    expect(result.d).toBe(false)
  })

  it('coerces case-insensitively', () => {
    const c = parse('flag = "TRUE"')
    const schema = z.object({ flag: z.boolean() })
    expect(validate(c, schema).flag).toBe(true)
  })

  it('passes through boolean literals without coercion', () => {
    const c = parse('debug = false')
    const schema = z.object({ debug: z.boolean() })
    expect(validate(c, schema).debug).toBe(false)
  })
})

describe('validate() number coercion', () => {
  it('coerces numeric string to number for z.number()', () => {
    const c = parse('port = "8080"')
    const schema = z.object({ port: z.number() })
    expect(validate(c, schema).port).toBe(8080)
  })

  it('coerces float string to number', () => {
    const c = parse('rate = "3.14"')
    const schema = z.object({ rate: z.number() })
    expect(validate(c, schema).rate).toBe(3.14)
  })

  it('passes through number literals without coercion', () => {
    const c = parse('port = 8080')
    const schema = z.object({ port: z.number() })
    expect(validate(c, schema).port).toBe(8080)
  })

  it('lets Zod reject non-numeric strings', () => {
    const c = parse('port = "abc"')
    const schema = z.object({ port: z.number() })
    expect(() => validate(c, schema)).toThrow()
  })
})

describe('validate() wrapper unwrapping', () => {
  it('coerces through z.optional()', () => {
    const c = parse('debug = "true"')
    const schema = z.object({ debug: z.boolean().optional() })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces through z.nullable()', () => {
    const c = parse('debug = "false"')
    const schema = z.object({ debug: z.boolean().nullable() })
    expect(validate(c, schema).debug).toBe(false)
  })

  it('coerces through z.default()', () => {
    const c = parse('debug = "on"')
    const schema = z.object({ debug: z.boolean().default(false) })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces through z.readonly()', () => {
    const c = parse('debug = "true"')
    const schema = z.object({ debug: z.boolean().readonly() })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces through z.catch()', () => {
    const c = parse('debug = "yes"')
    const schema = z.object({ debug: z.boolean().catch(false) })
    expect(validate(c, schema).debug).toBe(true)
  })

  it('coerces inside z.array()', () => {
    const c = parse('flags = ["true", "false", "yes"]')
    const schema = z.object({ flags: z.array(z.boolean()) })
    const result = validate(c, schema)
    expect(result.flags).toEqual([true, false, true])
  })

  it('coerces in nested objects', () => {
    const c = parse(`
      server {
        debug = "true"
        port = "3000"
      }
    `)
    const schema = z.object({
      server: z.object({
        debug: z.boolean(),
        port: z.number(),
      }),
    })
    const result = validate(c, schema)
    expect(result.server.debug).toBe(true)
    expect(result.server.port).toBe(3000)
  })
})

describe('validate() passthrough behavior', () => {
  it('passes through string values for z.string()', () => {
    const c = parse('name = "hello"')
    const schema = z.object({ name: z.string() })
    expect(validate(c, schema).name).toBe('hello')
  })

  it('lets Zod reject non-boolean strings for z.boolean()', () => {
    const c = parse('debug = "maybe"')
    const schema = z.object({ debug: z.boolean() })
    expect(() => validate(c, schema)).toThrow()
  })
})

describe('getValidated() coercion', () => {
  it('coerces boolean string at path', () => {
    const c = parse('debug = "false"')
    expect(getValidated(c, 'debug', z.boolean())).toBe(false)
  })

  it('coerces numeric string at path', () => {
    const c = parse('port = "8080"')
    expect(getValidated(c, 'port', z.number())).toBe(8080)
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

describe('parseWithSchema()', () => {
  const Schema = z.object({
    server: z.object({
      host: z.string(),
      port: z.number().int(),
    }),
    debug: z.boolean(),
  })

  it('parses HOCON string and validates in one step', () => {
    const input = `
      server {
        host = "localhost"
        port = 8080
      }
      debug = false
    `
    const result = parseWithSchema(input, Schema)
    expect(result.server.host).toBe('localhost')
    expect(result.server.port).toBe(8080)
    expect(result.debug).toBe(false)
  })

  it('applies HOCON-aware coercion', () => {
    const input = `
      server {
        host = "localhost"
        port = "3000"
      }
      debug = "true"
    `
    const result = parseWithSchema(input, Schema)
    expect(result.server.port).toBe(3000)
    expect(result.debug).toBe(true)
  })

  it('throws ZodError on schema mismatch', () => {
    const input = 'server { host = 42, port = 8080 }, debug = false'
    expect(() => parseWithSchema(input, Schema)).toThrow()
  })

  it('passes ParseOptions through', () => {
    const input = 'host = ${HOST}'
    const HostSchema = z.object({ host: z.string() })
    const result = parseWithSchema(input, HostSchema, { env: { HOST: 'example.com' } })
    expect(result.host).toBe('example.com')
  })
})

describe('parseFileWithSchema()', () => {
  const Schema = z.object({
    app: z.object({ name: z.string() }),
  })

  it('parses a file and validates in one step', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hocon-test-'))
    const tmpFile = path.join(tmpDir, 'test.conf')
    fs.writeFileSync(tmpFile, 'app { name = "myapp" }')

    try {
      const result = parseFileWithSchema(tmpFile, Schema)
      expect(result.app.name).toBe('myapp')
    } finally {
      fs.unlinkSync(tmpFile)
      fs.rmdirSync(tmpDir)
    }
  })
})
