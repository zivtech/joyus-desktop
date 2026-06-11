# Research: Live Control Plane Integration & Pilot Readiness

## Decision 1: HTTP Client Implementation

**Decision**: Native `fetch` (Node.js 24 built-in) via the existing `FetchLike` injection seam in `controlPlaneContracts.ts`.

**Rationale**: `controlPlaneContracts.ts` already defines a `FetchLike` interface and injects the HTTP function as a dependency. No structural change is needed — only a concrete implementation must be created. Node.js 24 native `fetch` supports custom `Agent` options (for mTLS via `tls.connect`) and is zero-dependency.

**Alternatives considered**:
- `got` / `undici`: Richer APIs but add a dependency the constitution discourages.
- `node-fetch`: Legacy shim; unnecessary on Node 24.

**mTLS approach**: Use `https.Agent` with `cert`/`key`/`ca` loaded from paths in environment variables. Pass the agent via `fetch`'s `dispatcher` option (undici `Agent` underlyingly). Certificate material is supplied by joyus-ai-ops at deployment time; the client reads paths from env vars at startup.

---

## Decision 2: Replay Cache Storage

**Decision**: `node:sqlite` (Node.js 22.5+ built-in, stabilized in Node 24) for the JTI replay cache.

**Rationale**: The user specified SQLite/file. `node:sqlite` is built into Node 24 with no additional dependency. A single `consumed_tokens` table keyed on `jti` with a `consumed_at` timestamp satisfies all requirements. Entries can be pruned on startup for JTIs past their `exp` + buffer window to bound file size.

**Alternatives considered**:
- `better-sqlite3`: Synchronous, well-tested, but CommonJS-native (requires ESM interop workaround).
- `@databases/sqlite`: ESM-native but adds a dependency.
- In-memory Map: Doesn't survive restarts; user explicitly requested persistence.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS consumed_tokens (
  jti TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consumed_tokens_expires ON consumed_tokens(expires_at);
```

---

## Decision 3: Token Refresh Strategy

**Decision**: Proactive refresh at 80% of token TTL, serialized via a per-action in-flight Promise map.

**Rationale**: The `PolicyDecideResponse` carries `token_expires_at`. The refresh service computes the 80% mark and schedules a refresh. If two concurrent callers both detect the token is near expiry, a shared `Map<actionKey, Promise>` ensures only one refresh request is sent; the second caller awaits the in-flight promise.

**Alternatives considered**:
- Refresh on-demand (after rejection): Adds a round-trip latency for every expired token; user-perceived latency impact.
- Fixed interval polling: Over-fetches; wastes quota on low-traffic sessions.

---

## Decision 4: Event Emission (non-blocking)

**Decision**: Fire-and-forget with an in-memory retry queue (max 3 retries, exponential backoff) and local structured log fallback on permanent failure.

**Rationale**: FR-009 requires event emission to be non-blocking. Events to `/v1/events` and artifact records to `/v1/artifacts` are best-effort observability; they must not block the primary action flow. A lightweight in-process queue with retries covers transient failures; permanent failures write to a local log file for later reconciliation without crashing the companion.

**Alternatives considered**:
- Synchronous emission: Blocked by spec (FR-009).
- Persistent queue (SQLite): Overkill for observability events; adds complexity.

---

## Decision 5: Integration Test Isolation

**Decision**: `MSW` (Mock Service Worker) in Node.js mode to intercept `fetch` calls in Vitest tests.

**Rationale**: MSW v2 supports Node.js intercept mode and works with native `fetch`. No test server process to manage. The existing test suite already uses Vitest; MSW integrates naturally via `setupServer` / `server.use()` per-test overrides. This allows testing retry logic, timeout behavior, error shapes, and replay rejection without a live control plane.

**Alternatives considered**:
- `nock`: Does not intercept native `fetch` in Node 24.
- Custom test HTTP server: Works but requires port management and process lifecycle.
- Live staging environment: Acceptable for pilot acceptance tests, not for CI unit/integration tests.

---

## Constitution Check Results

All planned choices are compliant:
- TypeScript 5.8+ strict mode: ✓ all new modules follow existing patterns
- Node.js 24 ESM-only: ✓ `node:sqlite` is built-in, no CommonJS shims
- No new runtime dependencies beyond `msw` (dev-only, test harness)
- 100% coverage: ✓ all modules will have accompanying test files
- `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`: ✓ null safety handled at SQLite read boundaries
