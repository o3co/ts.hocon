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

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Thrown when a getter is called on a Config whose value (or any transitive
 *  parent) contains an unresolved substitution placeholder. E12 decision 12.
 *  Use `instanceof NotResolvedError` to detect; also passes `instanceof ConfigError`. */
export class NotResolvedError extends ConfigError {
  constructor(path: string) {
    super(`value at path "${path}" is not resolved (call resolve() first)`, path)
    this.name = 'NotResolvedError'
  }
}
