import { ResolveError } from '../../errors.js'
import type { HoconValue } from '../../value.js'
import type { AstNode, AstField } from '../parser/ast.js'
import type { Segment } from '../lexer/token.js'
import {
  type ResObj,
  type ResolverValue,
  type ResolveOptions,
  separatorValues,
  isSubst,
  isConcat,
  isResObj,
  makeResObj,
} from './types.js'
import {
  containsSelfRef,
  foldNestedSelfRefs,
  foldOrSkipPrior,
  stringSegmentsToKey,
} from './fold-self-ref.js'
import {
  deepMergeResObjInto,
} from './utils.js'
import { IncludeLoader } from './include-loader.js'

/**
 * Pass 1: builds a ResObj tree from AST nodes.
 * Encapsulates structure building, include loading, and substitution-path relativization.
 */
export class StructureBuilder {
  private loader: IncludeLoader

  constructor(opts: ResolveOptions) {
    this.loader = new IncludeLoader(opts)
    this.loader.onBuildResObj = (a, o) => new StructureBuilder(o).build(a)
    this.loader.onBuildResObjAsync = async (a, o) => new StructureBuilder(o).buildAsync(a)
  }

  build(ast: AstNode, pathPrefix: string[] = []): ResObj {
    if (ast.kind !== 'object') {
      throw new ResolveError('root AST must be an object', '', ast.pos.line, ast.pos.col)
    }
    const obj = makeResObj()
    for (const field of ast.fields) {
      this.applyField(obj, field, pathPrefix)
    }
    return obj
  }

  async buildAsync(ast: AstNode, pathPrefix: string[] = []): Promise<ResObj> {
    if (ast.kind !== 'object') {
      throw new ResolveError('root AST must be an object', '', ast.pos.line, ast.pos.col)
    }
    const obj = makeResObj()
    for (const field of ast.fields) {
      await this.applyFieldAsync(obj, field, pathPrefix)
    }
    return obj
  }

  private applyField(obj: ResObj, field: AstField, pathPrefix: string[]): void {
    // include directive: key is empty, value is include node
    if (field.key.length === 0 && field.value.kind === 'include') {
      // Included files are parsed at their own root (pathPrefix=[]),
      // then relativized to the current scope's prefix.
      const { qualifier, path, required } = field.value
      let included: ResObj
      if (qualifier.kind === 'package') {
        included = this.loader.loadPackage(qualifier.identifier, path, required)
      } else {
        included = this.loader.load(path, required, qualifier.kind === 'file')
      }
      if (pathPrefix.length > 0) {
        this.relativizeResObj(included, pathPrefix)
      }
      deepMergeResObjInto(obj, included, pathPrefix)
      return
    }

    const [head, ...tail] = field.key
    if (head === undefined) return

    if (tail.length > 0) {
      // Nested key: server.host = "x" → create synthetic object AST
      const syntheticAst: AstNode = {
        kind: 'object',
        fields: [{ key: tail, value: field.value, append: field.append, pos: field.pos }],
        pos: field.pos,
      }
      this.applyField(obj, { key: [head], value: syntheticAst, append: false, pos: field.pos }, pathPrefix)
      return
    }

    const childPrefix = [...pathPrefix, head]
    const fullKey = stringSegmentsToKey(childPrefix)

    if (field.append) {
      // S13b.2: `a += b` ≡ `a = ${?a} [b]` (HOCON.md L732). Desugar to that
      // exact concat AST and re-dispatch through the normal-assignment path so
      // every `+=` flows through the chained-self-ref machinery (#118/#120),
      // which already accumulates `a = ${?a} [...]` as a duplicate-key chain —
      // including across include boundaries (the cross-include splice in
      // deepMergeResObjInto). The self-ref uses the full nested path so
      // `srv.items += x` references `${?srv.items}`; include relativization
      // rewrites it under a mount prefix. Reset semantics are preserved by the
      // `resetKeys` flag recorded on a non-self-ref assignment below. See
      // go.hocon#134.
      const synthetic = this.desugarAppend(field, childPrefix)
      this.applyField(obj, synthetic, pathPrefix)
      return
    }

    // Normal assignment
    const existing = obj.fields.get(head)
    const newVal = this.astToResolverValue(field.value, childPrefix)

    // go.hocon#134: a non-self-referential assignment to `head` is a *reset* —
    // its net value does not chain off an outer `${?head}`. Record it so a
    // cross-include merge discards (rather than splices onto) the destination's
    // pre-merge value. A desugared `+=` (or explicit `head = ${?head} ...`) is
    // self-referential and so is NOT a reset; the chain continues across the
    // include boundary. Once set the flag stays set (a later `+=` chains off the
    // reset value, so the net still does not chain off an outer prior).
    if (!containsSelfRef(newVal, fullKey)) {
      obj.resetKeys.add(head)
    }

    // Save prior value for self-referential substitution resolution.
    // foldNestedSelfRefs pre-pass handles the multi-segment object form
    // (`o = {history=${o},...}` chained): for Obj-typed existing values
    // the inner ResObjs may carry their own priorValues with leaf-key
    // pollution from a previous deepMerge step; the pre-pass folds those
    // inner self-refs against each level's priorValues before the outer
    // save site does its full-key fold-or-skip.
    if (existing !== undefined) {
      const oldPrior = obj.priorValues.get(head)
      const priorInput = isResObj(existing) ? foldNestedSelfRefs(existing, childPrefix) : existing
      const prior = foldOrSkipPrior(priorInput, fullKey, oldPrior)
      if (prior !== undefined) obj.priorValues.set(head, prior)
    }

    // Deep merge if both are ResObj
    if (existing !== undefined && isResObj(existing) && isResObj(newVal)) {
      deepMergeResObjInto(existing, newVal, childPrefix)
      // existing already in fields — no re-set needed
      return
    }

    obj.fields.set(head, newVal)
  }

  private async applyFieldAsync(obj: ResObj, field: AstField, pathPrefix: string[]): Promise<void> {
    if (field.key.length === 0 && field.value.kind === 'include') {
      const { qualifier, path, required } = field.value
      let included: ResObj
      if (qualifier.kind === 'package') {
        included = await this.loader.loadPackageAsync(qualifier.identifier, path, required)
      } else {
        included = await this.loader.loadAsync(path, required, qualifier.kind === 'file')
      }
      if (pathPrefix.length > 0) {
        this.relativizeResObj(included, pathPrefix)
      }
      deepMergeResObjInto(obj, included, pathPrefix)
      return
    }

    const [head, ...tail] = field.key
    if (head === undefined) return

    if (tail.length > 0) {
      const syntheticAst: AstNode = {
        kind: 'object',
        fields: [{ key: tail, value: field.value, append: field.append, pos: field.pos }],
        pos: field.pos,
      }
      await this.applyFieldAsync(obj, { key: [head], value: syntheticAst, append: false, pos: field.pos }, pathPrefix)
      return
    }

    const childPrefix = [...pathPrefix, head]
    const fullKey = stringSegmentsToKey(childPrefix)

    if (field.append) {
      // S13b.2 desugar — see the sync applyField for the rationale (go.hocon#134).
      const synthetic = this.desugarAppend(field, childPrefix)
      await this.applyFieldAsync(obj, synthetic, pathPrefix)
      return
    }

    const existing = obj.fields.get(head)
    const newVal = await this.astToResolverValueAsync(field.value, childPrefix)

    if (!containsSelfRef(newVal, fullKey)) {
      obj.resetKeys.add(head)
    }

    if (existing !== undefined) {
      const oldPrior = obj.priorValues.get(head)
      const priorInput = isResObj(existing) ? foldNestedSelfRefs(existing, childPrefix) : existing
      const prior = foldOrSkipPrior(priorInput, fullKey, oldPrior)
      if (prior !== undefined) obj.priorValues.set(head, prior)
    }

    if (existing !== undefined && isResObj(existing) && isResObj(newVal)) {
      deepMergeResObjInto(existing, newVal, childPrefix)
      return
    }

    obj.fields.set(head, newVal)
  }

  /** Builds the `key = ${?fullkey} [value]` field that `key += value` desugars
   * to (S13b.2, HOCON.md L732). `childPrefix` is the field's fully-qualified
   * path (pathPrefix + key), so a nested `srv { items += x }` references
   * `${?srv.items}`; include relativization rewrites it under a mount prefix.
   * `field.key` is already single-segment here (multi-segment keys are split
   * into nested objects upstream). Returns a NEW AstField (append=false);
   * positions inherit from the original field so resolve-time errors (the
   * S13b.2 non-array check, now via the scalar+array concat) keep a location. */
  private desugarAppend(field: AstField, childPrefix: string[]): AstField {
    const segments: Segment[] = childPrefix.map(text => ({ text, line: field.pos.line, col: field.pos.col }))
    const subst: AstNode = { kind: 'subst', segments, optional: true, listSuffix: false, pos: field.pos }
    const elemArray: AstNode = { kind: 'array', items: [field.value], pos: field.pos }
    const synthetic: AstNode = { kind: 'concat', nodes: [subst, elemArray], pos: field.pos }
    return { key: field.key, value: synthetic, append: false, pos: field.pos }
  }

  private astToResolverValue(ast: AstNode, pathPrefix: string[]): ResolverValue {
    switch (ast.kind) {
      case 'scalar': {
        const sv: HoconValue = { kind: 'scalar', raw: ast.raw, valueType: ast.valueType }
        if (ast._separator) separatorValues.add(sv)
        return sv
      }
      case 'array':
        return { kind: 'array', items: ast.items.map(i => this.astToResolverValue(i, pathPrefix) as HoconValue) }
      case 'object': {
        const inner = this.build(ast, pathPrefix)
        return inner
      }
      case 'subst':
        return { _kind: 'subst-placeholder', segments: ast.segments, optional: ast.optional, knownAbsent: false, listSuffix: ast.listSuffix, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
      case 'concat':
        return { _kind: 'concat-placeholder', nodes: ast.nodes.map(n => this.astToResolverValue(n, pathPrefix)), line: ast.pos.line, col: ast.pos.col }
      case 'include':
        return { kind: 'scalar', raw: 'null', valueType: 'null' } // handled by applyField; should not reach here
    }
  }

  private async astToResolverValueAsync(ast: AstNode, pathPrefix: string[]): Promise<ResolverValue> {
    switch (ast.kind) {
      case 'scalar': {
        const sv: HoconValue = { kind: 'scalar', raw: ast.raw, valueType: ast.valueType }
        if (ast._separator) separatorValues.add(sv)
        return sv
      }
      case 'array': {
        const items = []
        for (const i of ast.items) {
          items.push(await this.astToResolverValueAsync(i, pathPrefix) as HoconValue)
        }
        return { kind: 'array', items }
      }
      case 'object':
        return await this.buildAsync(ast, pathPrefix)
      case 'subst':
        return { _kind: 'subst-placeholder', segments: ast.segments, optional: ast.optional, knownAbsent: false, listSuffix: ast.listSuffix, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
      case 'concat': {
        const nodes = []
        for (const n of ast.nodes) {
          nodes.push(await this.astToResolverValueAsync(n, pathPrefix))
        }
        return { _kind: 'concat-placeholder', nodes, line: ast.pos.line, col: ast.pos.col }
      }
      case 'include':
        return { kind: 'scalar', raw: 'null', valueType: 'null' }
    }
  }

  // ---- Relativize substitution paths for nested includes ----

  private relativizeSubstPaths(val: ResolverValue, prefixSegments: string[]): void {
    if (isSubst(val)) {
      // Convert string prefix segments to Segment objects (position 0,0 since these are synthetic)
      const prefixAsSegments = prefixSegments.map(text => ({ text, line: 0, col: 0 }))
      val.segments = [...prefixAsSegments, ...val.segments]
      val.prefixLen += prefixSegments.length
      return
    }
    if (isConcat(val)) {
      for (const node of val.nodes) {
        this.relativizeSubstPaths(node, prefixSegments)
      }
      return
    }
    if (isResObj(val)) {
      this.relativizeResObj(val, prefixSegments)
      return
    }
    // HoconValue arrays may contain substitutions inside items (shouldn't happen
    // in practice since arrays are built from astToResolverValue, but be safe)
    const hv = val as HoconValue
    if (hv.kind === 'array') {
      for (const item of hv.items) {
        this.relativizeSubstPaths(item as ResolverValue, prefixSegments)
      }
    }
  }

  private relativizeResObj(obj: ResObj, prefixSegments: string[]): void {
    for (const val of obj.fields.values()) {
      this.relativizeSubstPaths(val, prefixSegments)
    }
    for (const val of obj.priorValues.values()) {
      this.relativizeSubstPaths(val, prefixSegments)
    }
  }
}
