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
    const entries = readdirSync(dir).sort()

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

describe('Lightbend HOCON suite tests (expected JSON)', () => {
  const expectedDir = join(dataDir, 'expected')
  if (!existsSync(expectedDir)) {
    throw new Error(`Missing expected JSON fixtures at ${expectedDir}. Run \`make testdata\` first.`)
  }

  // Known failures — skip these with reasons
  const skip = new Set([
    'file-include-expected.json',  // file include resolves extra keys (bar-file, baz) not in expected
    'test01-expected.json',        // env vars (system.path/pwd) differ per machine; also .33 parsed as number vs string, null handling
    'test02-expected.json',        // empty-string key substitution ${""."".""}  not resolved
    'test10-expected.json',        // nested include substitution scope
  ])

  const entries = readdirSync(expectedDir).sort()
  for (const entry of entries) {
    if (!entry.endsWith('-expected.json') || entry.includes('-expected-error')) continue

    const confName = entry.replace('-expected.json', '.conf')

    if (skip.has(entry)) {
      it.skip(`${confName} (known failure)`, () => {})
      continue
    }

    const confPath = join(dataDir, confName)
    if (!existsSync(confPath)) continue

    it(confName, () => {
      const confContent = readFileSync(confPath, 'utf-8')
      const config = parse(confContent, { baseDir: dataDir })
      const got = config.toObject()

      const expectedContent = readFileSync(join(expectedDir, entry), 'utf-8')
      const expected = JSON.parse(expectedContent)

      expect(got).toEqual(expected)
    })
  }
})

describe('Lightbend HOCON suite tests (expected errors)', () => {
  const expectedDir = join(dataDir, 'expected')
  if (!existsSync(expectedDir)) {
    throw new Error(`Missing expected JSON fixtures at ${expectedDir}. Run \`make testdata\` first.`)
  }

  const entries = readdirSync(expectedDir).sort()
  for (const entry of entries) {
    if (!entry.endsWith('-expected-error.json')) continue

    const confName = entry.replace('-expected-error.json', '.conf')
    const confPath = join(dataDir, confName)
    if (!existsSync(confPath)) continue

    it(`${confName} should error`, () => {
      const confContent = readFileSync(confPath, 'utf-8')
      expect(() => parse(confContent, { baseDir: dataDir })).toThrow()
    })
  }
})
