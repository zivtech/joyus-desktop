import { describe, it, expect } from "vitest";
import {
  HandoffError,
  DEFAULT_CHUNK_SIZE,
  SCHEMA_VERSION,
  type ConversationEntry,
  type PendingAction,
  type RuntimeConfig,
  type PolicyCacheEntry,
  type ArtifactReference,
  type SessionSnapshot,
  type SnapshotManifest,
  type HandoffRequest,
  type HandoffReceipt,
  type HandoffState,
  type PolicyOutcomeForHandoff,
} from "../src/handoffTypes";

describe("HandoffError", () => {
  it("sets name to HandoffError", () => {
    const err = new HandoffError("INVALID_TRANSITION", "test message");
    expect(err.name).toBe("HandoffError");
  });

  it("sets code correctly", () => {
    const err = new HandoffError("POLICY_DENIED", "denied");
    expect(err.code).toBe("POLICY_DENIED");
  });

  it("sets message correctly", () => {
    const err = new HandoffError("TIMEOUT", "operation timed out");
    expect(err.message).toBe("operation timed out");
  });

  it("is instanceof Error", () => {
    const err = new HandoffError("UPLOAD_FAILED", "upload failed");
    expect(err).toBeInstanceOf(Error);
  });

  it("is instanceof HandoffError", () => {
    const err = new HandoffError("TENANT_MISMATCH", "mismatch");
    expect(err).toBeInstanceOf(HandoffError);
  });

  it("supports all error codes", () => {
    const codes = [
      "INVALID_TRANSITION",
      "INVALID_SNAPSHOT",
      "POLICY_DENIED",
      "POLICY_ESCALATED",
      "POLICY_UNAVAILABLE",
      "UPLOAD_FAILED",
      "UPLOAD_CONFIG_MISMATCH",
      "HANDOFF_REJECTED",
      "INVALID_RESPONSE",
      "TIMEOUT",
      "CONCURRENT_HANDOFF",
      "TOKEN_EXPIRED",
      "SNAPSHOT_TOO_LARGE",
      "TENANT_MISMATCH",
      "ACTION_IN_PROGRESS",
    ] as const;

    for (const code of codes) {
      const err = new HandoffError(code, "msg");
      expect(err.code).toBe(code);
    }
  });
});

describe("constants", () => {
  it("DEFAULT_CHUNK_SIZE equals 5242880", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(5242880);
  });

  it("DEFAULT_CHUNK_SIZE equals 5 MiB", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(5 * 1024 * 1024);
  });

  it("SCHEMA_VERSION equals 1.0", () => {
    expect(SCHEMA_VERSION).toBe("1.0");
  });
});

describe("interface shape tests (type-level documentation)", () => {
  it("ConversationEntry has correct shape", () => {
    const entry: ConversationEntry = {
      entry_id: "e1",
      role: "user",
      content: "hello",
      timestamp: "2024-01-01T00:00:00Z",
    };
    expect(entry.entry_id).toBe("e1");
    expect(entry.role).toBe("user");
    expect(entry.content).toBe("hello");
    expect(entry.timestamp).toBe("2024-01-01T00:00:00Z");
    expect(entry.metadata).toBeUndefined();
  });

  it("ConversationEntry accepts all role values", () => {
    const user: ConversationEntry = { entry_id: "1", role: "user", content: "hi", timestamp: "t" };
    const assistant: ConversationEntry = { entry_id: "2", role: "assistant", content: "hi", timestamp: "t" };
    const system: ConversationEntry = { entry_id: "3", role: "system", content: "hi", timestamp: "t" };
    expect(user.role).toBe("user");
    expect(assistant.role).toBe("assistant");
    expect(system.role).toBe("system");
  });

  it("ConversationEntry accepts optional metadata", () => {
    const entry: ConversationEntry = {
      entry_id: "e1",
      role: "assistant",
      content: "response",
      timestamp: "2024-01-01T00:00:00Z",
      metadata: { token_count: 42 },
    };
    expect(entry.metadata).toEqual({ token_count: 42 });
  });

  it("PendingAction has correct shape", () => {
    const action: PendingAction = {
      action_id: "a1",
      action_name: "file_write",
      risk_level: "high",
      queued_at: "2024-01-01T00:00:00Z",
    };
    expect(action.action_id).toBe("a1");
    expect(action.action_name).toBe("file_write");
    expect(action.risk_level).toBe("high");
    expect(action.queued_at).toBe("2024-01-01T00:00:00Z");
    expect(action.target).toBeUndefined();
    expect(action.details).toBeUndefined();
  });

  it("PendingAction accepts optional target and details", () => {
    const action: PendingAction = {
      action_id: "a2",
      action_name: "shell_exec",
      risk_level: "medium",
      target: "/bin/bash",
      details: { command: "ls" },
      queued_at: "2024-01-01T00:00:00Z",
    };
    expect(action.target).toBe("/bin/bash");
    expect(action.details).toEqual({ command: "ls" });
  });

  it("RuntimeConfig has correct shape", () => {
    const config: RuntimeConfig = {
      execution_mode: "local",
      tenant_class: "internal",
      local_execution_enabled: true,
      control_plane_url: "https://cp.example.com",
    };
    expect(config.execution_mode).toBe("local");
    expect(config.tenant_class).toBe("internal");
    expect(config.local_execution_enabled).toBe(true);
    expect(config.control_plane_url).toBe("https://cp.example.com");
  });

  it("RuntimeConfig accepts remote execution mode", () => {
    const config: RuntimeConfig = {
      execution_mode: "remote",
      tenant_class: "external",
      local_execution_enabled: false,
      control_plane_url: "https://cp.example.com",
    };
    expect(config.execution_mode).toBe("remote");
    expect(config.tenant_class).toBe("external");
  });

  it("PolicyCacheEntry has correct shape", () => {
    const entry: PolicyCacheEntry = {
      jti: "jti-1",
      action_name: "file_read",
      decision: "allow",
      risk_level: "low",
      token_expires_at: "2024-12-31T23:59:59Z",
    };
    expect(entry.jti).toBe("jti-1");
    expect(entry.decision).toBe("allow");
    expect(entry.risk_level).toBe("low");
  });

  it("PolicyCacheEntry accepts all decision values", () => {
    const allow: PolicyCacheEntry = { jti: "1", action_name: "a", decision: "allow", risk_level: "low", token_expires_at: "t" };
    const deny: PolicyCacheEntry = { jti: "2", action_name: "a", decision: "deny", risk_level: "low", token_expires_at: "t" };
    const escalate: PolicyCacheEntry = { jti: "3", action_name: "a", decision: "escalate", risk_level: "low", token_expires_at: "t" };
    expect(allow.decision).toBe("allow");
    expect(deny.decision).toBe("deny");
    expect(escalate.decision).toBe("escalate");
  });

  it("ArtifactReference has correct shape", () => {
    const artifact: ArtifactReference = {
      artifact_id: "art-1",
      content_hash: "sha256:abc",
      size_bytes: 1024,
      content_type: "text/plain",
    };
    expect(artifact.artifact_id).toBe("art-1");
    expect(artifact.content_hash).toBe("sha256:abc");
    expect(artifact.size_bytes).toBe(1024);
    expect(artifact.content_type).toBe("text/plain");
    expect(artifact.label).toBeUndefined();
  });

  it("ArtifactReference accepts optional label", () => {
    const artifact: ArtifactReference = {
      artifact_id: "art-2",
      content_hash: "sha256:def",
      size_bytes: 2048,
      content_type: "application/json",
      label: "output.json",
    };
    expect(artifact.label).toBe("output.json");
  });

  it("SessionSnapshot has correct shape", () => {
    const snapshot: SessionSnapshot = {
      snapshot_id: "snap-1",
      session_id: "sess-1",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      conversation_history: [],
      pending_actions: [],
      runtime_config: {
        execution_mode: "local",
        tenant_class: "internal",
        local_execution_enabled: true,
        control_plane_url: "https://cp.example.com",
      },
      policy_cache: [],
      artifacts: [],
      integrity_signature: "sig-abc",
      created_at: "2024-01-01T00:00:00Z",
      schema_version: "1.0",
    };
    expect(snapshot.snapshot_id).toBe("snap-1");
    expect(snapshot.schema_version).toBe("1.0");
    expect(snapshot.conversation_history).toHaveLength(0);
  });

  it("SnapshotManifest has correct shape", () => {
    const manifest: SnapshotManifest = {
      snapshot_id: "snap-1",
      total_size_bytes: 10240,
      chunk_count: 2,
      chunk_size_bytes: 5120,
      artifact_count: 1,
      artifacts: [],
      schema_version: "1.0",
    };
    expect(manifest.snapshot_id).toBe("snap-1");
    expect(manifest.chunk_count).toBe(2);
    expect(manifest.artifact_count).toBe(1);
  });

  it("HandoffRequest has correct shape", () => {
    const manifest: SnapshotManifest = {
      snapshot_id: "snap-1",
      total_size_bytes: 0,
      chunk_count: 0,
      chunk_size_bytes: 0,
      artifact_count: 0,
      artifacts: [],
      schema_version: "1.0",
    };
    const request: HandoffRequest = {
      handoff_id: "ho-1",
      session_id: "sess-1",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      policy_token: "tok.abc.def",
      manifest,
      initiated_at: "2024-01-01T00:00:00Z",
    };
    expect(request.handoff_id).toBe("ho-1");
    expect(request.manifest).toBe(manifest);
  });

  it("HandoffReceipt has correct shape for completed status", () => {
    const receipt: HandoffReceipt = {
      handoff_id: "ho-1",
      cloud_session_id: "cloud-sess-1",
      status: "completed",
      pickup_url: "https://cloud.example.com/session/cloud-sess-1",
      completed_at: "2024-01-01T00:01:00Z",
    };
    expect(receipt.status).toBe("completed");
    expect(receipt.pickup_url).toBe("https://cloud.example.com/session/cloud-sess-1");
    expect(receipt.error).toBeUndefined();
  });

  it("HandoffReceipt has correct shape for failed status", () => {
    const receipt: HandoffReceipt = {
      handoff_id: "ho-2",
      cloud_session_id: "",
      status: "failed",
      completed_at: "2024-01-01T00:01:00Z",
      error: "upload timeout",
    };
    expect(receipt.status).toBe("failed");
    expect(receipt.error).toBe("upload timeout");
    expect(receipt.pickup_url).toBeUndefined();
  });

  it("HandoffState type covers all states", () => {
    const states: HandoffState[] = [
      "initiated",
      "authorizing",
      "encrypting",
      "transferring",
      "completed",
      "failed",
    ];
    expect(states).toHaveLength(6);
  });

  it("PolicyOutcomeForHandoff type covers all outcomes", () => {
    const outcomes: PolicyOutcomeForHandoff[] = ["allow", "deny", "escalate"];
    expect(outcomes).toHaveLength(3);
  });
});
