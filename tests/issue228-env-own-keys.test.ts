// tests/issue228-env-own-keys.test.ts
//
// #228 — a substitution reads the environment through its own keys only. The
// environment is a plain object, so `env[name]` used to answer `${?constructor}`
// or `${?toString}` with an Object.prototype member instead of "unset".

import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { ResolveError } from '../src/errors.js'

const PROTOTYPE_NAMES = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']

describe('#228 substitutions read the environment by own keys', () => {
  for (const name of PROTOTYPE_NAMES) {
    it(`\${?${name}} is unset when the environment does not set it`, () => {
      const c = parse(`a = \${?${name}}\nb = "x"\${?${name}}`, { env: { HOME: '/h' } })
      expect(c.toObject()).toEqual({ b: 'x' })
    })

    it(`\${${name}} is an error when the environment does not set it`, () => {
      expect(() => parse(`a = \${${name}}`, { env: {} })).toThrow(ResolveError)
    })
  }

  it('a prototype-named variable the environment does set is read', () => {
    const env: Record<string, string> = {}
    Object.defineProperty(env, '__proto__', { value: 'p', enumerable: true })
    env.constructor = 'c'
    const c = parse('a = ${constructor}\nb = ${__proto__}', { env })
    expect(c.getString('a')).toBe('c')
    expect(c.getString('b')).toBe('p')
  })

  it('a null-prototype environment works', () => {
    const env = Object.assign(Object.create(null) as Record<string, string>, { PORT: '8080' })
    expect(parse('a = ${PORT}\nb = ${?toString}', { env }).toObject()).toEqual({ a: '8080' })
  })

  it('the prefixed fallback of a nested substitution reads own keys only', () => {
    // `${?x.toString}` inside `x` is relativized; neither the full name nor the
    // bare name may come from the prototype.
    const c = parse('x { a = ${?toString} }', { env: {} })
    expect(c.toObject()).toEqual({ x: {} })
  })

  it('list expansion reads own keys only', () => {
    const env = Object.create({ LIST_0: 'inherited' }) as Record<string, string>
    const c = parse('a = ${?LIST[]}', { env })
    expect(c.toObject()).toEqual({})
  })
})
