// tools/smoke-entrypoints.mjs
//
// Regression gate for the published artifact: after `pnpm build`, every
// subpath in package.json "exports" must load under BOTH module systems.
// v1.10.0 shipped with all seven CJS entrypoints throwing at load time
// (createRequire(import.meta.url) with import.meta shimmed to {} by the CJS
// bundle), which `pnpm test` cannot catch — vitest imports src/, not dist/.
//
// Uses Node's package self-reference (the "name" + "exports" fields), so the
// exact export map that ships is what gets exercised, `require` condition and
// `import` condition both.
//
// Usage: node tools/smoke-entrypoints.mjs   (run `pnpm build` first)

import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const require = createRequire(import.meta.url)

if (!existsSync(join(root, 'dist'))) {
  console.error('smoke-entrypoints: dist/ not found — run `pnpm build` first')
  process.exit(1)
}

const subpaths = Object.keys(pkg.exports)
if (subpaths.length === 0) {
  console.error('smoke-entrypoints: package.json has no "exports" — nothing to check?')
  process.exit(1)
}

let failures = 0

for (const subpath of subpaths) {
  const specifier = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1)

  // CJS: require() must not throw and must expose at least one export.
  try {
    const mod = require(specifier)
    if (mod === null || typeof mod !== 'object' || Object.keys(mod).length === 0) {
      throw new Error('module loaded but exposes no exports')
    }
    console.log(`ok   require('${specifier}')`)
  } catch (e) {
    failures++
    console.error(`FAIL require('${specifier}'): ${e.message.split('\n')[0]}`)
  }

  // ESM: import() must not throw and must expose at least one export.
  try {
    const mod = await import(specifier)
    if (Object.keys(mod).length === 0) {
      throw new Error('module loaded but exposes no exports')
    }
    console.log(`ok   import('${specifier}')`)
  } catch (e) {
    failures++
    console.error(`FAIL import('${specifier}'): ${e.message.split('\n')[0]}`)
  }
}

if (failures > 0) {
  console.error(`\nsmoke-entrypoints: ${failures} entrypoint load(s) FAILED — the artifact is broken, do not ship`)
  process.exit(1)
}
console.log(`\nsmoke-entrypoints: all ${subpaths.length} exports load under require() and import()`)
