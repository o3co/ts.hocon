// tools/smoke-entrypoints.mjs
//
// Regression gate for the published artifact. `pnpm test` runs vitest against
// `src/`, which is a permanent blind spot for bundler-shape bugs: the shims tsup
// injects (`import.meta` rewritten to `{}` in the CJS bundle, a Proxy over
// `require` in the ESM one) exist only in `dist/`, and this package has shipped
// two release blockers that live exactly there — 1.10.0's CJS entrypoints
// throwing at load, and the ESM `include package(...)` regression that briefly
// replaced it.
//
// So this gate runs against the built output, and does five things:
//
//   1. LOADs every subpath in package.json "exports" under both module systems.
//   2. USEs it — calls the entrypoint's real function and checks the answer.
//   3. Checks each condition declares its own "types" of the right flavour.
//   4. Checks that what a subpath returns or throws is an instance of the
//      classes the root entrypoint exports (Config, ConfigError, ParseError,
//      …), so `instanceof` holds across entrypoints in both module systems.
//   5. Checks that no CJS file names `__filename`, `__dirname` or `import.meta`.
//      A bundler that takes the "require" condition evaluates the CJS output
//      without Node's module wrapper, so a load-time `__filename` crashes every
//      entrypoint where there is no `document` either (what tsup's CJS shim
//      did, in Web / Service Workers and edge runtimes), and `import.meta` is
//      a SyntaxError in CJS anywhere.
//
// Step 2 is the point. A load-only check cannot see a defect whose whole nature
// is that it defers work to first use, which is what the `require`-shim bug was.
// The root and zod checks deliberately resolve `include package(...)`, the one
// code path whose behaviour differs between the two bundle formats.
//
// Usage: node tools/smoke-entrypoints.mjs   (`pnpm smoke` builds first)

import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const require = createRequire(import.meta.url)

if (!existsSync(join(root, 'dist'))) {
  console.error('smoke-entrypoints: dist/ not found — run `pnpm build` first')
  process.exit(1)
}

// ─── fixture: a package to resolve `include package(...)` against ────────────
// A real node_modules layout in a temp dir, so the include exercises
// require.resolve exactly as a consumer's would.
const fixtureDir = mkdtempSync(join(tmpdir(), 'ts-hocon-smoke-'))
// Registered the moment the directory exists, so *every* exit path removes it —
// the `process.exit(1)` calls below and anything that throws, not just the
// happy path. `rmSync` is synchronous, which is what an exit handler needs.
process.on('exit', () => rmSync(fixtureDir, { recursive: true, force: true }))
mkdirSync(join(fixtureDir, 'node_modules', 'smoke-fixture-pkg'), { recursive: true })
writeFileSync(
  join(fixtureDir, 'node_modules', 'smoke-fixture-pkg', 'package.json'),
  JSON.stringify({ name: 'smoke-fixture-pkg', version: '1.0.0' }),
)
writeFileSync(
  join(fixtureDir, 'node_modules', 'smoke-fixture-pkg', 'reference.conf'),
  'included = from-package\n',
)
const appConf = join(fixtureDir, 'app.conf')
writeFileSync(appConf, 'include package("smoke-fixture-pkg", "reference.conf")\nlocal = ${included}\n')

const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

// ─── functional check per entrypoint ─────────────────────────────────────────
// Each throws on any surprise. `load` really does fetch a peer dependency
// through the module system under test — require() for the CJS pass, import()
// for the ESM one — because the peers have dual builds of their own, and a gate
// that reached ESM entrypoints' dependencies through CJS would be exercising a
// configuration no consumer runs. That is the same mistake this gate exists to
// catch, one level down.
const checks = {
  '.': async (m) => {
    // The bundler-shape canary: include package(...) goes through
    // require.resolve, whose shape differs between the ESM and CJS bundles.
    const cfg = m.parseFile(appConf)
    eq(cfg.getString('included'), 'from-package', 'parseFile include package')
    eq(cfg.getString('local'), 'from-package', 'substitution across the include')
    eq(m.parse('a = 1\nb = ${a}').getNumber('b'), 1, 'parse + substitution')
  },
  './zod': async (m, load) => {
    const { z } = await load('zod')
    const out = m.parseWithSchema(
      'include package("smoke-fixture-pkg", "reference.conf")',
      z.object({ included: z.string() }),
      { baseDir: fixtureDir },
    )
    eq(out.included, 'from-package', 'parseWithSchema include package')
  },
  './adapters/properties': async (m) => {
    eq(m.parsePropertiesConfig('db.host = local\n').getString('db.host'), 'local', 'properties adapter')
  },
  './adapters/env': async (m) => {
    eq(m.loadEnv({ prefix: 'SMOKE_', env: { SMOKE_DB__HOST: 'local' } }).getString('db.host'), 'local', 'env adapter')
    eq(m.parseDotEnv('A__B=1\n').getString('a.b'), '1', 'dotenv adapter')
  },
  './adapters/jsonc': async (m) => {
    eq(m.parseJsonc('{"a": 1 /* c */, "b": [1,2,],}').getNumber('a'), 1, 'jsonc adapter')
  },
  './adapters/json5': async (m) => {
    eq(m.parseJson5("{db: {host: 'local'}, port: 0x1F90, /* c */}").getString('db.host'), 'local', 'json5 adapter')
    eq(m.parseJson5('{port: 0x1F90}').getNumber('port'), 8080, 'json5 hex integer')
  },
  './adapters/toml': async (m) => {
    eq(m.parseTomlConfig('[db]\nhost = "local"\n').getString('db.host'), 'local', 'toml adapter')
  },
  './adapters/yaml': async (m) => {
    eq(m.parseYaml('db:\n  host: local\n').getString('db.host'), 'local', 'yaml adapter')
  },
}

// ─── instanceof across entrypoints ───────────────────────────────────────────
// A consumer imports the error classes from the root and catches what a
// subpath throws: `catch (e) { if (e instanceof ConfigError) … }`. That only
// works if every entrypoint shares the root's classes rather than carrying its
// own copy. Each check gets the subpath module and the root module, loaded
// through the same module system.
const thrown = (fn) => {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected a throw')
}
const isA = (value, cls, what) => {
  if (value instanceof cls) return
  const got = value?.constructor?.name ?? typeof value
  const detail = got === cls.name
    ? `got a ${got} from another copy of the class`
    : `got a ${got}: ${String(value?.message ?? value).split('\n')[0]}`
  throw new Error(`${what}: not an instance of the root ${cls.name} (${detail})`)
}
// The Config an adapter returns is the root's Config, and its getters throw the
// root's ConfigError.
const sharesConfig = (cfg, root, what) => {
  isA(cfg, root.Config, `${what} result`)
  isA(thrown(() => cfg.getString('no.such.path')), root.ConfigError, `${what} result's getter error`)
}
const crossChecks = {
  './zod': async (m, root, load) => {
    const { z } = await load('zod')
    const schema = z.object({ a: z.string() })
    isA(thrown(() => m.parseWithSchema('a = {', schema)), root.ParseError, 'parseWithSchema parse error')
    isA(thrown(() => m.parseWithSchema('a = ${missing}', schema)), root.ResolveError, 'parseWithSchema resolve error')
  },
  './adapters/properties': async (m, root) => {
    sharesConfig(m.parsePropertiesConfig('a = 1\n'), root, 'parsePropertiesConfig')
  },
  './adapters/env': async (m, root) => {
    sharesConfig(m.parseDotEnv('A=1\n'), root, 'parseDotEnv')
    isA(thrown(() => m.parseDotEnv('no-equals-sign\n')), root.ConfigError, 'parseDotEnv error')
  },
  './adapters/jsonc': async (m, root) => {
    sharesConfig(m.parseJsonc('{"a": 1}'), root, 'parseJsonc')
    isA(thrown(() => m.parseJsonc('{"a": "x')), root.ConfigError, 'parseJsonc error')
  },
  './adapters/json5': async (m, root) => {
    sharesConfig(m.parseJson5('{a: 1}'), root, 'parseJson5')
    isA(thrown(() => m.parseJson5('{a: }')), root.ConfigError, 'parseJson5 error')
  },
  './adapters/toml': async (m, root) => {
    sharesConfig(m.parseTomlConfig('a = 1\n'), root, 'parseTomlConfig')
  },
  './adapters/yaml': async (m, root) => {
    sharesConfig(m.parseYaml('a: 1\n'), root, 'parseYaml')
    isA(thrown(() => m.parseYaml('a: [1\n')), root.ConfigError, 'parseYaml error')
  },
}

const subpaths = Object.keys(pkg.exports)
if (subpaths.length === 0) {
  console.error('smoke-entrypoints: package.json has no "exports" — nothing to check?')
  process.exit(1)
}

async function crossInstanceof(subpath, mod, root, load) {
  const check = crossChecks[subpath]
  if (check === undefined) throw new Error('no instanceof check defined for this export — add one')
  await check(mod, root, load)
}

let failures = 0
const fail = (what, e) => {
  failures++
  console.error(`FAIL ${what}: ${String(e && e.message ? e.message : e).split('\n')[0]}`)
}

for (const subpath of subpaths) {
  const specifier = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1)
  const check = checks[subpath]
  if (check === undefined) {
    fail(specifier, new Error('no functional check defined for this export — add one'))
    continue
  }

  // CJS: require() must load, and the module must work.
  try {
    const mod = require(specifier)
    if (mod === null || typeof mod !== 'object' || Object.keys(mod).length === 0) {
      throw new Error('module loaded but exposes no exports')
    }
    await check(mod, async (dep) => require(dep))
    console.log(`ok   require('${specifier}')  + functional check`)
  } catch (e) {
    fail(`require('${specifier}')`, e)
  }
  if (subpath !== '.') {
    try {
      await crossInstanceof(subpath, require(specifier), require(pkg.name), async (dep) => require(dep))
      console.log(`ok   require('${specifier}')  + instanceof the root's classes`)
    } catch (e) {
      fail(`require('${specifier}') instanceof`, e)
    }
  }

  // ESM: import() must load, and the module must work.
  try {
    const mod = await import(specifier)
    if (Object.keys(mod).length === 0) {
      throw new Error('module loaded but exposes no exports')
    }
    await check(mod, async (dep) => await import(dep))
    console.log(`ok   import('${specifier}')   + functional check`)
  } catch (e) {
    fail(`import('${specifier}')`, e)
  }
  if (subpath !== '.') {
    try {
      await crossInstanceof(subpath, await import(specifier), await import(pkg.name), async (dep) => await import(dep))
      console.log(`ok   import('${specifier}')   + instanceof the root's classes`)
    } catch (e) {
      fail(`import('${specifier}') instanceof`, e)
    }
  }
}

// ─── CJS output free of Node-wrapper globals ─────────────────────────────────
// Node's CJS wrapper provides __filename / __dirname; a browser bundler that
// consumes the CJS output does not. Checked by text: these names have no
// business in the built CJS at all (the source never uses them), so any
// occurrence is a bundler artifact.
{
  const cjsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cjsFiles(join(dir, e.name)) : e.name.endsWith('.cjs') ? [join(dir, e.name)] : [])
  for (const file of cjsFiles(join(root, 'dist'))) {
    const text = readFileSync(file, 'utf-8')
    const found = ['__filename', '__dirname', 'import.meta'].filter((name) => text.includes(name))
    const label = file.slice(root.length + 1)
    if (found.length > 0) fail(label, new Error(`CJS output names ${found.join(', ')}`))
    else console.log(`ok   ${label} names no __filename / __dirname / import.meta`)
  }
}

// ─── types conditions ────────────────────────────────────────────────────────
// A CJS consumer under moduleResolution node16/nodenext reads the "require"
// condition's own "types". Pointing both conditions at one .d.ts makes TS read
// the declarations as ESM (the package is "type": "module") and reject the
// require() call with TS1479 — the package would load but not typecheck.
for (const [subpath, cond] of Object.entries(pkg.exports)) {
  const label = `exports["${subpath}"]`
  for (const [condName, ext] of [['import', '.d.ts'], ['require', '.d.cts']]) {
    const entry = cond?.[condName]
    const types = typeof entry === 'object' && entry !== null ? entry.types : undefined
    if (typeof types !== 'string') {
      fail(label, new Error(`"${condName}" condition has no own "types" (CJS consumers need a ${ext})`))
      continue
    }
    if (!types.endsWith(ext)) {
      fail(label, new Error(`"${condName}".types is ${types}, expected a ${ext} file`))
      continue
    }
    if (!existsSync(join(root, types))) {
      fail(label, new Error(`"${condName}".types points at ${types}, which the build did not emit`))
      continue
    }
    console.log(`ok   ${label} "${condName}".types -> ${types}`)
  }
}

if (failures > 0) {
  console.error(`\nsmoke-entrypoints: ${failures} check(s) FAILED — the artifact is broken, do not ship`)
  process.exit(1)
}
console.log(`\nsmoke-entrypoints: all ${subpaths.length} exports load, work, share the root's classes, and declare types under require() and import()`)
