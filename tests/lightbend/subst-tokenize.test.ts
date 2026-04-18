// tests/lightbend/subst-tokenize.test.ts
//
// Conformance tests for substitution body tokenization.
// Auto-discovers xx.hocon subst-tokenize fixtures from testdata/subst-tokenize/.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../../src/parse.js'

const dataDir = fileURLToPath(new URL('./testdata/subst-tokenize', import.meta.url))
const expectedDir = fileURLToPath(new URL('./testdata/expected/subst-tokenize', import.meta.url))

describe('subst-tokenize conformance: success', () => {
  if (!existsSync(expectedDir)) {
    it.skip('fixtures missing — run `make testdata`', () => {})
    return
  }

  for (const entry of readdirSync(expectedDir).sort()) {
    if (!entry.endsWith('-expected.json')) continue
    const confName = entry.replace('-expected.json', '.conf')
    it(confName, () => {
      const confPath = join(dataDir, confName)
      const conf = readFileSync(confPath, 'utf-8')
      const expected = JSON.parse(readFileSync(join(expectedDir, entry), 'utf-8'))
      const config = parse(conf)
      expect(config.toObject()).toEqual(expected)
    })
  }
})

describe('subst-tokenize conformance: errors', () => {
  if (!existsSync(expectedDir)) {
    it.skip('fixtures missing — run `make testdata`', () => {})
    return
  }

  for (const entry of readdirSync(expectedDir).sort()) {
    if (!entry.endsWith('-expected-error.json')) continue
    const confName = entry.replace('-expected-error.json', '.conf')
    it(`${confName} should throw`, () => {
      const confPath = join(dataDir, confName)
      const conf = readFileSync(confPath, 'utf-8')
      expect(() => parse(conf)).toThrow()
    })
  }
})
