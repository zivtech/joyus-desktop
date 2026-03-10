import { randomUUID, createHmac } from "node:crypto";
import type {
  SessionSnapshot,
  SnapshotManifest,
  ArtifactReference,
  ConversationEntry,
  PendingAction,
  RuntimeConfig,
  PolicyCacheEntry,
} from "@joyus/policy-client";
import { HandoffError, DEFAULT_CHUNK_SIZE, SCHEMA_VERSION } from "@joyus/policy-client";

export interface SnapshotInput {
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_history: ConversationEntry[];
  pending_actions: PendingAction[];
  runtime_config: RuntimeConfig;
  policy_cache: PolicyCacheEntry[];
  artifacts: ArtifactReference[];
}

const CHUNK_ALIGNMENT = 256 * 1024; // 256 KiB

export function alignChunkSize(requestedSize: number): number {
  const minSize = CHUNK_ALIGNMENT;
  const size = Math.max(requestedSize, minSize);
  return Math.ceil(size / CHUNK_ALIGNMENT) * CHUNK_ALIGNMENT;
}

export function validateSnapshot(snapshot: SessionSnapshot): void {
  const requiredStrings: Array<[keyof SessionSnapshot, string]> = [
    ["snapshot_id", "snapshot_id"],
    ["session_id", "session_id"],
    ["tenant_id", "tenant_id"],
    ["workspace_id", "workspace_id"],
    ["schema_version", "schema_version"],
    ["created_at", "created_at"],
  ];

  for (const [field, label] of requiredStrings) {
    const value = snapshot[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new HandoffError("INVALID_SNAPSHOT", `Missing or empty required field: ${label}`);
    }
  }

  if (snapshot.schema_version !== SCHEMA_VERSION) {
    throw new HandoffError(
      "INVALID_SNAPSHOT",
      `Unsupported schema version: ${snapshot.schema_version} (expected ${SCHEMA_VERSION})`
    );
  }

  if (!Array.isArray(snapshot.conversation_history) || snapshot.conversation_history.length === 0) {
    throw new HandoffError(
      "INVALID_SNAPSHOT",
      "conversation_history must be a non-empty array"
    );
  }

  const rc = snapshot.runtime_config;
  if (
    !rc ||
    typeof rc.execution_mode !== "string" ||
    typeof rc.tenant_class !== "string" ||
    typeof rc.local_execution_enabled !== "boolean" ||
    typeof rc.control_plane_url !== "string" ||
    !rc.control_plane_url.trim()
  ) {
    throw new HandoffError(
      "INVALID_SNAPSHOT",
      "runtime_config is missing or has invalid fields"
    );
  }
}

export function assembleSnapshot(input: SnapshotInput): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    snapshot_id: randomUUID(),
    session_id: input.session_id,
    tenant_id: input.tenant_id,
    workspace_id: input.workspace_id,
    conversation_history: input.conversation_history,
    pending_actions: input.pending_actions,
    runtime_config: input.runtime_config,
    policy_cache: input.policy_cache,
    artifacts: input.artifacts,
    integrity_signature: "",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };

  validateSnapshot(snapshot);
  return snapshot;
}

export function generateManifest(
  snapshot: SessionSnapshot,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): SnapshotManifest {
  const effectiveChunkSize = alignChunkSize(chunkSize);
  const serialized = JSON.stringify(snapshot);
  const totalSizeBytes = Buffer.byteLength(serialized, "utf-8");
  const chunkCount = Math.ceil(totalSizeBytes / effectiveChunkSize);

  return {
    snapshot_id: snapshot.snapshot_id,
    total_size_bytes: totalSizeBytes,
    chunk_count: chunkCount,
    chunk_size_bytes: effectiveChunkSize,
    artifact_count: snapshot.artifacts.length,
    artifacts: snapshot.artifacts,
    schema_version: snapshot.schema_version,
  };
}

export function computeIntegritySignature(
  snapshot: SessionSnapshot,
  signingKey: Buffer
): string {
  const forSigning: SessionSnapshot = {
    ...snapshot,
    integrity_signature: "",
  };
  const serialized = JSON.stringify(forSigning);
  const hmac = createHmac("sha256", signingKey);
  hmac.update(serialized);
  return hmac.digest("hex");
}

export function assembleAndSignSnapshot(
  input: SnapshotInput,
  signingKey: Buffer
): SessionSnapshot {
  const snapshot = assembleSnapshot(input);
  const signature = computeIntegritySignature(snapshot, signingKey);
  return {
    ...snapshot,
    integrity_signature: signature,
  };
}
