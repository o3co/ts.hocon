import { ConfigError } from './errors.js'
import type { HoconValue } from './value.js'

export class Config {
  constructor(private readonly root: HoconValue & { kind: 'object' }) {}

  get(path: string): unknown {
    const v = this.lookupNode(path)
    if (v === undefined) return undefined
    return hoconToJs(v)
  }

  getString(path: string): string {
    const v = this.requireScalar(path)
    if (typeof v !== 'string') throw new ConfigError(`expected string at ${path}, got ${typeof v}`, path)
    return v
  }

  getNumber(path: string): number {
    const v = this.requireScalar(path)
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (!Number.isNaN(n)) return n
    }
    throw new ConfigError(`expected number at ${path}, got ${typeof v}`, path)
  }

  getBoolean(path: string): boolean {
    const v = this.requireScalar(path)
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      if (v === 'true') return true
      if (v === 'false') return false
    }
    throw new ConfigError(`expected boolean at ${path}, got ${typeof v}`, path)
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
    const segments = path.split('.')
    let current: HoconValue = this.root
    for (const seg of segments) {
      if (current.kind !== 'object') return undefined
      const next = current.fields.get(seg)
      if (next === undefined) return undefined
      current = next
    }
    return current
  }

  private requireScalar(path: string): string | number | boolean | null {
    const v = this.lookupNode(path)
    if (v === undefined) throw new ConfigError(`path not found: ${path}`, path)
    if (v.kind !== 'scalar') throw new ConfigError(`expected scalar at ${path}, got ${v.kind}`, path)
    return v.value
  }
}

function hoconToJs(v: HoconValue): unknown {
  switch (v.kind) {
    case 'scalar': return v.value
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
