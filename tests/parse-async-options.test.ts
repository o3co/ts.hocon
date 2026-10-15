// tests/parse-async-options.test.ts
// parseAsync / parseFileAsync honour ParseOptions the way parse / parseFile do:
// resolveSubstitutions: false returns an unresolved Config (E12), and
// originDescription is carried on the Config.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ParseError, parse, parseAsync, parseFile, parseFileAsync } from '../src/index.js'

const dir = mkdtempSync(join(tmpdir(), 'ts-hocon-parse-async-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('parseAsync options', () => {
  it('resolveSubstitutions: false leaves substitutions unresolved, like parse', async () => {
    const sync = parse('a = ${b}', { resolveSubstitutions: false })
    const async = await parseAsync('a = ${b}', { resolveSubstitutions: false })
    expect(async.isResolved()).toBe(sync.isResolved())
    expect(async.isResolved()).toBe(false)
    expect(async.resolveWith(parse('b = 1')).getNumber('a')).toBe(1)
  })

  it('resolveSubstitutions: false without substitutions is resolved', async () => {
    expect((await parseAsync('a = 1', { resolveSubstitutions: false })).isResolved()).toBe(true)
  })

  it('resolves by default', async () => {
    const c = await parseAsync('b = 1, a = ${b}')
    expect(c.isResolved()).toBe(true)
    expect(c.getNumber('a')).toBe(1)
  })

  it('merges a fallback and resolves later, like parse', async () => {
    const text = 'a = ${b}, list = [1], list += ${extra}'
    const fallback = parse('b = 1, extra = 2')
    const sync = parse(text, { resolveSubstitutions: false }).withFallback(fallback).resolve()
    const async = (await parseAsync(text, { resolveSubstitutions: false })).withFallback(fallback).resolve()
    expect(async.toObject()).toEqual(sync.toObject())
  })

  it('still guards deep nesting on the deferred path', async () => {
    const deep = 'a = ' + '['.repeat(100_000) + ']'.repeat(100_000)
    await expect(parseAsync(deep, { resolveSubstitutions: false, originDescription: 'deep' })).rejects.toThrow(ParseError)
  })

  it('carries originDescription on the Config, resolved or not', async () => {
    expect((await parseAsync('a = 1', { originDescription: 'unit-test' }))._originDescription).toBe('unit-test')
    const deferred = await parseAsync('a = ${b}', { originDescription: 'unit-test', resolveSubstitutions: false })
    expect(deferred._originDescription).toBe('unit-test')
    expect(deferred._originDescription).toBe(
      parse('a = ${b}', { originDescription: 'unit-test', resolveSubstitutions: false })._originDescription,
    )
  })
})

describe('parseFileAsync options', () => {
  beforeAll(() => {
    writeFileSync(join(dir, 'base.conf'), 'base { host = local }\n')
    writeFileSync(join(dir, 'app.conf'), 'include "base.conf"\nport = ${?PORT}\nurl = ${base.host}":"${listen}\n')
  })

  it('resolveSubstitutions: false expands includes asynchronously and defers substitutions', async () => {
    const reads: string[] = []
    const readFile = async (p: string) => {
      reads.push(p)
      return readFileSync(p, 'utf-8')
    }
    const readFileSync_ = () => {
      throw new Error('the async path must not read synchronously')
    }
    const c = await parseFileAsync(join(dir, 'app.conf'), {
      resolveSubstitutions: false,
      readFile,
      readFileSync: readFileSync_,
    })
    expect(c.isResolved()).toBe(false)
    expect(reads.map((p) => p.split(/[\\/]/).pop())).toEqual(['app.conf', 'base.conf'])
    const resolved = c.resolveWith(parse('listen = 8080'))
    expect(resolved.getString('url')).toBe('local:8080')
    expect(resolved.getString('base.host')).toBe('local')
  })

  it('agrees with parseFile', async () => {
    const opts = { resolveSubstitutions: false, originDescription: 'app' } as const
    const sync = parseFile(join(dir, 'app.conf'), opts)
    const async = await parseFileAsync(join(dir, 'app.conf'), opts)
    expect(async.isResolved()).toBe(sync.isResolved())
    expect(async._originDescription).toBe(sync._originDescription)
    const fallback = parse('listen = 1')
    expect(async.resolveWith(fallback).toObject()).toEqual(sync.resolveWith(fallback).toObject())
  })
})
