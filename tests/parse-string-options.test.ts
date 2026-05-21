// tests/parse-string-options.test.ts
import { describe, expect, it } from 'vitest'
import { parseString, parseStringWithOptions, defaultParseOptions } from '../src/parse.js'

describe('parseString', () => {
  it('is an alias for parse — produces resolved Config', () => {
    const c = parseString('a = 1')
    expect(c.isResolved()).toBe(true)
    expect(c.getString('a')).toBe('1')
  })
})

describe('parseStringWithOptions', () => {
  it('resolveSubstitutions:true (default) — same as parseString', () => {
    const c = parseStringWithOptions('a = 1', defaultParseOptions())
    expect(c.isResolved()).toBe(true)
  })

  it('resolveSubstitutions:false — produces unresolved Config when subst present', () => {
    const c = parseStringWithOptions('a = ${b}', { resolveSubstitutions: false })
    expect(c.isResolved()).toBe(false)
  })

  it('resolveSubstitutions:false — still resolved when no substitutions', () => {
    // No placeholders in tree → isResolved is true even with flag=false
    const c = parseStringWithOptions('a = 1', { resolveSubstitutions: false })
    expect(c.isResolved()).toBe(true)
  })

  it('originDescription is carried on Config', () => {
    const c = parseStringWithOptions('a = 1', { originDescription: 'unit-test' })
    expect(c._originDescription).toBe('unit-test')
  })
})
