// tests/bench/parse.bench.ts
import { describe, bench } from 'vitest'
import { parse } from '../../src/parse.js'
import { fixtures } from './fixtures.js'

describe('parse - config size', () => {
  bench('small (10 keys)', () => {
    const config = parse(fixtures.small.hocon)
    config.getString('group0.key0')
  })

  bench('medium (100 keys)', () => {
    const config = parse(fixtures.medium.hocon)
    config.getString('group0.key0')
  })

  bench('large (1000 keys)', () => {
    const config = parse(fixtures.large.hocon)
    config.getString('group0.key0')
  })
})

describe('parse - substitutions', () => {
  bench('10 substitutions', () => {
    const config = parse(fixtures.substitutions10.hocon)
    config.getString('sub0')
  })

  bench('50 substitutions', () => {
    const config = parse(fixtures.substitutions50.hocon)
    config.getString('sub0')
  })

  bench('100 substitutions', () => {
    const config = parse(fixtures.substitutions100.hocon)
    config.getString('sub0')
  })
})

describe('parse - deep nesting', () => {
  bench('depth 5', () => {
    const config = parse(fixtures.deepNest5.hocon)
    config.getString('level0.level1.level2.level3.level4.key0')
  })

  bench('depth 10', () => {
    const config = parse(fixtures.deepNest10.hocon)
    config.getString('level0.level1.level2.level3.level4.level5.level6.level7.level8.level9.key0')
  })

  bench('depth 20', () => {
    const config = parse(fixtures.deepNest20.hocon)
    config.getString(
      Array.from({ length: 20 }, (_, i) => `level${i}`).join('.') + '.key0'
    )
  })
})
