import * as nodePath from 'node:path'
import { ResolveError } from '../../errors.js'
import type { AstNode } from '../parser/ast.js'
import { tokenize } from '../lexer/lexer.js'
import { parseTokens } from '../parser/parser.js'
import { propertiesToHoconValue } from '../properties/properties.js'
import {
  type ResObj,
  type ResolveOptions,
  makeResObj,
} from './types.js'
import {
  deepMergeResObjInto,
  hoconValueToResObj,
  isFileNotFoundError,
} from './utils.js'

export class IncludeLoader {
  private opts: ResolveOptions

  // Callbacks set by the caller (StructureBuilder) to avoid circular dependency.
  // These delegate back to buildResObj / buildResObjAsync.
  onBuildResObj!: (ast: AstNode, opts: ResolveOptions) => ResObj
  onBuildResObjAsync!: (ast: AstNode, opts: ResolveOptions) => Promise<ResObj>

  constructor(opts: ResolveOptions) {
    this.opts = opts
  }

  /**
   * Resolve an include path to an absolute path.
   * - file() includes resolve relative to CWD (or as absolute paths),
   *   NOT relative to the including file's directory.
   * - Bare includes resolve relative to the including file's directory (baseDir).
   */
  private resolveIncludePath(includePath: string, baseDir: string | undefined, isFile: boolean): string {
    return isFile
      ? nodePath.resolve(includePath)
      : (baseDir ? nodePath.resolve(baseDir, includePath) : nodePath.resolve(includePath))
  }

  load(includePath: string, required: boolean, isFile?: boolean): ResObj {
    const { baseDir, includeStack = [] } = this.opts
    const absPath = this.resolveIncludePath(includePath, baseDir, !!isFile)

    if (includeStack.includes(absPath)) {
      throw new ResolveError(`circular include: ${absPath}`, absPath, 0, 0)
    }

    if (includeStack.length >= 50) {
      throw new ResolveError(`include depth limit exceeded (max 50)`, includePath, 0, 0)
    }

    const hasExplicitExt = absPath.endsWith('.conf') || absPath.endsWith('.json') || absPath.endsWith('.properties')

    if (hasExplicitExt) {
      const result = this.loadSingle(absPath)
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
      const obj = this.loadSingle(`${absPath}${ext}`)
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

  async loadAsync(includePath: string, required: boolean, isFile?: boolean): Promise<ResObj> {
    const { baseDir, includeStack = [] } = this.opts
    const absPath = this.resolveIncludePath(includePath, baseDir, !!isFile)

    if (includeStack.includes(absPath)) {
      throw new ResolveError(`circular include: ${absPath}`, absPath, 0, 0)
    }

    if (includeStack.length >= 50) {
      throw new ResolveError(`include depth limit exceeded (max 50)`, includePath, 0, 0)
    }

    const hasExplicitExt = absPath.endsWith('.conf') || absPath.endsWith('.json') || absPath.endsWith('.properties')

    if (hasExplicitExt) {
      const result = await this.loadSingleAsync(absPath)
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
      const obj = await this.loadSingleAsync(`${absPath}${ext}`)
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

  private loadSingle(candidate: string): ResObj | undefined {
    const { readFileSync, includeStack = [], env } = this.opts

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
    return this.onBuildResObj(ast, {
      env,
      baseDir: nodePath.dirname(candidate),
      readFileSync,
      includeStack: [...includeStack, candidate],
    })
  }

  private async loadSingleAsync(candidate: string): Promise<ResObj | undefined> {
    const { readFile, readFileSync, includeStack = [], env } = this.opts
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
    return this.onBuildResObjAsync(ast, {
      env,
      baseDir: nodePath.dirname(candidate),
      readFileSync,
      readFile,
      includeStack: [...includeStack, candidate],
    })
  }
}
