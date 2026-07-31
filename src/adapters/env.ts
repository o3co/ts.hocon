import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { type PathPair, nestPairs, pathKey } from '../internal/properties/properties.js'
import { ConfigError } from '../errors.js'
import { stripBom } from '../internal/strip-bom.js'
import { MAX_PATH_SEGMENTS, tooDeep } from '../internal/depth.js'

/** The double underscore that marks a path boundary; a single one stays part of
 *  the segment, so `APP_DB__MAX_CONN` is `db.max_conn` (spec F1.2). Fixed rather
 *  than configurable so every language's adapter nests identically. */
const SEPARATOR = '__'

export type EnvOptions = {
  /**
   * Selects which variables to mount, and is stripped from the resulting path.
   * Required by {@link loadEnv}: mounting the whole environment would pull in
   * PATH, HOME and whatever secrets happen to be set (spec F1.1).
   * {@link parseDotEnv} allows it to be empty, a `.env` file being a closed set
   * the caller chose deliberately.
   */
  prefix?: string
  /** Source name for error messages. */
  originDescription?: string
}

/**
 * Mount a prefixed slice of the environment as config.
 *
 * ```ts
 * const base = loadEnv({ prefix: 'APP_' })   // APP_DB__HOST -> db.host
 * ```
 *
 * Reading a single variable needs nothing from here — HOCON's own `${?VAR}`
 * already does that. This is for mounting a whole namespace as a subtree.
 *
 * `__` is the only path separator: a single `_` stays part of its segment
 * (`APP_DB__MAX_CONN` → `db.max_conn`), and a literal `.` in a variable name is
 * key text rather than a boundary, so `APP_FOO.BAR` becomes the single
 * top-level key `foo.bar` — addressable as the quoted path `"foo.bar"` — and
 * coexists with `APP_FOO__BAR` instead of colliding with it (F1.2).
 *
 * Two names that do map to one path are an error, the environment having no
 * order to break the tie with (F1.6). Keys named `__proto__`, `constructor` or
 * `prototype` are kept like any other (F2.9).
 *
 * Values are always strings, and a `${...}` inside one stays literal (F0.2, F1.4).
 */
export function loadEnv(opts: EnvOptions & { env?: Record<string, string | undefined> } = {}): Config {
  const prefix = opts.prefix ?? ''
  if (prefix === '') {
    throw new ConfigError(
      'loadEnv: a prefix is required when mounting the environment (spec F1.1)',
      '',
    )
  }
  const source = opts.env ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

  // Sorted so a collision is reported the same way on every run.
  const names = Object.keys(source).sort()
  const seen = new Map<string, string>()
  const pairs: PathPair[] = []

  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const value = source[name]
    if (value === undefined) continue
    const path = toPath(name.slice(prefix.length))
    // Collisions are compared on the segment list, as go.hocon's adapter does
    // (it joins with NUL; this encodes, which needs no delimiter to be safe):
    // `APP_FOO.BAR` (one segment "foo.bar") and `APP_FOO__BAR` (two segments)
    // are different paths and must both survive, which a dot-joined comparison
    // would conflate (F1.2/F1.6).
    const key = pathKey(path)
    const prev = seen.get(key)
    if (prev !== undefined) {
      // F1.6: two names can reach one path and the environment has no
      // meaningful order to break the tie with, so neither silently wins.
      throw new ConfigError(`loadEnv: ${prev} and ${name} both map to "${path.join('.')}"`, path.join('.'))
    }
    seen.set(key, name)
    pairs.push([path, value])
  }

  return fromMap(nestPairs(pairs), opts.originDescription ?? 'environment variables')
}

/**
 * Read `.env` file content.
 *
 * The dialect is deliberately small (spec F1.7): `NAME=value`, an optional
 * `export ` prefix, whole-line `#` comments, single quotes taken literally,
 * double quotes with `\n \r \t \\ \"`. Multi-line values and trailing comments
 * are not supported — an unquoted value containing ` #` is an error rather than
 * a guess about whether a comment was meant. No `${...}` expansion.
 *
 * Names map to paths exactly as in {@link loadEnv}: `__` is the only separator,
 * so a literal `.` stays key text (`FOO.BAR` → the single key `foo.bar`). A
 * file has a definite line order, so a repeated name is last-wins (F0.7)
 * rather than the collision error the process environment gets.
 */
export function parseDotEnv(input: string, opts: EnvOptions = {}): Config {
  const origin = opts.originDescription ?? '.env'
  const prefix = opts.prefix ?? ''
  const pairs: PathPair[] = []

  const lines = stripBom(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? '').trim()
    if (raw === '' || raw.startsWith('#')) continue
    const line = raw.startsWith('export ') ? raw.slice('export '.length) : raw

    const eq = line.indexOf('=')
    if (eq === -1) throw new ConfigError(`${origin}:${i + 1}: expected NAME=value`, '')
    const name = line.slice(0, eq).trim()
    if (name === '') throw new ConfigError(`${origin}:${i + 1}: empty variable name`, '')
    const value = dotEnvValue(line.slice(eq + 1).replace(/^[ \t]+/, ''), origin, i + 1, name)

    if (!name.startsWith(prefix)) continue
    pairs.push([toPath(name.slice(prefix.length)), value])
  }

  // A file has a definite line order, so a repeated name is simply last-wins
  // (F0.7) rather than the collision error the environment gets.
  return fromMap(nestPairs(pairs), origin)
}

/**
 * Split a prefix-stripped name on `__` and lowercase each segment (F1.2, F1.3).
 *
 * The result stays a **segment list** all the way into `nestPairs`. Joining it
 * on `.` and letting the nesting step re-split — which is what this did before
 * — turns a literal `.` in a variable name into a path boundary the environment
 * never had: `APP_FOO.BAR` must be the single top-level key `"foo.bar"`,
 * addressable as a quoted path, and must not collide with `APP_FOO__BAR`.
 * go.hocon's env adapter carries `[]string` for the same reason.
 *
 * Case folding is ASCII-only (F1.3). JS's `toLowerCase` applies the full
 * Unicode mapping, so `İ` (U+0130) becomes `i` + U+0307, while Go's simple
 * mapping yields plain `i` — which decides whether `APP_İ` collides with
 * `APP_I` under F1.6. Environment variable names are ASCII in practice, so
 * pinning the mapping costs nothing and keeps the implementations agreeing.
 */
function toPath(name: string): string[] {
  const segs = name.split(SEPARATOR).map(asciiLower)
  if (segs.some(s => s === '')) {
    throw new ConfigError(`env: "${name}" produces an empty path segment`, name)
  }
  if (tooDeep(segs.length)) {
    // One name produces one arbitrarily deep chain, so a single long variable
    // name was enough to exhaust the stack — and it did so as a RangeError,
    // outside every error type documented here. rs.hocon and py.hocon cap the
    // same mapping at the same number.
    throw new ConfigError(
      `env: "${name}" maps to a path ${segs.length} segments deep, over the limit of ${MAX_PATH_SEGMENTS}`,
      name,
    )
  }
  return segs
}

/** `A`–`Z` → `a`–`z`, every other codepoint untouched (F1.3). */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32))
}

function dotEnvValue(v: string, origin: string, line: number, name: string): string {
  const fail = (msg: string): never => {
    throw new ConfigError(`${origin}:${line}: ${name}: ${msg}`, name)
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1)
    if (end === -1) fail('unterminated \' quote (multi-line values are not supported)')
    if (v.slice(end + 1).trim() !== '') fail(`unexpected text after the closing quote`)
    return v.slice(1, end)
  }
  if (v.startsWith('"')) {
    let out = ''
    for (let i = 1; i < v.length; i++) {
      const c = v[i]
      if (c === '"') {
        if (v.slice(i + 1).trim() !== '') fail('unexpected text after the closing quote')
        return out
      }
      if (c === '\\') {
        i++
        const e = v[i]
        if (e === undefined) fail('dangling \\ at end of line')
        else if (e === 'n') out += '\n'
        else if (e === 'r') out += '\r'
        else if (e === 't') out += '\t'
        else if (e === '\\') out += '\\'
        else if (e === '"') out += '"'
        else fail(`unknown escape \\${e} (supported: \\n \\r \\t \\\\ \\")`)
        continue
      }
      out += c
    }
    return fail('unterminated " quote (multi-line values are not supported)')
  }
  const trimmed = v.replace(/[ \t]+$/, '')
  if (/[ \t]#/.test(trimmed)) {
    fail(`ambiguous value "${trimmed}": trailing comments are not supported, so quote the value if the # belongs to it`)
  }
  return trimmed
}
