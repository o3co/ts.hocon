import { parse as parseToml } from 'smol-toml'
import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'
import { depthError, guardStackDepth } from '../internal/depth.js'

/**
 * Read a TOML document as HOCON config, via `smol-toml`.
 *
 * TOML's types line up with HOCON's apart from dates: HOCON has no datetime, so
 * all four TOML date-time types become their RFC 3339 string forms, which is
 * the honest representation rather than a lossy number (spec F4.2).
 *
 * `smol-toml` refuses an integer it cannot represent losslessly, so a value past
 * the safe-integer range is an error here rather than silently rounded — go's
 * adapter accepts those, its int64 being wide enough (spec F0.5).
 *
 * See docs/specs/format-ingestion-mapping.md items F4.x in the hocon scope.
 */
export function parseTomlConfig(input: string, originDescription?: string): Config {
  const doc = parseToml(stripBom(input)) as Record<string, unknown>
  return fromMap(
    guardStackDepth(
      () => convert(doc, '') as Record<string, unknown>,
      msg => depthError(`toml: ${msg}`),
    ),
    originDescription,
  )
}

function convert(v: unknown, atPath: string): unknown {
  if (Array.isArray(v)) return v.map((e, i) => convert(e, `${atPath}[${i}]`))
  if (v instanceof Date) {
    // TomlDate.toISOString() renders each of the four TOML date-time types in
    // its own shape: offset, local date-time, date only, time only. It always
    // writes milliseconds, so `07:32:00` comes back as `07:32:00.000`; trailing
    // zeros are dropped to keep the source's own precision, which is what
    // F4.2 pins and what Go's RFC3339Nano already did.
    return v.toISOString().replace(/\.(\d*?)0+(?=Z?$)/, (_m, keep: string) => (keep ? `.${keep}` : ''))
  }
  if (v !== null && typeof v === 'object') {
    // Object.fromEntries defines own data properties; the `{}` carrier this
    // replaced assigned through [[Set]], so a table named `__proto__` hit
    // Object.prototype's setter and disappeared (`[a.__proto__]` yielded
    // `{"a":{}}`). smol-toml hands it over correctly — the loss was here.
    // F2.9's principle: preserve every key, be safe by construction.
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(
        ([k, e]) => [k, convert(e, atPath === '' ? k : `${atPath}.${k}`)] as const,
      ),
    )
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new ConfigError(
      `toml: ${v} at "${atPath}" is not representable in HOCON (spec F0.6)`,
      atPath,
    )
  }
  return v
}
