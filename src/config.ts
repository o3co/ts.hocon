import { coerceBoolean, coerceNumber, parseBytes, parseDuration } from './coerce.js'
import type { ByteUnit, DurationUnit } from './coerce.js'
import { ConfigError, NotResolvedError } from './errors.js'
import {
  buildPartialHoconFromResObj,
  containsPlaceholders,
  hoconValueToResObj,
  resolveTree,
  valContainsPlaceholders,
} from './internal/resolver/resolver.js'
import { isAppend, isConcat, isResObj, isSubst, mergeUnresolved } from './internal/resolver/types.js'
import type { ResObj, ResolveOptions as InternalResolveOptions } from './internal/resolver/types.js'
import { numericObjectToArray } from './value/numeric-array.js'
import type { HoconValue, ScalarValueType } from './value.js'

export class Config {
  /** @internal resolved flag: true when no substitution placeholders remain. */
  private readonly _resolved: boolean
  /** @internal base directory for re-runs (file-parsed configs). */
  readonly _parseBaseDir: string | undefined
  /** @internal origin description for error messages. */
  readonly _originDescription: string | undefined
  /** @internal ResObj tree for deferred-resolution path. Set when resolved=false. */
  readonly _resObjRoot: ResObj | undefined
  /** @internal ResolveOptions stored for the resolve() call. */
  private readonly _resolveOpts: InternalResolveOptions | undefined

  constructor(
    private readonly root: HoconValue & { kind: 'object' },
    opts?: {
      resolved?: boolean
      parseBaseDir?: string
      originDescription?: string
      resObjRoot?: ResObj
      resolveOpts?: InternalResolveOptions
    }
  ) {
    this._resolved = opts?.resolved ?? true
    this._parseBaseDir = opts?.parseBaseDir
    this._originDescription = opts?.originDescription
    this._resObjRoot = opts?.resObjRoot
    this._resolveOpts = opts?.resolveOpts
  }

  /** Returns true when the Config's value tree contains no unresolved
   *  substitution placeholders. Whole-config granularity (E12 decision 11). */
  isResolved(): boolean {
    return this._resolved
  }

  /** @internal Test-only: construct a resolved Config from a HoconValue. */
  static _fromResolvedValue(
    root: HoconValue & { kind: 'object' },
    opts?: { originDescription?: string }
  ): Config {
    return new Config(root, { resolved: true, originDescription: opts?.originDescription })
  }

  /** @internal Construct an unresolved Config carrying a ResObj tree.
   *  Used by parseStringWithOptions (deferred path) in T6. */
  static _fromUnresolvedResObj(
    tree: ResObj,
    opts: {
      parseBaseDir?: string
      originDescription?: string
      resolved: boolean
      resolveOpts: InternalResolveOptions
    }
  ): Config {
    const partialRoot = buildPartialHoconFromResObj(tree)
    return new Config(partialRoot, {
      resolved: opts.resolved,
      parseBaseDir: opts.parseBaseDir,
      originDescription: opts.originDescription,
      resObjRoot: tree,
      resolveOpts: opts.resolveOpts,
    })
  }

  get(path: string): unknown {
    const v = this.lookupNode(path)
    if (v === undefined) return undefined
    return hoconToJs(v)
  }

  getString(path: string): string {
    const v = this.requireScalar(path)
    return v.raw
  }

  getNumber(path: string): number {
    const v = this.requireScalar(path)
    const coerced = coerceNumber(v.raw)
    if (coerced !== undefined) return coerced
    throw new ConfigError(`expected number at ${path}, got ${v.valueType}`, path)
  }

  getBoolean(path: string): boolean {
    const v = this.requireScalar(path)
    const coerced = coerceBoolean(v.raw)
    if (coerced !== undefined) return coerced
    throw new ConfigError(`expected boolean at ${path}, got ${v.valueType}`, path)
  }

  getDuration(path: string, unit?: DurationUnit): number {
    const v = this.requireScalar(path)
    if (v.valueType !== 'string' && v.valueType !== 'number') {
      throw new ConfigError(`expected duration at ${path}, got ${v.valueType}`, path)
    }
    const result = parseDuration(v.raw, unit)
    if (Number.isNaN(result)) throw new ConfigError(`invalid duration at ${path}: ${JSON.stringify(v.raw)}`, path)
    return result
  }

  getBytes(path: string, unit?: ByteUnit): number {
    const v = this.requireScalar(path)
    if (v.valueType !== 'string' && v.valueType !== 'number') {
      throw new ConfigError(`expected byte size at ${path}, got ${v.valueType}`, path)
    }
    const result = parseBytes(v.raw, unit)
    if (Number.isNaN(result)) throw new ConfigError(`invalid byte size at ${path}: ${JSON.stringify(v.raw)}`, path)
    // Lightbend getBytesBigInteger positive-only invariant: byte sizes must be non-negative.
    if (result < 0) throw new ConfigError(`byte size must be non-negative at ${path}: ${JSON.stringify(v.raw)}`, path)
    return result
  }

  getConfig(path: string): Config {
    const v = this.lookupNode(path)
    if (v === undefined) {
      if (!this._resolved && this._resObjRootSubtreeHasPlaceholders(path)) {
        throw new NotResolvedError(path)
      }
      throw new ConfigError(`path not found: ${path}`, path)
    }
    if (v.kind !== 'object') throw new ConfigError(`expected object at ${path}`, path)
    // T2: even when a partial value was found, the underlying ResObj subtree may
    // contain unresolved placeholders (omitted from the partial root). Throw
    // NotResolvedError when the subtree at this path is unresolved.
    if (!this._resolved && this._resObjRootSubtreeHasPlaceholders(path)) {
      throw new NotResolvedError(path)
    }
    return new Config(v, { resolved: this._resolved })
  }

  getList(path: string): unknown[] {
    const v = this.lookupNode(path)
    if (v === undefined) {
      if (!this._resolved && this._resObjRootSubtreeHasPlaceholders(path)) {
        throw new NotResolvedError(path)
      }
      throw new ConfigError(`path not found: ${path}`, path)
    }
    // T2: check _resObjRoot subtree for unresolved placeholders in the array case.
    // (T1 handles the case where the array field is omitted from the partial root;
    // this guard handles the case where the field IS present but sub-paths of a
    // returned object in the list would be unresolved — belt-and-suspenders.)
    if (!this._resolved && this._resObjRootSubtreeHasPlaceholders(path)) {
      throw new NotResolvedError(path)
    }
    // S15: if the value is a numerically-keyed object, convert to array before type check.
    // Empty objects and objects with no eligible integer keys return null → fall through to error.
    if (v.kind === 'object') {
      const converted = numericObjectToArray(v)
      if (converted !== null) return converted.map(hoconToJs)
    }
    if (v.kind !== 'array') throw new ConfigError(`expected array at ${path}`, path)
    return v.items.map(hoconToJs)
  }

  has(path: string): boolean {
    return this.lookupNode(path) !== undefined
  }

  keys(): string[] {
    return [...this.root.fields.keys()]
  }

  withFallback(fallback: Config | undefined): Config {
    if (fallback == null) return this

    const selfTree = this._resObjRoot ?? hoconValueToResObj(this.root)
    const fbTree = fallback._resObjRoot ?? hoconValueToResObj(fallback.root)
    const merged = mergeUnresolved(selfTree, fbTree)
    const hasPlaceholders = containsPlaceholders(merged)
    const partialRoot = buildPartialHoconFromResObj(merged)
    return new Config(partialRoot, {
      resolved: !hasPlaceholders,
      parseBaseDir: this._parseBaseDir,
      originDescription: this._originDescription,
      resObjRoot: merged,
      resolveOpts: this._resolveOpts ?? fallback._resolveOpts,
    })
  }

  /**
   * Runs substitution resolution (phase 2) on the stored unresolved tree.
   * Idempotent: calling resolve() on an already-resolved Config returns an
   * equivalent resolved Config.
   *
   * opts.allowUnresolved (default false) — when true, leaves unresolved
   * non-optional placeholders in place rather than throwing.
   * opts.useSystemEnvironment (default true) — when false, env var lookups
   * are suppressed (hermetic resolution).
   *
   * E12 decision 3.
   */
  resolve(opts: import('./parse.js').ResolveOptions = {}): Config {
    if (this._resolved) {
      // Idempotent: already resolved — return fresh equivalent Config.
      return new Config(this.root, {
        resolved: true,
        parseBaseDir: this._parseBaseDir,
        originDescription: this._originDescription,
      })
    }
    const tree = this._resObjRoot
    if (!tree) {
      // No ResObj stored (legacy path) — treat as resolved.
      return new Config(this.root, { resolved: true })
    }

    const resolveOpts: InternalResolveOptions = {
      ...(this._resolveOpts ?? { env: {}, baseDir: undefined, readFileSync: () => { throw new Error('no files') } }),
      allowUnresolved: opts.allowUnresolved ?? false,
      useSystemEnvironment: opts.useSystemEnvironment ?? true,
      originDescription: this._originDescription,
    }

    const resolved = resolveTree(tree, resolveOpts)
    if (resolved.kind !== 'object') throw new Error('resolve: expected object root')

    // If allowUnresolved=true, some fields may still be SubstPlaceholders
    // (returned as HoconValue by the resolver via `s as unknown as HoconValue`,
    // or as concat-placeholder-in-place when resolveConcat returns the placeholder).
    // Strip them out so getters throw NotResolvedError for those paths.
    // Use stripped.hadPlaceholders (not containsPlaceholders(tree)) — the original tree
    // always has placeholders for any input with substitutions, but the resolved output
    // may have none (all substitutions resolved successfully). hadPlaceholders from the
    // strip result correctly reflects whether unresolved placeholders remain.
    if (opts.allowUnresolved) {
      const { stripped, hadPlaceholders } = stripPlaceholderFields(resolved)
      return new Config(stripped, {
        resolved: !hadPlaceholders,
        parseBaseDir: this._parseBaseDir,
        originDescription: this._originDescription,
        resObjRoot: hadPlaceholders ? tree : undefined,
        resolveOpts: hadPlaceholders ? resolveOpts : undefined,
      })
    }

    return new Config(resolved as HoconValue & { kind: 'object' }, {
      resolved: true,
      parseBaseDir: this._parseBaseDir,
      originDescription: this._originDescription,
    })
  }

  /**
   * Resolves receiver substitutions using source as lookup context.
   * Source's keys are NOT merged into the result — differs from
   * `this.withFallback(source).resolve()` which includes source keys.
   *
   * Precondition (E12 decision 10): source must be resolved. If
   * source.isResolved() is false, throws NotResolvedError.
   *
   * On an already-resolved receiver, resolveWith is a no-op (returns an
   * equivalent resolved Config, source keys not included).
   *
   * E12 decisions 9, 10.
   */
  resolveWith(source: Config, opts: import('./parse.js').ResolveOptions = {}): Config {
    if (!source.isResolved()) {
      throw new NotResolvedError('source')
    }
    if (this._resolved) {
      // Idempotent: already resolved — source keys not included.
      return new Config(this.root, {
        resolved: true,
        parseBaseDir: this._parseBaseDir,
        originDescription: this._originDescription,
      })
    }

    const receiverTree = this._resObjRoot ?? hoconValueToResObj(this.root)
    const srcTree = hoconValueToResObj(source.root)
    const merged = mergeUnresolved(receiverTree, srcTree)

    const resolveOpts: InternalResolveOptions = {
      ...(this._resolveOpts ?? { env: {}, baseDir: undefined, readFileSync: () => { throw new Error('no files') } }),
      allowUnresolved: opts.allowUnresolved ?? false,
      useSystemEnvironment: opts.useSystemEnvironment ?? true,
      originDescription: this._originDescription,
    }

    const resolved = resolveTree(merged, resolveOpts)
    if (resolved.kind !== 'object') throw new Error('resolveWith: expected object root')

    // Filter: keep only paths that exist in the receiver's original shape.
    // Use receiverTree (the ResObj with placeholder keys included) to build
    // the shape — this.root omits placeholder keys, which would wrongly filter
    // them out even after they've been resolved by source.
    const receiverShapeForFilter = resObjToKeyShape(receiverTree)
    const filtered = filterByReceiverShape(resolved, receiverShapeForFilter)

    // If allowUnresolved=true, some fields may still be SubstPlaceholders.
    // Strip them and track resolution status (same pattern as resolve()).
    if (opts.allowUnresolved) {
      const { stripped, hadPlaceholders } = stripPlaceholderFields(filtered)
      return new Config(stripped, {
        resolved: !hadPlaceholders,
        parseBaseDir: this._parseBaseDir,
        originDescription: this._originDescription,
        resObjRoot: hadPlaceholders ? receiverTree : undefined,
        resolveOpts: hadPlaceholders ? resolveOpts : undefined,
      })
    }

    return new Config(filtered as HoconValue & { kind: 'object' }, {
      resolved: true,
      parseBaseDir: this._parseBaseDir,
      originDescription: this._originDescription,
    })
  }

  toObject(): unknown {
    return hoconToJs(this.root)
  }

  /**
   * @internal Test-only: renders this resolved Config's value tree as canonical
   * JSON (sorted keys, no whitespace). Used by Layer-2 fixture tests to compare
   * against Lightbend ground truth. NOT part of the public API.
   *
   * Throws if the Config is unresolved (contains placeholders).
   */
  _renderJSONForTest(): string {
    return renderHoconAsJSON(this.root)
  }

  private lookupNode(path: string): HoconValue | undefined {
    const segments = splitConfigPath(path)
    let current: HoconValue = this.root
    for (const seg of segments) {
      if (current.kind !== 'object') return undefined
      const next = current.fields.get(seg)
      if (next === undefined) return undefined
      current = next
    }
    return current
  }

  /**
   * _resObjRootSubtreeHasPlaceholders — walk _resObjRoot to the given path and
   * return true if the subtree there contains any unresolved placeholder.
   * Used by getConfig / getList (T2) to detect transitive unresolved placeholders
   * in object / array subtrees that would otherwise appear to be "resolved" in the
   * partial HoconValue root (because individual leaf fields are omitted rather than
   * the whole subtree when their value is a direct placeholder scalar, but object
   * sub-containers are retained in the partial root with the placeholder-keyed
   * fields omitted from them — so the object appears "present but empty-ish").
   */
  private _resObjRootSubtreeHasPlaceholders(path: string): boolean {
    const tree = this._resObjRoot
    if (!tree) return false
    const segments = splitConfigPath(path)
    let cur: ResObj = tree
    for (const seg of segments) {
      const val = cur.fields.get(seg)
      if (val === undefined) return false
      if (isResObj(val)) {
        cur = val
      } else {
        // Leaf value at this path — placeholder directly, or a HoconValue
        // (e.g. array) whose contents include placeholders.
        return valContainsPlaceholders(val)
      }
    }
    // cur is now the ResObj at the given path — check for any placeholders in it
    return containsPlaceholders(cur)
  }

  private requireScalar(path: string): { raw: string; valueType: ScalarValueType } {
    const v = this.lookupNode(path)
    if (v === undefined) {
      // Distinguish placeholder paths (NotResolvedError) from truly-missing
      // paths (ConfigError) — even on unresolved configs, a path absent from
      // _resObjRoot is genuinely not present.
      if (!this._resolved && this._resObjRootSubtreeHasPlaceholders(path)) {
        throw new NotResolvedError(path)
      }
      throw new ConfigError(`path not found: ${path}`, path)
    }
    if (v.kind !== 'scalar') throw new ConfigError(`expected scalar at ${path}, got ${v.kind}`, path)
    return v
  }
}

function splitConfigPath(path: string): string[] {
  const segments: string[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '"') {
      i++
      let segment = ''
      let closed = false
      while (i < path.length) {
        const ch = path[i]
        if (ch === '\\' && i + 1 < path.length) {
          const next = path[i + 1]
          segment += next
          i += 2
          continue
        }
        if (ch === '"') {
          closed = true
          i++
          break
        }
        segment += ch
        i++
      }
      if (!closed) throw new ConfigError(`unterminated quoted path segment: ${path}`, path)
      segments.push(segment)
      if (i < path.length && path[i] === '.') i++
    } else {
      const dot = path.indexOf('.', i)
      if (dot === -1) {
        segments.push(path.slice(i))
        break
      }
      segments.push(path.slice(i, dot))
      i = dot + 1
    }
  }
  return segments
}

function scalarToJs(raw: string, valueType: ScalarValueType): unknown {
  switch (valueType) {
    case 'null': return null
    case 'boolean': return raw === 'true'
    case 'number': return Number(raw)
    case 'string': return raw
  }
}

function hoconToJs(v: HoconValue): unknown {
  switch (v.kind) {
    case 'scalar': return scalarToJs(v.raw, v.valueType)
    case 'array': return v.items.map(hoconToJs)
    case 'object': {
      // Use Object.create(null) to prevent __proto__ prototype pollution when
      // a key named "__proto__" exists (e.g. from fromMap({ __proto__: ... })).
      // The result is then converted to a plain {} by Object.assign for a
      // standard JS object that passes instanceof/typeof checks normally.
      const obj = Object.create(null) as Record<string, unknown>
      for (const [k, val] of v.fields) obj[k] = hoconToJs(val)
      return Object.assign({}, obj)
    }
  }
}

/**
 * resObjToKeyShape — converts a ResObj to a HoconValue-shaped object that
 * includes ALL keys (even placeholder-valued ones) as synthetic scalars.
 * Used by resolveWith to build the receiver's key shape for filtering —
 * this.root omits placeholder keys, but we want to include them in the
 * filter so that resolved values for those keys appear in the result.
 */
function resObjToKeyShape(tree: ResObj): HoconValue & { kind: 'object' } {
  const fields = new Map<string, HoconValue>()
  for (const [k, v] of tree.fields) {
    if (isSubst(v) || isConcat(v) || isAppend(v)) {
      // Placeholder: represent as a synthetic scalar so the key is present in the shape.
      fields.set(k, { kind: 'scalar', raw: '', valueType: 'null' })
    } else if (isResObj(v)) {
      fields.set(k, resObjToKeyShape(v))
    } else {
      fields.set(k, v as HoconValue)
    }
  }
  return { kind: 'object', fields }
}

/**
 * stripPlaceholderFields — removes fields that are SubstPlaceholders masquerading
 * as HoconValues (the resolver returns `s as unknown as HoconValue` when
 * allowUnresolved=true). Returns the cleaned object and whether any were stripped.
 */
function stripPlaceholderFields(
  v: HoconValue & { kind: 'object' },
): { stripped: HoconValue & { kind: 'object' }; hadPlaceholders: boolean } {
  const fields = new Map<string, HoconValue>()
  let hadPlaceholders = false
  for (const [k, val] of v.fields) {
    // SubstPlaceholders are tagged with _kind; HoconValues have `kind`.
    if ((val as { _kind?: string })._kind === 'subst-placeholder' ||
        (val as { _kind?: string })._kind === 'concat-placeholder' ||
        (val as { _kind?: string })._kind === 'append-placeholder') {
      hadPlaceholders = true
      // Omit the field — getter will throw NotResolvedError.
    } else if (val.kind === 'object') {
      const inner = stripPlaceholderFields(val)
      if (inner.hadPlaceholders) hadPlaceholders = true
      fields.set(k, inner.stripped)
    } else {
      fields.set(k, val)
    }
  }
  return { stripped: { kind: 'object', fields }, hadPlaceholders }
}

/**
 * filterByReceiverShape — recursively keeps only paths from `resolved` that
 * exist in `receiverShape`. This prevents source keys from leaking into the
 * resolveWith result. Must be recursive — top-level-only filtering leaks
 * nested source keys under shared top-level keys (C3 multi-reviewer
 * convergence lesson). E12 decision 9.
 */
function filterByReceiverShape(
  resolved: HoconValue & { kind: 'object' },
  receiverShape: HoconValue & { kind: 'object' },
): HoconValue & { kind: 'object' } {
  const fields = new Map<string, HoconValue>()
  for (const [k, rv] of resolved.fields) {
    if (!receiverShape.fields.has(k)) continue
    const receiverVal = receiverShape.fields.get(k)!
    if (rv.kind === 'object' && receiverVal.kind === 'object') {
      fields.set(k, filterByReceiverShape(rv, receiverVal))
    } else {
      fields.set(k, rv)
    }
  }
  return { kind: 'object', fields }
}

/**
 * renderHoconAsJSON — renders a resolved HoconValue tree as canonical JSON
 * (sorted-key objects, no whitespace). Used by _renderJSONForTest.
 */
function renderHoconAsJSON(v: HoconValue): string {
  switch (v.kind) {
    case 'scalar': {
      switch (v.valueType) {
        case 'null': return 'null'
        case 'boolean': return v.raw
        case 'number': {
          const n = Number(v.raw)
          if (Number.isFinite(n)) return v.raw
          return JSON.stringify(v.raw)
        }
        case 'string': return JSON.stringify(v.raw)
      }
      break
    }
    case 'array': {
      const items = v.items.map(renderHoconAsJSON)
      return `[${items.join(',')}]`
    }
    case 'object': {
      const keys = [...v.fields.keys()].sort()
      const pairs = keys.map(k => {
        const val = v.fields.get(k)!
        return `${JSON.stringify(k)}:${renderHoconAsJSON(val)}`
      })
      return `{${pairs.join(',')}}`
    }
  }
  // Should never reach here for valid HoconValue.
  throw new Error(`renderHoconAsJSON: unsupported value kind (unresolved placeholder?)`)
}
