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
// So this gate runs against the built output, and does three things:
//
//   1. LOADs every subpath in package.json "exports" under both module systems.
//   2. USEs it — calls the entrypoint's real function and checks the answer.
//   3. Checks each condition declares its own "types" of the right flavour.
//
// Step 2 is the point. A load-only check cannot see a defect whose whole nature
// is that it defers work to first use, which is what the `require`-shim bug was.
// The root and zod checks deliberately resolve `include package(...)`, the one
// code path whose behaviour differs between the two bundle formats.
//
// Usage: node tools/smoke-entrypoints.mjs   (`pnpm smoke` builds first)

import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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
  './adapters/toml': async (m) => {
    eq(m.parseTomlConfig('[db]\nhost = "local"\n').getString('db.host'), 'local', 'toml adapter')
  },
  './adapters/yaml': async (m) => {
    eq(m.parseYaml('db:\n  host: local\n').getString('db.host'), 'local', 'yaml adapter')
  },
}

const subpaths = Object.keys(pkg.exports)
if (subpaths.length === 0) {
  console.error('smoke-entrypoints: package.json has no "exports" — nothing to check?')
  process.exit(1)
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
console.log(`\nsmoke-entrypoints: all ${subpaths.length} exports load, work, and declare types under require() and import()`)
