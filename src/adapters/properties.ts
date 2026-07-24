import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { parseProperties } from '../internal/properties/properties.js'

/**
 * Read a `java.util.Properties` file as HOCON config.
 *
 * The result is a fully resolved Config holding only strings, so it works as a
 * fallback layer under your own document:
 *
 * ```ts
 * const base = parsePropertiesConfig(readFileSync('service.properties', 'utf-8'))
 * const cfg = parse(readFileSync('app.conf', 'utf-8'), { resolveSubstitutions: false })
 * const merged = cfg.withFallback(base).resolve()
 * ```
 *
 * Deferring resolution matters: the default `parse` resolves as it goes, so a
 * `${...}` pointing into the Properties file would fail before the fallback is
 * ever attached.
 *
 * A `${a.b}` in a value stays that literal text — the file belongs to another
 * program that never agreed to HOCON's syntax (spec F0.2).
 *
 * Shares its syntax layer with `include "x.properties"`, so the two cannot
 * drift apart.
 */
export function parsePropertiesConfig(input: string, originDescription?: string): Config {
  return fromMap(parseProperties(input), originDescription)
}
