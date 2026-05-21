export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly file?: string,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}

export class ResolveError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly line: number,
    public readonly col: number,
    public readonly file?: string,
  ) {
    super(message)
    this.name = 'ResolveError'
  }
}

/**
 * Thrown when `include package("id", "file")` resolution fails because the
 * package cannot be located via `require.resolve` or a custom `packageResolver`.
 * Extends `ResolveError` so callers who catch `ResolveError` still handle it,
 * while callers who need to distinguish a missing-package error can use:
 *   `if (err instanceof PackageLookupError) { ... }`
 */
export class PackageLookupError extends ResolveError {
  constructor(
    message: string,
    public readonly identifier: string,
    public readonly packageFile: string,
    line: number,
    col: number,
  ) {
    super(message, `${identifier}/${packageFile}`, line, col)
    this.name = 'PackageLookupError'
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}
