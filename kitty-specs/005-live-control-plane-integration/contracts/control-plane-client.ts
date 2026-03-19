/**
 * Contract: ControlPlaneClient
 *
 * Concrete HTTP client wrapping the existing FetchLike seam in
 * packages/policy-client/src/controlPlaneContracts.ts.
 *
 * Responsibilities:
 * - Load config from environment variables at construction time
 * - Provide a FetchLike implementation backed by native fetch
 * - Enforce per-request timeout
 * - Retry on transient failures with exponential backoff
 * - Support mTLS via cert/key/ca paths loaded from env vars
 *
 * NOTE: This is the contract (interface + types only).
 * Implementation lives in packages/policy-client/src/controlPlaneClient.ts
 */

export interface ControlPlaneConfig {
  /** Base URL of the deployed joyus-ai API. No trailing slash. */
  baseUrl: string;
  /** Bearer token for Authorization header. */
  bearerToken: string;
  /** Path to PEM client certificate (mTLS). Undefined = no mTLS. */
  mtlsCertPath: string | undefined;
  /** Path to PEM client key (mTLS). Undefined = no mTLS. */
  mtlsKeyPath: string | undefined;
  /** Path to CA bundle (mTLS). Undefined = system CA. */
  mtlsCaPath: string | undefined;
  /** Per-request timeout in milliseconds. Default: 5000. */
  requestTimeoutMs: number;
  /** Maximum retry attempts for transient failures. Default: 3. */
  retryMaxAttempts: number;
  /** Base delay for exponential backoff in milliseconds. Default: 200. */
  retryBaseDelayMs: number;
}

export interface ControlPlaneClientDeps {
  /** Injectable fetch function. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Inject current time for testability. Defaults to Date.now. */
  nowMs?: () => number;
}

/**
 * Loads ControlPlaneConfig from environment variables.
 * Throws if required variables are missing.
 */
export type LoadConfigFromEnv = () => ControlPlaneConfig;

/**
 * Creates a FetchLike function backed by native fetch with
 * retry, timeout, and optional mTLS support.
 *
 * The returned function satisfies the FetchLike type from
 * packages/policy-client/src/controlPlaneContracts.ts.
 */
export type CreateControlPlaneClient = (
  config: ControlPlaneConfig,
  deps?: ControlPlaneClientDeps
) => import("../../../packages/policy-client/src/controlPlaneContracts.js").FetchLike;
