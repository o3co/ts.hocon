// tests/parse-options.test.ts
import { describe, expect, it } from 'vitest'
import { defaultParseOptions, defaultResolveOptions } from '../src/parse.js'

describe('defaultParseOptions', () => {
  it('resolveSubstitutions defaults to true', () => {
    const opts = defaultParseOptions()
    expect(opts.resolveSubstitutions).toBe(true)
  })

  it('originDescription defaults to undefined', () => {
    const opts = defaultParseOptions()
    expect(opts.originDescription).toBeUndefined()
  })

  it('override via spread', () => {
    const opts = { ...defaultParseOptions(), resolveSubstitutions: false }
    expect(opts.resolveSubstitutions).toBe(false)
  })
})

describe('defaultResolveOptions', () => {
  it('useSystemEnvironment defaults to true', () => {
    const opts = defaultResolveOptions()
    expect(opts.useSystemEnvironment).toBe(true)
  })

  it('allowUnresolved defaults to false', () => {
    const opts = defaultResolveOptions()
    expect(opts.allowUnresolved).toBe(false)
  })

  it('override via spread', () => {
    const opts = { ...defaultResolveOptions(), allowUnresolved: true, useSystemEnvironment: false }
    expect(opts.allowUnresolved).toBe(true)
    expect(opts.useSystemEnvironment).toBe(false)
  })
})
