import YAML from 'yaml'
import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'

/**
 * Read a YAML document as HOCON config, via `yaml` (eemeli).
 *
 * The library follows the YAML 1.2 core schema, so the "Norway problem" does
 * not arise: `no`, `yes`, `on` and `off` stay strings and only `true`/`false`
 * are booleans (spec F5.1).
 *
 * Anchors, aliases and merge keys are resolved before the tree is mapped, and
 * non-string scalar keys arrive as their string forms (F5.2, F5.3). A
 * multi-document stream is refused: a config is one document, and this library
 * throws on the second rather than dropping it silently (F5.7).
 *
 * See docs/specs/format-ingestion-mapping.md items F5.x in the hocon scope.
 */
export function parseYaml(input: string, originDescription?: string): Config {
  // merge: true is required — without it `<<` stays a literal key rather
  // than merging, which would silently produce a `<<` field (spec F5.2).
  const docs = YAML.parseAllDocuments(input, { merge: true })
  if (docs.length > 1) {
    throw new ConfigError(
      'yaml: multi-document streams are not supported (spec F5.7); a config is one document',
      '',
    )
  }
  const doc = docs[0]
  if (doc === undefined) return fromMap({}, originDescription)
  if (doc.errors.length > 0) {
    throw new ConfigError(`yaml: ${doc.errors[0]?.message ?? 'parse error'}`, '')
  }

  const value: unknown = doc.toJS({ mapAsMap: false })
  // An empty document is the empty object, as an empty HOCON document is
  // (S3.1), rather than a root-type failure (spec F5.9).
  if (value === null || value === undefined) return fromMap({}, originDescription)
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(
      `yaml: document root is ${Array.isArray(value) ? 'an array' : typeof value}, but a config root must be an object (spec F0.3)`,
      '',
    )
  }
  return fromMap(convert(value, '') as Record<string, unknown>, originDescription)
}

function convert(v: unknown, atPath: string): unknown {
  if (Array.isArray(v)) return v.map((e, i) => convert(e, `${atPath}[${i}]`))
  if (v instanceof Uint8Array) {
    // !!binary — HOCON has no binary type, so keep the base64 text the source
    // itself carried (spec F5.5).
    return btoa(String.fromCharCode(...v))
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      out[k] = convert(e, atPath === '' ? k : `${atPath}.${k}`)
    }
    return out
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new ConfigError(
      `yaml: ${v} at "${atPath}" is not representable in HOCON (spec F0.6)`,
      atPath,
    )
  }
  return v
}
