# Data Model: Live Control Plane Integration & Pilot Readiness

## Entities

### ControlPlaneConfig

Configuration loaded from environment variables at companion startup.

| Field | Type | Source Env Var | Notes |
|-------|------|----------------|-------|
| `baseUrl` | `string` | `JOYUS_API_URL` | Required. No trailing slash. |
| `bearerToken` | `string` | `JOYUS_API_TOKEN` | Required. Sent as `Authorization: Bearer`. |
| `mtlsCertPath` | `string \| undefined` | `JOYUS_MTLS_CERT_PATH` | Optional. Path to PEM cert file. |
| `mtlsKeyPath` | `string \| undefined` | `JOYUS_MTLS_KEY_PATH` | Optional. Path to PEM key file. |
| `mtlsCaPath` | `string \| undefined` | `JOYUS_MTLS_CA_PATH` | Optional. Path to CA bundle. |
| `requestTimeoutMs` | `number` | `JOYUS_REQUEST_TIMEOUT_MS` | Default: 5000. |
| `retryMaxAttempts` | `number` | `JOYUS_RETRY_MAX_ATTEMPTS` | Default: 3. |
| `retryBaseDelayMs` | `number` | `JOYUS_RETRY_BASE_DELAY_MS` | Default: 200. |
| `replayCachePath` | `string` | `JOYUS_REPLAY_CACHE_PATH` | Default: `~/.joyus/replay-cache.db`. |

---

### ConsumedToken

Persisted record in the SQLite replay cache. Tracks every decision token JTI that has been consumed.

| Field | Type | Notes |
|-------|------|-------|
| `jti` | `TEXT PRIMARY KEY` | Unique token identifier from the decision token. |
| `tenant_id` | `TEXT NOT NULL` | Tenant the token was issued for. |
| `consumed_at` | `INTEGER NOT NULL` | Unix epoch seconds when the token was consumed. |
| `expires_at` | `INTEGER NOT NULL` | Unix epoch seconds from `exp` claim. Used for pruning. |

**State transitions**: A JTI is written on first consumption. Any subsequent lookup returning a row = replay attempt. Rows are pruned on startup when `expires_at + 3600 < now()`.

---

### PendingEvent

In-memory structure representing an event or artifact record queued for async delivery.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID generated at enqueue time. |
| `endpoint` | `"/v1/events" \| "/v1/artifacts"` | Target endpoint. |
| `payload` | `Record<string, unknown>` | JSON body to POST. |
| `attempts` | `number` | Number of delivery attempts so far. |
| `nextRetryAt` | `number` | Unix epoch ms for next retry. |
| `createdAt` | `number` | Unix epoch ms when enqueued. |

**Retry policy**: Max 3 attempts. Backoff: `200ms * 2^(attempt-1)` (200ms, 400ms, 800ms). After 3 failures, the event is written to a structured local log file at `JOYUS_EVENT_LOG_PATH` (default: `~/.joyus/event-failures.ndjson`).

---

### TokenRefreshEntry

In-memory tracking of in-flight token refresh requests. Prevents duplicate refresh calls for the same action key.

| Field | Type | Notes |
|-------|------|-------|
| `actionKey` | `string` | Key derived from `tenantId + sessionId + actionName`. |
| `promise` | `Promise<PolicyDecideResponse>` | Shared in-flight refresh promise. |
| `startedAt` | `number` | Unix epoch ms. Used to detect stale entries. |

**Invariant**: Only one entry per `actionKey` exists at a time. Entry is removed on promise settlement.

---

## State Transitions

### Decision Token Lifecycle

```
[Issued by control plane]
        ↓
[Decoded + validated by policyClient]
        ↓
[Consumed: JTI written to replay cache]
        ↓
[Action proceeds / blocked based on outcome]
        ↓
[JTI pruned from cache after exp + 1h buffer]
```

### Outage Recovery

```
[Control plane reachable]    →  [Normal enforcement]
        ↓ (timeout/error)
[Fail-closed: spec 001 rules applied]
        ↓ (control plane recovers)
[Automatic reconnection on next request]
        ↓
[Normal enforcement resumes]
```

No manual restart required. The client retries on each new request; reconnection is transparent.
