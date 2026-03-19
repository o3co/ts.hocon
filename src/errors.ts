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
