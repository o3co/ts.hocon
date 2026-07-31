import YAML from 'yaml'
import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'
import { depthError, guardStackDepth } from '../internal/depth.js'

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
 * Integers are ingested losslessly (F0.5): the document is decoded with
 * `intAsBigInt`, so a literal too wide for a JS `number` keeps its digits —
 * `getString` returns them exactly — and one outside int64 is refused rather
 * than rounded. `getNumber` and `toObject` still apply the JS number model, so
 * read large identifiers with `getString`.
 *
 * See docs/specs/format-ingestion-mapping.md items F5.x in the hocon scope.
 */
export function parseYaml(input: string, originDescription?: string): Config {
  // version is declared rather than defaulted. The same library returns 8 for
  // `010` under 1.1 and 10 under 1.2, and resolves `no` to false under 1.1 —
  // the Norway problem is a schema choice, not a library defect. F5.1 states no
  // baseline schema — scalar resolution is the library's answer — so the point
  // of declaring the version is that the answer cannot drift under us when a
  // major release moves its default. The library is `yaml` (eemeli) 2.9.x.
  //
  // merge: true is required alongside it — `<<` is a 1.1 feature, so under 1.2
  // it would otherwise stay a literal key and leak into the config (spec F5.2).
  //
  // intAsBigInt: true is the F0.5 half of it. The library decodes an integer
  // into a JS number otherwise, so 9007199254740993 would silently arrive as
  // ...992 — the precision loss the spec forbids. Every integer therefore
  // arrives as a bigint and `convert` narrows the ones a number holds exactly
  // back to number, leaving the rest for the value factory's int64 check.
  const docs = YAML.parseAllDocuments(stripBom(input), { version: '1.2', merge: true, intAsBigInt: true })
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

  // mapAsMap, because F5.3 cannot be enforced on a plain object: `1:` and
  // `"1":` are distinct YAML keys that both stringify to "1", and an object
  // has already kept one of them by the time this function sees it — the other
  // value is gone with nothing left to notice. A Map keeps both, so the
  // collision is still there to be reported. It also keeps a null key as
  // `null`; the object form turns it into "" rather than "null", which is the
  // key the sibling implementations produce.
  return fromYamlValue(doc.toJS({ mapAsMap: true }), originDescription)
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
 * base64 (F5.5), at any size. A `bigint` (a library decoding integers widely)
 * narrows to a number where a double is exact and otherwise keeps its digits,
 * bounded by int64 (F0.5).
 */
export function fromYamlValue(value: unknown, originDescription?: string): Config {
  // An empty document is the empty object, as an empty HOCON document is
  // (S3.1), rather than a root-type failure (spec F5.9).
  if (value === null || value === undefined) return fromMap({}, originDescription)
  // `convert` recurses per level and runs before `fromMap`'s own guard, so a
  // tree handed straight to this entry point would otherwise leave as a
  // RangeError (see internal/depth.ts).
  const normalized = guardStackDepth(
    () => convert(value, ''),
    msg => depthError(`yaml: ${msg}`),
  )
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
    // eemeli's mapAsMap shape, and the shape `parseYaml` asks for; scalar keys
    // stringify per F5.3.
    const entries: [string, unknown][] = []
    const seen = new Map<string, unknown>()
    for (const [k, e] of v) {
      if (k !== null && typeof k === 'object') {
        throw new ConfigError(
          `yaml: a collection key at "${atPath}" is not usable as an object key (spec F5.3)`,
          atPath,
        )
      }
      const key = String(k)
      if (seen.has(key)) {
        // Two source keys, one object key: the int 1 and the string "1", ~ and
        // "null", 0x10 and "16". Writing the second would drop the first's
        // value with nothing to show for it, so neither wins (spec F5.3). A Map
        // iterates in insertion order, so this reports the same pair every run
        // and names the keys in the order they were written.
        throw new ConfigError(
          `yaml: sibling mapping keys ${keyForm(seen.get(key))} and ${keyForm(k)} ` +
            `both give the key "${key}"${atPath === '' ? '' : ` at "${atPath}"`}; ` +
            `rename one of them, because one of the two values would otherwise ` +
            `be lost. Quoting a non-string key helps only where that changes ` +
            `the key text, as 0x10 does and 1 does not (spec F5.3)`,
          atPath,
        )
      }
      seen.set(key, k)
      entries.push([key, convert(e, atPath === '' ? key : `${atPath}.${key}`)])
    }
    return Object.fromEntries(entries)
  }
  if (v instanceof Uint8Array) {
    // !!binary — HOCON has no binary type, so the bytes become base64 text
    // (spec F5.5). This re-encodes what the library decoded rather than echoing
    // the source's own characters, so the result is canonical base64: the
    // library silently drops characters outside the alphabet while decoding, and
    // whitespace/line breaks in the source do not survive.
    return bytesToBase64(v)
  }
  if (v !== null && typeof v === 'object') {
    // Object.fromEntries defines own data properties (CreateDataProperty). A
    // `{}` carrier written with `out[k] = …` goes through [[Set]] instead, so a
    // key named `__proto__` hit Object.prototype's setter and vanished — the
    // library had handed it over correctly, and this adapter lost it. Same bug
    // as config.ts's old Object.assign, same fix (F2.9's principle: safety by
    // construction, never by dropping keys).
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(
        ([k, e]) => [k, convert(e, atPath === '' ? k : `${atPath}.${k}`)] as const,
      ),
    )
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

/**
 * Render a source key for the F5.3 collision error: a string is quoted, every
 * other scalar shows its type, so the int `1` and the string `"1"` stay apart
 * in the message the way they failed to in the mapping.
 */
function keyForm(k: unknown): string {
  if (typeof k === 'string') return JSON.stringify(k)
  return `${String(k)} (${k === null ? 'null' : typeof k})`
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

function isSafeIntegerBigInt(v: bigint): boolean {
  return v <= MAX_SAFE && v >= MIN_SAFE
}
