// tests/lightbend/lightbend.test.ts
//
// Lightbend HOCON spec compliance tests, mirroring go.hocon's lightbend_test.go.
// Tests equiv01-05 directories (each .conf compared against original.json).
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../../src/parse.js'

const dataDir = new URL('./testdata', import.meta.url).pathname

// Known skip reasons for specific test files
const equivSkip = new Set([
  'equiv03/includes.conf', // requires .properties file support
])

describe('Lightbend HOCON equiv tests', () => {
  for (let i = 1; i <= 5; i++) {
    const dir = join(dataDir, `equiv${String(i).padStart(2, '0')}`)
    const jsonPath = join(dir, 'original.json')
    if (!existsSync(jsonPath)) continue

    const expected = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    const entries = readdirSync(dir)

    for (const entry of entries) {
      if (!entry.endsWith('.conf')) continue
      const rel = `equiv${String(i).padStart(2, '0')}/${entry}`
      if (equivSkip.has(rel)) continue

      it(rel, () => {
        const confPath = join(dir, entry)
        const confContent = readFileSync(confPath, 'utf-8')
        const config = parse(confContent, { baseDir: dir })
        expect(config.toObject()).toEqual(expected)
      })
    }
  }
})
