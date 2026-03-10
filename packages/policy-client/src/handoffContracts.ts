import type { FetchLike } from "./controlPlaneContracts";
import { callMcpTool } from "./controlPlaneContracts";
import type { HandoffReceipt, HandoffState, SnapshotManifest } from "./handoffTypes";
import { HandoffError } from "./handoffTypes";

// ---------------------------------------------------------------------------
// Request / Response interfaces
// ---------------------------------------------------------------------------

export interface InitiateHandoffRequest {
  manifest: SnapshotManifest;
  policy_token: string;
  session_id: string;
  tenant_id: string;
  workspace_id: string;
}

export interface ArtifactUploadEntry {
  artifact_id: string;
  upload_url: string;
}

export interface InitiateHandoffResponse {
  handoff_id: string;
  cloud_public_key: string;
  manifest_upload_url: string;
  artifact_upload_urls: ArtifactUploadEntry[];
  expires_at: string;
}

export interface CompleteHandoffRequest {
  handoff_id: string;
  ephemeral_public_key: string;
}

export interface HandoffStatusResponse {
  handoff_id: string;
  state: HandoffState;
  chunks_received: number;
  chunks_total: number;
  artifacts_received: number;
  artifacts_total: number;
  error?: string;
}

export interface HandoffConnectionConfig {
  baseUrl: string;
  bearerToken: string;
}

export interface PollOptions {
  interval?: number;
  timeout?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_HANDOFF_STATES: ReadonlySet<string> = new Set([
  "initiated",
  "authorizing",
  "encrypting",
  "transferring",
  "completed",
  "failed"
]);

const FINAL_HANDOFF_STATES: ReadonlySet<string> = new Set(["completed", "failed"]);

function isBase64Of32Bytes(value: string): boolean {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    return false;
  }
  // Ensure the value actually round-trips as valid base64
  return decoded.toString("base64") === value;
}

export function validateInitiateResponse(
  data: unknown,
  expectedArtifactCount: number
): InitiateHandoffResponse {
  if (!data || typeof data !== "object") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: expected object");
  }

  const value = data as Record<string, unknown>;

  if (typeof value.handoff_id !== "string" || !value.handoff_id) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: handoff_id");
  }

  if (typeof value.cloud_public_key !== "string" || !value.cloud_public_key) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: cloud_public_key");
  }

  if (!isBase64Of32Bytes(value.cloud_public_key)) {
    throw new HandoffError(
      "INVALID_RESPONSE",
      "Invalid initiate_handoff response: cloud_public_key must be base64-encoded 32 bytes"
    );
  }

  if (typeof value.manifest_upload_url !== "string" || !value.manifest_upload_url) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: manifest_upload_url");
  }

  if (!Array.isArray(value.artifact_upload_urls)) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: artifact_upload_urls");
  }

  for (const entry of value.artifact_upload_urls) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).artifact_id !== "string" ||
      typeof (entry as Record<string, unknown>).upload_url !== "string"
    ) {
      throw new HandoffError(
        "INVALID_RESPONSE",
        "Invalid initiate_handoff response: artifact_upload_urls entries must have artifact_id and upload_url"
      );
    }
  }

  if (value.artifact_upload_urls.length !== expectedArtifactCount) {
    throw new HandoffError(
      "INVALID_RESPONSE",
      `Invalid initiate_handoff response: artifact_upload_urls length (${value.artifact_upload_urls.length}) does not match manifest artifact_count (${expectedArtifactCount})`
    );
  }

  if (typeof value.expires_at !== "string" || !value.expires_at) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid initiate_handoff response: expires_at");
  }

  return {
    handoff_id: value.handoff_id,
    cloud_public_key: value.cloud_public_key,
    manifest_upload_url: value.manifest_upload_url,
    artifact_upload_urls: value.artifact_upload_urls as ArtifactUploadEntry[],
    expires_at: value.expires_at
  };
}

export function validateCompleteResponse(data: unknown): HandoffReceipt {
  if (!data || typeof data !== "object") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: expected object");
  }

  const value = data as Record<string, unknown>;

  if (typeof value.handoff_id !== "string" || !value.handoff_id) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: handoff_id");
  }

  if (typeof value.cloud_session_id !== "string" || !value.cloud_session_id) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: cloud_session_id");
  }

  if (value.status !== "completed" && value.status !== "failed") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: status");
  }

  if (typeof value.completed_at !== "string" || !value.completed_at) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: completed_at");
  }

  if (value.pickup_url !== undefined && typeof value.pickup_url !== "string") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: pickup_url");
  }

  if (value.error !== undefined && typeof value.error !== "string") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid complete_handoff response: error");
  }

  const receipt: HandoffReceipt = {
    handoff_id: value.handoff_id,
    cloud_session_id: value.cloud_session_id,
    status: value.status,
    completed_at: value.completed_at,
    ...(value.pickup_url !== undefined ? { pickup_url: value.pickup_url as string } : {}),
    ...(value.error !== undefined ? { error: value.error as string } : {})
  };

  return receipt;
}

export function validateStatusResponse(data: unknown): HandoffStatusResponse {
  if (!data || typeof data !== "object") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: expected object");
  }

  const value = data as Record<string, unknown>;

  if (typeof value.handoff_id !== "string" || !value.handoff_id) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: handoff_id");
  }

  if (typeof value.state !== "string" || !VALID_HANDOFF_STATES.has(value.state)) {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: state");
  }

  if (typeof value.chunks_received !== "number") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: chunks_received");
  }

  if (typeof value.chunks_total !== "number") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: chunks_total");
  }

  if (typeof value.artifacts_received !== "number") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: artifacts_received");
  }

  if (typeof value.artifacts_total !== "number") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: artifacts_total");
  }

  if (value.error !== undefined && typeof value.error !== "string") {
    throw new HandoffError("INVALID_RESPONSE", "Invalid handoff_status response: error");
  }

  return {
    handoff_id: value.handoff_id,
    state: value.state as HandoffState,
    chunks_received: value.chunks_received,
    chunks_total: value.chunks_total,
    artifacts_received: value.artifacts_received,
    artifacts_total: value.artifacts_total,
    ...(value.error !== undefined ? { error: value.error as string } : {})
  };
}

// ---------------------------------------------------------------------------
// MCP tool wrappers
// ---------------------------------------------------------------------------

export async function initiateHandoff(
  fetchLike: FetchLike,
  config: HandoffConnectionConfig,
  request: InitiateHandoffRequest
): Promise<InitiateHandoffResponse> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    toolName: "initiate_handoff",
    arguments: {
      session_id: request.session_id,
      tenant_id: request.tenant_id,
      workspace_id: request.workspace_id,
      policy_token: request.policy_token,
      manifest: request.manifest
    }
  });

  return validateInitiateResponse(raw, request.manifest.artifact_count);
}

export async function completeHandoff(
  fetchLike: FetchLike,
  config: HandoffConnectionConfig,
  request: CompleteHandoffRequest
): Promise<HandoffReceipt> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    toolName: "complete_handoff",
    arguments: {
      handoff_id: request.handoff_id,
      ephemeral_public_key: request.ephemeral_public_key
    }
  });

  const receipt = validateCompleteResponse(raw);

  if (receipt.status === "failed") {
    throw new HandoffError(
      "HANDOFF_REJECTED",
      receipt.error ?? "Handoff was rejected by the cloud"
    );
  }

  return receipt;
}

export async function getHandoffStatus(
  fetchLike: FetchLike,
  config: HandoffConnectionConfig,
  handoffId: string
): Promise<HandoffStatusResponse> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    toolName: "handoff_status",
    arguments: {
      handoff_id: handoffId
    }
  });

  return validateStatusResponse(raw);
}

export async function* pollHandoffStatus(
  fetchLike: FetchLike,
  config: HandoffConnectionConfig,
  handoffId: string,
  options?: PollOptions
): AsyncGenerator<HandoffStatusResponse> {
  const interval = options?.interval ?? 2000;
  const timeout = options?.timeout ?? 60000;
  const signal = options?.signal;

  const start = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    if (Date.now() - start >= timeout) {
      throw new HandoffError("TIMEOUT", `Handoff status polling timed out after ${timeout}ms`);
    }

    const status = await getHandoffStatus(fetchLike, config, handoffId);
    yield status;

    if (FINAL_HANDOFF_STATES.has(status.state)) {
      return;
    }

    // Wait for the interval, but break early on abort
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}
