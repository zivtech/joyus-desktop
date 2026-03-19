# Quickstart: Live Control Plane Integration & Pilot Readiness

## Prerequisites

- joyus-desktop dev environment set up (`pnpm install`)
- joyus-ai deployed (spec 010 in joyus-ai-ops) — base URL and bearer token available
- mTLS certificate files provisioned by joyus-ai-ops (optional for local dev; required for staging/production)

## Environment Setup

Create a `.env.local` (not committed) in `apps/desktop-companion/`:

```bash
# Required
JOYUS_API_URL=https://api.joyus.ai          # Deployed joyus-ai base URL
JOYUS_API_TOKEN=your-bearer-token-here       # Issued by joyus-ai

# mTLS (required for staging/production; optional for local dev)
JOYUS_MTLS_CERT_PATH=/path/to/client.crt
JOYUS_MTLS_KEY_PATH=/path/to/client.key
JOYUS_MTLS_CA_PATH=/path/to/ca.crt

# Optional tuning (defaults shown)
JOYUS_REQUEST_TIMEOUT_MS=5000
JOYUS_RETRY_MAX_ATTEMPTS=3
JOYUS_RETRY_BASE_DELAY_MS=200
JOYUS_REPLAY_CACHE_PATH=~/.joyus/replay-cache.db
JOYUS_EVENT_LOG_PATH=~/.joyus/event-failures.ndjson
```

## Running Tests

Tests use a mock HTTP server (MSW) — no live joyus-ai instance needed:

```bash
pnpm test                           # All tests
pnpm vitest run packages/policy-client/test/controlPlaneClient.test.ts
pnpm vitest run packages/policy-client/test/replayCache.test.ts
pnpm vitest run apps/desktop-companion/test/integration/control-plane-wiring.test.ts
```

## Verifying the Integration (Pilot Acceptance)

Once `JOYUS_API_URL` and `JOYUS_API_TOKEN` are configured, run the companion and trigger a policy-gated action. Verify in joyus-ai ops console:

1. A policy decision record appears under the session ID
2. The event trail shows the action event in `/v1/events`
3. Any artifact produced appears in `/v1/artifacts` with session + token reference

To test replay rejection:
```bash
# Capture a JTI from logs, then replay it — companion should block and log
```

To test outage fail-closed:
```bash
# Point JOYUS_API_URL at an unreachable host
# Attempt a high-risk action — companion must block (not allow)
```

## New Modules (post-implementation)

| Module | Location |
|--------|----------|
| Control plane HTTP client | `packages/policy-client/src/controlPlaneClient.ts` |
| Replay cache (SQLite) | `packages/policy-client/src/replayCache.ts` |
| Token refresh service | `packages/policy-client/src/tokenRefresh.ts` |
| Async event emitter | `packages/policy-client/src/eventEmitter.ts` |
| Companion wiring | `apps/desktop-companion/src/controlPlaneWiring.ts` |
| Pilot acceptance tests | `apps/desktop-companion/test/integration/pilot-acceptance.test.ts` |
