// tests/conformance/format-ingestion.test.ts
//
// Conformance against the shared format-ingestion fixtures from xx.hocon.
//
// These expectations are not oracle-generated — Lightbend has no equivalent of
// these adapters — so they encode the project's own F-item decisions. Their
// value is cross-implementation: all four must agree with them, and with each
// other. See tests/lightbend/testdata/format-ingestion/manifest.json.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Config } from '../../src/config.js'
import { loadEnv, parseDotEnv } from '../../src/adapters/env.js'
import { parseJsonc } from '../../src/adapters/jsonc.js'
import { parseTomlConfig } from '../../src/adapters/toml.js'
import { parseYaml } from '../../src/adapters/yaml.js'

const root = fileURLToPath(new URL('../lightbend/testdata/format-ingestion', import.meta.url))

type Case = {
  id: string
  format: string
  input: string
  kind?: string
  expect: 'ok' | 'error'
  expected?: string
  cites?: string
  note: string
}

describe('format-ingestion fixtures (xx.hocon)', () => {
  if (!existsSync(join(root, 'manifest.json'))) {
    it.skip('fixtures unavailable — run `make testdata`', () => {})
    return
  }

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as {
    cases: Case[]
  }
  expect(manifest.cases.length).toBeGreaterThan(0)

  const ingest = (c: Case): Config => {
    const text = readFileSync(join(root, c.input), 'utf-8')
    switch (c.format) {
      case 'jsonc':
        return parseJsonc(text, c.id)
      case 'toml':
        return parseTomlConfig(text, c.id)
      case 'yaml':
        return parseYaml(text, c.id)
      case 'env': {
        if (c.kind === 'dotenv') return parseDotEnv(text, { originDescription: c.id })
        const f = JSON.parse(text) as { prefix: string; vars: Record<string, string> }
        return loadEnv({ prefix: f.prefix, env: f.vars, originDescription: c.id })
      }
      default:
        throw new Error(`unknown format ${c.format}`)
    }
  }

  for (const c of manifest.cases) {
    it(`${c.id} — ${c.note}`, () => {
      if (c.expect === 'error') {
        let thrown: unknown
        try {
          ingest(c)
        } catch (e) {
          thrown = e
        }
        expect(thrown, `${c.id} should have been refused`).toBeDefined()
        if (c.cites !== undefined) {
          expect(String((thrown as Error).message)).toContain(c.cites)
        }
        return
      }
      const got = ingest(c).toObject()
      const want = JSON.parse(readFileSync(join(root, c.expected as string), 'utf-8'))
      expect(got).toEqual(want)
    })
  }
})
