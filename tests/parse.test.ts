// tests/parse.test.ts
import { describe, it, expect } from 'vitest'
import { parse, parseAsync, parseFile, parseFileAsync } from '../src/parse.js'
import { ParseError, ResolveError } from '../src/errors.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveAsync } from '../src/internal/resolver/resolver.js'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'

// Helper: resolve HOCON string with async resolver
function resolveAsyncStr(input: string, opts: Partial<Parameters<typeof resolveAsync>[1]> = {}) {
  const ast = parseTokens(tokenize(input))
  return resolveAsync(ast, {
    env: {},
    baseDir: undefined,
    readFileSync: () => { throw new Error('no fs') },
    ...opts,
  })
}

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

  it('resolves includes using async readFile', async () => {
    const files: Record<string, string> = {
      '/config/base.conf': 'base = 1',
    }
    const cfg = await parseAsync('include "base.conf"\napp = 2', {
      baseDir: '/config',
      readFile: async (p: string) => {
        const content = files[p]
        if (!content) throw new Error(`File not found: ${p}`)
        return content
      },
    })
    expect(cfg.getNumber('base')).toBe(1)
    expect(cfg.getNumber('app')).toBe(2)
  })

  it('resolves nested includes asynchronously', async () => {
    const files: Record<string, string> = {
      '/config/a.conf': 'include "b.conf"\na = 1',
      '/config/b.conf': 'b = 2',
    }
    const cfg = await parseAsync('include "a.conf"\nroot = 3', {
      baseDir: '/config',
      readFile: async (p: string) => {
        const content = files[p]
        if (!content) throw new Error(`File not found: ${p}`)
        return content
      },
    })
    expect(cfg.getNumber('a')).toBe(1)
    expect(cfg.getNumber('b')).toBe(2)
    expect(cfg.getNumber('root')).toBe(3)
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
      fs.rmSync(dir, { recursive: true })
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
      fs.rmSync(dir, { recursive: true })
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
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('accepts custom readFile', async () => {
    const c = await parseFileAsync('virtual.conf', {
      readFile: async () => 'key = "async-reader"',
      baseDir: os.tmpdir(),
    })
    expect(c.getString('key')).toBe('async-reader')
  })

  it('resolves includes in file using async readFile', async () => {
    const files: Record<string, string> = {
      '/vfs/main.conf': 'include "sub.conf"\nmain = 1',
      '/vfs/sub.conf': 'sub = 2',
    }
    const c = await parseFileAsync('/vfs/main.conf', {
      readFile: async (p: string) => {
        const content = files[p]
        if (!content) throw new Error(`File not found: ${p}`)
        return content
      },
    })
    expect(c.getNumber('main')).toBe(1)
    expect(c.getNumber('sub')).toBe(2)
  })
})

// ---- Async resolver internals coverage ----

describe('resolveAsync() — applyFieldAsync branches', () => {
  it('handles dotted keys (nested key expansion)', async () => {
    const v = await resolveAsyncStr('server.host = "localhost"\nserver.port = 8080')
    if (v.kind !== 'object') throw new Error('expected object')
    const server = v.fields.get('server')
    expect(server?.kind).toBe('object')
    if (server?.kind === 'object') {
      expect(server.fields.get('host')).toEqual({ kind: 'scalar', value: 'localhost' })
      expect(server.fields.get('port')).toEqual({ kind: 'scalar', value: 8080 })
    }
  })

  it('handles += (append) operator', async () => {
    const v = await resolveAsyncStr('items = [1, 2]\nitems += 3')
    if (v.kind !== 'object') throw new Error('expected object')
    const items = v.fields.get('items')
    expect(items?.kind).toBe('array')
    if (items?.kind === 'array') {
      expect(items.items.map(i => (i as { kind: 'scalar'; value: unknown }).value)).toEqual([1, 2, 3])
    }
  })

  it('deep-merges two objects at the same key', async () => {
    const v = await resolveAsyncStr('db { host = "a" }\ndb { port = 5432 }')
    if (v.kind !== 'object') throw new Error('expected object')
    const db = v.fields.get('db')
    expect(db?.kind).toBe('object')
    if (db?.kind === 'object') {
      expect(db.fields.get('host')).toEqual({ kind: 'scalar', value: 'a' })
      expect(db.fields.get('port')).toEqual({ kind: 'scalar', value: 5432 })
    }
  })
})

describe('resolveAsync() — astToResolverValueAsync branches', () => {
  it('handles array values', async () => {
    const v = await resolveAsyncStr('list = [1, 2, 3]')
    if (v.kind !== 'object') throw new Error('expected object')
    const list = v.fields.get('list')
    expect(list?.kind).toBe('array')
    if (list?.kind === 'array') {
      expect(list.items).toHaveLength(3)
    }
  })

  it('handles nested object values', async () => {
    const v = await resolveAsyncStr('outer { inner { x = 42 } }')
    if (v.kind !== 'object') throw new Error('expected object')
    const outer = v.fields.get('outer')
    expect(outer?.kind).toBe('object')
    if (outer?.kind === 'object') {
      const inner = outer.fields.get('inner')
      expect(inner?.kind).toBe('object')
    }
  })

  it('handles substitution nodes', async () => {
    const v = await resolveAsyncStr('base = 10\nderived = ${base}')
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('derived')).toEqual({ kind: 'scalar', value: 10 })
  })

  it('handles concat nodes', async () => {
    const v = await resolveAsyncStr('prefix = "hello"\nfull = ${prefix}" world"')
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('full')).toEqual({ kind: 'scalar', value: 'hello world' })
  })
})

describe('resolveAsync() — loadIncludeAsync branches', () => {
  it('probes .conf extension when include has no extension', async () => {
    // Include "base" (no extension) → should try base.conf
    const files: Record<string, string> = {
      '/cfg/base.conf': 'probed = true',
    }
    const v = await resolveAsyncStr('include "base"\napp = 1', {
      baseDir: '/cfg',
      readFile: async (p: string) => {
        const content = files[p]
        if (content === undefined) throw new Error(`not found: ${p}`)
        return content
      },
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('probed')).toEqual({ kind: 'scalar', value: true })
    expect(v.fields.get('app')).toEqual({ kind: 'scalar', value: 1 })
  })

  it('silently ignores missing optional includes', async () => {
    // Include a file that doesn't exist — should not throw, just produce empty merge
    const v = await resolveAsyncStr('include "nonexistent.conf"\napp = 42', {
      baseDir: '/cfg',
      readFile: async (_p: string) => { throw new Error('file not found') },
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('app')).toEqual({ kind: 'scalar', value: 42 })
    // nonexistent include is silently ignored
    expect(v.fields.get('missing')).toBeUndefined()
  })

  it('detects circular include (direct self-reference)', async () => {
    const files: Record<string, string> = {
      '/cfg/self.conf': 'include "self.conf"\nval = 1',
    }
    await expect(
      resolveAsyncStr('include "self.conf"', {
        baseDir: '/cfg',
        readFile: async (p: string) => {
          const content = files[p]
          if (content === undefined) throw new Error(`not found: ${p}`)
          return content
        },
      })
    ).rejects.toThrow(ResolveError)
  })

  it('falls back to sync readFileSync when no async readFile provided', async () => {
    // loadIncludeAsync without readFile option — uses sync fallback
    const files: Record<string, string> = {
      '/cfg/sync.conf': 'synced = 99',
    }
    const v = await resolveAsyncStr('include "sync.conf"\nlocal = 1', {
      baseDir: '/cfg',
      readFileSync: (p: string) => {
        const content = files[p]
        if (content === undefined) throw new Error(`not found: ${p}`)
        return content
      },
      // no readFile provided — exercises sync fallback path in loadIncludeAsync
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('synced')).toEqual({ kind: 'scalar', value: 99 })
    expect(v.fields.get('local')).toEqual({ kind: 'scalar', value: 1 })
  })

  it('detects circular include via extension-probed path (async)', async () => {
    // "base" (no ext) resolves to base.conf, which then includes "base" again.
    // The second pass: absPath=/cfg/base not in stack, but candidate /cfg/base.conf IS → line 598
    const files: Record<string, string> = {
      '/cfg/base.conf': 'include "base"\nval = 1',
    }
    await expect(
      resolveAsyncStr('include "base"', {
        baseDir: '/cfg',
        readFile: async (p: string) => {
          const content = files[p]
          if (content === undefined) throw new Error(`not found: ${p}`)
          return content
        },
      })
    ).rejects.toThrow(ResolveError)
  })
})

describe('resolve() — loadInclude sync branches', () => {
  it('detects circular include via extension-probed path (sync)', () => {
    // Mirrors the async test: "base" probes to base.conf, then base.conf re-includes "base"
    const files: Record<string, string> = {
      '/cfg/base.conf': 'include "base"\nval = 1',
    }
    expect(() =>
      parse('include "base"', {
        baseDir: '/cfg',
        readFileSync: (p: string) => {
          const content = files[p]
          if (content === undefined) throw new Error(`not found: ${p}`)
          return content
        },
      })
    ).toThrow(ResolveError)
  })

  it('silently ignores missing sync includes', () => {
    const c = parse('include "nonexistent.conf"\napp = 99', {
      baseDir: '/cfg',
      readFileSync: (_p: string) => { throw new Error('not found') },
    })
    expect(c.getNumber('app')).toBe(99)
  })

  it('propagates parse errors from included files during sync probing', () => {
    const files: Record<string, string> = {
      '/config/broken.conf': '{ invalid = }',  // syntax error
    }
    expect(() => parse('include "broken"', {
      baseDir: '/config',
      readFileSync: (path: string) => {
        const content = files[path]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return content
      },
    })).toThrow()
  })
})

describe('resolveAsync() — parse error propagation in include probing', () => {
  it('propagates parse errors from included files during async probing', async () => {
    const files: Record<string, string> = {
      '/config/broken.conf': '{ invalid = }',  // syntax error
    }
    await expect(parseAsync('include "broken"', {
      baseDir: '/config',
      readFile: async (path: string) => {
        const content = files[path]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return content
      },
    })).rejects.toThrow()
  })
})
