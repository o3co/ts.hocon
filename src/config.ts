import { coerceBoolean, coerceNumber, parseBytes, parseDuration } from './coerce.js'
import type { ByteUnit, DurationUnit } from './coerce.js'
import { ConfigError } from './errors.js'
import { numericObjectToArray } from './value/numeric-array.js'
import type { HoconValue, ScalarValueType } from './value.js'

export class Config {
  constructor(private readonly root: HoconValue & { kind: 'object' }) {}

  get(path: string): unknown {
    const v = this.lookupNode(path)
    if (v === undefined) return undefined
    return hoconToJs(v)
  }

  getString(path: string): string {
    const v = this.requireScalar(path)
    return v.raw
  }

  getNumber(path: string): number {
    const v = this.requireScalar(path)
    const coerced = coerceNumber(v.raw)
    if (coerced !== undefined) return coerced
    throw new ConfigError(`expected number at ${path}, got ${v.valueType}`, path)
  }

  getBoolean(path: string): boolean {
    const v = this.requireScalar(path)
    const coerced = coerceBoolean(v.raw)
    if (coerced !== undefined) return coerced
    throw new ConfigError(`expected boolean at ${path}, got ${v.valueType}`, path)
  }

  getDuration(path: string, unit?: DurationUnit): number {
    const v = this.requireScalar(path)
    if (v.valueType !== 'string' && v.valueType !== 'number') {
      throw new ConfigError(`expected duration at ${path}, got ${v.valueType}`, path)
    }
    const result = parseDuration(v.raw, unit)
    if (Number.isNaN(result)) throw new ConfigError(`invalid duration at ${path}: ${JSON.stringify(v.raw)}`, path)
    return result
  }

  getBytes(path: string, unit?: ByteUnit): number {
    const v = this.requireScalar(path)
    if (v.valueType !== 'string' && v.valueType !== 'number') {
      throw new ConfigError(`expected byte size at ${path}, got ${v.valueType}`, path)
    }
    const result = parseBytes(v.raw, unit)
    if (Number.isNaN(result)) throw new ConfigError(`invalid byte size at ${path}: ${JSON.stringify(v.raw)}`, path)
    return result
  }

  getConfig(path: string): Config {
    const v = this.lookupNode(path)
    if (v === undefined) throw new ConfigError(`path not found: ${path}`, path)
    if (v.kind !== 'object') throw new ConfigError(`expected object at ${path}`, path)
    return new Config(v)
  }

  getList(path: string): unknown[] {
    const v = this.lookupNode(path)
    if (v === undefined) throw new ConfigError(`path not found: ${path}`, path)
    // S15: if the value is a numerically-keyed object, convert to array before type check.
    // Empty objects and objects with no eligible integer keys return null → fall through to error.
    if (v.kind === 'object') {
      const converted = numericObjectToArray(v)
      if (converted !== null) return converted.map(hoconToJs)
    }
    if (v.kind !== 'array') throw new ConfigError(`expected array at ${path}`, path)
    return v.items.map(hoconToJs)
  }

  has(path: string): boolean {
    return this.lookupNode(path) !== undefined
  }

  keys(): string[] {
    return [...this.root.fields.keys()]
  }

  withFallback(fallback: Config): Config {
    const merged = deepMergeHocon(this.root, fallback.root)
    return new Config(merged)
  }

  toObject(): unknown {
    return hoconToJs(this.root)
  }

  private lookupNode(path: string): HoconValue | undefined {
    const segments = splitConfigPath(path)
    let current: HoconValue = this.root
    for (const seg of segments) {
      if (current.kind !== 'object') return undefined
      const next = current.fields.get(seg)
      if (next === undefined) return undefined
      current = next
    }
    return current
  }

  private requireScalar(path: string): { raw: string; valueType: ScalarValueType } {
    const v = this.lookupNode(path)
    if (v === undefined) throw new ConfigError(`path not found: ${path}`, path)
    if (v.kind !== 'scalar') throw new ConfigError(`expected scalar at ${path}, got ${v.kind}`, path)
    return v
  }
}

function splitConfigPath(path: string): string[] {
  const segments: string[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '"') {
      i++
      let segment = ''
      let closed = false
      while (i < path.length) {
        const ch = path[i]
        if (ch === '\\' && i + 1 < path.length) {
          const next = path[i + 1]
          segment += next
          i += 2
          continue
        }
        if (ch === '"') {
          closed = true
          i++
          break
        }
        segment += ch
        i++
      }
      if (!closed) throw new ConfigError(`unterminated quoted path segment: ${path}`, path)
      segments.push(segment)
      if (i < path.length && path[i] === '.') i++
    } else {
      const dot = path.indexOf('.', i)
      if (dot === -1) {
        segments.push(path.slice(i))
        break
      }
      segments.push(path.slice(i, dot))
      i = dot + 1
    }
  }
  return segments
}

function scalarToJs(raw: string, valueType: ScalarValueType): unknown {
  switch (valueType) {
    case 'null': return null
    case 'boolean': return raw === 'true'
    case 'number': return Number(raw)
    case 'string': return raw
  }
}

function hoconToJs(v: HoconValue): unknown {
  switch (v.kind) {
    case 'scalar': return scalarToJs(v.raw, v.valueType)
    case 'array': return v.items.map(hoconToJs)
    case 'object': {
      const obj: Record<string, unknown> = {}
      for (const [k, val] of v.fields) obj[k] = hoconToJs(val)
      return obj
    }
  }
}

function deepMergeHocon(
  receiver: HoconValue & { kind: 'object' },
  fallback: HoconValue & { kind: 'object' },
): HoconValue & { kind: 'object' } {
  const merged = new Map(fallback.fields)
  for (const [k, v] of receiver.fields) {
    const fb = merged.get(k)
    if (fb?.kind === 'object' && v.kind === 'object') {
      merged.set(k, deepMergeHocon(v, fb))
    } else {
      merged.set(k, v)
    }
  }
  return { kind: 'object', fields: merged }
}
