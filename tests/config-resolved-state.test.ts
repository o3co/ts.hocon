// tests/config-resolved-state.test.ts
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import { Config } from '../src/config.js'

describe('Config.isResolved', () => {
  it('fused parse() produces a resolved Config', () => {
    const c = parse('a = 1')
    expect(c.isResolved()).toBe(true)
  })

  it('Config constructed directly with resolved=true reports isResolved=true', () => {
    // Tests the constructor extension (resolved flag).
    const val: Parameters<typeof Config['_fromResolvedValue']>[0] =
      { kind: 'object', fields: new Map([['a', { kind: 'scalar', raw: '1', valueType: 'number' as const }]]) }
    const c = Config._fromResolvedValue(val)
    expect(c.isResolved()).toBe(true)
  })
})
