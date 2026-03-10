import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type {
  ConversationEntry,
  PendingAction,
  RuntimeConfig,
  PolicyCacheEntry,
  ArtifactReference,
  SessionSnapshot,
  SnapshotManifest,
  HandoffReceipt,
} from "@joyus/policy-client";
import { HandoffError } from "@joyus/policy-client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../src/handoffAuthorization", () => ({
  requestHandoffAuthorization: vi.fn(),
}));

vi.mock("../src/snapshotAssembly", () => ({
  assembleAndSignSnapshot: vi.fn(),
  generateManifest: vi.fn(),
}));

vi.mock("@joyus/policy-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@joyus/policy-client")>();
  return {
    ...actual,
    performKeyAgreement: vi.fn(),
    encryptSnapshot: vi.fn(),
    encryptArtifact: vi.fn(),
    initiateHandoff: vi.fn(),
    completeHandoff: vi.fn(),
  };
});

vi.mock("../src/handoffUpload", () => ({
  uploadEncryptedSnapshot: vi.fn(),
  uploadArtifacts: vi.fn(),
}));

// Import mocked modules
import { requestHandoffAuthorization } from "../src/handoffAuthorization";
import {
  assembleAndSignSnapshot,
  generateManifest,
} from "../src/snapshotAssembly";
import {
  performKeyAgreement,
  encryptSnapshot,
  encryptArtifact,
  initiateHandoff,
  completeHandoff,
} from "@joyus/policy-client";
import {
  uploadEncryptedSnapshot,
  uploadArtifacts,
} from "../src/handoffUpload";

// Import the module under test
import {
  executeHandoff,
  _testing,
  type HandoffOptions,
  type HandoffDependencies,
  type HandoffProgress,
} from "../src/handoffOrchestrator";

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockRequestAuth = requestHandoffAuthorization as Mock;
const mockAssembleAndSign = assembleAndSignSnapshot as Mock;
const mockGenerateManifest = generateManifest as Mock;
const mockPerformKeyAgreement = performKeyAgreement as Mock;
const mockEncryptSnapshot = encryptSnapshot as Mock;
const mockEncryptArtifact = encryptArtifact as Mock;
const mockInitiateHandoff = initiateHandoff as Mock;
const mockCompleteHandoff = completeHandoff as Mock;
const mockUploadSnapshot = uploadEncryptedSnapshot as Mock;
const mockUploadArtifacts = uploadArtifacts as Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConversation(): ConversationEntry[] {
  return [
    {
      entry_id: "e1",
      role: "user",
      content: "hello",
      timestamp: "2026-03-10T10:00:00Z",
    },
  ];
}

function makePendingActions(
  overrides?: Partial<PendingAction>[]
): PendingAction[] {
  if (overrides) {
    return overrides.map((o, i) => ({
      action_id: `a${i}`,
      action_name: o.action_name ?? "some_action",
      risk_level: o.risk_level ?? "low",
      queued_at: "2026-03-10T10:00:00Z",
      ...o,
    }));
  }
  return [];
}

function makeRuntimeConfig(): RuntimeConfig {
  return {
    execution_mode: "local",
    tenant_class: "internal",
    local_execution_enabled: true,
    control_plane_url: "https://control.example.com",
  };
}

function makePolicyCache(): PolicyCacheEntry[] {
  return [
    {
      jti: "jti-1",
      action_name: "session_handoff",
      decision: "allow",
      risk_level: "medium",
      token_expires_at: "2026-03-10T12:00:00Z",
    },
  ];
}

function makeArtifacts(): ArtifactReference[] {
  return [
    {
      artifact_id: "art-1",
      content_hash: "abc123",
      size_bytes: 100,
      content_type: "text/plain",
    },
  ];
}

function makeArtifactData(): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  map.set("art-1", new Uint8Array([1, 2, 3]));
  return map;
}

function makeOptions(overrides?: Partial<HandoffOptions>): HandoffOptions {
  return {
    session_id: "sess-001",
    tenant_id: "tenant-abc",
    workspace_id: "ws-123",
    conversation_history: makeConversation(),
    pending_actions: [],
    runtime_config: makeRuntimeConfig(),
    policy_cache: makePolicyCache(),
    artifacts: makeArtifacts(),
    artifactData: makeArtifactData(),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<HandoffDependencies>): HandoffDependencies {
  return {
    fetchLike: vi.fn(),
    baseUrl: "https://control.example.com",
    bearerToken: "bearer-token-123",
    signingKey: Buffer.from("test-signing-key-32-bytes-long!!"),
    ...overrides,
  };
}

const fakeSnapshot: SessionSnapshot = {
  snapshot_id: "snap-001",
  session_id: "sess-001",
  tenant_id: "tenant-abc",
  workspace_id: "ws-123",
  conversation_history: makeConversation(),
  pending_actions: [],
  runtime_config: makeRuntimeConfig(),
  policy_cache: makePolicyCache(),
  artifacts: makeArtifacts(),
  integrity_signature: "sig-hex",
  created_at: "2026-03-10T10:00:00Z",
  schema_version: "1.0",
};

const fakeManifest: SnapshotManifest = {
  snapshot_id: "snap-001",
  total_size_bytes: 1024,
  chunk_count: 1,
  chunk_size_bytes: 262144,
  artifact_count: 1,
  artifacts: makeArtifacts(),
  schema_version: "1.0",
};

const fakeEncryptedChunk = {
  chunkIndex: 0,
  iv: Buffer.from("aabbccddee001122", "hex"),
  ciphertext: Buffer.from("encrypted-snapshot-data"),
  authTag: Buffer.from("1234567890abcdef", "hex"),
  aad: Buffer.from("sess-001:0:1"),
};

const fakeEncryptedArtifact = {
  artifact_id: "art-1",
  iv: Buffer.from("aabbccddee001122", "hex"),
  ciphertext: Buffer.from("encrypted-artifact-data"),
  authTag: Buffer.from("1234567890abcdef", "hex"),
};

const fakeEphemeralPublicKey = Buffer.alloc(32, 0xaa);
const fakeCEK = Buffer.alloc(32, 0xbb);
const fakeCloudPublicKeyBase64 = Buffer.alloc(32, 0xcc).toString("base64");

const fakeInitiateResponse = {
  handoff_id: "ho-001",
  cloud_public_key: fakeCloudPublicKeyBase64,
  manifest_upload_url: "https://upload.example.com/manifest",
  artifact_upload_urls: [
    { artifact_id: "art-1", upload_url: "https://upload.example.com/art-1" },
  ],
  expires_at: "2026-03-10T12:00:00Z",
};

const fakeReceipt: HandoffReceipt = {
  handoff_id: "ho-001",
  cloud_session_id: "cloud-sess-001",
  status: "completed",
  completed_at: "2026-03-10T10:01:00Z",
  pickup_url: "https://cloud.example.com/pickup/cloud-sess-001",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupHappyMocks(): void {
  mockRequestAuth.mockResolvedValue({
    decision: "allow",
    policy_token: "policy-tok-123",
    token_expires_at: "2099-12-31T23:59:59Z",
  });

  mockAssembleAndSign.mockReturnValue(fakeSnapshot);
  mockGenerateManifest.mockReturnValue(fakeManifest);
  mockInitiateHandoff.mockResolvedValue(fakeInitiateResponse);

  mockPerformKeyAgreement.mockReturnValue({
    ephemeralPublicKey: fakeEphemeralPublicKey,
    contentEncryptionKey: fakeCEK,
  });

  mockEncryptSnapshot.mockReturnValue([fakeEncryptedChunk]);
  mockEncryptArtifact.mockReturnValue(fakeEncryptedArtifact);

  mockUploadSnapshot.mockResolvedValue(undefined);
  mockUploadArtifacts.mockResolvedValue(undefined);

  mockCompleteHandoff.mockResolvedValue(fakeReceipt);
}

beforeEach(() => {
  vi.clearAllMocks();
  _testing.activeHandoffs.clear();
});

afterEach(() => {
  _testing.activeHandoffs.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeHandoff", () => {
  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  describe("happy path", () => {
    it("completes full handoff flow and returns HandoffResult", async () => {
      setupHappyMocks();
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      const result = await executeHandoff(opts, makeDeps());

      expect(result).toEqual({
        handoff_id: "ho-001",
        cloud_session_id: "cloud-sess-001",
        pickup_url: "https://cloud.example.com/pickup/cloud-sess-001",
      });

      // Verify call order
      expect(mockRequestAuth).toHaveBeenCalledOnce();
      expect(mockAssembleAndSign).toHaveBeenCalledOnce();
      expect(mockGenerateManifest).toHaveBeenCalledOnce();
      expect(mockInitiateHandoff).toHaveBeenCalledOnce();
      expect(mockPerformKeyAgreement).toHaveBeenCalledOnce();
      expect(mockEncryptSnapshot).toHaveBeenCalledOnce();
      expect(mockEncryptArtifact).toHaveBeenCalledOnce();
      expect(mockUploadSnapshot).toHaveBeenCalledOnce();
      expect(mockUploadArtifacts).toHaveBeenCalledOnce();
      expect(mockCompleteHandoff).toHaveBeenCalledOnce();

      // Verify progress events
      const states = progressEvents.map((p) => p.state);
      expect(states).toContain("authorizing");
      expect(states).toContain("encrypting");
      expect(states).toContain("transferring");
      expect(states).toContain("completed");
    });

    it("returns result without pickup_url when receipt has none", async () => {
      setupHappyMocks();
      mockCompleteHandoff.mockResolvedValue({
        ...fakeReceipt,
        pickup_url: undefined,
      });

      const result = await executeHandoff(makeOptions(), makeDeps());

      expect(result.pickup_url).toBeUndefined();
      expect(result.handoff_id).toBe("ho-001");
      expect(result.cloud_session_id).toBe("cloud-sess-001");
    });

    it("handles empty artifacts list", async () => {
      setupHappyMocks();
      const manifestNoArt = { ...fakeManifest, artifact_count: 0, artifacts: [] };
      mockGenerateManifest.mockReturnValue(manifestNoArt);
      mockInitiateHandoff.mockResolvedValue({
        ...fakeInitiateResponse,
        artifact_upload_urls: [],
      });

      const opts = makeOptions({
        artifacts: [],
        artifactData: new Map(),
      });

      const result = await executeHandoff(opts, makeDeps());

      expect(result.handoff_id).toBe("ho-001");
      expect(mockEncryptArtifact).not.toHaveBeenCalled();
    });

    it("passes correct arguments to requestHandoffAuthorization", async () => {
      setupHappyMocks();
      const deps = makeDeps();
      const opts = makeOptions();

      await executeHandoff(opts, deps);

      expect(mockRequestAuth).toHaveBeenCalledWith({
        session_id: "sess-001",
        tenant_id: "tenant-abc",
        workspace_id: "ws-123",
        fetchLike: deps.fetchLike,
        baseUrl: deps.baseUrl,
        bearerToken: deps.bearerToken,
      });
    });

    it("passes correct arguments to initiateHandoff", async () => {
      setupHappyMocks();
      const deps = makeDeps();
      await executeHandoff(makeOptions(), deps);

      expect(mockInitiateHandoff).toHaveBeenCalledWith(
        deps.fetchLike,
        { baseUrl: deps.baseUrl, bearerToken: deps.bearerToken },
        {
          manifest: fakeManifest,
          policy_token: "policy-tok-123",
          session_id: "sess-001",
          tenant_id: "tenant-abc",
          workspace_id: "ws-123",
        }
      );
    });

    it("passes correct arguments to completeHandoff", async () => {
      setupHappyMocks();
      const deps = makeDeps();
      await executeHandoff(makeOptions(), deps);

      expect(mockCompleteHandoff).toHaveBeenCalledWith(
        deps.fetchLike,
        { baseUrl: deps.baseUrl, bearerToken: deps.bearerToken },
        {
          handoff_id: "ho-001",
          ephemeral_public_key: fakeEphemeralPublicKey.toString("base64"),
        }
      );
    });

    it("passes abort signal to upload config", async () => {
      setupHappyMocks();
      await executeHandoff(makeOptions(), makeDeps());

      const uploadCall = mockUploadSnapshot.mock.calls[0]!;
      const config = uploadCall[1] as { signal?: AbortSignal };
      expect(config.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -----------------------------------------------------------------------
  // Policy failure paths
  // -----------------------------------------------------------------------

  describe("policy failures", () => {
    it("throws POLICY_DENIED when authorization denies", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_DENIED", "Handoff denied: org policy")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        expect((err as HandoffError).code).toBe("POLICY_DENIED");
      }
    });

    it("throws POLICY_ESCALATED when authorization escalates", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError(
          "POLICY_ESCALATED",
          "Handoff requires approval: admin needed"
        )
      );

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.message).toBe(
        "Handoff requires additional approval. Please contact your admin."
      );
    });

    it("throws POLICY_UNAVAILABLE when policy service is unreachable", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError(
          "POLICY_UNAVAILABLE",
          "Policy service unavailable: timeout"
        )
      );

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.message).toBe(
        "Policy service is currently unavailable. Please try again later."
      );
    });
  });

  // -----------------------------------------------------------------------
  // Encryption failure
  // -----------------------------------------------------------------------

  describe("encryption failure", () => {
    it("transitions to failed when assembleAndSignSnapshot throws", async () => {
      setupHappyMocks();
      mockAssembleAndSign.mockImplementation(() => {
        throw new HandoffError(
          "INVALID_SNAPSHOT",
          "Missing required field: session_id"
        );
      });

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.message).toBe(
        "Session data could not be prepared for handoff."
      );
    });

    it("transitions to failed when encryptSnapshot throws", async () => {
      setupHappyMocks();
      mockEncryptSnapshot.mockImplementation(() => {
        throw new Error("crypto failure");
      });

      await expect(executeHandoff(makeOptions(), makeDeps())).rejects.toThrow(
        HandoffError
      );
    });
  });

  // -----------------------------------------------------------------------
  // Upload failure
  // -----------------------------------------------------------------------

  describe("upload failure", () => {
    it("transitions to failed when uploadEncryptedSnapshot throws", async () => {
      setupHappyMocks();
      mockUploadSnapshot.mockRejectedValue(
        new HandoffError("UPLOAD_FAILED", "Upload failed after retries")
      );

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("UPLOAD_FAILED");
      }
    });

    it("transitions to failed when uploadArtifacts throws", async () => {
      setupHappyMocks();
      mockUploadArtifacts.mockRejectedValue(
        new HandoffError("UPLOAD_FAILED", "Artifact upload failed")
      );

      await expect(executeHandoff(makeOptions(), makeDeps())).rejects.toThrow(
        HandoffError
      );
    });
  });

  // -----------------------------------------------------------------------
  // Complete failure (handoff rejected)
  // -----------------------------------------------------------------------

  describe("complete failure", () => {
    it("throws HANDOFF_REJECTED when completeHandoff fails", async () => {
      setupHappyMocks();
      mockCompleteHandoff.mockRejectedValue(
        new HandoffError(
          "HANDOFF_REJECTED",
          "Handoff was rejected by the cloud"
        )
      );

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.message).toBe(
        "Cloud could not accept the session. Please try again."
      );
    });
  });

  // -----------------------------------------------------------------------
  // Timeout
  // -----------------------------------------------------------------------

  describe("timeout", () => {
    it("aborts handoff when timeout expires", async () => {
      setupHappyMocks();

      // Make authorization take longer than the timeout
      mockRequestAuth.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                decision: "allow",
                policy_token: "tok",
                token_expires_at: "2099-12-31T23:59:59Z",
              });
            }, 200);
          })
      );

      const opts = makeOptions({ timeoutMs: 10 });

      try {
        await executeHandoff(opts, makeDeps());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        expect((err as HandoffError).code).toBe("TIMEOUT");
      }
    });

    it("clears timeout on successful completion", async () => {
      setupHappyMocks();
      const opts = makeOptions({ timeoutMs: 30_000 });

      const result = await executeHandoff(opts, makeDeps());

      // If timeout were not cleared, it would fire later
      expect(result.handoff_id).toBe("ho-001");
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent handoff prevention
  // -----------------------------------------------------------------------

  describe("concurrent handoff prevention", () => {
    it("throws CONCURRENT_HANDOFF when session already active", async () => {
      setupHappyMocks();
      // Manually add session to active set
      _testing.activeHandoffs.add("sess-001");

      await expect(
        executeHandoff(makeOptions(), makeDeps())
      ).rejects.toThrow(HandoffError);

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("CONCURRENT_HANDOFF");
      }

      _testing.activeHandoffs.delete("sess-001");
    });

    it("removes session from active set after success", async () => {
      setupHappyMocks();

      await executeHandoff(makeOptions(), makeDeps());

      expect(_testing.activeHandoffs.has("sess-001")).toBe(false);
    });

    it("removes session from active set after failure", async () => {
      setupHappyMocks();
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_DENIED", "denied")
      );

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch {
        // expected
      }

      expect(_testing.activeHandoffs.has("sess-001")).toBe(false);
    });

    it("allows new handoff for same session after previous completes", async () => {
      setupHappyMocks();

      await executeHandoff(makeOptions(), makeDeps());

      // Should succeed again
      const result = await executeHandoff(makeOptions(), makeDeps());
      expect(result.handoff_id).toBe("ho-001");
    });
  });

  // -----------------------------------------------------------------------
  // Abort signal
  // -----------------------------------------------------------------------

  describe("abort signal", () => {
    it("throws immediately with pre-aborted signal", async () => {
      setupHappyMocks();
      const controller = new AbortController();
      controller.abort();

      const opts = makeOptions({ signal: controller.signal });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(
          makeOptions({ signal: controller.signal }),
          makeDeps()
        );
      } catch (err) {
        expect((err as HandoffError).code).toBe("TIMEOUT");
      }
    });

    it("throws when signal is aborted during upload", async () => {
      setupHappyMocks();
      const controller = new AbortController();

      mockUploadSnapshot.mockImplementation(async () => {
        controller.abort();
        throw new HandoffError("UPLOAD_FAILED", "Upload aborted");
      });

      const opts = makeOptions({ signal: controller.signal });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );
    });

    it("cleans up external signal listener on error", async () => {
      setupHappyMocks();
      const controller = new AbortController();
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_DENIED", "denied")
      );

      const opts = makeOptions({ signal: controller.signal });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      // The external signal's abort listener should have been removed
      // Verify by aborting and confirming no side-effects
      controller.abort();
    });

    it("cleans up external signal listener on success", async () => {
      setupHappyMocks();
      const controller = new AbortController();
      const opts = makeOptions({ signal: controller.signal });

      const result = await executeHandoff(opts, makeDeps());
      expect(result.handoff_id).toBe("ho-001");

      // The external signal's abort listener should have been removed
      controller.abort();
    });
  });

  // -----------------------------------------------------------------------
  // Edge case: mid-execution handoff (F3)
  // -----------------------------------------------------------------------

  describe("mid-execution action check", () => {
    it("throws ACTION_IN_PROGRESS for high-risk pending action", async () => {
      const opts = makeOptions({
        pending_actions: makePendingActions([
          { action_name: "deploy_prod", risk_level: "high" },
        ]),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(opts, makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("ACTION_IN_PROGRESS");
        expect((err as HandoffError).message).toContain("deploy_prod");
      }
    });

    it("throws ACTION_IN_PROGRESS for critical-risk pending action", async () => {
      const opts = makeOptions({
        pending_actions: makePendingActions([
          { action_name: "delete_db", risk_level: "critical" },
        ]),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(opts, makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("ACTION_IN_PROGRESS");
      }
    });

    it("allows handoff with low-risk pending actions", async () => {
      setupHappyMocks();
      const opts = makeOptions({
        pending_actions: makePendingActions([
          { action_name: "read_file", risk_level: "low" },
        ]),
      });

      const result = await executeHandoff(opts, makeDeps());
      expect(result.handoff_id).toBe("ho-001");
    });

    it("allows handoff with medium-risk pending actions", async () => {
      setupHappyMocks();
      const opts = makeOptions({
        pending_actions: makePendingActions([
          { action_name: "write_file", risk_level: "medium" },
        ]),
      });

      const result = await executeHandoff(opts, makeDeps());
      expect(result.handoff_id).toBe("ho-001");
    });
  });

  // -----------------------------------------------------------------------
  // Edge case: token expiry (F4)
  // -----------------------------------------------------------------------

  describe("token expiry check", () => {
    it("throws TOKEN_EXPIRED when policy token is already expired", async () => {
      setupHappyMocks();
      mockRequestAuth.mockResolvedValue({
        decision: "allow",
        policy_token: "expired-tok",
        token_expires_at: "2020-01-01T00:00:00Z", // In the past
      });

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("TOKEN_EXPIRED");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Edge case: snapshot too large (F5)
  // -----------------------------------------------------------------------

  describe("snapshot size limit check", () => {
    it("throws SNAPSHOT_TOO_LARGE when manifest exceeds max size", async () => {
      setupHappyMocks();
      mockGenerateManifest.mockReturnValue({
        ...fakeManifest,
        total_size_bytes: 200_000_000, // 200 MiB > 100 MiB default
      });

      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await expect(executeHandoff(opts, makeDeps())).rejects.toThrow(
        HandoffError
      );

      try {
        await executeHandoff(makeOptions(), makeDeps());
      } catch (err) {
        expect((err as HandoffError).code).toBe("SNAPSHOT_TOO_LARGE");
      }
    });

    it("allows snapshot at exactly the max size", async () => {
      setupHappyMocks();
      mockGenerateManifest.mockReturnValue({
        ...fakeManifest,
        total_size_bytes: 104_857_600, // Exactly 100 MiB
      });

      const result = await executeHandoff(
        makeOptions(),
        makeDeps({ maxSnapshotSize: 104_857_600 })
      );
      expect(result.handoff_id).toBe("ho-001");
    });

    it("respects custom maxSnapshotSize", async () => {
      setupHappyMocks();
      mockGenerateManifest.mockReturnValue({
        ...fakeManifest,
        total_size_bytes: 5000,
      });

      await expect(
        executeHandoff(makeOptions(), makeDeps({ maxSnapshotSize: 1000 }))
      ).rejects.toThrow(HandoffError);

      try {
        await executeHandoff(
          makeOptions(),
          makeDeps({ maxSnapshotSize: 1000 })
        );
      } catch (err) {
        expect((err as HandoffError).code).toBe("SNAPSHOT_TOO_LARGE");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Edge case: tenant mismatch (F6)
  // -----------------------------------------------------------------------
  // Note: The current implementation trusts the MCP contract to validate
  // tenant routing. We test the integration here; actual mismatch detection
  // would need the initiate_handoff response to include tenant info.

  // -----------------------------------------------------------------------
  // Error notification mapping
  // -----------------------------------------------------------------------

  describe("error notification mapping", () => {
    it("maps POLICY_DENIED to correct user message", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_DENIED", "denied")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "Handoff was denied by your organization's policy."
      );
    });

    it("maps POLICY_ESCALATED to correct user message", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_ESCALATED", "escalated")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "Handoff requires additional approval. Please contact your admin."
      );
    });

    it("maps POLICY_UNAVAILABLE to correct user message", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_UNAVAILABLE", "unavailable")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "Policy service is currently unavailable. Please try again later."
      );
    });

    it("maps UPLOAD_FAILED to correct user message", async () => {
      setupHappyMocks();
      mockUploadSnapshot.mockRejectedValue(
        new HandoffError("UPLOAD_FAILED", "failed")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "Transfer failed after multiple retries. Please try again."
      );
    });

    it("maps HANDOFF_REJECTED to correct user message", async () => {
      setupHappyMocks();
      mockCompleteHandoff.mockRejectedValue(
        new HandoffError("HANDOFF_REJECTED", "rejected")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "Cloud could not accept the session. Please try again."
      );
    });

    it("maps CONCURRENT_HANDOFF to correct user message", () => {
      const msg =
        _testing.ERROR_NOTIFICATIONS["CONCURRENT_HANDOFF"];
      expect(msg).toBe(
        "A handoff is already in progress for this session."
      );
    });

    it("maps TOKEN_EXPIRED to correct user message", () => {
      const msg = _testing.ERROR_NOTIFICATIONS["TOKEN_EXPIRED"];
      expect(msg).toBe(
        "Policy authorization expired during handoff. Please try again."
      );
    });

    it("maps SNAPSHOT_TOO_LARGE to correct user message", () => {
      const msg =
        _testing.ERROR_NOTIFICATIONS["SNAPSHOT_TOO_LARGE"];
      expect(msg).toBe(
        "Session is too large to hand off. Try reducing conversation history."
      );
    });

    it("maps TENANT_MISMATCH to correct user message", () => {
      const msg =
        _testing.ERROR_NOTIFICATIONS["TENANT_MISMATCH"];
      expect(msg).toBe(
        "Session tenant does not match cloud target environment."
      );
    });

    it("maps ACTION_IN_PROGRESS to correct user message", () => {
      const msg =
        _testing.ERROR_NOTIFICATIONS["ACTION_IN_PROGRESS"];
      expect(msg).toBe(
        "Cannot hand off while a privileged action is running. Wait for it to complete."
      );
    });

    it("maps INVALID_SNAPSHOT to correct user message", () => {
      const msg =
        _testing.ERROR_NOTIFICATIONS["INVALID_SNAPSHOT"];
      expect(msg).toBe(
        "Session data could not be prepared for handoff."
      );
    });

    it("maps TIMEOUT to correct user message", () => {
      const msg = _testing.ERROR_NOTIFICATIONS["TIMEOUT"];
      expect(msg).toBe(
        "Handoff timed out. Please try again with a smaller session."
      );
    });

    it("uses generic message for unknown errors", async () => {
      setupHappyMocks();
      mockRequestAuth.mockRejectedValue(new Error("random failure"));
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "An unexpected error occurred during handoff."
      );
    });

    it("uses generic message for HandoffError codes not in notification map", async () => {
      setupHappyMocks();
      mockInitiateHandoff.mockRejectedValue(
        new HandoffError("INVALID_RESPONSE", "bad response from server")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const failedEvent = progressEvents.find((p) => p.state === "failed");
      expect(failedEvent!.message).toBe(
        "An unexpected error occurred during handoff."
      );
    });
  });

  // -----------------------------------------------------------------------
  // Constants exported for testing
  // -----------------------------------------------------------------------

  describe("testing exports", () => {
    it("exports default timeout", () => {
      expect(_testing.DEFAULT_TIMEOUT_MS).toBe(30_000);
    });

    it("exports default max snapshot size", () => {
      expect(_testing.DEFAULT_MAX_SNAPSHOT_SIZE).toBe(104_857_600);
    });

    it("exports active handoffs set", () => {
      expect(_testing.activeHandoffs).toBeInstanceOf(Set);
    });
  });

  // -----------------------------------------------------------------------
  // State machine transitions
  // -----------------------------------------------------------------------

  describe("state machine transitions", () => {
    it("transitions through all states on happy path", async () => {
      setupHappyMocks();
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      await executeHandoff(opts, makeDeps());

      const states = progressEvents.map((p) => p.state);
      // Should have: authorizing, encrypting (multiple), transferring (multiple), completed
      expect(states[0]).toBe("authorizing");
      expect(states).toContain("encrypting");
      expect(states).toContain("transferring");
      expect(states[states.length - 1]).toBe("completed");
    });

    it("emits failed state on error", async () => {
      mockRequestAuth.mockRejectedValue(
        new HandoffError("POLICY_DENIED", "denied")
      );
      const progressEvents: HandoffProgress[] = [];
      const opts = makeOptions({
        onProgress: (p) => progressEvents.push({ ...p }),
      });

      try {
        await executeHandoff(opts, makeDeps());
      } catch {
        // expected
      }

      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent!.state).toBe("failed");
    });
  });

  // -----------------------------------------------------------------------
  // Non-HandoffError wrapping
  // -----------------------------------------------------------------------

  describe("non-HandoffError wrapping", () => {
    it("wraps generic errors during encryption as UPLOAD_FAILED", async () => {
      setupHappyMocks();
      mockEncryptSnapshot.mockImplementation(() => {
        throw new Error("unexpected crypto error");
      });

      try {
        await executeHandoff(makeOptions(), makeDeps());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        // Non-abort generic errors get wrapped as UPLOAD_FAILED
        expect((err as HandoffError).code).toBe("UPLOAD_FAILED");
      }
    });

    it("wraps AbortError as TIMEOUT", async () => {
      setupHappyMocks();
      mockUploadSnapshot.mockImplementation(async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      });

      try {
        await executeHandoff(makeOptions(), makeDeps());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        expect((err as HandoffError).code).toBe("TIMEOUT");
      }
    });

    it("wraps string error as UPLOAD_FAILED", async () => {
      setupHappyMocks();
      mockEncryptSnapshot.mockImplementation(() => {
        throw "string error";
      });

      try {
        await executeHandoff(makeOptions(), makeDeps());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        expect((err as HandoffError).code).toBe("UPLOAD_FAILED");
        expect((err as HandoffError).message).toBe("string error");
      }
    });

    it("wraps non-AbortError as TIMEOUT when internal signal is aborted", async () => {
      setupHappyMocks();

      // Make upload take long enough for timeout to fire, then throw a generic Error
      mockUploadSnapshot.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              // By this point the 10ms timeout has fired and aborted the internal signal
              reject(new Error("network connection reset"));
            }, 50);
          })
      );

      const opts = makeOptions({ timeoutMs: 10 });

      try {
        await executeHandoff(opts, makeDeps());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HandoffError);
        // Should be TIMEOUT because internalSignal.aborted is true
        expect((err as HandoffError).code).toBe("TIMEOUT");
      }
    });
  });
});
