import type {
  ConversationEntry,
  PendingAction,
  RuntimeConfig,
  PolicyCacheEntry,
  ArtifactReference,
  HandoffState,
  SessionSnapshot,
  SnapshotManifest,
  FetchLike,
  HandoffReceipt,
  ArtifactUploadEntry,
} from "@joyus/policy-client";
import {
  HandoffError,
  HandoffStateMachine,
  performKeyAgreement,
  encryptSnapshot,
  encryptArtifact,
  initiateHandoff,
  completeHandoff,
} from "@joyus/policy-client";
import type { EncryptedChunk, EncryptedArtifact } from "@joyus/policy-client";
import { assembleAndSignSnapshot, generateManifest } from "./snapshotAssembly";
import { requestHandoffAuthorization, type HandoffAuthResult } from "./handoffAuthorization";
import { uploadEncryptedSnapshot, uploadArtifacts } from "./handoffUpload";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface HandoffOptions {
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_history: ConversationEntry[];
  pending_actions: PendingAction[];
  runtime_config: RuntimeConfig;
  policy_cache: PolicyCacheEntry[];
  artifacts: ArtifactReference[];
  artifactData: Map<string, Uint8Array>;
  timeoutMs?: number;
  onProgress?: (progress: HandoffProgress) => void;
  signal?: AbortSignal;
}

export interface HandoffProgress {
  state: HandoffState;
  message: string;
  percentComplete: number;
}

export interface HandoffResult {
  handoff_id: string;
  cloud_session_id: string;
  pickup_url?: string;
}

export interface HandoffDependencies {
  fetchLike: FetchLike;
  baseUrl: string;
  bearerToken: string;
  signingKey: Buffer;
  maxSnapshotSize?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SNAPSHOT_SIZE = 104_857_600; // 100 MiB

const ERROR_NOTIFICATIONS: Record<string, string> = {
  POLICY_DENIED: "Handoff was denied by your organization's policy.",
  POLICY_ESCALATED:
    "Handoff requires additional approval. Please contact your admin.",
  POLICY_UNAVAILABLE:
    "Policy service is currently unavailable. Please try again later.",
  INVALID_SNAPSHOT: "Session data could not be prepared for handoff.",
  UPLOAD_FAILED: "Transfer failed after multiple retries. Please try again.",
  HANDOFF_REJECTED:
    "Cloud could not accept the session. Please try again.",
  TIMEOUT: "Handoff timed out. Please try again with a smaller session.",
  CONCURRENT_HANDOFF: "A handoff is already in progress for this session.",
  TOKEN_EXPIRED:
    "Policy authorization expired during handoff. Please try again.",
  SNAPSHOT_TOO_LARGE:
    "Session is too large to hand off. Try reducing conversation history.",
  TENANT_MISMATCH:
    "Session tenant does not match cloud target environment.",
  ACTION_IN_PROGRESS:
    "Cannot hand off while a privileged action is running. Wait for it to complete.",
};

// ---------------------------------------------------------------------------
// Concurrent handoff prevention
// ---------------------------------------------------------------------------

const activeHandoffs = new Set<string>();

// ---------------------------------------------------------------------------
// Helper: emit progress
// ---------------------------------------------------------------------------

function emitProgress(
  onProgress: ((progress: HandoffProgress) => void) | undefined,
  state: HandoffState,
  message: string,
  percentComplete: number
): void {
  onProgress?.({ state, message, percentComplete });
}

// ---------------------------------------------------------------------------
// Helper: check abort signal
// ---------------------------------------------------------------------------

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new HandoffError("TIMEOUT", "Handoff was aborted");
  }
}

function findMissingArtifactPayloadIds(
  artifacts: readonly ArtifactReference[],
  artifactData: ReadonlyMap<string, Uint8Array>,
): string[] {
  const missing: string[] = [];

  for (const artifact of artifacts) {
    if (!artifactData.has(artifact.artifact_id)) {
      missing.push(artifact.artifact_id);
    }
  }

  return missing;
}

function resolveArtifactUploadUrls(
  artifacts: readonly EncryptedArtifact[],
  uploadEntries: readonly ArtifactUploadEntry[],
): string[] {
  const byArtifactId = new Map<string, string>();

  for (const entry of uploadEntries) {
    byArtifactId.set(entry.artifact_id, entry.upload_url);
  }

  const missing: string[] = [];
  const urls = artifacts.map((artifact) => {
    const uploadUrl = byArtifactId.get(artifact.artifact_id);
    if (uploadUrl === undefined) {
      missing.push(artifact.artifact_id);
      return "";
    }
    return uploadUrl;
  });

  if (missing.length > 0) {
    throw new HandoffError(
      "INVALID_RESPONSE",
      `Missing artifact upload URL for artifact payload(s): ${missing.join(", ")}`
    );
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Helper: safe transition to failed
// ---------------------------------------------------------------------------

function safeTransitionToFailed(sm: HandoffStateMachine): void {
  if (!sm.isFinal()) {
    sm.transition("failed");
  }
}

// ---------------------------------------------------------------------------
// Helper: get user-facing notification for error
// ---------------------------------------------------------------------------

function getErrorNotification(error: unknown): string {
  if (error instanceof HandoffError) {
    return (
      ERROR_NOTIFICATIONS[error.code] ??
      "An unexpected error occurred during handoff."
    );
  }
  return "An unexpected error occurred during handoff.";
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function executeHandoff(
  options: HandoffOptions,
  deps: HandoffDependencies
): Promise<HandoffResult> {
  const {
    session_id,
    tenant_id,
    workspace_id,
    conversation_history,
    pending_actions,
    runtime_config,
    policy_cache,
    artifacts,
    artifactData,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress,
    signal: externalSignal,
  } = options;

  const {
    fetchLike,
    baseUrl,
    bearerToken,
    signingKey,
    maxSnapshotSize = DEFAULT_MAX_SNAPSHOT_SIZE,
  } = deps;

  // -- Concurrent handoff prevention --
  if (activeHandoffs.has(session_id)) {
    throw new HandoffError(
      "CONCURRENT_HANDOFF",
      "A handoff is already in progress for this session"
    );
  }

  // -- Mid-execution action check (F3) --
  const inProgressAction = pending_actions.find(
    (a) => a.risk_level === "high" || a.risk_level === "critical"
  );
  if (inProgressAction) {
    throw new HandoffError(
      "ACTION_IN_PROGRESS",
      `Cannot hand off while action '${inProgressAction.action_name}' is running`
    );
  }

  activeHandoffs.add(session_id);

  const sm = new HandoffStateMachine();
  const abortController = new AbortController();
  const internalSignal = abortController.signal;

  // Link external signal
  const onExternalAbort = () => {
    abortController.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      activeHandoffs.delete(session_id);
      throw new HandoffError("TIMEOUT", "Handoff was aborted");
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  // Set up timeout
  const timer = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  function cleanup(): void {
    clearTimeout(timer);
    activeHandoffs.delete(session_id);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  try {
    const missingArtifactPayloadIds = findMissingArtifactPayloadIds(
      artifacts,
      artifactData,
    );
    if (missingArtifactPayloadIds.length > 0) {
      throw new HandoffError(
        "INVALID_SNAPSHOT",
        `Missing artifact payload(s): ${missingArtifactPayloadIds.join(", ")}`
      );
    }

    // =====================================================================
    // Step 1: Authorize
    // =====================================================================
    checkAborted(internalSignal);
    sm.transition("authorizing");
    emitProgress(onProgress, "authorizing", "Requesting authorization...", 10);

    const authResult = await requestHandoffAuthorization({
      session_id,
      tenant_id,
      workspace_id,
      fetchLike,
      baseUrl,
      bearerToken,
    });

    // authResult is always { decision: "allow" } here because deny/escalate/unavailable throw
    if (authResult.decision !== "allow") {
      throw new HandoffError("POLICY_DENIED", `Handoff not allowed: ${(authResult as HandoffAuthResult).decision}`);
    }
    const policyToken = authResult.policy_token;
    const tokenExpiresAt = authResult.token_expires_at;

    // =====================================================================
    // Step 2: Assemble, validate, encrypt
    // =====================================================================
    checkAborted(internalSignal);

    // -- Token expiry check (F4) --
    // Add a 30-second buffer to guard against clock skew between the
    // desktop client and the policy service.
    if (new Date(tokenExpiresAt).getTime() <= Date.now() + 30_000) {
      throw new HandoffError(
        "TOKEN_EXPIRED",
        "Policy authorization expired before encryption"
      );
    }

    sm.transition("encrypting");
    emitProgress(
      onProgress,
      "encrypting",
      "Assembling and encrypting session...",
      25
    );

    const snapshot: SessionSnapshot = assembleAndSignSnapshot(
      {
        session_id,
        tenant_id,
        workspace_id,
        conversation_history,
        pending_actions,
        runtime_config,
        policy_cache,
        artifacts,
      },
      signingKey
    );

    const manifest: SnapshotManifest = generateManifest(snapshot);

    // -- Snapshot size limit check (F5) --
    if (manifest.total_size_bytes > maxSnapshotSize) {
      throw new HandoffError(
        "SNAPSHOT_TOO_LARGE",
        `Snapshot size (${manifest.total_size_bytes} bytes) exceeds maximum (${maxSnapshotSize} bytes)`
      );
    }

    checkAborted(internalSignal);

    // =====================================================================
    // Step 3: Initiate handoff (MCP) — get cloud public key + upload URLs
    // =====================================================================
    emitProgress(
      onProgress,
      "encrypting",
      "Initiating handoff with cloud...",
      35
    );

    const initiateResponse = await initiateHandoff(
      fetchLike,
      { baseUrl, bearerToken },
      {
        manifest,
        policy_token: policyToken,
        session_id,
        tenant_id,
        workspace_id,
      }
    );

    // -- Tenant mismatch check (F6) --
    // The InitiateHandoffResponse type does not echo tenant_id or
    // workspace_id back to the client — the server validates tenant routing
    // before issuing a handoff_id and rejects mismatched requests with an
    // appropriate error code.  A client-side post-response comparison is
    // therefore not possible without protocol changes.  If the server ever
    // adds echoed tenant fields to the response, compare them here and
    // throw new HandoffError("TENANT_MISMATCH", ...) on divergence.

    checkAborted(internalSignal);

    // =====================================================================
    // Step 4: Key agreement + encrypt snapshot + encrypt artifacts
    // =====================================================================
    emitProgress(
      onProgress,
      "encrypting",
      "Performing key agreement and encrypting...",
      45
    );

    const cloudPublicKey = Buffer.from(
      initiateResponse.cloud_public_key,
      "base64"
    );
    const { ephemeralPublicKey, contentEncryptionKey } =
      performKeyAgreement(cloudPublicKey);

    const snapshotData = Buffer.from(JSON.stringify(snapshot));
    const encryptedChunks: EncryptedChunk[] = encryptSnapshot(
      contentEncryptionKey,
      snapshotData,
      session_id
    );

    // Encrypt artifacts
    const encryptedArtifacts: EncryptedArtifact[] = [];
    for (const artifactRef of artifacts) {
      const rawData = artifactData.get(artifactRef.artifact_id) as Uint8Array;
      encryptedArtifacts.push(
        encryptArtifact(
          contentEncryptionKey,
          artifactRef.artifact_id,
          Buffer.from(rawData)
        )
      );
    }

    checkAborted(internalSignal);

    // =====================================================================
    // Step 5: Upload
    // =====================================================================
    sm.transition("transferring");
    emitProgress(
      onProgress,
      "transferring",
      "Uploading encrypted session...",
      60
    );

    const uploadConfig = {
      uploadUrl: initiateResponse.manifest_upload_url,
      chunkSize: manifest.chunk_size_bytes,
      maxRetries: 3,
      baseRetryDelay: 1000,
      maxRetryDelay: 10_000,
      signal: internalSignal,
    };

    const artifactUploadUrls = resolveArtifactUploadUrls(
      encryptedArtifacts,
      initiateResponse.artifact_upload_urls
    );

    // Upload snapshot and artifacts in parallel
    await Promise.all([
      uploadEncryptedSnapshot(encryptedChunks, uploadConfig),
      uploadArtifacts(encryptedArtifacts, artifactUploadUrls, {
        chunkSize: uploadConfig.chunkSize,
        maxRetries: uploadConfig.maxRetries,
        baseRetryDelay: uploadConfig.baseRetryDelay,
        maxRetryDelay: uploadConfig.maxRetryDelay,
        signal: internalSignal,
      }),
    ]);

    checkAborted(internalSignal);

    // =====================================================================
    // Step 6: Complete handoff (MCP)
    // =====================================================================
    emitProgress(
      onProgress,
      "transferring",
      "Completing handoff...",
      90
    );

    const receipt: HandoffReceipt = await completeHandoff(
      fetchLike,
      { baseUrl, bearerToken },
      {
        handoff_id: initiateResponse.handoff_id,
        ephemeral_public_key: ephemeralPublicKey.toString("base64"),
      }
    );

    // =====================================================================
    // Step 7: Success
    // =====================================================================
    sm.transition("completed");
    emitProgress(onProgress, "completed", "Handoff completed successfully.", 100);

    const result: HandoffResult = {
      handoff_id: receipt.handoff_id,
      cloud_session_id: receipt.cloud_session_id,
    };
    if (receipt.pickup_url) {
      result.pickup_url = receipt.pickup_url;
    }

    return result;
  } catch (error: unknown) {
    // Capture state before transitioning to failed so we can use it for error code selection.
    const stateAtFailure = sm.getState();
    safeTransitionToFailed(sm);

    const notification = getErrorNotification(error);
    emitProgress(onProgress, "failed", notification, 0);

    // Wrap abort errors as TIMEOUT
    if (
      error instanceof Error &&
      !(error instanceof HandoffError) &&
      (error.name === "AbortError" || internalSignal.aborted)
    ) {
      throw new HandoffError("TIMEOUT", "Handoff timed out");
    }

    // Wrap generic errors using the captured state to pick an accurate code.
    // Errors during the 'encrypting' state are snapshot/crypto failures;
    // errors in later states are upload or network failures.
    if (!(error instanceof HandoffError)) {
      const code = stateAtFailure === "encrypting" ? "INVALID_SNAPSHOT" : "UPLOAD_FAILED";
      throw new HandoffError(
        code,
        error instanceof Error ? error.message : String(error)
      );
    }

    throw error;
  /* v8 ignore next */
  } finally {
    cleanup();
  }
}

// Export for testing
export const _testing = {
  activeHandoffs,
  ERROR_NOTIFICATIONS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SNAPSHOT_SIZE,
};
