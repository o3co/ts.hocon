import type { ZodType } from 'zod'
import type { Config } from './config.js'

export function validate<T>(config: Config, schema: ZodType<T>): T {
  const plain = config.toObject()
  return schema.parse(plain)
}

export function getValidated<T>(config: Config, path: string, schema: ZodType<T>): T {
  const val = config.get(path)
  return schema.parse(val)
}
