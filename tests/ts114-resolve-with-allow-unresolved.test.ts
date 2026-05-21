import { describe, it, expect } from 'vitest'
import { parseStringWithOptions, fromMap } from '../src/index.js'
import { NotResolvedError } from '../src/errors.js'

describe('ts#114 — resolveWith(allowUnresolved:true) placeholder tracking', () => {
  it('returns isResolved()=false when allowUnresolved is true and substitution is still unmet', () => {
    const r = parseStringWithOptions('a = ${missing}', { resolveSubstitutions: false })
    const src = fromMap({ key: 'val' })
    const out = r.resolveWith(src, { allowUnresolved: true })
    expect(out.isResolved()).toBe(false)
  })

  it('getter on unresolved-path-through-resolveWith throws NotResolvedError', () => {
    const r = parseStringWithOptions('a = ${missing}', { resolveSubstitutions: false })
    const src = fromMap({ key: 'val' })
    const out = r.resolveWith(src, { allowUnresolved: true })
    expect(() => out.getString('a')).toThrow(NotResolvedError)
  })

  it('returns isResolved()=true when allowUnresolved is true and substitution gets satisfied by source', () => {
    const r = parseStringWithOptions('a = ${key}', { resolveSubstitutions: false })
    const src = fromMap({ key: 'val' })
    const out = r.resolveWith(src, { allowUnresolved: true })
    expect(out.isResolved()).toBe(true)
    expect(out.getString('a')).toBe('val')
  })
})
