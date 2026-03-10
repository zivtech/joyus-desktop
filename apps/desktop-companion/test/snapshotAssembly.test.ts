import { describe, expect, it } from "vitest";
import {
  assembleSnapshot,
  assembleAndSignSnapshot,
  generateManifest,
  validateSnapshot,
  computeIntegritySignature,
  alignChunkSize,
} from "../src/snapshotAssembly";
import type { SnapshotInput } from "../src/snapshotAssembly";
import type { SessionSnapshot } from "@joyus/policy-client";
import { HandoffError, SCHEMA_VERSION, DEFAULT_CHUNK_SIZE } from "@joyus/policy-client";

function createTestSnapshotInput(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    session_id: "session-abc-123",
    tenant_id: "tenant-xyz-456",
    workspace_id: "workspace-789",
    conversation_history: [
      {
        entry_id: "entry-1",
        role: "user",
        content: "Hello, assistant",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      {
        entry_id: "entry-2",
        role: "assistant",
        content: "Hello! How can I help?",
        timestamp: "2024-01-01T00:00:01.000Z",
      },
    ],
    pending_actions: [
      {
        action_id: "action-1",
        action_name: "read_file",
        risk_level: "low",
        target: "/home/user/file.txt",
        queued_at: "2024-01-01T00:00:02.000Z",
      },
    ],
    runtime_config: {
      execution_mode: "remote",
      tenant_class: "external",
      local_execution_enabled: false,
      control_plane_url: "https://control.example.com",
    },
    policy_cache: [
      {
        jti: "jti-1",
        action_name: "read_file",
        decision: "allow",
        risk_level: "low",
        token_expires_at: "2024-01-02T00:00:00.000Z",
      },
    ],
    artifacts: [
      {
        artifact_id: "artifact-1",
        content_hash: "sha256:abc123",
        size_bytes: 1024,
        content_type: "text/plain",
        label: "output.txt",
      },
    ],
    ...overrides,
  };
}

describe("alignChunkSize", () => {
  const CHUNK_ALIGNMENT = 256 * 1024;

  it("returns 256 KiB for zero input", () => {
    expect(alignChunkSize(0)).toBe(CHUNK_ALIGNMENT);
  });

  it("returns 256 KiB for input smaller than alignment", () => {
    expect(alignChunkSize(1)).toBe(CHUNK_ALIGNMENT);
    expect(alignChunkSize(100)).toBe(CHUNK_ALIGNMENT);
    expect(alignChunkSize(CHUNK_ALIGNMENT - 1)).toBe(CHUNK_ALIGNMENT);
  });

  it("returns exactly 256 KiB for input equal to alignment", () => {
    expect(alignChunkSize(CHUNK_ALIGNMENT)).toBe(CHUNK_ALIGNMENT);
  });

  it("rounds up to next 256 KiB boundary", () => {
    expect(alignChunkSize(CHUNK_ALIGNMENT + 1)).toBe(2 * CHUNK_ALIGNMENT);
    expect(alignChunkSize(2 * CHUNK_ALIGNMENT - 1)).toBe(2 * CHUNK_ALIGNMENT);
    expect(alignChunkSize(2 * CHUNK_ALIGNMENT)).toBe(2 * CHUNK_ALIGNMENT);
  });

  it("handles DEFAULT_CHUNK_SIZE (5 MiB) correctly", () => {
    // 5 MiB = 5 * 1024 * 1024 = 5242880; ceil(5242880 / 262144) * 262144 = 20 * 262144
    expect(alignChunkSize(DEFAULT_CHUNK_SIZE)).toBe(20 * CHUNK_ALIGNMENT);
  });

  it("handles large sizes", () => {
    const tenMiB = 10 * 1024 * 1024;
    expect(alignChunkSize(tenMiB)).toBe(tenMiB); // 10 MiB is exactly 40 * 256 KiB
  });
});

describe("validateSnapshot", () => {
  function buildValidSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
    return {
      snapshot_id: "snap-1",
      session_id: "session-1",
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      conversation_history: [
        {
          entry_id: "entry-1",
          role: "user",
          content: "Hello",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      ],
      pending_actions: [],
      runtime_config: {
        execution_mode: "remote",
        tenant_class: "external",
        local_execution_enabled: false,
        control_plane_url: "https://control.example.com",
      },
      policy_cache: [],
      artifacts: [],
      integrity_signature: "",
      created_at: "2024-01-01T00:00:00.000Z",
      schema_version: SCHEMA_VERSION,
      ...overrides,
    };
  }

  it("passes for a valid snapshot", () => {
    expect(() => validateSnapshot(buildValidSnapshot())).not.toThrow();
  });

  it("throws INVALID_SNAPSHOT when session_id is empty", () => {
    const snapshot = buildValidSnapshot({ session_id: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("session_id");
  });

  it("throws INVALID_SNAPSHOT when session_id is whitespace", () => {
    const snapshot = buildValidSnapshot({ session_id: "   " });
    const err = (() => {
      try { validateSnapshot(snapshot); } catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(HandoffError);
    expect((err as HandoffError).code).toBe("INVALID_SNAPSHOT");
  });

  it("throws INVALID_SNAPSHOT when tenant_id is missing", () => {
    const snapshot = buildValidSnapshot({ tenant_id: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("tenant_id");
  });

  it("throws INVALID_SNAPSHOT when workspace_id is empty", () => {
    const snapshot = buildValidSnapshot({ workspace_id: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("workspace_id");
  });

  it("throws INVALID_SNAPSHOT when snapshot_id is empty", () => {
    const snapshot = buildValidSnapshot({ snapshot_id: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("snapshot_id");
  });

  it("throws INVALID_SNAPSHOT when created_at is empty", () => {
    const snapshot = buildValidSnapshot({ created_at: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("created_at");
  });

  it("throws INVALID_SNAPSHOT when schema_version is empty", () => {
    const snapshot = buildValidSnapshot({ schema_version: "" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
  });

  it("throws INVALID_SNAPSHOT when schema_version does not match SCHEMA_VERSION", () => {
    const snapshot = buildValidSnapshot({ schema_version: "2.0" });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("Unsupported schema version");
  });

  it("throws INVALID_SNAPSHOT when conversation_history is empty", () => {
    const snapshot = buildValidSnapshot({ conversation_history: [] });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("conversation_history");
  });

  it("passes when pending_actions is empty", () => {
    const snapshot = buildValidSnapshot({ pending_actions: [] });
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("passes when artifacts is empty", () => {
    const snapshot = buildValidSnapshot({ artifacts: [] });
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("passes when policy_cache is empty", () => {
    const snapshot = buildValidSnapshot({ policy_cache: [] });
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("throws INVALID_SNAPSHOT when runtime_config control_plane_url is empty", () => {
    const snapshot = buildValidSnapshot({
      runtime_config: {
        execution_mode: "remote",
        tenant_class: "external",
        local_execution_enabled: false,
        control_plane_url: "",
      },
    });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
    expect(() => validateSnapshot(snapshot)).toThrow("runtime_config");
  });

  it("throws INVALID_SNAPSHOT when runtime_config control_plane_url is whitespace", () => {
    const snapshot = buildValidSnapshot({
      runtime_config: {
        execution_mode: "remote",
        tenant_class: "external",
        local_execution_enabled: false,
        control_plane_url: "   ",
      },
    });
    expect(() => validateSnapshot(snapshot)).toThrow(HandoffError);
  });
});

describe("assembleSnapshot", () => {
  it("returns a snapshot with all fields populated from input", () => {
    const input = createTestSnapshotInput();
    const snapshot = assembleSnapshot(input);

    expect(snapshot.session_id).toBe(input.session_id);
    expect(snapshot.tenant_id).toBe(input.tenant_id);
    expect(snapshot.workspace_id).toBe(input.workspace_id);
    expect(snapshot.conversation_history).toEqual(input.conversation_history);
    expect(snapshot.pending_actions).toEqual(input.pending_actions);
    expect(snapshot.runtime_config).toEqual(input.runtime_config);
    expect(snapshot.policy_cache).toEqual(input.policy_cache);
    expect(snapshot.artifacts).toEqual(input.artifacts);
  });

  it("generates a valid UUID for snapshot_id", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(snapshot.snapshot_id).toMatch(uuidPattern);
  });

  it("generates a unique snapshot_id on each call", () => {
    const snap1 = assembleSnapshot(createTestSnapshotInput());
    const snap2 = assembleSnapshot(createTestSnapshotInput());
    expect(snap1.snapshot_id).not.toBe(snap2.snapshot_id);
  });

  it("generates a valid ISO 8601 created_at timestamp", () => {
    const before = new Date().toISOString();
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const after = new Date().toISOString();

    expect(new Date(snapshot.created_at).toISOString()).toBe(snapshot.created_at);
    expect(snapshot.created_at >= before).toBe(true);
    expect(snapshot.created_at <= after).toBe(true);
  });

  it("sets schema_version to SCHEMA_VERSION", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    expect(snapshot.schema_version).toBe(SCHEMA_VERSION);
  });

  it("sets integrity_signature to empty string before signing", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    expect(snapshot.integrity_signature).toBe("");
  });

  it("throws INVALID_SNAPSHOT when conversation_history is empty", () => {
    const input = createTestSnapshotInput({ conversation_history: [] });
    expect(() => assembleSnapshot(input)).toThrow(HandoffError);
  });
});

describe("generateManifest", () => {
  it("returns chunk_count of 1 for a small snapshot using default chunk size", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const manifest = generateManifest(snapshot);

    expect(manifest.chunk_count).toBe(1);
    expect(manifest.snapshot_id).toBe(snapshot.snapshot_id);
    expect(manifest.schema_version).toBe(snapshot.schema_version);
  });

  it("sets total_size_bytes to the byte length of the serialized snapshot", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const manifest = generateManifest(snapshot);
    const expectedBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf-8");
    expect(manifest.total_size_bytes).toBe(expectedBytes);
  });

  it("reflects artifact_count from snapshot", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const manifest = generateManifest(snapshot);
    expect(manifest.artifact_count).toBe(snapshot.artifacts.length);
    expect(manifest.artifact_count).toBe(1);
  });

  it("returns artifact_count of 0 when no artifacts", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput({ artifacts: [] }));
    const manifest = generateManifest(snapshot);
    expect(manifest.artifact_count).toBe(0);
    expect(manifest.artifacts).toEqual([]);
  });

  it("uses custom chunk size aligned to 256 KiB boundary", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const customChunkSize = 512 * 1024; // 512 KiB
    const manifest = generateManifest(snapshot, customChunkSize);
    expect(manifest.chunk_size_bytes).toBe(customChunkSize);
  });

  it("rounds non-aligned chunk size up to 256 KiB boundary", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const nonAligned = 300 * 1024; // 300 KiB — not aligned to 256 KiB
    const manifest = generateManifest(snapshot, nonAligned);
    expect(manifest.chunk_size_bytes).toBe(512 * 1024); // rounds up to 512 KiB
  });

  it("calculates correct chunk_count for custom chunk size", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const serialized = JSON.stringify(snapshot);
    const totalBytes = Buffer.byteLength(serialized, "utf-8");
    const chunkSize = 256 * 1024; // 256 KiB
    const manifest = generateManifest(snapshot, chunkSize);
    const expectedChunks = Math.ceil(totalBytes / chunkSize);
    expect(manifest.chunk_count).toBe(expectedChunks);
  });

  it("uses default chunk size when no chunkSize argument is provided", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const manifest = generateManifest(snapshot);
    // DEFAULT_CHUNK_SIZE (5 MiB) aligns to 5 MiB (20 * 256 KiB)
    expect(manifest.chunk_size_bytes).toBe(alignChunkSize(DEFAULT_CHUNK_SIZE));
  });

  it("copies artifacts array from snapshot", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const manifest = generateManifest(snapshot);
    expect(manifest.artifacts).toEqual(snapshot.artifacts);
  });
});

describe("computeIntegritySignature", () => {
  const signingKey = Buffer.from("test-signing-key-32-bytes-padded!", "utf-8");

  it("returns a hex-encoded string", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const sig = computeIntegritySignature(snapshot, signingKey);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const sig = computeIntegritySignature(snapshot, signingKey);
    expect(sig).toHaveLength(64);
  });

  it("is deterministic: same input and key produce same signature", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const sig1 = computeIntegritySignature(snapshot, signingKey);
    const sig2 = computeIntegritySignature(snapshot, signingKey);
    expect(sig1).toBe(sig2);
  });

  it("produces different signature with different key", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const otherKey = Buffer.from("different-signing-key-32-bytes!!", "utf-8");
    const sig1 = computeIntegritySignature(snapshot, signingKey);
    const sig2 = computeIntegritySignature(snapshot, otherKey);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signature for different snapshot content", () => {
    const snap1 = assembleSnapshot(createTestSnapshotInput({ session_id: "session-A" }));
    const snap2 = assembleSnapshot(createTestSnapshotInput({ session_id: "session-B" }));
    const sig1 = computeIntegritySignature(snap1, signingKey);
    const sig2 = computeIntegritySignature(snap2, signingKey);
    expect(sig1).not.toBe(sig2);
  });

  it("excludes integrity_signature field from computation", () => {
    const snapshot = assembleSnapshot(createTestSnapshotInput());
    const snapshotWithSig: SessionSnapshot = { ...snapshot, integrity_signature: "some-prior-sig" };
    const sig1 = computeIntegritySignature(snapshot, signingKey);
    const sig2 = computeIntegritySignature(snapshotWithSig, signingKey);
    expect(sig1).toBe(sig2);
  });
});

describe("assembleAndSignSnapshot", () => {
  const signingKey = Buffer.from("test-signing-key-32-bytes-padded!", "utf-8");

  it("returns a snapshot with non-empty integrity_signature", () => {
    const snapshot = assembleAndSignSnapshot(createTestSnapshotInput(), signingKey);
    expect(snapshot.integrity_signature).not.toBe("");
    expect(snapshot.integrity_signature).toHaveLength(64);
  });

  it("signature is hex-encoded", () => {
    const snapshot = assembleAndSignSnapshot(createTestSnapshotInput(), signingKey);
    expect(snapshot.integrity_signature).toMatch(/^[0-9a-f]+$/);
  });

  it("signature is verifiable by recomputing with the same key", () => {
    const snapshot = assembleAndSignSnapshot(createTestSnapshotInput(), signingKey);
    const recomputed = computeIntegritySignature(snapshot, signingKey);
    expect(snapshot.integrity_signature).toBe(recomputed);
  });

  it("populates all other fields correctly", () => {
    const input = createTestSnapshotInput();
    const snapshot = assembleAndSignSnapshot(input, signingKey);
    expect(snapshot.session_id).toBe(input.session_id);
    expect(snapshot.tenant_id).toBe(input.tenant_id);
    expect(snapshot.schema_version).toBe(SCHEMA_VERSION);
  });

  it("throws INVALID_SNAPSHOT when input is invalid", () => {
    const input = createTestSnapshotInput({ conversation_history: [] });
    expect(() => assembleAndSignSnapshot(input, signingKey)).toThrow(HandoffError);
  });
});
