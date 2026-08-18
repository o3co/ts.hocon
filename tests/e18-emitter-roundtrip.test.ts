// tests/e18-emitter-roundtrip.test.ts
//
// E18 — the shared emitter round-trip corpus (xx.hocon
// testdata/emitter-roundtrip/, synced by `make testdata`). Each fixture is a
// JSON value tree; the contract is parse(render(tree)) == tree, compared as
// trees, never as text. See xx.hocon docs/extra-spec-conventions.md §E18.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseString } from '../src/parse.js'
import { fromMap } from '../src/value-factory.js'

const corpusDir = new URL('./testdata/emitter-roundtrip', import.meta.url).pathname

describe('E18 emitter round-trip corpus', () => {
  if (!existsSync(corpusDir)) {
    it.skip('emitter-roundtrip corpus not synced — run `make testdata`', () => {})
    return
  }

  const fixtures = readdirSync(corpusDir)
    .filter(f => f.endsWith('.json'))
    .sort()

  it('corpus directory holds fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const name of fixtures) {
    it(name.replace(/\.json$/, ''), () => {
      // Corpus numbers stay within 2^53 by convention (E18), so JSON.parse
      // reads every fixture number exactly; go's json.Number int64/float64
      // split is not needed under the JS number model.
      const tree = JSON.parse(readFileSync(join(corpusDir, name), 'utf-8')) as Record<string, unknown>
      const cfg = fromMap(tree, name)
      const before = cfg._renderJSONForTest()
      const text = cfg.renderHocon()
      let reparsed
      try {
        reparsed = parseString(text)
      } catch (e) {
        throw new Error(`re-parse of emitted HOCON failed: ${String(e)}\n--- emitted ---\n${text}`)
      }
      expect(
        reparsed._renderJSONForTest(),
        `round trip changed the tree\n--- emitted ---\n${text}`,
      ).toBe(before)
    })
  }
})
