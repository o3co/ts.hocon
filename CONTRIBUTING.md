# Contributing to ts.hocon

Thank you for your interest in contributing!

## Reporting Bugs

Please open a [GitHub Issue](https://github.com/o3co/ts.hocon/issues) and include:

- Node.js version (`node --version`)
- @o3co/ts.hocon version
- A minimal reproducing HOCON snippet
- Expected vs. actual behavior

## Proposing Features

Open an issue first to discuss the proposal before sending a PR. This avoids wasted effort if the direction doesn't fit the project scope.

## Development Setup

```bash
git clone https://github.com/o3co/ts.hocon.git
cd ts.hocon
npm install
npm test
```

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run coverage

# Type check only
npm run typecheck

# Lightbend spec compliance suite
npx vitest run tests/lightbend/
```

## Code Style

- TypeScript strict mode throughout — no `any` unless unavoidable
- Keep public API consistent with the existing throwing / `undefined`-return dual pattern
- New features must include tests
- Internal modules (`src/internal/`) are not part of the public API

## Submitting a Pull Request

1. Fork the repository and create a branch from `develop`
2. Write tests for your change
3. Ensure `npm test` and `npm run typecheck` pass
4. Open a PR against `develop` with a clear description of what and why

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
