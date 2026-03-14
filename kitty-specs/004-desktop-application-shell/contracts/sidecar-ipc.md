# IPC Contract: Rust ↔ Node.js Sidecar

**Protocol**: JSON-RPC 2.0 over stdio (newline-delimited JSON)
**Direction**: Bidirectional — Rust sends requests, Node.js sends requests and notifications

## Rust → Node.js (Requests)

### `servers.list`

Returns all registered MCP servers with current status.

**Params**: none
**Result**: `ServerInfo[]`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "servers.list",
  "params": {}
}
```

### `servers.start`

Start a specific MCP server.

**Params**: `{ "name": string }`
**Result**: `ServerInfo`

### `servers.stop`

Stop a specific MCP server.

**Params**: `{ "name": string }`
**Result**: `{ "stopped": boolean }`

### `servers.restart`

Restart a specific MCP server.

**Params**: `{ "name": string }`
**Result**: `ServerInfo`

### `sync.trigger`

Trigger an immediate skill sync.

**Params**: none
**Result**: `SyncResult`

### `sync.status`

Get current sync status and metadata.

**Params**: none
**Result**: `SyncStatus`

### `governance.getMode`

Get current governance mode.

**Params**: none
**Result**: `{ "mode": "off" | "audit" | "enforce" }`

### `governance.getDecisions`

Get recent governance decisions.

**Params**: `{ "limit": number }`
**Result**: `GovernanceDecision[]`

### `skills.list`

List available skills with version info.

**Params**: none
**Result**: `SkillInfo[]`

### `usage.query`

Query local usage data for dashboard.

**Params**: `{ "eventType"?: string, "source"?: string, "since"?: string, "limit"?: number }`
**Result**: `UsageEvent[]`

### `usage.summary`

Get aggregated usage summary for dashboard overview.

**Params**: `{ "days": number }`
**Result**: `UsageSummary`

### `health.check`

Verify sidecar is alive and responsive.

**Params**: none
**Result**: `{ "ok": true, "uptime_ms": number }`

### `onboarding.start`

Begin the onboarding flow.

**Params**: `{ "authToken": string, "tenantId": string, "workspaceId": string }`
**Result**: `{ "success": boolean, "serversStarted": number, "skillsSynced": boolean }`

### `chrome.detect`

Check if system Chrome is available for Playwright MCPs.

**Params**: none
**Result**: `{ "available": boolean, "path"?: string, "version"?: string }`

## Node.js → Rust (Notifications)

Notifications have no `id` field and expect no response.

### `state.serverChanged`

Emitted when an MCP server's status changes.

```json
{
  "jsonrpc": "2.0",
  "method": "state.serverChanged",
  "params": {
    "name": "axe-core",
    "status": "error",
    "lastError": "Process exited with code 1",
    "restartCount": 2
  }
}
```

### `state.syncCompleted`

Emitted when a skill sync finishes.

```json
{
  "jsonrpc": "2.0",
  "method": "state.syncCompleted",
  "params": {
    "version": "1.2.0",
    "fromCache": false,
    "durationMs": 3200
  }
}
```

### `state.governanceDecision`

Emitted when a governance decision is made.

```json
{
  "jsonrpc": "2.0",
  "method": "state.governanceDecision",
  "params": {
    "toolName": "jira_create_issue",
    "serverName": "atlassian",
    "decision": "allow",
    "mode": "audit"
  }
}
```

### `state.error`

Emitted on critical sidecar errors (for crash reporting via telemetry).

```json
{
  "jsonrpc": "2.0",
  "method": "state.error",
  "params": {
    "source": "mcp-registry",
    "message": "Failed to spawn server: ENOENT",
    "fatal": false
  }
}
```

## Shared Types

### ServerInfo

```typescript
interface ServerInfo {
  name: string;
  status: "running" | "stopped" | "error" | "starting";
  pid?: number;
  version?: string;
  enabled: boolean;
  restartCount: number;
  lastError?: string;
  startedAt?: string;
}
```

### SyncResult

```typescript
interface SyncResult {
  version: string;
  syncedAt: string;
  fromCache: boolean;
  durationMs: number;
}
```

### SyncStatus

```typescript
interface SyncStatus {
  status: "idle" | "syncing" | "synced" | "error";
  currentVersion?: string;
  lastSyncAt?: string;
  lastError?: string;
}
```

### SkillInfo

```typescript
interface SkillInfo {
  name: string;
  version: string;
  bundle: string;
  path: string;
}
```

### UsageEvent

```typescript
interface UsageEvent {
  id: number;
  eventType: string;
  source: string;
  action: string;
  outcome: string;
  durationMs?: number;
  metadata?: Record<string, string>;
  createdAt: string;
}
```

### UsageSummary

```typescript
interface UsageSummary {
  totalToolCalls: number;
  totalSyncs: number;
  totalGovernanceDecisions: number;
  serverCrashes: number;
  topTools: Array<{ name: string; count: number }>;
  topServers: Array<{ name: string; callCount: number }>;
  dailyCounts: Array<{ date: string; count: number }>;
}
```

### GovernanceDecision

```typescript
interface GovernanceDecision {
  timestamp: string;
  toolName: string;
  serverName: string;
  decision: "allow" | "deny" | "audit";
  mode: "off" | "audit" | "enforce";
}
```
