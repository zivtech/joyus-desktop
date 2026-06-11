/**
 * Contract: AsyncEventEmitter
 *
 * Non-blocking emitter for /v1/events and /v1/artifacts payloads.
 * Queues events in-memory, delivers asynchronously with retry,
 * and falls back to local structured log on permanent failure.
 *
 * NOTE: This is the contract (interface + types only).
 * Implementation lives in packages/policy-client/src/eventEmitter.ts
 */

import type { FetchLike } from "../../../packages/policy-client/src/controlPlaneContracts.js";

export type EventEndpoint = "/v1/events" | "/v1/artifacts";

export interface QueuedEvent {
  id: string;
  endpoint: EventEndpoint;
  payload: Record<string, unknown>;
  attempts: number;
  nextRetryAt: number; // Unix epoch ms
  createdAt: number;   // Unix epoch ms
}

export interface EventEmitterConfig {
  /** Max delivery attempts before writing to failure log. Default: 3. */
  maxAttempts: number;
  /** Base delay for exponential backoff in ms. Default: 200. */
  baseDelayMs: number;
  /** Path to local failure log (NDJSON). Default: ~/.joyus/event-failures.ndjson */
  failureLogPath: string;
}

export interface AsyncEventEmitter {
  /**
   * Enqueue an event for async delivery. Returns immediately.
   * Never throws — failures are handled internally.
   */
  emit(endpoint: EventEndpoint, payload: Record<string, unknown>): void;

  /**
   * Flush all pending events synchronously. Used on graceful shutdown.
   * Best-effort — remaining failures are written to the failure log.
   */
  flush(): Promise<void>;
}

export interface EventEmitterDeps {
  fetchFn: FetchLike;
  baseUrl: string;
  bearerToken: string;
  config?: Partial<EventEmitterConfig>;
  /** Injectable for testability. */
  nowMs?: () => number;
}

export type CreateEventEmitter = (deps: EventEmitterDeps) => AsyncEventEmitter;
