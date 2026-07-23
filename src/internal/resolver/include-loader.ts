import { createRequire } from 'node:module'
import * as nodePath from 'node:path'
import { PackageLookupError, ParseError, ResolveError } from '../../errors.js'
import type { AstNode } from '../parser/ast.js'
import { tokenize } from '../lexer/lexer.js'
import { parseTokens } from '../parser/parser.js'
import { propertiesToHoconValue } from '../properties/properties.js'
import {
  type PackageResolver,
  type ResObj,
  type ResolveOptions,
  makeResObj,
} from './types.js'
import {
  deepMergeResObjInto,
  hoconValueToResObj,
  isFileNotFoundError,
} from './utils.js'

// createRequire works in both CJS and ESM Node contexts (Node ≥ 12).
// Using import.meta.url makes this module's directory the resolution anchor,
// which is overridden per-call via the `paths` option.
const _require = createRequire(import.meta.url)

/**
 * Detect Yarn Berry PnP store paths. PnP resolves to ZIP-internal paths that
 * cannot be read by fs.readFileSync after resolution.
 */
function isPnpPath(p: string): boolean {
  return p.includes('.yarn/cache') || p.includes('.pnp.cjs') || p.includes('.pnp.loader')
}

/**
 * Validate the file argument of `package("id", "file")` per E11 decision 6.
 * Runs on the post-HOCON-unescape string value.
 * Throws `ParseError` on violation (structural constraint, not a resolution failure).
 */
function validatePackageFile(file: string, identifier: string): void {
  if (file.length === 0) {
    throw new ParseError(`include package("${identifier}", ...): file argument must be non-empty`, 0, 0)
  }
  if (file.includes('\\')) {
    throw new ParseError(
      `include package("${identifier}", "${file}"): backslash not allowed in file argument (use forward slash)`,
      0, 0,
    )
  }
  if (file.startsWith('/')) {
    throw new ParseError(
      `include package("${identifier}", "${file}"): absolute path not allowed in file argument`,
      0, 0,
    )
  }
  if (/(?:^|\/)\.\.?(?:\/|$)/u.test(file)) {
    throw new ParseError(
      `include package("${identifier}", "${file}"): path traversal (. or ..) not allowed in file argument`,
      0, 0,
    )
  }
  if (file.includes('//')) {
    throw new ParseError(
      `include package("${identifier}", "${file}"): consecutive slashes not allowed in file argument`,
      0, 0,
    )
  }
}

/**
 * Validate the identifier argument of `package("id", "file")` per E11 decision 1.
 * Throws `ParseError` on violation.
 */
function validatePackageIdentifier(identifier: string): void {
  if (identifier.length === 0) {
    throw new ParseError('include package: identifier argument must be non-empty', 0, 0)
  }
}

/**
 * Default package resolver using Node's `require.resolve` via `createRequire`.
 * Works in both CJS and ESM contexts. Throws `PackageLookupError` on miss.
 */
function defaultPackageResolver(
  identifier: string,
  file: string,
  includingFile: string | undefined,
  baseDir: string | undefined,
  resolveFrom: string | string[] | undefined,
): string {
  // Priority: explicit resolveFrom > baseDir (active parse context) >
  // path.dirname(includingFile) (when threaded) > process.cwd() (last resort).
  // Without this baseDir step, package resolution from within a nested file
  // include falls back to cwd, breaking resolution for typical project layouts.
  const from = resolveFrom
    ? (Array.isArray(resolveFrom) ? resolveFrom : [resolveFrom])
    : baseDir
      ? [baseDir]
      : (includingFile ? [nodePath.dirname(includingFile)] : [process.cwd()])

  let resolved: string
  try {
    resolved = _require.resolve(`${identifier}/${file}`, { paths: from })
  } catch {
    throw new PackageLookupError(
      `include package("${identifier}", "${file}"): module not found (starting from: ${from.join(', ')})`,
      identifier,
      file,
      0,
      0,
    )
  }

  if (isPnpPath(resolved)) {
    throw new ResolveError(
      `include package("${identifier}", "${file}"): Yarn Berry PnP store paths are not supported. ` +
      `Provide a custom packageResolver option to handle PnP resolution.`,
      `${identifier}/${file}`,
      0,
      0,
    )
  }

  // E11 decision 5: case-sensitive file basename check.
  // On macOS/Windows (case-insensitive FS), require.resolve may return a path
  // with different capitalisation. Check the resolved basename matches exactly.
  const fileParts = file.split('/')
  const expectedBasename = fileParts[fileParts.length - 1] ?? file
  const resolvedBasename = nodePath.basename(resolved)
  if (resolvedBasename !== expectedBasename) {
    throw new PackageLookupError(
      `include package("${identifier}", "${file}"): case mismatch — resolved "${resolvedBasename}" ` +
      `but expected "${expectedBasename}" (E11 decision 5: case-sensitive)`,
      identifier,
      file,
      0,
      0,
    )
  }

  return resolved
}

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
        // Extension-probe merge: substitutions inside an included file are
        // still file-local at this stage (relativization happens at the
        // caller side after the file-group merges complete). Pass empty
        // prefix so fold uses bare-leaf keys.
        deepMergeResObjInto(merged, obj, [])
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
        // Extension-probe merge: substitutions inside an included file are
        // still file-local at this stage (relativization happens at the
        // caller side after the file-group merges complete). Pass empty
        // prefix so fold uses bare-leaf keys.
        deepMergeResObjInto(merged, obj, [])
        foundAny = true
      }
    }

    if (!foundAny && required) {
      throw new ResolveError(`required include file not found: ${includePath}`, includePath, 0, 0)
    }
    return merged
  }

  /**
   * Resolve and load `include package("identifier", "file")`.
   * Validates the identifier and file arguments, resolves via the package resolver,
   * performs cycle detection using a JSON-serialised cycle key, and parses the content.
   */
  // `required` is reserved for future optional-package semantics (E11 decision 7);
  // currently all package lookup failures throw regardless of this flag.
  loadPackage(identifier: string, file: string, _required: boolean): ResObj {
    validatePackageIdentifier(identifier)
    validatePackageFile(file, identifier)

    const { includeStack = [], baseDir, resolveFrom, packageResolver, readFileSync } = this.opts
    const cycleKey = JSON.stringify(['package', identifier, file])

    if (includeStack.includes(cycleKey)) {
      throw new ResolveError(
        `circular include: package("${identifier}", "${file}")`,
        `${identifier}/${file}`,
        0, 0,
      )
    }
    if (includeStack.length >= 50) {
      throw new ResolveError(`include depth limit exceeded (max 50)`, `${identifier}/${file}`, 0, 0)
    }

    const resolver: PackageResolver = packageResolver ??
      ((id, f, includingFile, bDir) => defaultPackageResolver(id, f, includingFile, bDir, resolveFrom))

    // The parent .conf's absolute path is not currently threaded through the loader,
    // so `includingFile` is undefined. `baseDir` IS available from the parse context
    // (set by the file-include loader via spread `...this.opts`) and gives the default
    // resolver the right starting directory for `require.resolve`'s `paths`.
    // Custom resolvers MUST handle both arguments being undefined gracefully.
    const resolvedPath = resolver(identifier, file, undefined, baseDir)

    const content = readFileSync(resolvedPath)
    // S3.1 (corrected, xx.hocon E10): empty / whitespace-only / comment-only
    // content is a valid empty document — parseTokens yields an empty object
    // AST, contributing {} (ipk08 and variants). No emptiness guard.
    const tokens = tokenize(content)
    const ast = parseTokens(tokens)
    return this.onBuildResObj(ast, {
      ...this.opts,
      baseDir: nodePath.dirname(resolvedPath),
      includeStack: [...includeStack, cycleKey],
    })
  }

  /**
   * Async variant of `loadPackage`.
   */
  async loadPackageAsync(identifier: string, file: string, _required: boolean): Promise<ResObj> {
    validatePackageIdentifier(identifier)
    validatePackageFile(file, identifier)

    const { includeStack = [], baseDir, resolveFrom, packageResolver, readFile, readFileSync } = this.opts
    const cycleKey = JSON.stringify(['package', identifier, file])

    if (includeStack.includes(cycleKey)) {
      throw new ResolveError(
        `circular include: package("${identifier}", "${file}")`,
        `${identifier}/${file}`,
        0, 0,
      )
    }
    if (includeStack.length >= 50) {
      throw new ResolveError(`include depth limit exceeded (max 50)`, `${identifier}/${file}`, 0, 0)
    }

    const resolver: PackageResolver = packageResolver ??
      ((id, f, includingFile, bDir) => defaultPackageResolver(id, f, includingFile, bDir, resolveFrom))

    // The parent .conf's absolute path is not currently threaded through the loader,
    // so `includingFile` is undefined. `baseDir` IS available from the parse context
    // (set by the file-include loader via spread `...this.opts`) and gives the default
    // resolver the right starting directory for `require.resolve`'s `paths`.
    // Custom resolvers MUST handle both arguments being undefined gracefully.
    const resolvedPath = resolver(identifier, file, undefined, baseDir)

    const read = readFile
      ? async (p: string) => readFile(p)
      : async (p: string) => readFileSync(p)

    const content = await read(resolvedPath)
    // S3.1 (corrected, xx.hocon E10): empty / whitespace-only / comment-only
    // content is a valid empty document contributing {} — same rule as loadPackage.
    const tokens = tokenize(content)
    const ast = parseTokens(tokens)
    return this.onBuildResObjAsync(ast, {
      ...this.opts,
      baseDir: nodePath.dirname(resolvedPath),
      includeStack: [...includeStack, cycleKey],
    })
  }

  private loadSingle(candidate: string): ResObj | undefined {
    const { readFileSync, includeStack = [] } = this.opts

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

    const tokens = tokenize(content)
    // S3.1 (corrected, xx.hocon E10): an empty / whitespace-only / comment-only
    // document parses to the empty object everywhere — the former #105
    // include-path carve-out is now simply the rule; parseTokens on an empty
    // stream yields an empty object AST contributing {}.
    const ast = parseTokens(tokens)
    // Spread all opts to preserve packageResolver / resolveFrom / readFile across nested includes.
    return this.onBuildResObj(ast, {
      ...this.opts,
      baseDir: nodePath.dirname(candidate),
      includeStack: [...includeStack, candidate],
    })
  }

  private async loadSingleAsync(candidate: string): Promise<ResObj | undefined> {
    const { readFile, readFileSync, includeStack = [] } = this.opts
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

    const tokens = tokenize(content)
    // S3.1 (corrected, xx.hocon E10): same rule as loadSingle — empty document contributes {}.
    const ast = parseTokens(tokens)
    // Spread all opts to preserve packageResolver / resolveFrom across nested includes.
    return this.onBuildResObjAsync(ast, {
      ...this.opts,
      baseDir: nodePath.dirname(candidate),
      includeStack: [...includeStack, candidate],
    })
  }
}
