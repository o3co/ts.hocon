import type { ZodType } from 'zod'

import { coerceBoolean, coerceNumber } from './coerce.js'
import type { Config } from './config.js'
import { parse, parseFile } from './parse.js'
import type { ParseOptions } from './parse.js'

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
  // Zod v4 wrapper types (optional, nullable, default, catch, readonly) store
  // the wrapped schema in `def.innerType`. The `def.schema` fallback is for
  // forward-compatibility in case future Zod versions change the property name.
  return def?.innerType ?? def?.schema
}

function getObjectShape(schema: ZodType): Record<string, ZodType> | undefined {
  const shape = (schema as any)._zod?.def?.shape
  return typeof shape === 'object' && shape !== null ? shape : undefined
}

function getArrayElement(schema: ZodType): ZodType | undefined {
  return (schema as any)._zod?.def?.element
}

export function parseWithSchema<T>(input: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parse(input, opts)
  return validate(config, schema)
}

export function parseFileWithSchema<T>(filePath: string, schema: ZodType<T>, opts?: ParseOptions): T {
  const config = parseFile(filePath, opts)
  return validate(config, schema)
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
      if (typeof value === 'string') {
        const coerced = coerceNumber(value)
        return coerced !== undefined ? coerced : value
      }
      return value

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const shape = getObjectShape(schema)
      if (!shape) return value
      const obj = value as Record<string, unknown>
      const result: Record<string, unknown> = { ...obj }
      for (const key of Object.keys(shape)) {
        if (key in obj) {
          result[key] = coerceValue(obj[key], shape[key])
        }
      }
      return result
    }

    case 'array': {
      if (!Array.isArray(value)) return value
      const elementSchema = getArrayElement(schema)
      if (!elementSchema) return value
      return value.map((item) => coerceValue(item, elementSchema))
    }

    case 'optional':
    case 'nullable':
    case 'default':
    case 'catch':
    case 'readonly': {
      const inner = getInnerSchema(schema)
      return inner ? coerceValue(value, inner) : value
    }

    default:
      return value
  }
}
