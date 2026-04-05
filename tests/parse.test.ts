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
    const files: Record<string, string | undefined> = {
      '/config/base.conf': 'base = 1',
    }
    const cfg = await parseAsync('include "base.conf"\napp = 2', {
      baseDir: '/config',
      readFile: async (p: string) => {
        const content = files[p]
        if (content === undefined) throw new Error(`File not found: ${p}`)
        return content
      },
    })
    expect(cfg.getNumber('base')).toBe(1)
    expect(cfg.getNumber('app')).toBe(2)
  })

  it('resolves nested includes asynchronously', async () => {
    const files: Record<string, string | undefined> = {
      '/config/a.conf': 'include "b.conf"\na = 1',
      '/config/b.conf': 'b = 2',
    }
    const cfg = await parseAsync('include "a.conf"\nroot = 3', {
      baseDir: '/config',
      readFile: async (p: string) => {
        const content = files[p]
        if (content === undefined) throw new Error(`File not found: ${p}`)
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
    const files: Record<string, string | undefined> = {
      '/vfs/main.conf': 'include "sub.conf"\nmain = 1',
      '/vfs/sub.conf': 'sub = 2',
    }
    const c = await parseFileAsync('/vfs/main.conf', {
      readFile: async (p: string) => {
        const content = files[p]
        if (content === undefined) throw new Error(`File not found: ${p}`)
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
      expect(server.fields.get('host')).toEqual({ kind: 'scalar', raw: 'localhost', valueType: 'string' })
      expect(server.fields.get('port')).toEqual({ kind: 'scalar', raw: '8080', valueType: 'number' })
    }
  })

  it('handles += (append) operator', async () => {
    const v = await resolveAsyncStr('items = [1, 2]\nitems += 3')
    if (v.kind !== 'object') throw new Error('expected object')
    const items = v.fields.get('items')
    expect(items?.kind).toBe('array')
    if (items?.kind === 'array') {
      expect(items.items.map(i => (i as { kind: 'scalar'; raw: string }).raw)).toEqual(['1', '2', '3'])
    }
  })

  it('deep-merges two objects at the same key', async () => {
    const v = await resolveAsyncStr('db { host = "a" }\ndb { port = 5432 }')
    if (v.kind !== 'object') throw new Error('expected object')
    const db = v.fields.get('db')
    expect(db?.kind).toBe('object')
    if (db?.kind === 'object') {
      expect(db.fields.get('host')).toEqual({ kind: 'scalar', raw: 'a', valueType: 'string' })
      expect(db.fields.get('port')).toEqual({ kind: 'scalar', raw: '5432', valueType: 'number' })
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
    expect(v.fields.get('derived')).toEqual({ kind: 'scalar', raw: '10', valueType: 'number' })
  })

  it('handles concat nodes', async () => {
    const v = await resolveAsyncStr('prefix = "hello"\nfull = ${prefix}" world"')
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('full')).toEqual({ kind: 'scalar', raw: 'hello world', valueType: 'string' })
  })
})

describe('resolveAsync() — loadIncludeAsync branches', () => {
  it('probes .conf extension when include has no extension', async () => {
    // Include "base" (no extension) → should try base.conf
    const files: Record<string, string | undefined> = {
      '/cfg/base.conf': 'probed = true',
    }
    const v = await resolveAsyncStr('include "base"\napp = 1', {
      baseDir: '/cfg',
      readFile: async (p: string) => {
        const content = files[p]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        return content
      },
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('probed')).toEqual({ kind: 'scalar', raw: 'true', valueType: 'boolean' })
    expect(v.fields.get('app')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('silently ignores missing optional includes', async () => {
    // Include a file that doesn't exist — should not throw, just produce empty merge
    const v = await resolveAsyncStr('include "nonexistent.conf"\napp = 42', {
      baseDir: '/cfg',
      readFile: async (_p: string) => { throw Object.assign(new Error('ENOENT: not found'), { code: 'ENOENT' }) },
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('app')).toEqual({ kind: 'scalar', raw: '42', valueType: 'number' })
    // nonexistent include is silently ignored
    expect(v.fields.get('missing')).toBeUndefined()
  })

  it('detects circular include (direct self-reference)', async () => {
    const files: Record<string, string | undefined> = {
      '/cfg/self.conf': 'include "self.conf"\nval = 1',
    }
    await expect(
      resolveAsyncStr('include "self.conf"', {
        baseDir: '/cfg',
        readFile: async (p: string) => {
          const content = files[p]
          if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
          return content
        },
      })
    ).rejects.toThrow(ResolveError)
  })

  it('falls back to sync readFileSync when no async readFile provided', async () => {
    // loadIncludeAsync without readFile option — uses sync fallback
    const files: Record<string, string | undefined> = {
      '/cfg/sync.conf': 'synced = 99',
    }
    const v = await resolveAsyncStr('include "sync.conf"\nlocal = 1', {
      baseDir: '/cfg',
      readFileSync: (p: string) => {
        const content = files[p]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
        return content
      },
      // no readFile provided — exercises sync fallback path in loadIncludeAsync
    })
    if (v.kind !== 'object') throw new Error('expected object')
    expect(v.fields.get('synced')).toEqual({ kind: 'scalar', raw: '99', valueType: 'number' })
    expect(v.fields.get('local')).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })

  it('detects circular include via extension-probed path (async)', async () => {
    // "base" (no ext) resolves to base.conf, which then includes "base" again.
    // The second pass: absPath=/cfg/base not in stack, but candidate /cfg/base.conf IS → line 598
    const files: Record<string, string | undefined> = {
      '/cfg/base.conf': 'include "base"\nval = 1',
    }
    await expect(
      resolveAsyncStr('include "base"', {
        baseDir: '/cfg',
        readFile: async (p: string) => {
          const content = files[p]
          if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
          return content
        },
      })
    ).rejects.toThrow(ResolveError)
  })
})

describe('resolve() — loadInclude sync branches', () => {
  it('detects circular include via extension-probed path (sync)', () => {
    // Mirrors the async test: "base" probes to base.conf, then base.conf re-includes "base"
    const files: Record<string, string | undefined> = {
      '/cfg/base.conf': 'include "base"\nval = 1',
    }
    expect(() =>
      parse('include "base"', {
        baseDir: '/cfg',
        readFileSync: (p: string) => {
          const content = files[p]
          if (content === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
          return content
        },
      })
    ).toThrow(ResolveError)
  })

  it('silently ignores missing sync includes', () => {
    const c = parse('include "nonexistent.conf"\napp = 99', {
      baseDir: '/cfg',
      readFileSync: (_p: string) => { throw Object.assign(new Error('ENOENT: not found'), { code: 'ENOENT' }) },
    })
    expect(c.getNumber('app')).toBe(99)
  })

  it('propagates parse errors from included files during sync probing', () => {
    const files: Record<string, string | undefined> = {
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
    const files: Record<string, string | undefined> = {
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

describe('parseAsync — .properties include', () => {
  it('should include .properties file with string values and nested keys', async () => {
    const files: Record<string, string | undefined> = {
      '/config/app.properties': 'server.host=localhost\nserver.port=8080\ndebug=true',
    }
    const cfg = await parseAsync('include "app.properties"\napp = 1', {
      baseDir: '/config',
      readFile: async (path: string) => {
        const content = files[path]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return content
      },
    })
    expect(cfg.getString('server.host')).toBe('localhost')
    expect(cfg.getString('server.port')).toBe('8080')  // string, not number
    expect(cfg.getString('debug')).toBe('true')  // string, not boolean
    expect(cfg.getNumber('app')).toBe(1)
  })
})

describe('parseAsync — required include error paths', () => {
  it('errors on required include when file missing (async path)', async () => {
    await expect(parseAsync('include required("nonexistent.conf")', {
      baseDir: '/nowhere',
      readFile: async (p: string) => {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
      },
    })).rejects.toThrow(/required/)
  })

  it('silently ignores MODULE_NOT_FOUND in async probing', async () => {
    const cfg = await parseAsync('include "mod"\na = 1', {
      baseDir: '/nowhere',
      readFile: async (p: string) => {
        throw Object.assign(new Error(`MODULE_NOT_FOUND: ${p}`), { code: 'MODULE_NOT_FOUND' })
      },
    })
    expect(cfg.getNumber('a')).toBe(1) // include silently ignored
  })

  it('re-throws non-ENOENT errors in async include probing', async () => {
    await expect(parseAsync('include "perm"\na = 1', {
      baseDir: '/nowhere',
      readFile: async (p: string) => {
        throw Object.assign(new Error(`EACCES: ${p}`), { code: 'EACCES' })
      },
    })).rejects.toThrow(/EACCES/)
  })

  it('silently ignores custom readFile errors without .code for missing files', async () => {
    // Custom readFile may throw plain Error without .code property
    const cfg = await parseAsync('include "missing"\na = 1', {
      baseDir: '/nowhere',
      readFile: async (p: string) => {
        throw new Error(`File not found: ${p}`)
      },
    })
    expect(cfg.getNumber('a')).toBe(1) // include silently ignored
  })

  it('silently ignores custom sync readFileSync errors without .code for missing files', () => {
    const cfg = parse('include "missing"\na = 1', {
      baseDir: '/nowhere',
      readFileSync: (p: string) => {
        throw new Error(`no such file or directory: ${p}`)
      },
    })
    expect(cfg.getNumber('a')).toBe(1)
  })
})

describe('parseAsync — .properties extension probing', () => {
  it('should probe .properties extension during include resolution', async () => {
    const files: Record<string, string | undefined> = {
      '/config/app.properties': 'key=from-properties',
    }
    const cfg = await parseAsync('include "app"\nother = 1', {
      baseDir: '/config',
      readFile: async (path: string) => {
        const content = files[path]
        if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return content
      },
    })
    expect(cfg.getString('key')).toBe('from-properties')
  })
})

describe('parseAsync — include depth limit', () => {
  it('throws on include depth limit exceeded (async)', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i <= 51; i++) {
      files[`/depth/file${i}.conf`] = i < 51 ? `include "file${i + 1}.conf"\nkey${i} = ${i}` : `key51 = 51`
    }
    await expect(parseAsync('include "file0.conf"', {
      readFile: async (p: string) => {
        const name = p.split('/').pop()!
        const content = files[`/depth/${name}`]
        if (content === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        return content
      },
      baseDir: '/depth',
    })).rejects.toThrow(/depth limit/)
  })
})
