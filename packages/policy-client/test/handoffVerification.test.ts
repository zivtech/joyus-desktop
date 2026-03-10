import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySnapshot,
  reconstructSession,
  computeIntegritySignature,
  createMockCloudVerifier,
} from "../src/handoffVerification";
import type {
  VerificationInput,
  VerificationError,
  ReconstructedSession,
} from "../src/handoffVerification";
import {
  generateEphemeralKeyPair,
  deriveContentEncryptionKey,
  performKeyAgreement,
  encryptSnapshot,
  encryptArtifact,
} from "../src/snapshotEncryption";
import type { EncryptedChunk, EncryptedArtifact } from "../src/snapshotEncryption";
import { SCHEMA_VERSION } from "../src/handoffTypes";
import type {
  SessionSnapshot,
  SnapshotManifest,
  ConversationEntry,
  PendingAction,
  RuntimeConfig,
  PolicyCacheEntry,
  ArtifactReference,
} from "../src/handoffTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNING_KEY = Buffer.alloc(32, 0x42);

function createTestSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  const base: SessionSnapshot = {
    snapshot_id: "snap-test-001",
    session_id: "session-test-001",
    tenant_id: "tenant-001",
    workspace_id: "workspace-001",
    conversation_history: [
      {
        entry_id: "entry-1",
        role: "user",
        content: "Hello",
        timestamp: "2026-03-10T10:00:00Z",
      },
      {
        entry_id: "entry-2",
        role: "assistant",
        content: "Hi there!",
        timestamp: "2026-03-10T10:00:01Z",
      },
    ],
    pending_actions: [
      {
        action_id: "action-1",
        action_name: "file.read",
        risk_level: "low",
        queued_at: "2026-03-10T10:00:02Z",
      },
    ],
    runtime_config: {
      execution_mode: "local",
      tenant_class: "internal",
      local_execution_enabled: true,
      control_plane_url: "https://control.example.com",
    },
    policy_cache: [
      {
        jti: "jti-001",
        action_name: "file.read",
        decision: "allow",
        risk_level: "low",
        token_expires_at: "2026-03-11T00:00:00Z",
      },
    ],
    artifacts: [],
    integrity_signature: "",
    created_at: "2026-03-10T10:00:00Z",
    schema_version: SCHEMA_VERSION,
    ...overrides,
  };

  // Compute real integrity signature
  const signature = computeIntegritySignature(base, SIGNING_KEY);
  return { ...base, integrity_signature: signature };
}

function createTestSnapshotWithArtifacts(): {
  snapshot: SessionSnapshot;
  artifactData: Map<string, Buffer>;
} {
  const artifactData = new Map<string, Buffer>();
  artifactData.set("art-1", Buffer.from("artifact-one-content"));
  artifactData.set("art-2", Buffer.from("artifact-two-content"));

  const artifacts: ArtifactReference[] = [
    {
      artifact_id: "art-1",
      content_hash: "hash-1",
      size_bytes: 20,
      content_type: "text/plain",
    },
    {
      artifact_id: "art-2",
      content_hash: "hash-2",
      size_bytes: 20,
      content_type: "text/plain",
    },
  ];

  const snapshot = createTestSnapshot({
    artifacts,
  });

  return { snapshot, artifactData };
}

/**
 * Encrypt a snapshot end-to-end simulating the desktop side, then return
 * everything the cloud verifier needs.
 */
function encryptForCloud(
  snapshot: SessionSnapshot,
  cloudPublicKey: Buffer,
  artifactData?: Map<string, Buffer>
): {
  encryptedChunks: EncryptedChunk[];
  encryptedArtifacts: EncryptedArtifact[];
  manifest: SnapshotManifest;
  ephemeralPublicKey: Buffer;
  cek: Buffer;
} {
  const { ephemeralPublicKey, contentEncryptionKey: cek } =
    performKeyAgreement(cloudPublicKey);

  const snapshotJson = Buffer.from(JSON.stringify(snapshot));
  const encryptedChunks = encryptSnapshot(
    cek,
    snapshotJson,
    snapshot.session_id
  );

  const encryptedArtifacts: EncryptedArtifact[] = [];
  if (artifactData) {
    for (const [id, data] of artifactData) {
      encryptedArtifacts.push(encryptArtifact(cek, id, data));
    }
  }

  const manifest: SnapshotManifest = {
    snapshot_id: snapshot.snapshot_id,
    total_size_bytes: snapshotJson.length,
    chunk_count: encryptedChunks.length,
    chunk_size_bytes: 5 * 1024 * 1024, // default
    artifact_count: encryptedArtifacts.length,
    artifacts: snapshot.artifacts,
    schema_version: snapshot.schema_version,
  };

  return { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey, cek };
}

// ---------------------------------------------------------------------------
// T037 — verifySnapshot
// ---------------------------------------------------------------------------

describe("computeIntegritySignature", () => {
  it("produces a hex HMAC-SHA256 string", () => {
    const snapshot = createTestSnapshot();
    const sig = computeIntegritySignature(snapshot, SIGNING_KEY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same output for the same input", () => {
    const snapshot = createTestSnapshot();
    const sig1 = computeIntegritySignature(snapshot, SIGNING_KEY);
    const sig2 = computeIntegritySignature(snapshot, SIGNING_KEY);
    expect(sig1).toBe(sig2);
  });

  it("differs when signing key changes", () => {
    const snapshot = createTestSnapshot();
    const sig1 = computeIntegritySignature(snapshot, SIGNING_KEY);
    const sig2 = computeIntegritySignature(snapshot, Buffer.alloc(32, 0x99));
    expect(sig1).not.toBe(sig2);
  });

  it("zeroes out integrity_signature before hashing", () => {
    const snapshot = createTestSnapshot();
    // Compute signature of a snapshot that already has a signature set
    const sig = computeIntegritySignature(snapshot, SIGNING_KEY);
    // Should equal signature of the same snapshot with empty integrity_signature
    const blank = { ...snapshot, integrity_signature: "" };
    const sigBlank = computeIntegritySignature(
      blank as SessionSnapshot,
      SIGNING_KEY
    );
    expect(sig).toBe(sigBlank);
  });
});

describe("verifySnapshot", () => {
  describe("happy path", () => {
    it("returns valid=true for a correctly encrypted snapshot", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.snapshot).toBeDefined();
      expect(result.snapshot!.snapshot_id).toBe(snapshot.snapshot_id);
      expect(result.snapshot!.session_id).toBe(snapshot.session_id);
      expect(result.snapshot!.conversation_history).toHaveLength(2);
    });

    it("decrypts artifacts and returns them in the result", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const { snapshot, artifactData } = createTestSnapshotWithArtifacts();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey, artifactData);

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(true);
      expect(result.decryptedArtifacts).toBeDefined();
      expect(result.decryptedArtifacts!.size).toBe(2);
      expect(
        Buffer.from(result.decryptedArtifacts!.get("art-1")!).toString()
      ).toBe("artifact-one-content");
      expect(
        Buffer.from(result.decryptedArtifacts!.get("art-2")!).toString()
      ).toBe("artifact-two-content");
    });
  });

  describe("tampered chunk", () => {
    it("returns DECRYPTION_FAILED for modified ciphertext", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      // Tamper with first chunk
      const tampered: EncryptedChunk = {
        ...encryptedChunks[0]!,
        ciphertext: Buffer.concat([
          Buffer.from([encryptedChunks[0]!.ciphertext[0]! ^ 0xff]),
          encryptedChunks[0]!.ciphertext.subarray(1),
        ]),
      };

      const result = await verifySnapshot({
        encryptedChunks: [tampered],
        encryptedArtifacts,
        manifest: { ...manifest, chunk_count: 1 },
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const decErr = result.errors.find(
        (e) => e.code === "DECRYPTION_FAILED"
      );
      expect(decErr).toBeDefined();
      expect(decErr!.message).toContain("chunk 0");
      expect(decErr!.details).toBeDefined();
      expect(decErr!.details!.chunkIndex).toBe(0);
    });
  });

  describe("integrity mismatch", () => {
    it("returns INTEGRITY_MISMATCH when signature is wrong", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      // Create snapshot with wrong integrity signature
      const base = createTestSnapshot();
      const badSnapshot: SessionSnapshot = {
        ...base,
        integrity_signature: "deadbeef".repeat(8),
      };

      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(badSnapshot, cloudKeys.publicKey);

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const intErr = result.errors.find(
        (e) => e.code === "INTEGRITY_MISMATCH"
      );
      expect(intErr).toBeDefined();
      expect(intErr!.message).toContain("Integrity signature");
    });
  });

  describe("manifest mismatch", () => {
    it("returns MANIFEST_MISMATCH for wrong chunk_count", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      const badManifest: SnapshotManifest = {
        ...manifest,
        chunk_count: 999,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest: badManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const manErr = result.errors.find(
        (e) =>
          e.code === "MANIFEST_MISMATCH" &&
          e.message.includes("chunk_count")
      );
      expect(manErr).toBeDefined();
      expect(manErr!.details!.expected).toBe(999);
      expect(manErr!.details!.actual).toBe(encryptedChunks.length);
    });

    it("returns MANIFEST_MISMATCH for wrong artifact_count", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      const badManifest: SnapshotManifest = {
        ...manifest,
        artifact_count: 5,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest: badManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const manErr = result.errors.find(
        (e) =>
          e.code === "MANIFEST_MISMATCH" &&
          e.message.includes("artifact_count")
      );
      expect(manErr).toBeDefined();
    });

    it("returns MANIFEST_MISMATCH for wrong total_size_bytes", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      const badManifest: SnapshotManifest = {
        ...manifest,
        total_size_bytes: 1,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest: badManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const manErr = result.errors.find(
        (e) =>
          e.code === "MANIFEST_MISMATCH" &&
          e.message.includes("total_size_bytes")
      );
      expect(manErr).toBeDefined();
    });
  });

  describe("missing artifact", () => {
    it("returns MISSING_ARTIFACT when snapshot references artifact not provided", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const { snapshot, artifactData } = createTestSnapshotWithArtifacts();

      // Only encrypt one of two artifacts
      const partialArtifactData = new Map<string, Buffer>();
      partialArtifactData.set("art-1", artifactData.get("art-1")!);

      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey, partialArtifactData);

      // Fix manifest to match actual artifact count
      const fixedManifest: SnapshotManifest = {
        ...manifest,
        artifact_count: encryptedArtifacts.length,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest: fixedManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const missingErr = result.errors.find(
        (e) => e.code === "MISSING_ARTIFACT"
      );
      expect(missingErr).toBeDefined();
      expect(missingErr!.message).toContain("art-2");
      expect(missingErr!.details!.artifact_id).toBe("art-2");
    });
  });

  describe("invalid schema", () => {
    it("returns INVALID_SCHEMA for unknown schema_version", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      // Create snapshot with bad schema version, but sign it so integrity passes
      const badBase: SessionSnapshot = {
        snapshot_id: "snap-bad-schema",
        session_id: "session-bad",
        tenant_id: "tenant-001",
        workspace_id: "workspace-001",
        conversation_history: [
          {
            entry_id: "entry-1",
            role: "user",
            content: "Hello",
            timestamp: "2026-03-10T10:00:00Z",
          },
        ],
        pending_actions: [],
        runtime_config: {
          execution_mode: "local",
          tenant_class: "internal",
          local_execution_enabled: true,
          control_plane_url: "https://control.example.com",
        },
        policy_cache: [],
        artifacts: [],
        integrity_signature: "",
        created_at: "2026-03-10T10:00:00Z",
        schema_version: "99.0",
      };
      const sig = computeIntegritySignature(badBase, SIGNING_KEY);
      const badSnapshot: SessionSnapshot = { ...badBase, integrity_signature: sig };

      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(badSnapshot, cloudKeys.publicKey);

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const schErr = result.errors.find((e) => e.code === "INVALID_SCHEMA");
      expect(schErr).toBeDefined();
      expect(schErr!.message).toContain("99.0");
      expect(schErr!.details!.expected).toBe(SCHEMA_VERSION);
      expect(schErr!.details!.actual).toBe("99.0");
    });
  });

  describe("JSON parse failure", () => {
    it("returns DECRYPTION_FAILED when decrypted data is not valid JSON", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const { ephemeralPublicKey, contentEncryptionKey: cek } =
        performKeyAgreement(cloudKeys.publicKey);

      // Encrypt non-JSON data
      const badData = Buffer.from("not valid json {{{}}}");
      const encryptedChunks = encryptSnapshot(cek, badData, "session-bad");

      const manifest: SnapshotManifest = {
        snapshot_id: "snap-bad-json",
        total_size_bytes: badData.length,
        chunk_count: encryptedChunks.length,
        chunk_size_bytes: 5 * 1024 * 1024,
        artifact_count: 0,
        artifacts: [],
        schema_version: SCHEMA_VERSION,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts: [],
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const parseErr = result.errors.find(
        (e) => e.code === "DECRYPTION_FAILED" && e.message.includes("JSON")
      );
      expect(parseErr).toBeDefined();
    });
  });

  describe("error accumulation", () => {
    it("reports multiple errors at once (tampered chunk + manifest mismatch)", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      // Tamper with chunk AND wrong manifest
      const tampered: EncryptedChunk = {
        ...encryptedChunks[0]!,
        ciphertext: Buffer.concat([
          Buffer.from([encryptedChunks[0]!.ciphertext[0]! ^ 0xff]),
          encryptedChunks[0]!.ciphertext.subarray(1),
        ]),
      };

      const badManifest: SnapshotManifest = {
        ...manifest,
        chunk_count: 999,
        artifact_count: 10,
      };

      const result = await verifySnapshot({
        encryptedChunks: [tampered],
        encryptedArtifacts,
        manifest: badManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("DECRYPTION_FAILED");
      expect(codes).toContain("MANIFEST_MISMATCH");
    });

    it("reports both missing artifact and manifest mismatch errors", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const { snapshot, artifactData } = createTestSnapshotWithArtifacts();

      // Only provide one of two artifacts AND wrong artifact_count in manifest
      const partialArtifactData = new Map<string, Buffer>();
      partialArtifactData.set("art-1", artifactData.get("art-1")!);

      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey, partialArtifactData);

      // Keep manifest artifact_count at 2 (wrong -- only 1 provided)
      const badManifest: SnapshotManifest = {
        ...manifest,
        artifact_count: 2,
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest: badManifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("MISSING_ARTIFACT");
      expect(codes).toContain("MANIFEST_MISMATCH");
    });
  });

  describe("empty chunks", () => {
    it("skips total_size validation when no chunks are provided", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { ephemeralPublicKey } = performKeyAgreement(cloudKeys.publicKey);

      // Provide zero chunks with manifest saying 0 chunks
      const manifest: SnapshotManifest = {
        snapshot_id: snapshot.snapshot_id,
        total_size_bytes: 999, // wrong size, but should not be checked
        chunk_count: 0,
        chunk_size_bytes: 5 * 1024 * 1024,
        artifact_count: 0,
        artifacts: [],
        schema_version: SCHEMA_VERSION,
      };

      const result = await verifySnapshot({
        encryptedChunks: [],
        encryptedArtifacts: [],
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      // No MANIFEST_MISMATCH for total_size since no chunks were decrypted
      // But there should be a DECRYPTION_FAILED for JSON parse since empty buffer
      expect(result.valid).toBe(false);
      const sizeErrors = result.errors.filter(
        (e) =>
          e.code === "MANIFEST_MISMATCH" &&
          e.message.includes("total_size_bytes")
      );
      expect(sizeErrors).toHaveLength(0);
    });
  });

  describe("wrong key", () => {
    it("returns DECRYPTION_FAILED when using wrong cloud private key", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const wrongCloudKeys = generateEphemeralKeyPair();
      const snapshot = createTestSnapshot();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey);

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts,
        manifest,
        cloudPrivateKey: wrongCloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const decErr = result.errors.find(
        (e) => e.code === "DECRYPTION_FAILED"
      );
      expect(decErr).toBeDefined();
    });
  });

  describe("artifact decryption failure", () => {
    it("returns DECRYPTION_FAILED for tampered encrypted artifact", async () => {
      const cloudKeys = generateEphemeralKeyPair();
      const { snapshot, artifactData } = createTestSnapshotWithArtifacts();
      const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
        encryptForCloud(snapshot, cloudKeys.publicKey, artifactData);

      // Tamper with second artifact ciphertext
      const tamperedArtifact: EncryptedArtifact = {
        ...encryptedArtifacts[1]!,
        ciphertext: Buffer.concat([
          Buffer.from([encryptedArtifacts[1]!.ciphertext[0]! ^ 0xff]),
          encryptedArtifacts[1]!.ciphertext.subarray(1),
        ]),
      };

      const result = await verifySnapshot({
        encryptedChunks,
        encryptedArtifacts: [encryptedArtifacts[0]!, tamperedArtifact],
        manifest,
        cloudPrivateKey: cloudKeys.privateKey,
        desktopEphemeralPublicKey: ephemeralPublicKey,
        signingKey: SIGNING_KEY,
      });

      expect(result.valid).toBe(false);
      const artErr = result.errors.find(
        (e) =>
          e.code === "DECRYPTION_FAILED" &&
          e.message.includes("artifact")
      );
      expect(artErr).toBeDefined();
      expect(artErr!.details!.artifact_id).toBe("art-2");
    });
  });
});

// ---------------------------------------------------------------------------
// T038 — reconstructSession
// ---------------------------------------------------------------------------

describe("reconstructSession", () => {
  it("creates a reconstructed session with cloud_session_id", () => {
    const snapshot = createTestSnapshot();
    const artifacts = new Map<string, Uint8Array>();

    const result = reconstructSession(snapshot, artifacts);

    expect(result.cloud_session_id).toBeDefined();
    expect(result.cloud_session_id.length).toBeGreaterThan(0);
    // UUID v4 format
    expect(result.cloud_session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("copies session_id from snapshot", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());
    expect(result.session_id).toBe(snapshot.session_id);
  });

  it("copies tenant_id and workspace_id", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());
    expect(result.tenant_id).toBe(snapshot.tenant_id);
    expect(result.workspace_id).toBe(snapshot.workspace_id);
  });

  it("preserves conversation history in order", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());

    expect(result.conversation_history).toHaveLength(2);
    expect(result.conversation_history[0]!.entry_id).toBe("entry-1");
    expect(result.conversation_history[1]!.entry_id).toBe("entry-2");
    expect(result.conversation_history[0]!.role).toBe("user");
    expect(result.conversation_history[1]!.role).toBe("assistant");
  });

  it("preserves pending actions", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());

    expect(result.pending_actions).toHaveLength(1);
    expect(result.pending_actions[0]!.action_id).toBe("action-1");
    expect(result.pending_actions[0]!.action_name).toBe("file.read");
  });

  it("preserves runtime config", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());

    expect(result.runtime_config.execution_mode).toBe("local");
    expect(result.runtime_config.tenant_class).toBe("internal");
    expect(result.runtime_config.local_execution_enabled).toBe(true);
    expect(result.runtime_config.control_plane_url).toBe(
      "https://control.example.com"
    );
  });

  it("preserves policy cache", () => {
    const snapshot = createTestSnapshot();
    const result = reconstructSession(snapshot, new Map());

    expect(result.policy_cache).toHaveLength(1);
    expect(result.policy_cache[0]!.jti).toBe("jti-001");
  });

  it("attaches decrypted artifacts", () => {
    const { snapshot } = createTestSnapshotWithArtifacts();
    const artifacts = new Map<string, Uint8Array>();
    artifacts.set("art-1", new Uint8Array([1, 2, 3]));
    artifacts.set("art-2", new Uint8Array([4, 5, 6]));

    const result = reconstructSession(snapshot, artifacts);

    expect(result.artifacts.size).toBe(2);
    expect(result.artifacts.get("art-1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.artifacts.get("art-2")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("sets reconstructed_at timestamp", () => {
    const snapshot = createTestSnapshot();
    const before = new Date().toISOString();
    const result = reconstructSession(snapshot, new Map());
    const after = new Date().toISOString();

    expect(result.reconstructed_at).toBeDefined();
    expect(result.reconstructed_at >= before).toBe(true);
    expect(result.reconstructed_at <= after).toBe(true);
  });

  it("throws when artifact referenced in snapshot is missing from map", () => {
    const { snapshot } = createTestSnapshotWithArtifacts();
    const artifacts = new Map<string, Uint8Array>();
    // Only provide art-1, missing art-2

    artifacts.set("art-1", new Uint8Array([1, 2, 3]));

    expect(() => reconstructSession(snapshot, artifacts)).toThrow(
      "Missing decrypted artifact: art-2"
    );
  });

  it("throws when conversation history is empty", () => {
    const snapshot = createTestSnapshot({
      conversation_history: [],
    });

    expect(() => reconstructSession(snapshot, new Map())).toThrow(
      "Conversation history is empty"
    );
  });

  it("generates unique cloud_session_id each time", () => {
    const snapshot = createTestSnapshot();
    const r1 = reconstructSession(snapshot, new Map());
    const r2 = reconstructSession(snapshot, new Map());
    expect(r1.cloud_session_id).not.toBe(r2.cloud_session_id);
  });
});

// ---------------------------------------------------------------------------
// T039 — createMockCloudVerifier
// ---------------------------------------------------------------------------

describe("createMockCloudVerifier", () => {
  it("generates a key pair with 32-byte public key", () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    expect(mock.keyPair.publicKey).toBeInstanceOf(Buffer);
    expect(mock.keyPair.publicKey.length).toBe(32);
  });

  it("has a private key of type x25519", () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    expect(mock.keyPair.privateKey.type).toBe("private");
    expect(mock.keyPair.privateKey.asymmetricKeyType).toBe("x25519");
  });

  it("verify succeeds with correctly encrypted snapshot", async () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    const snapshot = createTestSnapshot();
    const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
      encryptForCloud(snapshot, mock.keyPair.publicKey);

    const result = await mock.verify({
      encryptedChunks,
      encryptedArtifacts,
      manifest,
      cloudPrivateKey: mock.keyPair.privateKey,
      desktopEphemeralPublicKey: ephemeralPublicKey,
      signingKey: SIGNING_KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.snapshot_id).toBe(snapshot.snapshot_id);
  });

  it("verify fails with wrong cloud key", async () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    const wrongKeys = generateEphemeralKeyPair();
    const snapshot = createTestSnapshot();
    // Encrypt with wrong key (not the mock's key)
    const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
      encryptForCloud(snapshot, wrongKeys.publicKey);

    const result = await mock.verify({
      encryptedChunks,
      encryptedArtifacts,
      manifest,
      cloudPrivateKey: mock.keyPair.privateKey,
      desktopEphemeralPublicKey: ephemeralPublicKey,
      signingKey: SIGNING_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const decErr = result.errors.find(
      (e) => e.code === "DECRYPTION_FAILED"
    );
    expect(decErr).toBeDefined();
  });

  it("reconstruct creates a valid session", () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    const snapshot = createTestSnapshot();

    const session = mock.reconstruct(snapshot, new Map());

    expect(session.cloud_session_id).toBeDefined();
    expect(session.session_id).toBe(snapshot.session_id);
    expect(session.tenant_id).toBe(snapshot.tenant_id);
    expect(session.reconstructed_at).toBeDefined();
  });

  it("end-to-end: encrypt with mock public key, verify, reconstruct", async () => {
    const mock = createMockCloudVerifier(SIGNING_KEY);
    const { snapshot, artifactData } = createTestSnapshotWithArtifacts();
    const { encryptedChunks, encryptedArtifacts, manifest, ephemeralPublicKey } =
      encryptForCloud(snapshot, mock.keyPair.publicKey, artifactData);

    const verifyResult = await mock.verify({
      encryptedChunks,
      encryptedArtifacts,
      manifest,
      cloudPrivateKey: mock.keyPair.privateKey,
      desktopEphemeralPublicKey: ephemeralPublicKey,
      signingKey: SIGNING_KEY,
    });

    expect(verifyResult.valid).toBe(true);

    const session = mock.reconstruct(
      verifyResult.snapshot!,
      verifyResult.decryptedArtifacts!
    );

    expect(session.cloud_session_id).toBeDefined();
    expect(session.session_id).toBe(snapshot.session_id);
    expect(session.artifacts.size).toBe(2);
    expect(
      Buffer.from(session.artifacts.get("art-1")!).toString()
    ).toBe("artifact-one-content");
  });
});
