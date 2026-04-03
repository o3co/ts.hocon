import { describe, it, expect } from 'vitest'
import { parseProperties } from '../src/internal/properties/properties.js'

describe('parseProperties', () => {
  it('parses simple key=value pairs', () => {
    const result = parseProperties('host=localhost\nport=8080')
    expect(result).toEqual({ host: 'localhost', port: '8080' })
  })

  it('parses key:value with colon separator', () => {
    const result = parseProperties('host:localhost')
    expect(result).toEqual({ host: 'localhost' })
  })

  it('trims whitespace around key and value', () => {
    const result = parseProperties('  host  =  localhost  ')
    expect(result).toEqual({ host: 'localhost' })
  })

  it('skips comment lines (# and !)', () => {
    const result = parseProperties('# comment\n! also comment\nkey=val')
    expect(result).toEqual({ key: 'val' })
  })

  it('skips empty lines', () => {
    const result = parseProperties('\n\nkey=val\n\n')
    expect(result).toEqual({ key: 'val' })
  })

  it('expands dotted keys into nested objects', () => {
    const result = parseProperties('server.host=localhost\nserver.port=8080')
    expect(result).toEqual({
      server: { host: 'localhost', port: '8080' }
    })
  })

  it('all values are strings (no type coercion)', () => {
    const result = parseProperties('num=42\nbool=true\nnull=null')
    expect(result).toEqual({ num: '42', bool: 'true', null: 'null' })
  })

  it('should not pollute prototype via __proto__ key', () => {
    parseProperties('__proto__.polluted=true')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
