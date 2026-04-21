---
work_package_id: WP01
title: Control Plane HTTP Client
dependencies: []
subtasks: [T001, T002, T003, T004, T005]
history:
- date: '2026-03-18'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG3
owned_files:
- src/controlPlaneClient.ts
- src/controlPlaneContracts.ts
- src/index.ts
- test/controlPlaneClient.test.ts
wp_code: WP01
---

# WP01 — Control Plane HTTP Client

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P0 (blocks WP02, WP03, WP04, and all downstream work)
**Implement with**: `spec-kitty implement WP01`

## Objective

Create the concrete HTTP client that satisfies the existing `FetchLike` seam in
`packages/policy-client/src/controlPlaneContracts.ts`. This is the only new runtime
component needed to bridge desktop → live joyus-ai API.

`FetchLike` is already defined and injected throughout the codebase. WP01 just creates
the implementation. Nothing else changes structurally.

## Context

**Key file**: `packages/policy-client/src/controlPlaneContracts.ts`

The `FetchLike` type is:
```typescript
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<FetchLikeResponse>;
```

All control plane calls (`requestPolicyDecision`, `requestWorkspace`, `getArtifactProvenance`,
`callMcpTool`) already accept a `FetchLike` as their first argument. WP01 creates the
production implementation of that function.

**New file location**: `packages/policy-client/src/controlPlaneClient.ts`
**Test location**: `packages/policy-client/test/controlPlaneClient.test.ts`

## Subtasks

### T001 — ControlPlaneConfig and loadConfigFromEnv()

**Purpose**: Define the configuration shape and load it from environment variables at startup.

**Steps**:

1. Create `packages/policy-client/src/controlPlaneClient.ts` with:

```typescript
export interface ControlPlaneConfig {
  baseUrl: string;          // JOYUS_API_URL — required, no trailing slash
  bearerToken: string;      // JOYUS_API_TOKEN — required
  mtlsCertPath: string | undefined;  // JOYUS_MTLS_CERT_PATH — optional
  mtlsKeyPath: string | undefined;   // JOYUS_MTLS_KEY_PATH — optional
  mtlsCaPath: string | undefined;    // JOYUS_MTLS_CA_PATH — optional
  requestTimeoutMs: number;   // JOYUS_REQUEST_TIMEOUT_MS — default 5000
  retryMaxAttempts: number;   // JOYUS_RETRY_MAX_ATTEMPTS — default 3
  retryBaseDelayMs: number;   // JOYUS_RETRY_BASE_DELAY_MS — default 200
}
```

2. Implement `loadConfigFromEnv()`:
   - Read `process.env.JOYUS_API_URL` and `process.env.JOYUS_API_TOKEN`
   - Throw descriptive error if either is missing (e.g., `"Missing required env var: JOYUS_API_URL"`)
   - Strip trailing slash from baseUrl
   - Parse numeric env vars with `parseInt`; use defaults if missing or NaN
   - `exactOptionalPropertyTypes`: use `value !== undefined ? value : undefined` pattern for optional fields

**Files**: `packages/policy-client/src/controlPlaneClient.ts`

**Validation**:
- [ ] Missing `JOYUS_API_URL` throws with descriptive message
- [ ] Missing `JOYUS_API_TOKEN` throws with descriptive message
- [ ] Trailing slash on URL is stripped
- [ ] Numeric defaults applied when env vars absent
- [ ] Optional mTLS paths are `undefined` when not set

---

### T002 — Concrete FetchLike with AbortController timeout

**Purpose**: Implement the native fetch wrapper that enforces per-request timeouts.

**Steps**:

1. Implement `createControlPlaneClient(config, deps?)` returning a `FetchLike`:

```typescript
export interface ControlPlaneClientDeps {
  fetchFn?: typeof globalThis.fetch;
  nowMs?: () => number;
}

export function createControlPlaneClient(
  config: ControlPlaneConfig,
  deps?: ControlPlaneClientDeps
): FetchLike {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  // ... return FetchLike implementation
}
```

2. For each request, create an `AbortController` and `setTimeout`:
   - `setTimeout(() => controller.abort(), config.requestTimeoutMs)`
   - Pass `signal: controller.signal` in the fetch init
   - Clear the timer on completion (`clearTimeout`) to avoid leaks
   - On `AbortError`, throw a typed `ControlPlaneTimeoutError`

3. Add `Authorization: Bearer ${config.bearerToken}` header to every request.

4. The returned `FetchLikeResponse` must satisfy the interface:
   ```typescript
   { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }
   ```
   Native `Response` satisfies this — return it directly.

**Important**: The `FetchLike` signature uses `init: { method, headers, body? }` — note this is NOT the full `RequestInit`. The wrapper must map this to native `fetch`'s second argument.

**Files**: `packages/policy-client/src/controlPlaneClient.ts`

**Validation**:
- [ ] Bearer token header present on every request
- [ ] AbortController timer cleared after successful request
- [ ] Timeout throws `ControlPlaneTimeoutError` (not generic Error)
- [ ] fetchFn is injectable (for testing)

---

### T003 — Retry logic with exponential backoff

**Purpose**: Automatically retry transient failures without surfacing them to callers.

**Steps**:

1. Wrap the fetch call in a retry loop inside the `FetchLike` implementation:
   - Retry on: network errors (fetch throws), 429, 503, 504, 502
   - Do NOT retry on: 4xx (except 429), successful 2xx
   - Max attempts: `config.retryMaxAttempts` (default 3)
   - Backoff: `config.retryBaseDelayMs * Math.pow(2, attempt - 1)` ms
     - Attempt 1: 200ms, Attempt 2: 400ms, Attempt 3: 800ms

2. Export a helper for testability:
```typescript
export function calculateBackoffMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}
```

3. After all retries exhausted, throw the last error (or return the last non-retryable response).

4. For `AbortError` (timeout): do NOT retry — propagate immediately as `ControlPlaneTimeoutError`.

**Files**: `packages/policy-client/src/controlPlaneClient.ts`

**Validation**:
- [ ] 503 response triggers retry (up to max attempts)
- [ ] 400 response does NOT trigger retry
- [ ] Backoff delays are correct (injectable `sleep` for testability)
- [ ] AbortError is not retried
- [ ] Last error propagated after max retries

---

### T004 — mTLS support

**Purpose**: Enable mutual TLS when cert paths are configured by joyus-ai-ops.

**Steps**:

1. When `config.mtlsCertPath`, `config.mtlsKeyPath` are both present:
   - Read cert and key files using `import { readFileSync } from 'node:fs'`
   - Construct an `https.Agent` with `cert`, `key`, and optionally `ca`
   - Pass the agent to fetch using the undici `dispatcher` option:
     ```typescript
     import { Agent } from 'undici';
     const agent = new Agent({ connect: { cert, key, ca } });
     // pass as: dispatcher: agent in fetch options
     ```

2. Node 24's native `fetch` is backed by undici. The `dispatcher` option accepts an undici `Agent`. Export `undici` is needed if not already in the workspace — check `apps/desktop-companion/package.json`; if `undici` is already a transitive dep, import from it. If not, use the built-in `node:https` Agent and the `node-fetch`-style pattern.

3. When mTLS paths are absent: use default dispatcher (no agent).

4. Export `buildMtlsAgent()` as a testable helper:
```typescript
export function buildMtlsAgent(
  certPath: string,
  keyPath: string,
  caPath: string | undefined
): { cert: string; key: string; ca: string | undefined } {
  return {
    cert: readFileSync(certPath, 'utf8'),
    key: readFileSync(keyPath, 'utf8'),
    ca: caPath !== undefined ? readFileSync(caPath, 'utf8') : undefined,
  };
}
```

**Files**: `packages/policy-client/src/controlPlaneClient.ts`

**Validation**:
- [ ] mTLS agent constructed when both cert+key paths present
- [ ] No agent when paths absent
- [ ] `buildMtlsAgent` reads files and returns typed object
- [ ] Missing file throws with clear path in error message

---

### T005 — Unit tests

**Purpose**: 100% coverage for all four subtasks above.

**Test file**: `packages/policy-client/test/controlPlaneClient.test.ts`

**Test cases**:

```typescript
// Config loading
- loadConfigFromEnv: missing JOYUS_API_URL throws
- loadConfigFromEnv: missing JOYUS_API_TOKEN throws
- loadConfigFromEnv: trailing slash stripped from baseUrl
- loadConfigFromEnv: numeric defaults applied when env vars absent
- loadConfigFromEnv: all env vars present → correct config

// Fetch + timeout
- createControlPlaneClient: adds Authorization header
- createControlPlaneClient: aborts after requestTimeoutMs
- createControlPlaneClient: clears abort timer on success

// Retry
- createControlPlaneClient: retries on 503 up to maxAttempts
- createControlPlaneClient: does not retry on 400
- createControlPlaneClient: does not retry on AbortError
- calculateBackoffMs: correct values for attempts 1/2/3

// mTLS
- buildMtlsAgent: reads cert/key files and returns object
- buildMtlsAgent: ca is undefined when caPath is undefined
- createControlPlaneClient: no dispatcher when no cert paths
```

**Tooling**: Use `vi.fn()` for injectable `fetchFn` and `sleep`. Use `vi.useFakeTimers()` for timeout tests.

**Validation**:
- [ ] `pnpm coverage` passes at 100% for `controlPlaneClient.ts`
- [ ] `pnpm typecheck` passes with no errors

## Definition of Done

- [ ] `packages/policy-client/src/controlPlaneClient.ts` created
- [ ] `packages/policy-client/test/controlPlaneClient.test.ts` created
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes at 100% for this file
- [ ] `loadConfigFromEnv()` and `createControlPlaneClient()` exported from `packages/policy-client/src/index.ts`

## Risks

- **undici Agent API**: Node 24 native fetch uses undici internally. The `dispatcher` option for passing an Agent is not in the standard fetch type definitions. May need a type assertion or `@ts-expect-error` with a comment. Verify in Node 24 docs before implementing.
- **`exactOptionalPropertyTypes`**: All optional fields in `ControlPlaneConfig` must use the exact optional pattern. Do not assign `undefined` to fields typed as `T | undefined` via `exactOptionalPropertyTypes` — use conditional object spread instead.

## Activity Log

- 2026-03-19T02:12:35Z – claude – shell_pid=64322 – lane=doing – Started implementation via workflow command
- 2026-03-19T02:47:55Z – claude – shell_pid=64322 – lane=for_review – Ready for review: controlPlaneClient.ts with 33 tests at 100% coverage. loadConfigFromEnv, createControlPlaneClient, buildMtlsAgent, calculateBackoffMs, ControlPlaneTimeoutError all implemented and exported.
- 2026-03-19T11:46:16Z – claude – shell_pid=21096 – lane=doing – Started review via workflow command
- 2026-03-19T11:49:57Z – claude – shell_pid=21096 – lane=done – Review passed: loadConfigFromEnv, createControlPlaneClient, buildMtlsAgent, calculateBackoffMs, ControlPlaneTimeoutError all correct. AbortController timeout, retry backoff, mTLS wiring verified. 33 tests, 100% coverage, typecheck clean.
