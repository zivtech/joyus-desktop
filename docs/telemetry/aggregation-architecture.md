# Telemetry Aggregation Architecture

## Overview

The telemetry aggregation endpoint is a central receiver on joyus-ai that accepts, stores, and serves telemetry events from Cowork and CLI channels. It enables admins to query usage data, generate reports, and measure skill adoption and ROI.

## Architecture

```
Cowork Skill Wrapper → POST /api/telemetry/events → joyus-ai ingestion endpoint
CLI Collector         ↓
                  telemetry_events table (PostgreSQL)
                      ↓
                  Usage reports, admin queries
```

## Endpoint Specification

### POST /api/telemetry/events

Accepts telemetry events and stores them asynchronously.

#### Request

```
POST /api/telemetry/events
X-Telemetry-Key: <api-key>
Content-Type: application/json

{
  "events": [
    {
      "event_id": "uuid",
      "timestamp": "2026-03-11T15:30:45.123Z",
      "user_id": "user-123",
      "org_id": "zivtech",
      "channel": "cowork",
      "event_type": "skill_invocation",
      "name": "proposal-critic",
      "version": "1.2.0",
      "outcome": "success",
      "duration_ms": 2450,
      "metadata": {
        "invocation_method": "slash_command"
      }
    }
  ]
}
```

**or a single event**:

```json
{
  "event_id": "uuid",
  "timestamp": "2026-03-11T15:30:45.123Z",
  ...
}
```

#### Response

**Success (202 Accepted)**:
```json
{
  "message": "Events accepted for processing",
  "count": 1
}
```

**Bad Request (400)**:
```json
{
  "error": "Invalid event schema",
  "details": "Missing required field: event_id"
}
```

**Unauthorized (401)**:
```json
{
  "error": "Invalid or missing API key"
}
```

**Rate Limited (429)**:
```json
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

#### Authentication

- API key passed in `X-Telemetry-Key` header.
- Keys are managed in joyus-ai admin panel; one key per org or per-client.
- Clients must rotate keys securely; keys should never be hardcoded in client-facing code.

#### Rate Limiting

- **Limit**: 100 events per minute per API key.
- **Response**: 429 Too Many Requests if exceeded.
- **Retry-After**: Server includes retry-after header.

#### Async Processing

- Endpoint returns 202 immediately; events are processed asynchronously.
- Events are validated and written to the database within seconds.
- No guarantee of immediate consistency for aggregation queries.

## Database Schema

### telemetry_events Table

```sql
CREATE TABLE telemetry_events (
  event_id UUID PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  org_id VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL,  -- "cowork", "cli", "desktop"
  event_type VARCHAR(50) NOT NULL,  -- "skill_invocation", "mcp_tool_call"
  name VARCHAR(255) NOT NULL,  -- skill or tool name
  version VARCHAR(50),  -- semantic version
  outcome VARCHAR(20) NOT NULL,  -- "success", "failure", "timeout"
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}',  -- flexible, non-PII metadata
  schema_version VARCHAR(20) DEFAULT 'v1',  -- schema versioning
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_telemetry_org_timestamp
  ON telemetry_events (org_id, timestamp DESC);

CREATE INDEX idx_telemetry_user_timestamp
  ON telemetry_events (user_id, timestamp DESC);

CREATE INDEX idx_telemetry_event_type
  ON telemetry_events (event_type);

CREATE INDEX idx_telemetry_name
  ON telemetry_events (name);
```

### Column Definitions

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| event_id | UUID | NO | Unique event identifier (client-generated) |
| timestamp | TIMESTAMP | NO | Event time in ISO 8601 (client-generated; use server time as canonical) |
| user_id | VARCHAR | NO | User identifier (from Cowork/CLI auth context) |
| org_id | VARCHAR | NO | Organization ("zivtech", "milk-jawn") |
| channel | VARCHAR | NO | Invocation channel ("cowork", "cli", "desktop") |
| event_type | VARCHAR | NO | Type of event ("skill_invocation", "mcp_tool_call") |
| name | VARCHAR | NO | Skill or tool name (e.g., "proposal-critic", "Jira search") |
| version | VARCHAR | YES | Version string (e.g., "1.2.0") |
| outcome | VARCHAR | NO | Result ("success", "failure", "timeout") |
| duration_ms | INTEGER | YES | Execution time in milliseconds |
| metadata | JSONB | YES | Extensible metadata (no PII) |
| schema_version | VARCHAR | YES | Schema version for evolution (default "v1") |
| created_at | TIMESTAMP | NO | Server-side insertion time |

## Data Flow

### From Cowork

1. User invokes skill in Cowork.
2. Skill wrapper calls `POST /api/telemetry/events` with event payload.
3. Endpoint validates schema, checks auth, and queues for insertion.
4. Event is inserted into `telemetry_events` table.
5. Admin queries endpoint to retrieve events for reporting.

### From CLI

1. Skill execution completes in Claude Code CLI.
2. CLI collector batches event(s) and calls `POST /api/telemetry/events`.
3. Endpoint receives, validates, and inserts.
4. Same reporting flow as Cowork.

### For Admin Reporting

1. Admin requests usage report (e.g., `/admin/usage-report?org=zivtech&days=7`).
2. Report generator queries `telemetry_events` with filters.
3. Aggregates: active users, invocation counts, success rates, etc.
4. Returns markdown or JSON response.

## Client Library

A shared `@joyus/telemetry` package provides reusable functions for collectors:

```typescript
// packages/telemetry/src/client.ts

import { FetchLike } from '@joyus/common'; // HTTP abstraction

export interface TelemetryClient {
  sendEvent(event: TelemetryEvent): Promise<void>;
  sendBatch(events: TelemetryEvent[]): Promise<void>;
}

export function createTelemetryClient(
  endpoint: string,
  apiKey: string,
  fetch: FetchLike
): TelemetryClient {
  return {
    async sendEvent(event: TelemetryEvent) {
      await fetch(`${endpoint}/api/telemetry/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telemetry-Key': apiKey,
        },
        body: JSON.stringify(event),
      });
    },

    async sendBatch(events: TelemetryEvent[]) {
      await fetch(`${endpoint}/api/telemetry/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telemetry-Key': apiKey,
        },
        body: JSON.stringify({ events }),
      });
    },
  };
}
```

### FetchLike Pattern

The client uses `FetchLike` to abstract HTTP transport, enabling:
- Browser environments (fetch API)
- Node.js environments (node-fetch or built-in fetch)
- Custom implementations with proxies, logging, etc.

## Event Batching

Clients should batch events to reduce overhead:

- **Batch window**: Collect events and send every 60 seconds or on session end.
- **Buffer size**: If buffer exceeds 100 events, flush immediately.
- **Retry logic**: If POST fails, buffer events locally and retry on next batch window.

**Example** (CLI collector):

```typescript
const batch: TelemetryEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

async function addEvent(event: TelemetryEvent) {
  batch.push(event);

  if (batch.length >= 100) {
    await flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, 60000); // Flush every 60s
  }
}

async function flush() {
  if (batch.length === 0) return;

  try {
    await telemetryClient.sendBatch(batch.splice(0)); // Send and clear
  } catch (err) {
    // Batch remains in memory; retry on next flush
    console.error('Telemetry flush failed:', err);
  }

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

// On session end or SIGINT
process.on('SIGINT', async () => {
  await flush();
  process.exit(0);
});
```

## Error Handling

### Client-Side

- **Fire-and-forget with local buffer**: POST attempts are non-blocking; if the endpoint is unreachable, events are retained in a local buffer and retried later.
- **Timeout**: Client waits max 5 seconds for endpoint response; if no response, event is buffered locally.
- **No impact on user session**: Telemetry errors do NOT propagate to the user or degrade the skill/tool execution.

### Server-Side

| Condition | Response | Action |
|-----------|----------|--------|
| Invalid schema | 400 Bad Request | Log error, reject event, do not insert |
| Missing API key | 401 Unauthorized | Log failed auth attempt, reject event |
| Rate limit exceeded | 429 Too Many Requests | Reject event, include retry-after header |
| Database error | 500 Internal Server Error | Log error, return 500, do not insert (client will retry) |
| Valid event | 202 Accepted | Queue for async insertion |

### Validation

All events must have:
- Required fields: event_id, timestamp, user_id, org_id, channel, event_type, name, outcome
- Correct types: strings, integers, timestamps in ISO 8601
- No PII beyond user_id and org_id

## Data Retention

- **Raw events**: Retained for 90 days; older events are archived or deleted based on compliance policy.
- **Aggregated metrics**: Computed and stored indefinitely for historical reporting.

## Schema Evolution

### Version 1 (v1)

Current schema as of Q1 2026. Includes:
- event_id, timestamp, user_id, org_id, channel
- event_type (skill_invocation, mcp_tool_call)
- name, version, outcome, duration_ms
- metadata (JSONB), schema_version

### Future Versions

If schema needs to change:
1. New optional fields can be added to metadata without breaking clients.
2. Breaking changes (e.g., removal of fields) require a new schema_version (v2).
3. Clients send `schema_version: "v1"` in each event.
4. Server supports multiple versions concurrently during transition period.
5. Deprecation announced 90 days before old version is no longer accepted.

## Query Examples

### Invocations by Skill (Last 7 Days)

```sql
SELECT
  name,
  COUNT(*) as count,
  COUNT(CASE WHEN outcome = 'success' THEN 1 END)::float / COUNT(*) as success_rate
FROM telemetry_events
WHERE org_id = 'zivtech'
  AND timestamp > now() - interval '7 days'
  AND event_type = 'skill_invocation'
GROUP BY name
ORDER BY count DESC;
```

### Active Users by Org

```sql
SELECT
  org_id,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_invocations
FROM telemetry_events
WHERE timestamp > now() - interval '7 days'
GROUP BY org_id;
```

### Events by Channel

```sql
SELECT channel, COUNT(*) as count
FROM telemetry_events
WHERE org_id = 'zivtech'
  AND timestamp > now() - interval '7 days'
GROUP BY channel;
```

## References

- Event Schema: `packages/telemetry/src/schema.ts`
- Cowork Collection: `docs/telemetry/cowork-collection.md`
- Verification Plan: `docs/verification/wp05-telemetry-verification.md`
