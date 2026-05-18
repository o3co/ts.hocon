import { ResolveError } from '../../errors.js'
import type { HoconValue } from '../../value.js'
import type { AstNode, AstField } from '../parser/ast.js'
import {
  type ResObj,
  type ResolverValue,
  type ResolveOptions,
  separatorValues,
  isSubst,
  isConcat,
  isAppend,
  isResObj,
  makeResObj,
} from './types.js'
import {
  deepMergeResObjInto,
} from './utils.js'
import { IncludeLoader } from './include-loader.js'

/**
 * Pass 1: builds a ResObj tree from AST nodes.
 * Encapsulates structure building, include loading, and substitution-path relativization.
 */
export class StructureBuilder {
  private opts: ResolveOptions
  private loader: IncludeLoader

  constructor(opts: ResolveOptions) {
    this.opts = opts
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
      const included = this.loader.load(field.value.path, field.value.required, field.value.isFile)
      if (pathPrefix.length > 0) {
        this.relativizeResObj(included, pathPrefix)
      }
      deepMergeResObjInto(obj, included)
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

    if (field.append) {
      // +=: append elem to existing array (or start from [])
      const existing: ResolverValue = obj.fields.get(head) ?? ({ kind: 'array', items: [] } satisfies HoconValue)
      obj.priorValues.set(head, existing)
      obj.fields.set(head, {
        _kind: 'append-placeholder',
        existing,
        elem: this.astToResolverValue(field.value, childPrefix),
      })
      return
    }

    // Normal assignment
    const existing = obj.fields.get(head)
    const newVal = this.astToResolverValue(field.value, childPrefix)

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

  private async applyFieldAsync(obj: ResObj, field: AstField, pathPrefix: string[]): Promise<void> {
    if (field.key.length === 0 && field.value.kind === 'include') {
      const included = await this.loader.loadAsync(field.value.path, field.value.required, field.value.isFile)
      if (pathPrefix.length > 0) {
        this.relativizeResObj(included, pathPrefix)
      }
      deepMergeResObjInto(obj, included)
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

    if (field.append) {
      const existing: ResolverValue = obj.fields.get(head) ?? ({ kind: 'array', items: [] } satisfies HoconValue)
      obj.priorValues.set(head, existing)
      obj.fields.set(head, {
        _kind: 'append-placeholder',
        existing,
        elem: await this.astToResolverValueAsync(field.value, childPrefix),
      })
      return
    }

    const existing = obj.fields.get(head)
    const newVal = await this.astToResolverValueAsync(field.value, childPrefix)

    if (existing !== undefined) {
      obj.priorValues.set(head, existing)
    }

    if (existing !== undefined && isResObj(existing) && isResObj(newVal)) {
      deepMergeResObjInto(existing, newVal)
      return
    }

    obj.fields.set(head, newVal)
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
        return { _kind: 'subst-placeholder', segments: ast.segments, optional: ast.optional, listSuffix: ast.listSuffix, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
      case 'concat':
        return { _kind: 'concat-placeholder', nodes: ast.nodes.map(n => this.astToResolverValue(n, pathPrefix)) }
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
        return { _kind: 'subst-placeholder', segments: ast.segments, optional: ast.optional, listSuffix: ast.listSuffix, line: ast.pos.line, col: ast.pos.col, prefixLen: 0 }
      case 'concat': {
        const nodes = []
        for (const n of ast.nodes) {
          nodes.push(await this.astToResolverValueAsync(n, pathPrefix))
        }
        return { _kind: 'concat-placeholder', nodes }
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
    if (isAppend(val)) {
      this.relativizeSubstPaths(val.existing, prefixSegments)
      this.relativizeSubstPaths(val.elem, prefixSegments)
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
