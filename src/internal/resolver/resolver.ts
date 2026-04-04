import * as nodePath from 'node:path'
import { ResolveError } from '../../errors.js'
import type { HoconValue } from '../../value.js'
import type { AstNode, AstField } from '../parser/ast.js'
import { tokenize } from '../lexer/lexer.js'
import { parseTokens } from '../parser/parser.js'
import { propertiesToHoconValue } from '../properties/properties.js'

// ---- Internal placeholder types (not exported) ----
type SubstPlaceholder = {
  _kind: 'subst-placeholder'
  path: string
  optional: boolean
  line: number
  col: number
  prefixLen: number  // 0 for normal, >0 for relativized (number of prefix segments)
}
type ConcatPlaceholder = {
  _kind: 'concat-placeholder'
  nodes: ResolverValue[]
}
type AppendPlaceholder = {
  _kind: 'append-placeholder'
  existing: ResolverValue
  elem: ResolverValue
}
type ResObj = {
  _kind: 'res-obj'
  fields: Map<string, ResolverValue>
  priorValues: Map<string, ResolverValue>
}

type ResolverValue = HoconValue | SubstPlaceholder | ConcatPlaceholder | AppendPlaceholder | ResObj

// Track parser-inserted separator whitespace values without leaking _separator
// into the public HoconValue type. Uses WeakSet so values can be GC'd normally.
const separatorValues = new WeakSet<HoconValue>()

function isSubst(v: ResolverValue): v is SubstPlaceholder {
  return (v as SubstPlaceholder)._kind === 'subst-placeholder'
}
function isConcat(v: ResolverValue): v is ConcatPlaceholder {
  return (v as ConcatPlaceholder)._kind === 'concat-placeholder'
}
function isAppend(v: ResolverValue): v is AppendPlaceholder {
  return (v as AppendPlaceholder)._kind === 'append-placeholder'
}
function isResObj(v: ResolverValue): v is ResObj {
  return (v as ResObj)._kind === 'res-obj'
}

function makeResObj(): ResObj {
  return { _kind: 'res-obj', fields: new Map(), priorValues: new Map() }
}

export type ResolveOptions = {
  env: Record<string, string>
  baseDir: string | undefined
  readFileSync: (filePath: string) => string
  readFile?: (filePath: string) => Promise<string>
  includeStack?: string[]
}

// ---- Public entry point ----

export function resolve(ast: AstNode, opts: ResolveOptions): HoconValue {
  // Pass 1
  const root = buildResObj(ast, opts, [])
  // Pass 2
  const resolving = new Set<string>()
  const resolvedCache = new Map<string, HoconValue>()
  return resolveResObj(root, root, resolving, resolvedCache, opts)
}

export async function resolveAsync(ast: AstNode, opts: ResolveOptions): Promise<HoconValue> {
  // Pass 1 (async — awaits file reads for includes)
  const root = await buildResObjAsync(ast, opts, [])
  // Pass 2 (sync — no I/O needed for substitution resolution)
  const resolving = new Set<string>()
  const resolvedCache = new Map<string, HoconValue>()
  return resolveResObj(root, root, resolving, resolvedCache, opts)
}

// ---- Pass 1: structure building ----

function buildResObj(ast: AstNode, opts: ResolveOptions, pathPrefix: string[]): ResObj {
  if (ast.kind !== 'object') {
    throw new ResolveError('root AST must be an object', '', ast.pos.line, ast.pos.col)
  }
  const obj = makeResObj()
  for (const field of ast.fields) {
    applyField(obj, field, opts, pathPrefix)
  }
  return obj
}

function applyField(obj: ResObj, field: AstField, opts: ResolveOptions, pathPrefix: string[]): void {
  // include directive: key is empty, value is include node
  if (field.key.length === 0 && field.value.kind === 'include') {
    // Included files are parsed at their own root (pathPrefix=[]),
    // then relativized to the current scope's prefix.
    const included = loadInclude(field.value.path, field.value.required, opts)
    if (pathPrefix.length > 0) {
      relativizeResObj(included, pathPrefix.join('.'), pathPrefix.length)
    }
    deepMergeResObjInto(obj, included)
    return
  }

  const [head, ...tail] = field.key
  if (!head) return

  if (tail.length > 0) {
    // Nested key: server.host = "x" → create synthetic object AST
    const syntheticAst: AstNode = {
      kind: 'object',
      fields: [{ key: tail, value: field.value, append: field.append, pos: field.pos }],
      pos: field.pos,
    }
    applyField(obj, { key: [head], value: syntheticAst, append: false, pos: field.pos }, opts, pathPrefix)
    return
  }

  const childPrefix = [...pathPrefix, head]

  if (field.append) {
    // +=: append elem to existing array (or start from [])
    const existing: ResolverValue = obj.fields.get(head) ?? ({ kind: 'array', items: [] } satisfies HoconValue)
    obj.priorValues.set(head, existing)
    obj.fields.set(head, {
      _kind: 'append-placeholder',
      existing,
      elem: astToResolverValue(field.value, opts, childPrefix),
    })
    return
  }

  // Normal assignment
  const existing = obj.fields.get(head)
  const newVal = astToResolverValue(field.value, opts, childPrefix)

  // Save prior value for self-referential substitution resolution
  if (existing !== undefined) {
    obj.priorValues.set(head, existing)
  }

  // Deep merge if both are ResObj
  if (existing !== undefined && isResObj(existing) && isResObj(newVal)) {
    deepMergeResObjInto(existing, newVal)
    // existing already in fields — no re-set needed
    return
  }

  obj.fields.set(head, newVal)
}

function astToResolverValue(ast: AstNode, opts: ResolveOptions, pathPrefix: string[]): ResolverValue {
  switch (ast.kind) {
    case 'scalar': {
      const sv: HoconValue = { kind: 'scalar', value: ast.value }
      if (ast._separator) separatorValues.add(sv)
      return sv
    }
    case 'array':
      return { kind: 'array', items: ast.items.map(i => astToResolverValue(i, opts, pathPrefix) as HoconValue) }
    case 'object': {
      const inner = buildResObj(ast, opts, pathPrefix)
      return inner
    }
    case 'subst':
      return { _kind: 'subst-placeholder', path: ast.path, optional: ast.optional, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
    case 'concat':
      return { _kind: 'concat-placeholder', nodes: ast.nodes.map(n => astToResolverValue(n, opts, pathPrefix)) }
    case 'include':
      return { kind: 'scalar', value: null } // handled by applyField; should not reach here
  }
}

function hoconValueToResObj(hv: HoconValue): ResObj {
  const obj = makeResObj()
  if (hv.kind !== 'object') return obj
  for (const [key, val] of hv.fields) {
    if (val.kind === 'object') {
      obj.fields.set(key, hoconValueToResObj(val))
    } else {
      obj.fields.set(key, val)
    }
  }
  return obj
}

function deepMergeResObjInto(dst: ResObj, src: ResObj): void {
  for (const [k, srcVal] of src.fields) {
    const dstVal = dst.fields.get(k)
    if (dstVal !== undefined && isResObj(dstVal) && isResObj(srcVal)) {
      deepMergeResObjInto(dstVal, srcVal)
    } else {
      if (dstVal !== undefined) dst.priorValues.set(k, dstVal)
      dst.fields.set(k, srcVal)
    }
  }
  // Carry over priorValues from src that dst doesn't already have
  for (const [k, srcPrior] of src.priorValues) {
    if (!dst.priorValues.has(k)) {
      dst.priorValues.set(k, srcPrior)
    }
  }
}

// ---- Relativize substitution paths for nested includes ----

function relativizeSubstPaths(val: ResolverValue, prefix: string, prefixSegmentCount: number): void {
  if (isSubst(val)) {
    val.path = `${prefix}.${val.path}`
    val.prefixLen = prefixSegmentCount
    return
  }
  if (isConcat(val)) {
    for (const node of val.nodes) {
      relativizeSubstPaths(node, prefix, prefixSegmentCount)
    }
    return
  }
  if (isAppend(val)) {
    relativizeSubstPaths(val.existing, prefix, prefixSegmentCount)
    relativizeSubstPaths(val.elem, prefix, prefixSegmentCount)
    return
  }
  if (isResObj(val)) {
    relativizeResObj(val, prefix, prefixSegmentCount)
    return
  }
  // HoconValue arrays may contain substitutions inside items (shouldn't happen
  // in practice since arrays are built from astToResolverValue, but be safe)
  const hv = val as HoconValue
  if (hv.kind === 'array') {
    for (const item of hv.items) {
      relativizeSubstPaths(item as ResolverValue, prefix, prefixSegmentCount)
    }
  }
}

function relativizeResObj(obj: ResObj, prefix: string, prefixSegmentCount: number): void {
  for (const val of obj.fields.values()) {
    relativizeSubstPaths(val, prefix, prefixSegmentCount)
  }
  for (const val of obj.priorValues.values()) {
    relativizeSubstPaths(val, prefix, prefixSegmentCount)
  }
}

// ---- Pass 2: substitution resolution ----

function resolveResObj(
  obj: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const result = new Map<string, HoconValue>()
  for (const [key, val] of obj.fields) {
    const resolved = resolveVal(val, obj, root, resolving, resolvedCache, opts)
    if (resolved !== undefined) {
      // Delayed merge: if both current and prior resolve to objects, deep merge
      if (resolved.kind === 'object') {
        const prior = obj.priorValues.get(key)
        if (prior !== undefined) {
          const priorResolved = resolveVal(prior, obj, root, resolving, resolvedCache, opts)
          if (priorResolved !== undefined && priorResolved.kind === 'object') {
            result.set(key, deepMergeHoconValues(
              priorResolved as HoconValue & { kind: 'object' },
              resolved as HoconValue & { kind: 'object' },
            ))
            continue
          }
        }
      }
      result.set(key, resolved)
    } else {
      // Unresolved optional substitution: fall back to prior value per HOCON spec
      const prior = obj.priorValues.get(key)
      if (prior !== undefined) {
        const priorResolved = resolveVal(prior, obj, root, resolving, resolvedCache, opts)
        if (priorResolved !== undefined) result.set(key, priorResolved)
      }
    }
  }
  return { kind: 'object', fields: result }
}

function resolveVal(
  v: ResolverValue,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue | undefined {
  if (isSubst(v)) return resolveSubst(v, scope, root, resolving, resolvedCache, opts)
  if (isConcat(v)) return resolveConcat(v.nodes, scope, root, resolving, resolvedCache, opts)
  if (isAppend(v)) return resolveAppend(v, scope, root, resolving, resolvedCache, opts)
  if (isResObj(v)) return resolveResObj(v, root, resolving, resolvedCache, opts)
  const hv = v as HoconValue
  if (hv.kind === 'array') {
    return {
      kind: 'array',
      items: hv.items.map((item: HoconValue) =>
        resolveVal(item as ResolverValue, scope, root, resolving, resolvedCache, opts)
        ?? ({ kind: 'scalar', value: null } satisfies HoconValue)
      ),
    }
  }
  return hv
}

function resolveSubst(
  s: SubstPlaceholder,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue | undefined {
  if (resolvedCache.has(s.path)) return resolvedCache.get(s.path)!

  if (resolving.has(s.path)) {
    // Cycle detected: try prior value for self-referential substitutions.
    const segments = parseSubstPath(s.path)
    let prior: ResolverValue | undefined
    if (s.prefixLen > 0) {
      const leafSeg = segments[segments.length - 1] ?? ''
      const parentScope = lookupResObj(root, segments.slice(0, segments.length - 1))
      prior = parentScope?.priorValues.get(leafSeg)
    } else {
      const rootSeg = segments[0] ?? ''
      prior = scope.priorValues.get(rootSeg) ?? root.priorValues.get(rootSeg)
    }
    if (prior !== undefined) {
      // Resolve prior with a fresh resolving set to avoid re-triggering the cycle check
      return resolveVal(prior, scope, root, new Set(resolving), resolvedCache, opts)
    }
    if (s.optional) return undefined
    throw new ResolveError(`circular substitution: ${s.path}`, s.path, s.line, s.col)
  }

  resolving.add(s.path)
  try {
    const found = lookupPath(root, parseSubstPath(s.path))
    if (found !== undefined) {
      // Only fall back to prior value for actual self-referential substitutions
      // (e.g. b=${b}), not for any substitution found during lookup.
      if (isSubst(found) || isConcat(found)) {
        const isSelfRef = isSubst(found)
          ? found.path === s.path
          : isConcat(found) && found.nodes.some(
              (n: ResolverValue) => isSubst(n) && n.path === s.path
            )
        if (isSelfRef) {
          const selfSegments = parseSubstPath(s.path)
          let prior: ResolverValue | undefined
          if (s.prefixLen > 0) {
            const leafSeg = selfSegments[selfSegments.length - 1] ?? ''
            const parentScope = lookupResObj(root, selfSegments.slice(0, selfSegments.length - 1))
            prior = parentScope?.priorValues.get(leafSeg)
          } else {
            const rootSeg = selfSegments[0] ?? ''
            prior = scope.priorValues.get(rootSeg) ?? root.priorValues.get(rootSeg)
          }
          if (prior !== undefined) {
            const result = resolveVal(prior, scope, root, resolving, resolvedCache, opts)
            if (result !== undefined) resolvedCache.set(s.path, result)
            return result
          }
        }
      }
      let result = resolveVal(found, scope, root, resolving, resolvedCache, opts)
      // Delayed merge in substitution context: if the resolved value is an object
      // and there's a prior value for the leaf segment that also resolves to an object,
      // deep merge them (prior as base, current on top).
      // For non-relativized paths: only single-segment (e.g. ${a}), not multi-segment
      // (e.g. ${a.b}) which would incorrectly merge the prior of "a".
      // For relativized paths: effective segment count (after prefix) must be 1.
      const segments = parseSubstPath(s.path)
      const effectiveLen = segments.length - s.prefixLen
      if (effectiveLen === 1 && result !== undefined && result.kind === 'object') {
        const leafSeg = segments[segments.length - 1] ?? ''
        // Find the prior value: for relativized paths, walk from root to the parent scope
        let prior: ResolverValue | undefined
        if (s.prefixLen > 0) {
          const parentScope = lookupResObj(root, segments.slice(0, segments.length - 1))
          prior = parentScope?.priorValues.get(leafSeg)
        } else {
          prior = scope.priorValues.get(leafSeg) ?? root.priorValues.get(leafSeg)
        }
        if (prior !== undefined) {
          const priorResolved = resolveVal(prior, scope, root, resolving, resolvedCache, opts)
          if (priorResolved !== undefined && priorResolved.kind === 'object') {
            result = deepMergeHoconValues(
              priorResolved as HoconValue & { kind: 'object' },
              result as HoconValue & { kind: 'object' },
            )
          }
        }
      }
      if (result !== undefined) resolvedCache.set(s.path, result)
      return result
    }

    // Env var fallback — also try the original (non-relativized) path
    const envVal = opts.env[s.path] ?? (
      s.prefixLen > 0
        ? opts.env[parseSubstPath(s.path).slice(s.prefixLen).join('.')]
        : undefined
    )
    if (envVal !== undefined) {
      const result: HoconValue = { kind: 'scalar', value: envVal }
      resolvedCache.set(s.path, result)
      return result
    }

    if (s.optional) return undefined
    throw new ResolveError(`could not resolve substitution: \${${s.path}}`, s.path, s.line, s.col)
  } finally {
    resolving.delete(s.path)
  }
}

function resolveConcat(
  nodes: ResolverValue[],
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const resolved = nodes
    .map(n => resolveVal(n, scope, root, resolving, resolvedCache, opts))
    .filter((v): v is HoconValue => v !== undefined)

  if (resolved.length === 0) return { kind: 'scalar', value: null }
  if (resolved.length === 1) return resolved[0]!

  // Object concatenation: if all non-separator elements are objects, deep-merge them.
  // Only filter parser-inserted separator whitespace (tracked via separatorValues WeakSet),
  // NOT user-authored values like "" or " " which should prevent object merging.
  const nonSep = resolved.filter(v => !separatorValues.has(v))
  if (nonSep.length > 0 && nonSep.every(v => v.kind === 'object')) {
    const merged = new Map<string, HoconValue>()
    for (const v of nonSep) {
      if (v.kind === 'object') {
        for (const [k, val] of v.fields) {
          const existing = merged.get(k)
          if (existing?.kind === 'object' && val.kind === 'object') {
            merged.set(k, deepMergeHoconValues(existing, val))
          } else {
            merged.set(k, val)
          }
        }
      }
    }
    return { kind: 'object', fields: merged }
  }

  // Array concatenation: if any element is an array, treat all as array elements
  if (resolved.some(v => v.kind === 'array')) {
    const items: HoconValue[] = []
    for (const v of resolved) {
      if (v.kind === 'array') items.push(...v.items)
      else items.push(v)
    }
    return { kind: 'array', items }
  }

  // String concatenation
  const str = resolved.map(v => v.kind === 'scalar' ? String(v.value) : JSON.stringify(v)).join('')
  return { kind: 'scalar', value: str }
}

function deepMergeHoconValues(
  base: HoconValue & { kind: 'object' },
  overlay: HoconValue & { kind: 'object' },
): HoconValue & { kind: 'object' } {
  const merged = new Map(base.fields)
  for (const [k, v] of overlay.fields) {
    const existing = merged.get(k)
    if (existing?.kind === 'object' && v.kind === 'object') {
      merged.set(k, deepMergeHoconValues(existing as HoconValue & { kind: 'object' }, v as HoconValue & { kind: 'object' }))
    } else {
      merged.set(k, v)
    }
  }
  return { kind: 'object', fields: merged }
}

function resolveAppend(
  a: AppendPlaceholder,
  scope: ResObj,
  root: ResObj,
  resolving: Set<string>,
  resolvedCache: Map<string, HoconValue>,
  opts: ResolveOptions,
): HoconValue {
  const existing = resolveVal(a.existing, scope, root, resolving, resolvedCache, opts)
    ?? ({ kind: 'array', items: [] } satisfies HoconValue)
  const elem = resolveVal(a.elem, scope, root, resolving, resolvedCache, opts)
  const items: HoconValue[] = existing.kind === 'array' ? [...existing.items] : [existing]
  if (elem !== undefined) items.push(elem)
  return { kind: 'array', items }
}

/** Walk from root to find a ResObj at the given path (not the value, but the container). */
function lookupResObj(root: ResObj, segments: string[]): ResObj | undefined {
  let cur: ResObj = root
  for (const seg of segments) {
    const val = cur.fields.get(seg)
    if (val === undefined || !isResObj(val)) return undefined
    cur = val
  }
  return cur
}

function lookupPath(root: ResObj, segments: string[]): ResolverValue | undefined {
  const [head, ...tail] = segments
  if (head === undefined || head === '') {
    // For empty-string keys like "", try direct lookup
    if (segments.length > 0) {
      const val = root.fields.get('')
      if (val === undefined) return undefined
      if (tail.length === 0) return val
      if (isResObj(val)) return lookupPath(val, tail)
      return undefined
    }
    return undefined
  }
  const val = root.fields.get(head)
  if (val === undefined) return undefined
  if (tail.length === 0) return val
  if (isResObj(val)) return lookupPath(val, tail)
  return undefined
}

/**
 * Parse a substitution path that may contain quoted segments.
 * E.g. `"a.b.c"` → ["a.b.c"], `a.b.c` → ["a","b","c"],
 * `"".""."""` → ["","",""]
 */
function parseSubstPath(raw: string): string[] {
  const segments: string[] = []
  let i = 0
  while (i < raw.length) {
    // Skip whitespace
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++
    if (i >= raw.length) break

    if (raw[i] === '"') {
      // Quoted segment
      i++ // skip opening quote
      let seg = ''
      while (i < raw.length && raw[i] !== '"') {
        seg += raw[i]
        i++
      }
      if (i < raw.length) i++ // skip closing quote
      segments.push(seg)
      // Skip whitespace and dot separator
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++
      if (i < raw.length && raw[i] === '.') i++
    } else if (raw[i] === '.') {
      // Dot at start or after dot means empty-string segment
      segments.push('')
      i++
    } else {
      // Unquoted segment - read until dot or end
      let seg = ''
      while (i < raw.length && raw[i] !== '.') {
        seg += raw[i]
        i++
      }
      segments.push(seg.trim())
      if (i < raw.length && raw[i] === '.') i++
    }
  }
  return segments
}

function isFileNotFoundError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'MODULE_NOT_FOUND') return true
  // Fallback for custom readFile implementations that don't set .code
  const msg = e.message.toLowerCase()
  return msg.includes('not found') || msg.includes('no such file') || msg.includes('enoent')
}

function loadSingleInclude(candidate: string, opts: ResolveOptions): ResObj | undefined {
  const { readFileSync, includeStack = [], env } = opts

  if (includeStack.includes(candidate)) {
    throw new ResolveError(`circular include: ${candidate}`, candidate, 0, 0)
  }

  let content: string
  try {
    content = readFileSync(candidate)
  } catch (e: unknown) {
    if (isFileNotFoundError(e)) return undefined
    throw e
  }

  if (candidate.endsWith('.properties')) {
    return hoconValueToResObj(propertiesToHoconValue(content))
  }

  const ast = parseTokens(tokenize(content))
  return buildResObj(ast, {
    env,
    baseDir: nodePath.dirname(candidate),
    readFileSync,
    includeStack: [...includeStack, candidate],
  }, [])
}

function loadInclude(includePath: string, required: boolean, opts: ResolveOptions): ResObj {
  const { baseDir, includeStack = [] } = opts
  const absPath = baseDir
    ? nodePath.resolve(baseDir, includePath)
    : nodePath.resolve(includePath)

  if (includeStack.includes(absPath)) {
    throw new ResolveError(`circular include: ${absPath}`, absPath, 0, 0)
  }

  if (includeStack.length >= 50) {
    throw new ResolveError(`include depth limit exceeded (max 50)`, includePath, 0, 0)
  }

  const hasExplicitExt = absPath.endsWith('.conf') || absPath.endsWith('.json') || absPath.endsWith('.properties')

  if (hasExplicitExt) {
    // Explicit extension: load only that exact file
    const result = loadSingleInclude(absPath, opts)
    if (result !== undefined) return result
    if (required) {
      throw new ResolveError(`required include file not found: ${includePath}`, includePath, 0, 0)
    }
    return makeResObj()
  }

  // No extension: merge all found extensions
  // Probe order: .properties, .json, .conf (last wins via deepMerge)
  const merged = makeResObj()
  let foundAny = false
  const probeExts = ['.properties', '.json', '.conf']
  for (const ext of probeExts) {
    const obj = loadSingleInclude(`${absPath}${ext}`, opts)
    if (obj !== undefined) {
      deepMergeResObjInto(merged, obj)
      foundAny = true
    }
  }

  if (!foundAny && required) {
    throw new ResolveError(`required include file not found: ${includePath}`, includePath, 0, 0)
  }
  return merged
}

// ---- Async Pass 1 helpers (mirror sync versions but await file reads) ----

async function buildResObjAsync(ast: AstNode, opts: ResolveOptions, pathPrefix: string[]): Promise<ResObj> {
  if (ast.kind !== 'object') {
    throw new ResolveError('root AST must be an object', '', ast.pos.line, ast.pos.col)
  }
  const obj = makeResObj()
  for (const field of ast.fields) {
    await applyFieldAsync(obj, field, opts, pathPrefix)
  }
  return obj
}

async function applyFieldAsync(obj: ResObj, field: AstField, opts: ResolveOptions, pathPrefix: string[]): Promise<void> {
  if (field.key.length === 0 && field.value.kind === 'include') {
    const included = await loadIncludeAsync(field.value.path, field.value.required, opts)
    if (pathPrefix.length > 0) {
      relativizeResObj(included, pathPrefix.join('.'), pathPrefix.length)
    }
    deepMergeResObjInto(obj, included)
    return
  }

  const [head, ...tail] = field.key
  if (!head) return

  if (tail.length > 0) {
    const syntheticAst: AstNode = {
      kind: 'object',
      fields: [{ key: tail, value: field.value, append: field.append, pos: field.pos }],
      pos: field.pos,
    }
    await applyFieldAsync(obj, { key: [head], value: syntheticAst, append: false, pos: field.pos }, opts, pathPrefix)
    return
  }

  const childPrefix = [...pathPrefix, head]

  if (field.append) {
    const existing: ResolverValue = obj.fields.get(head) ?? ({ kind: 'array', items: [] } satisfies HoconValue)
    obj.priorValues.set(head, existing)
    obj.fields.set(head, {
      _kind: 'append-placeholder',
      existing,
      elem: await astToResolverValueAsync(field.value, opts, childPrefix),
    })
    return
  }

  const existing = obj.fields.get(head)
  const newVal = await astToResolverValueAsync(field.value, opts, childPrefix)

  if (existing !== undefined) {
    obj.priorValues.set(head, existing)
  }

  if (existing !== undefined && isResObj(existing) && isResObj(newVal)) {
    deepMergeResObjInto(existing, newVal)
    return
  }

  obj.fields.set(head, newVal)
}

async function astToResolverValueAsync(ast: AstNode, opts: ResolveOptions, pathPrefix: string[]): Promise<ResolverValue> {
  switch (ast.kind) {
    case 'scalar': {
      const sv: HoconValue = { kind: 'scalar', value: ast.value }
      if (ast._separator) separatorValues.add(sv)
      return sv
    }
    case 'array': {
      const items = []
      for (const i of ast.items) {
        items.push(await astToResolverValueAsync(i, opts, pathPrefix) as HoconValue)
      }
      return { kind: 'array', items }
    }
    case 'object':
      return await buildResObjAsync(ast, opts, pathPrefix)
    case 'subst':
      return { _kind: 'subst-placeholder', path: ast.path, optional: ast.optional, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
    case 'concat': {
      const nodes = []
      for (const n of ast.nodes) {
        nodes.push(await astToResolverValueAsync(n, opts, pathPrefix))
      }
      return { _kind: 'concat-placeholder', nodes }
    }
    case 'include':
      return { kind: 'scalar', value: null }
  }
}

async function loadSingleIncludeAsync(candidate: string, opts: ResolveOptions): Promise<ResObj | undefined> {
  const { readFile, readFileSync, includeStack = [], env } = opts
  const read = readFile
    ? async (p: string) => readFile(p)
    : async (p: string) => readFileSync(p)

  if (includeStack.includes(candidate)) {
    throw new ResolveError(`circular include: ${candidate}`, candidate, 0, 0)
  }

  let content: string
  try {
    content = await read(candidate)
  } catch (e: unknown) {
    if (isFileNotFoundError(e)) return undefined
    throw e
  }

  if (candidate.endsWith('.properties')) {
    return hoconValueToResObj(propertiesToHoconValue(content))
  }

  const ast = parseTokens(tokenize(content))
  return buildResObjAsync(ast, {
    env,
    baseDir: nodePath.dirname(candidate),
    readFileSync,
    readFile,
    includeStack: [...includeStack, candidate],
  }, [])
}

async function loadIncludeAsync(includePath: string, required: boolean, opts: ResolveOptions): Promise<ResObj> {
  const { baseDir, includeStack = [] } = opts
  const absPath = baseDir
    ? nodePath.resolve(baseDir, includePath)
    : nodePath.resolve(includePath)

  if (includeStack.includes(absPath)) {
    throw new ResolveError(`circular include: ${absPath}`, absPath, 0, 0)
  }

  if (includeStack.length >= 50) {
    throw new ResolveError(`include depth limit exceeded (max 50)`, includePath, 0, 0)
  }

  const hasExplicitExt = absPath.endsWith('.conf') || absPath.endsWith('.json') || absPath.endsWith('.properties')

  if (hasExplicitExt) {
    // Explicit extension: load only that exact file
    const result = await loadSingleIncludeAsync(absPath, opts)
    if (result !== undefined) return result
    if (required) {
      throw new ResolveError(`required include file not found: ${includePath}`, includePath, 0, 0)
    }
    return makeResObj()
  }

  // No extension: merge all found extensions
  const merged = makeResObj()
  let foundAny = false
  const probeExts = ['.properties', '.json', '.conf']
  for (const ext of probeExts) {
    const obj = await loadSingleIncludeAsync(`${absPath}${ext}`, opts)
    if (obj !== undefined) {
      deepMergeResObjInto(merged, obj)
      foundAny = true
    }
  }

  if (!foundAny && required) {
    throw new ResolveError(`required include file not found: ${includePath}`, includePath, 0, 0)
  }
  return merged
}
