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
pnpm install
pnpm test
```

## Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm coverage

# Type check only
pnpm typecheck

# Lightbend spec compliance suite
pnpm vitest run tests/lightbend/
```

## Code Style

- TypeScript strict mode throughout — no `any` unless unavoidable
- Keep public API consistent with the existing throwing / `undefined`-return dual pattern
- New features must include tests
- Internal modules (`src/internal/`) are not part of the public API

## Submitting a Pull Request

1. Fork the repository and create a branch from `develop`
2. Write tests for your change
3. Ensure `pnpm test` and `pnpm typecheck` pass
4. Open a PR against `develop` with a clear description of what and why

## Releasing

Releases are published to npm automatically by CI when a `v*` tag is pushed.
Use `npm version` to do everything in one command:

```bash
npm version patch   # or: npm version minor / npm version major
git push && git push --tags
```

`npm version` will:

1. Bump the version in `package.json`
2. Create a commit (`v0.1.4`)
3. Tag it (`v0.1.4`)

Then `git push --tags` triggers CI, which runs tests, builds, and publishes to npm.

> **Do not** run `pnpm publish` locally — CI handles it and verifies the tag matches `package.json`.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
