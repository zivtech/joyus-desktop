# Contributing to Joyus Desktop

Thank you for your interest in contributing. This document covers how to get started, development setup, and the conventions we follow.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards.

## Development Setup

Prerequisites: Node.js 20+, [pnpm](https://pnpm.io/), and (for the desktop app) the [Tauri 2.x prerequisites](https://v2.tauri.app/start/prerequisites/) including a Rust toolchain.

```bash
pnpm install              # Install all workspace dependencies
pnpm typecheck            # TypeScript strict checking (tsc --noEmit)
pnpm test                 # Run tests (vitest run)
pnpm coverage             # Run tests with 100% coverage enforcement
pnpm ci                   # Full CI pipeline: typecheck + coverage
```

Run a single test file:

```bash
pnpm vitest run packages/policy-client/test/policyClient.test.ts
```

## Quality Gates

Both gates must pass for CI to merge:

- **Typecheck**: `pnpm typecheck` — strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Coverage**: `pnpm coverage` — **100% threshold** on lines, functions, branches, and statements

Coverage includes all `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`. Tests live in `{package}/test/*.test.ts`. New code must ship with tests that keep coverage at 100%.

## Submitting Changes

1. **Fork** the repository and clone your fork locally.
2. **Create a branch** from `main` with a descriptive name:
   ```
   git checkout -b feat/my-feature
   git checkout -b fix/issue-description
   ```
3. **Make your changes**, keeping commits small and focused.
4. **Use conventional commit messages**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
5. **Run `pnpm ci`** locally and make sure it passes.
6. **Open a pull request** against `main` describing what changed and why.

## Reporting Issues

File issues on the [GitHub issue tracker](https://github.com/zivtech/joyus-desktop/issues). Include:

- A clear description of the problem or feature request
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Environment details (OS, Node.js version, app version)

For security vulnerabilities, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
