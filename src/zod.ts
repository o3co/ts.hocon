import type { ZodType } from 'zod'

import { coerceBoolean, coerceNumber } from './coerce.js'
import type { Config } from './config.js'

export function validate<T>(config: Config, schema: ZodType<T>): T {
  const plain = config.toObject()
  const coerced = coerceValue(plain, schema)
  return schema.parse(coerced)
}

export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  const val = config.get(path)
  const coerced = coerceValue(val, schema)
  return schema.parse(coerced)
}

function getDefType(schema: ZodType): string | undefined {
  const zod = (schema as any)._zod
  return zod?.def?.type
}

function getInnerSchema(schema: ZodType): ZodType | undefined {
  const def = (schema as any)._zod?.def
  return def?.innerType ?? def?.schema
}

function coerceValue(value: unknown, schema: ZodType): unknown {
  if (value === null || value === undefined) return value

  const defType = getDefType(schema)
  if (!defType) return value

  switch (defType) {
    case 'boolean':
      if (typeof value === 'string') {
        const coerced = coerceBoolean(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'number':
    case 'int':
      if (typeof value === 'string') {
        const coerced = coerceNumber(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const shape = (schema as any)._zod?.def?.shape
      if (!shape || typeof shape !== 'object') return value
      const result: Record<string, unknown> = {}
      const obj = value as Record<string, unknown>
      for (const key of Object.keys(obj)) {
        const fieldSchema = shape[key]
        result[key] = fieldSchema ? coerceValue(obj[key], fieldSchema) : obj[key]
      }
      return result
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = (schema as any)._zod?.def?.element
      if (!elementSchema) return value
      return value.map((item) => coerceValue(item, elementSchema))
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner) : value
    }

    default:
      return value
  }
}
