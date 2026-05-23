// tests/key-hyphen-position.test.ts
//
// Key-position S8.6 conformance (xx.hocon#42, E13) — kh01-kh08 fixtures.
// Fixture inputs:  tests/lightbend/testdata/hocon/key-hyphen-position/*.conf
// Expected outputs: tests/lightbend/testdata/expected/key-hyphen-position/
//
// HOCON.md L270-276 (S8.6) forbids unquoted strings from BEGINNING with `-`
// (unless followed by a digit). That rule is value-position only: Lightbend's
// path parser accepts hyphen-start segments verbatim in field-key position.
// ts.hocon previously over-enforced S8.6 on every dot-split key segment,
// rejecting all 8 cases. See docs/extra-spec-conventions.md E13 (xx.hocon).
//
// All 8 fixtures are success fixtures (no .error sidecars).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/index.js'

const confDir = fileURLToPath(new URL('./lightbend/testdata/hocon/key-hyphen-position', import.meta.url))
const expectedDir = fileURLToPath(new URL('./lightbend/testdata/expected/key-hyphen-position', import.meta.url))

const SUCCESS_FIXTURES = [
  'kh01-space-concat-hyphen-tail',          // foo -bar = 1               → {"foo -bar":1}
  'kh02-dotted-then-space-hyphen-tail',     // a.b -bar = 1               → {"a":{"b -bar":1}}
  'kh03-quoted-then-space-hyphen-tail',     // "foo" -bar = 1             → {"foo -bar":1}
  'kh04-space-concat-dot-hyphen-start',     // foo bar.-baz = 1           → {"foo bar":{"-baz":1}}
  'kh05-first-token-hyphen-start',          // -foo bar = 1               → {"-foo bar":1}
  'kh06-trailing-hyphen-only',              // foo - = 1                  → {"foo -":1}
  'kh07-dot-hyphen-start-segment',          // foo.-bar = 1               → {"foo":{"-bar":1}}
  'kh08-space-concat-hyphen-digit-tail',    // foo -1bar = 1              → {"foo -1bar":1}
]

describe('key-hyphen-position — kh01-kh08 fixture conformance (xx.hocon#42, E13)', () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name}: parses and resolves to expected JSON`, () => {
      const conf = readFileSync(join(confDir, `${name}.conf`), 'utf-8')
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${name}-expected.json`), 'utf-8'),
      )
      expect(parse(conf).toObject()).toEqual(expected)
    })
  }
})
