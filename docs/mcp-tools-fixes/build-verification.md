# Build Verification Steps

After applying the MCP tools fixes, run the following checks to verify a
clean build.

## 1. Install dependencies

```bash
pnpm install
```

Verify: zero warnings about unresolved workspace references.

## 2. Type-check

```bash
pnpm typecheck
```

Verify: exit code 0, no errors.

## 3. Run tests with coverage

```bash
pnpm vitest run packages/mcp-tools-compat --coverage
```

Verify:

- All tests pass.
- Coverage meets the 100 % threshold on lines, functions, branches, and
  statements for `packages/mcp-tools-compat/src/**`.

## 4. Full monorepo CI check

```bash
pnpm ci
```

This runs `pnpm typecheck && pnpm coverage` and enforces thresholds across
the entire workspace.

## Per-package tsconfig pattern (T032)

Every publishable package must contain a `tsconfig.json` that extends the
root config:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

## Workspace protocol (T033)

Internal dependencies must use the `workspace:*` protocol:

```jsonc
{
  "dependencies": {
    "@joyus/policy-client": "workspace:*"
  }
}
```

Do **not** use `workspace:^` or `workspace:~` -- they cause resolution
failures in strict lockfile mode.

## Shell package build exclusion (T035)

Non-TypeScript packages (e.g., `@mcp/shell`) should be excluded from
the TypeScript build by omitting them from the root `tsconfig.json`
include array and ensuring they do not appear in project references.
