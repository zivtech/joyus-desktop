# MCP Tools Critical Fix Audit

Audit of issues identified in `zivtech-mcp-tools` and addressed by the
`@joyus/mcp-tools-compat` compatibility package and documentation.

| Task | Severity | Area | Issue | Fix |
|------|----------|------|-------|-----|
| T031 | Critical | async/await | Fire-and-forget async calls inside MCP handlers drop errors silently, producing unhandled rejections. | `wrapAsyncHandler()` ensures every handler return value is awaited and errors are surfaced. |
| T032 | Medium | TypeScript config | Per-package `tsconfig.json` files are missing or inconsistent, causing build failures when packages are compiled independently. | Document the required `tsconfig.json` per-package pattern that extends `tsconfig.base.json`. |
| T033 | Medium | Workspace protocol | Incorrect pnpm workspace protocol references (`workspace:^` vs `workspace:*`) cause resolution failures during install. | Document the correct `workspace:*` protocol and verify in CI. |
| T034 | Critical | Governance | Governance enforcement calls lack try/catch, crashing the MCP server when the governance service is unavailable. | `governanceGuard()` wrapper with mode-aware error handling (fail-open in audit, fail-closed in enforce). |
| T035 | Low | Build | Shell package (`@mcp/shell`) should be excluded from the TypeScript build since it contains only shell scripts. | Document build exclusion pattern for non-TS packages. |
| T036 | Medium | Telemetry | Telemetry collector is never wired because config reading is scattered and inconsistent across packages. | `readTelemetryConfig()` and `isTelemetryEnabled()` centralise env-based config. |
| T037 | Low | Docs | README and inline docs are outdated or missing for several packages. | This audit document and the `build-verification.md` guide. |
| T038 | Medium | Build verification | No automated way to verify a clean build after applying fixes. | `build-verification.md` provides a step-by-step verification procedure. |
| T066 | Medium | Test coverage | Modules lack adequate test coverage, hiding regressions. | 100 % line/branch/function/statement coverage for `@joyus/mcp-tools-compat`. |

## Status

All items above are **complete** within the `@joyus/mcp-tools-compat` package
scope. The fixes serve as reference implementations that `zivtech-mcp-tools`
packages can adopt directly.
