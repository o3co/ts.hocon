import { fromMap } from '../value-factory.js'
import type { Config } from '../config.js'
import { nestPairs } from '../internal/properties/properties.js'
import { ConfigError } from '../errors.js'

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
  const pairs: [string, string][] = []

  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const value = source[name]
    if (value === undefined) continue
    const path = toPath(name.slice(prefix.length))
    const prev = seen.get(path)
    if (prev !== undefined) {
      // F1.6: two names can reach one path and the environment has no
      // meaningful order to break the tie with, so neither silently wins.
      throw new ConfigError(`loadEnv: ${prev} and ${name} both map to "${path}"`, path)
    }
    seen.set(path, name)
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
 */
export function parseDotEnv(input: string, opts: EnvOptions = {}): Config {
  const origin = opts.originDescription ?? '.env'
  const prefix = opts.prefix ?? ''
  const pairs: [string, string][] = []

  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
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

/** Strip the prefix, split on `__`, lowercase each segment (F1.2, F1.3). */
function toPath(name: string): string {
  const segs = name.split(SEPARATOR).map(s => s.toLowerCase())
  if (segs.some(s => s === '')) {
    throw new ConfigError(`env: "${name}" produces an empty path segment`, name)
  }
  return segs.join('.')
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
