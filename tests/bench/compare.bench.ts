// tests/bench/compare.bench.ts
import { describe, bench } from 'vitest'
import { parse } from '../../src/parse.js'
import { fixtures } from './fixtures.js'

describe('compare - small config (10 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.small.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.small.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})

describe('compare - medium config (100 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.medium.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.medium.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})

describe('compare - large config (1000 keys)', () => {
  bench('ts.hocon', () => {
    const config = parse(fixtures.large.hocon)
    config.getString('group0.key0')
  })

  bench('JSON.parse', () => {
    const obj = JSON.parse(fixtures.large.json) as Record<string, Record<string, string>>
    obj['group0']['key0']
  })
})
