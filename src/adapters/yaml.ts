import YAML from 'yaml'
import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'

/**
 * Read a YAML document as HOCON config.
 *
 * This is a HOCON library, not a YAML implementation, and the API keeps that
 * boundary. What this package owns is the decoded-tree → HOCON step, exposed
 * directly as {@link fromYamlValue}: root must be a mapping, `${...}` stays
 * literal, NaN and infinity are refused, a multi-document stream is refused,
 * binary becomes its base64 text. How YAML *text* becomes a tree — whether
 * `010` is 8 or 10, whether `no` is a boolean — is the YAML library's answer,
 * not a contract here.
 *
 * `parseYaml` is a convenience front on `yaml` (eemeli), pinned to
 * `version: '1.2'` so a library default cannot drift under it. A caller who
 * needs a different library, version or schema decodes the text themselves and
 * hands the tree to {@link fromYamlValue} — that is the supported way to swap
 * parsers, and it keeps the choice, and its consequences, in the caller's
 * hands:
 *
 * ```ts
 * import jsy from 'js-yaml'
 * const cfg = fromYamlValue(jsy.load(src), 'their-file.yml')
 * ```
 *
 * See docs/specs/format-ingestion-mapping.md items F5.x in the hocon scope.
 */
export function parseYaml(input: string, originDescription?: string): Config {
  // version is declared rather than defaulted. The same library returns 8 for
  // `010` under 1.1 and 10 under 1.2, and resolves `no` to false under 1.1 —
  // the Norway problem is a schema choice, not a library defect. F5.1 pins the
  // 1.2 core schema, so say so instead of trusting a default that a major
  // release could move.
  //
  // merge: true is required alongside it — `<<` is a 1.1 feature, so under 1.2
  // it would otherwise stay a literal key and leak into the config (spec F5.2).
  //
  // intAsBigInt: true is the F0.5 half of it. The library decodes an integer
  // into a JS number otherwise, so 9007199254740993 would silently arrive as
  // ...992 — the precision loss the spec forbids. Every integer therefore
  // arrives as a bigint and `convert` narrows the ones a number holds exactly
  // back to number, leaving the rest for the value factory's int64 check.
  const docs = YAML.parseAllDocuments(input, { version: '1.2', merge: true, intAsBigInt: true })
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

  return fromYamlValue(doc.toJS({ mapAsMap: false }), originDescription)
}

/**
 * Build a Config from an already-decoded YAML value tree, produced by whatever
 * YAML library and settings the caller chose. This is the tree-level boundary
 * this module actually owns (spec F5); `parseYaml` is just a default decoder in
 * front of it.
 *
 * Leaf normalization accepts the shapes common across JS YAML libraries, not
 * only the default one: a `Map` (eemeli with `mapAsMap`) has its scalar keys
 * stringified per F5.3, a `Date` (js-yaml 4 timestamps) becomes its ISO string
 * — the same reasoning as F4.2 for TOML dates — and a `Uint8Array` becomes
 * base64 (F5.5).
 */
export function fromYamlValue(value: unknown, originDescription?: string): Config {
  // An empty document is the empty object, as an empty HOCON document is
  // (S3.1), rather than a root-type failure (spec F5.9).
  if (value === null || value === undefined) return fromMap({}, originDescription)
  const normalized = convert(value, '')
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
    throw new ConfigError(
      `yaml: document root is ${Array.isArray(normalized) ? 'an array' : typeof normalized}, but a config root must be an object (spec F0.3)`,
      '',
    )
  }
  return fromMap(normalized as Record<string, unknown>, originDescription)
}

function convert(v: unknown, atPath: string): unknown {
  if (Array.isArray(v)) return v.map((e, i) => convert(e, `${atPath}[${i}]`))
  if (v instanceof Date) {
    // js-yaml 4 resolves timestamps to Date. HOCON has no datetime, so the
    // ISO text is the honest form (F4.2's reasoning).
    return v.toISOString()
  }
  if (v instanceof Map) {
    // eemeli's mapAsMap shape; scalar keys stringify per F5.3.
    const out: Record<string, unknown> = {}
    for (const [k, e] of v) {
      if (k !== null && typeof k === 'object') {
        throw new ConfigError(
          `yaml: a collection key at "${atPath}" is not usable as an object key (spec F5.3)`,
          atPath,
        )
      }
      out[String(k)] = convert(e, atPath === '' ? String(k) : `${atPath}.${String(k)}`)
    }
    return out
  }
  if (v instanceof Uint8Array) {
    // !!binary — HOCON has no binary type, so keep the base64 text the source
    // itself carried (spec F5.5).
    return bytesToBase64(v)
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
  if (typeof v === 'bigint') {
    // An integer a JS number holds exactly is a number here; a wider one stays
    // a bigint so its digits reach the value model intact (F0.5), where the
    // int64 bound is enforced. Injected trees get the same treatment — another
    // library configured for big integers produces the same shape.
    return isSafeIntegerBigInt(v) ? Number(v) : v
  }
  return v
}

/**
 * Base64 of a byte array, in chunks.
 *
 * `String.fromCharCode(...bytes)` passes every byte as its own argument, which
 * exhausts the call stack somewhere around a megabyte — an embedded
 * certificate or image threw `RangeError` instead of parsing. A chunked loop
 * has no such limit and needs no Node-only API, `parse` being documented as
 * usable in browsers.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function isSafeIntegerBigInt(v: bigint): boolean {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
}
