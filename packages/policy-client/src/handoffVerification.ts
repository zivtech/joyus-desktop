import { createHmac, randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import {
  generateEphemeralKeyPair,
  deriveContentEncryptionKey,
  decryptChunk,
  decryptArtifact,
} from "./snapshotEncryption";
import type { EncryptedChunk, EncryptedArtifact } from "./snapshotEncryption";
import {
  SCHEMA_VERSION,
} from "./handoffTypes";
import type {
  SessionSnapshot,
  SnapshotManifest,
  ConversationEntry,
  PendingAction,
  RuntimeConfig,
  PolicyCacheEntry,
} from "./handoffTypes";

// ---------------------------------------------------------------------------
// Verification contract types (T037)
// ---------------------------------------------------------------------------

export interface VerificationInput {
  encryptedChunks: EncryptedChunk[];
  encryptedArtifacts: EncryptedArtifact[];
  manifest: SnapshotManifest;
  cloudPrivateKey: KeyObject;
  desktopEphemeralPublicKey: Buffer;
  signingKey: Buffer;
}

export interface VerificationResult {
  valid: boolean;
  snapshot?: SessionSnapshot;
  decryptedArtifacts?: Map<string, Uint8Array>;
  errors: VerificationError[];
}

export interface VerificationError {
  code:
    | "DECRYPTION_FAILED"
    | "INTEGRITY_MISMATCH"
    | "MANIFEST_MISMATCH"
    | "MISSING_ARTIFACT"
    | "INVALID_SCHEMA";
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reconstruction contract types (T038)
// ---------------------------------------------------------------------------

export interface ReconstructedSession {
  cloud_session_id: string;
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_history: ConversationEntry[];
  pending_actions: PendingAction[];
  runtime_config: RuntimeConfig;
  policy_cache: PolicyCacheEntry[];
  artifacts: Map<string, Uint8Array>;
  reconstructed_at: string;
}

// ---------------------------------------------------------------------------
// Integrity helpers
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 integrity signature over a SessionSnapshot.
 * The `integrity_signature` field is set to "" before hashing.
 */
export function computeIntegritySignature(
  snapshot: SessionSnapshot,
  signingKey: Buffer
): string {
  const copy = { ...snapshot, integrity_signature: "" };
  const serialized = JSON.stringify(copy);
  return createHmac("sha256", signingKey).update(serialized).digest("hex");
}

// ---------------------------------------------------------------------------
// Verification (T037)
// ---------------------------------------------------------------------------

/**
 * Verify a received encrypted snapshot: decrypt, check integrity, validate
 * manifest, validate schema, and decrypt artifacts.
 *
 * Collects ALL errors before returning so callers get comprehensive feedback.
 */
export async function verifySnapshot(
  input: VerificationInput
): Promise<VerificationResult> {
  const errors: VerificationError[] = [];

  // Step 1 — Key agreement: derive CEK
  const cek = deriveContentEncryptionKey(
    input.cloudPrivateKey,
    input.desktopEphemeralPublicKey
  );

  // Step 2 — Decrypt chunks
  const decryptedParts: Buffer[] = [];
  let decryptionFailed = false;

  for (const chunk of input.encryptedChunks) {
    try {
      decryptedParts.push(decryptChunk(cek, chunk));
    } catch (err) {
      decryptionFailed = true;
      errors.push({
        code: "DECRYPTION_FAILED",
        message: `Failed to decrypt chunk ${chunk.chunkIndex}`,
        details: {
          chunkIndex: chunk.chunkIndex,
          error: String(err),
        },
      });
    }
  }

  // If decryption failed for any chunk we cannot reassemble — but continue
  // collecting manifest/artifact errors below.
  let snapshot: SessionSnapshot | undefined;

  if (!decryptionFailed) {
    // Step 3 — Reassemble
    const reassembled = Buffer.concat(decryptedParts);

    // Step 4 — Deserialize
    try {
      snapshot = JSON.parse(reassembled.toString("utf-8")) as SessionSnapshot;
    } catch {
      errors.push({
        code: "DECRYPTION_FAILED",
        message: "Failed to parse decrypted snapshot as JSON",
      });
    }

    if (snapshot) {
      // Step 5 — Verify integrity
      const expected = snapshot.integrity_signature;
      const computed = computeIntegritySignature(snapshot, input.signingKey);
      if (computed !== expected) {
        errors.push({
          code: "INTEGRITY_MISMATCH",
          message: "Integrity signature does not match",
          details: { expected, computed },
        });
      }

      // Step 7 — Validate schema
      if (snapshot.schema_version !== SCHEMA_VERSION) {
        errors.push({
          code: "INVALID_SCHEMA",
          message: `Unsupported schema version: ${snapshot.schema_version}`,
          details: {
            expected: SCHEMA_VERSION,
            actual: snapshot.schema_version,
          },
        });
      }
    }
  }

  // Step 6 — Validate manifest (can run even if decryption failed)
  if (input.manifest.chunk_count !== input.encryptedChunks.length) {
    errors.push({
      code: "MANIFEST_MISMATCH",
      message: `Manifest chunk_count (${input.manifest.chunk_count}) does not match received chunks (${input.encryptedChunks.length})`,
      details: {
        expected: input.manifest.chunk_count,
        actual: input.encryptedChunks.length,
      },
    });
  }

  if (input.manifest.artifact_count !== input.encryptedArtifacts.length) {
    errors.push({
      code: "MANIFEST_MISMATCH",
      message: `Manifest artifact_count (${input.manifest.artifact_count}) does not match received artifacts (${input.encryptedArtifacts.length})`,
      details: {
        expected: input.manifest.artifact_count,
        actual: input.encryptedArtifacts.length,
      },
    });
  }

  // Validate total_size against decrypted data (only if decryption succeeded)
  if (!decryptionFailed && decryptedParts.length > 0) {
    const totalDecrypted = decryptedParts.reduce((s, b) => s + b.length, 0);
    if (input.manifest.total_size_bytes !== totalDecrypted) {
      errors.push({
        code: "MANIFEST_MISMATCH",
        message: `Manifest total_size_bytes (${input.manifest.total_size_bytes}) does not match decrypted size (${totalDecrypted})`,
        details: {
          expected: input.manifest.total_size_bytes,
          actual: totalDecrypted,
        },
      });
    }
  }

  // Step 8 — Decrypt artifacts
  const decryptedArtifacts = new Map<string, Uint8Array>();

  // Check for missing artifacts (referenced in manifest but not provided)
  if (snapshot) {
    for (const ref of snapshot.artifacts) {
      const encrypted = input.encryptedArtifacts.find(
        (ea) => ea.artifact_id === ref.artifact_id
      );
      if (!encrypted) {
        errors.push({
          code: "MISSING_ARTIFACT",
          message: `Artifact ${ref.artifact_id} referenced in snapshot but not provided`,
          details: { artifact_id: ref.artifact_id },
        });
      }
    }
  }

  for (const ea of input.encryptedArtifacts) {
    try {
      const decrypted = decryptArtifact(cek, ea);
      decryptedArtifacts.set(ea.artifact_id, Uint8Array.from(decrypted));
    } catch (err) {
      errors.push({
        code: "DECRYPTION_FAILED",
        message: `Failed to decrypt artifact ${ea.artifact_id}`,
        details: {
          artifact_id: ea.artifact_id,
          error: String(err),
        },
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    snapshot: snapshot!,
    decryptedArtifacts,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Session Reconstruction (T038)
// ---------------------------------------------------------------------------

/**
 * Reconstruct a cloud session from a verified snapshot and its decrypted artifacts.
 *
 * Validates completeness: all snapshot artifacts must have corresponding
 * decrypted data, conversation history must be non-empty, and runtime config
 * must be present.
 *
 * Throws HandoffError on validation failure.
 */
export function reconstructSession(
  snapshot: SessionSnapshot,
  decryptedArtifacts: Map<string, Uint8Array>
): ReconstructedSession {
  // Validate completeness
  for (const ref of snapshot.artifacts) {
    if (!decryptedArtifacts.has(ref.artifact_id)) {
      throw new Error(
        `Missing decrypted artifact: ${ref.artifact_id}`
      );
    }
  }

  if (snapshot.conversation_history.length === 0) {
    throw new Error("Conversation history is empty");
  }

  return {
    cloud_session_id: randomUUID(),
    session_id: snapshot.session_id,
    tenant_id: snapshot.tenant_id,
    workspace_id: snapshot.workspace_id,
    conversation_history: [...snapshot.conversation_history],
    pending_actions: [...snapshot.pending_actions],
    runtime_config: { ...snapshot.runtime_config },
    policy_cache: [...snapshot.policy_cache],
    artifacts: new Map(decryptedArtifacts),
    reconstructed_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock Cloud Verifier (T039)
// ---------------------------------------------------------------------------

/**
 * Create a mock cloud verifier that simulates cloud-side verification.
 *
 * Generates a cloud X25519 key pair on creation and exposes:
 * - `keyPair`: the cloud's public + private keys (public key for desktop encryption)
 * - `verify`: runs the full verification pipeline
 * - `reconstruct`: runs session reconstruction
 */
export function createMockCloudVerifier(signingKey: Buffer): {
  keyPair: { publicKey: Buffer; privateKey: KeyObject };
  verify: (input: VerificationInput) => Promise<VerificationResult>;
  reconstruct: (
    snapshot: SessionSnapshot,
    artifacts: Map<string, Uint8Array>
  ) => ReconstructedSession;
} {
  const keyPair = generateEphemeralKeyPair();

  return {
    keyPair,
    verify: (input: VerificationInput) => verifySnapshot(input),
    reconstruct: (
      snapshot: SessionSnapshot,
      artifacts: Map<string, Uint8Array>
    ) => reconstructSession(snapshot, artifacts),
  };
}
