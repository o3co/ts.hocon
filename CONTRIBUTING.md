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

**The tag is the version.** `package.json` stays at `0.0.0-snapshot` on
`develop`; the release workflow writes the real version from the tag before it
publishes. Do not bump `package.json` in a PR — a release-prep PR that pre-sets
it is what broke the v1.4.0 publish, and while the workflow now skips the bump
when the two already agree, the manifest is still not where a version is
decided.

Releasing is therefore just a tag on a merged commit:

```bash
git checkout develop && git pull
git tag v1.4.0
git push origin v1.4.0
```

CI then runs the tests, sets the version from the tag, builds, publishes to npm,
and creates the GitHub Release from the matching `## [1.4.0]` section of
`CHANGELOG.md` — so that section has to exist and be committed *before* the tag
is pushed, or the run fails without publishing.

> **Do not** run `pnpm publish` locally — CI handles it, and npm does not allow
> republishing a version.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
