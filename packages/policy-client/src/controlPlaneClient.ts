import { readFileSync } from "node:fs";

import type { FetchLike, FetchLikeResponse } from "./controlPlaneContracts";

// ── Config ────────────────────────────────────────────────────────────────────

export interface ControlPlaneConfig {
  baseUrl: string;
  bearerToken: string;
  mtlsCertPath: string | undefined;
  mtlsKeyPath: string | undefined;
  mtlsCaPath: string | undefined;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}

export function loadConfigFromEnv(): ControlPlaneConfig {
  const baseUrlRaw = process.env["JOYUS_API_URL"];
  const bearerToken = process.env["JOYUS_API_TOKEN"];

  if (!baseUrlRaw) {
    throw new Error("Missing required env var: JOYUS_API_URL");
  }
  if (!bearerToken) {
    throw new Error("Missing required env var: JOYUS_API_TOKEN");
  }

  const baseUrl = baseUrlRaw.replace(/\/+$/, "");

  const parseIntOrDefault = (val: string | undefined, def: number): number => {
    if (val === undefined) return def;
    const n = parseInt(val, 10);
    return isNaN(n) ? def : n;
  };

  return {
    baseUrl,
    bearerToken,
    mtlsCertPath: process.env["JOYUS_MTLS_CERT_PATH"],
    mtlsKeyPath: process.env["JOYUS_MTLS_KEY_PATH"],
    mtlsCaPath: process.env["JOYUS_MTLS_CA_PATH"],
    requestTimeoutMs: parseIntOrDefault(process.env["JOYUS_REQUEST_TIMEOUT_MS"], 5000),
    retryMaxAttempts: parseIntOrDefault(process.env["JOYUS_RETRY_MAX_ATTEMPTS"], 3),
    retryBaseDelayMs: parseIntOrDefault(process.env["JOYUS_RETRY_BASE_DELAY_MS"], 200),
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class ControlPlaneTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Control plane request timed out after ${timeoutMs}ms: ${url}`);
    this.name = "ControlPlaneTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

// ── mTLS ─────────────────────────────────────────────────────────────────────

export function buildMtlsAgent(
  certPath: string,
  keyPath: string,
  caPath: string | undefined
): { cert: string; key: string; ca: string | undefined } {
  return {
    cert: readFileSync(certPath, "utf8"),
    key: readFileSync(keyPath, "utf8"),
    ca: caPath !== undefined ? readFileSync(caPath, "utf8") : undefined,
  };
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export function calculateBackoffMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

// ── Client ────────────────────────────────────────────────────────────────────

export interface ControlPlaneClientDeps {
  fetchFn?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createControlPlaneClient(
  config: ControlPlaneConfig,
  deps?: ControlPlaneClientDeps
): FetchLike {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  const sleep =
    deps?.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let mtlsConnect: { cert: string; key: string; ca: string | undefined } | undefined;
  if (config.mtlsCertPath !== undefined && config.mtlsKeyPath !== undefined) {
    mtlsConnect = buildMtlsAgent(config.mtlsCertPath, config.mtlsKeyPath, config.mtlsCaPath);
  }

  return async (url, init): Promise<FetchLikeResponse> => {
    const headers: Record<string, string> = {
      ...init.headers,
      Authorization: `Bearer ${config.bearerToken}`,
    };

    let lastError: unknown = new Error("Unexpected: no retry attempts made");

    for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, config.requestTimeoutMs);

      try {
        const fetchOptions: RequestInit = {
          method: init.method,
          headers,
          signal: controller.signal,
        };

        if (init.body !== undefined) {
          fetchOptions.body = init.body;
        }

        if (mtlsConnect !== undefined) {
          // Node 24 native fetch (undici) supports a dispatcher option for mTLS.
          // Not in standard RequestInit types — requires undici at runtime for actual mTLS.
          Object.assign(fetchOptions, { dispatcher: { connect: mtlsConnect } });
        }

        const response = await fetchFn(url, fetchOptions);
        clearTimeout(timeoutId);

        if (RETRY_STATUSES.has(response.status) && attempt < config.retryMaxAttempts) {
          await sleep(calculateBackoffMs(config.retryBaseDelayMs, attempt));
          continue;
        }

        return response;
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof Error && err.name === "AbortError") {
          throw new ControlPlaneTimeoutError(url, config.requestTimeoutMs);
        }

        lastError = err;

        if (attempt < config.retryMaxAttempts) {
          await sleep(calculateBackoffMs(config.retryBaseDelayMs, attempt));
        }
      }
    }

    throw lastError;
  };
}
