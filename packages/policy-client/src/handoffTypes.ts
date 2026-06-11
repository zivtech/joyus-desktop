// Re-export RiskLevel from policyClient for convenience
import type { RiskLevel } from "./policyClient";

export type { RiskLevel };

export type HandoffState = "initiated" | "authorizing" | "encrypting" | "transferring" | "completed" | "failed";

export type PolicyOutcomeForHandoff = "allow" | "deny" | "escalate";

// All snapshot-related interfaces use readonly fields for immutability

export interface ConversationEntry {
  readonly entry_id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export interface PendingAction {
  readonly action_id: string;
  readonly action_name: string;
  readonly risk_level: RiskLevel;
  readonly target?: string;
  readonly details?: Record<string, unknown>;
  readonly queued_at: string;
}

export interface RuntimeConfig {
  readonly execution_mode: "local" | "remote";
  readonly tenant_class: "internal" | "external";
  readonly local_execution_enabled: boolean;
  readonly control_plane_url: string;
}

export interface PolicyCacheEntry {
  readonly jti: string;
  readonly action_name: string;
  readonly decision: PolicyOutcomeForHandoff;
  readonly risk_level: RiskLevel;
  readonly token_expires_at: string;
}

export interface ArtifactReference {
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly size_bytes: number;
  readonly content_type: string;
  readonly label?: string;
}

export interface SessionSnapshot {
  readonly snapshot_id: string;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly conversation_history: readonly ConversationEntry[];
  readonly pending_actions: readonly PendingAction[];
  readonly runtime_config: RuntimeConfig;
  readonly policy_cache: readonly PolicyCacheEntry[];
  readonly artifacts: readonly ArtifactReference[];
  readonly integrity_signature: string;
  readonly created_at: string;
  readonly schema_version: string;
}

export interface SnapshotManifest {
  readonly snapshot_id: string;
  readonly total_size_bytes: number;
  readonly chunk_count: number;
  readonly chunk_size_bytes: number;
  readonly artifact_count: number;
  readonly artifacts: readonly ArtifactReference[];
  readonly schema_version: string;
}

export interface HandoffRequest {
  readonly handoff_id: string;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly policy_token: string;
  readonly manifest: SnapshotManifest;
  readonly initiated_at: string;
}

export interface HandoffReceipt {
  readonly handoff_id: string;
  readonly cloud_session_id: string;
  readonly status: "completed" | "failed";
  readonly pickup_url?: string;
  readonly completed_at: string;
  readonly error?: string;
}

export type HandoffErrorCode =
  | "INVALID_TRANSITION"
  | "INVALID_SNAPSHOT"
  | "POLICY_DENIED"
  | "POLICY_ESCALATED"
  | "POLICY_UNAVAILABLE"
  | "UPLOAD_FAILED"
  | "UPLOAD_CONFIG_MISMATCH"
  | "HANDOFF_REJECTED"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "CONCURRENT_HANDOFF"
  | "TOKEN_EXPIRED"
  | "SNAPSHOT_TOO_LARGE"
  | "TENANT_MISMATCH"
  | "ACTION_IN_PROGRESS";

export class HandoffError extends Error {
  readonly code: HandoffErrorCode;

  constructor(code: HandoffErrorCode, message: string) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
  }
}

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB
export const SCHEMA_VERSION = "1.0";
