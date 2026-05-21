// tests/resolver-phase-split.test.ts
import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/internal/lexer/lexer.js'
import { parseTokens } from '../src/internal/parser/parser.js'
import { buildTree, resolveTree, containsPlaceholders } from '../src/internal/resolver/resolver.js'
import { isSubst } from '../src/internal/resolver/types.js'

function makeOpts(overrides: Partial<Parameters<typeof buildTree>[1]> = {}) {
  return {
    env: {},
    baseDir: undefined,
    readFileSync: (_p: string): string => { throw new Error('no files') },
    ...overrides,
  }
}

function parseStr(input: string) {
  return parseTokens(tokenize(input))
}

describe('buildTree — leaves substitution placeholders', () => {
  it('leaves SubstPlaceholder for unresolved substitution', () => {
    const ast = parseStr('a = ${b}\nb = 1')
    const tree = buildTree(ast, makeOpts())
    const a = tree.fields.get('a')
    expect(a).toBeDefined()
    expect(isSubst(a!)).toBe(true)
  })
})

describe('resolveTree — resolves placeholders', () => {
  it('resolves ${b} where b = 1', () => {
    const ast = parseStr('a = ${b}\nb = 1')
    const tree = buildTree(ast, makeOpts())
    const result = resolveTree(tree, makeOpts())
    expect(result.kind).toBe('object')
    if (result.kind !== 'object') return
    const a = result.fields.get('a')
    expect(a).toEqual({ kind: 'scalar', raw: '1', valueType: 'number' })
  })
})

describe('resolveTree — allowUnresolved keeps placeholder', () => {
  it('leaves SubstPlaceholder in place when allowUnresolved=true', () => {
    const ast = parseStr('a = ${missing}')
    const tree = buildTree(ast, makeOpts())
    // allowUnresolved=true, useSystemEnvironment=false → no env lookup, no throw
    const result = resolveTree(tree, makeOpts({ allowUnresolved: true, useSystemEnvironment: false }))
    expect(result.kind).toBe('object')
    if (result.kind !== 'object') return
    const a = result.fields.get('a')
    // Value is left as-is (SubstPlaceholder survives into the output map)
    expect(a).toBeDefined()
    expect(isSubst(a as object)).toBe(true)
  })
})

describe('containsPlaceholders', () => {
  it('returns true for unresolved tree, false for resolved tree', () => {
    const ast = parseStr('a = ${b}\nb = 1')
    const tree = buildTree(ast, makeOpts())
    expect(containsPlaceholders(tree)).toBe(true)
    // After resolveTree the output is a plain HoconValue — no placeholders
    // containsPlaceholders works on ResObj; test the pre-resolution tree only
    // (the fully-resolved output is a HoconValue, not a ResObj).
    // Verify the tree itself reports true before resolution.
    buildTree(parseStr('x = 1'), makeOpts())
    const trivialTree = buildTree(parseStr('x = 1'), makeOpts())
    expect(containsPlaceholders(trivialTree)).toBe(false)
  })
})
