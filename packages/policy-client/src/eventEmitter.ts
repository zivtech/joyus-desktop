import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { FetchLike } from "./controlPlaneContracts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventKind =
  | "policy.decision"
  | "policy.replay"
  | "handoff.complete"
  | "artifact.register";

export interface QueuedEvent {
  kind: EventKind;
  endpoint: string;
  payload: unknown;
  enqueuedAt: number;
  attempts: number;
}

export interface AsyncEventEmitterDeps {
  fetch: FetchLike;
  baseUrl: string;
  /** Max delivery attempts before writing to failureLog. Default: 3 */
  maxAttempts?: number;
  /** Path to write NDJSON failure log. Default: ~/.joyus/event-failures.ndjson */
  failureLogPath?: string;
  /** Injectable sleep for testability. Default: real setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock. Default: Date.now */
  nowMs?: () => number;
}

export interface AsyncEventEmitter {
  /** Enqueue an event for async delivery. Returns immediately. */
  emit(kind: EventKind, endpoint: string, payload: unknown): void;

  /** Drain all pending events (best effort). Call on shutdown. */
  flush(): Promise<void>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_DELAY_MS = 200;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_FAILURE_LOG_PATH = "~/.joyus/event-failures.ndjson";

// ── Path helpers ──────────────────────────────────────────────────────────────

function resolveLogPath(rawPath: string): string {
  if (rawPath.startsWith("~")) {
    return join(homedir(), rawPath.slice(1));
  }
  return rawPath;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAsyncEventEmitter(deps: AsyncEventEmitterDeps): AsyncEventEmitter {
  const fetchFn = deps.fetch;
  const baseUrl = deps.baseUrl;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const failureLogPath = deps.failureLogPath ?? DEFAULT_FAILURE_LOG_PATH;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const nowMs = deps.nowMs ?? (() => Date.now());

  const queue: QueuedEvent[] = [];
  let draining = false;
  let drainPromise: Promise<void> | null = null;

  // ── Delivery ────────────────────────────────────────────────────────────────

  async function attemptDelivery(event: QueuedEvent): Promise<boolean> {
    try {
      const response = await fetchFn(`${baseUrl}${event.endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: event.kind, payload: event.payload }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function writeFallbackLog(event: QueuedEvent): Promise<void> {
    try {
      const resolvedPath = resolveLogPath(failureLogPath);
      mkdirSync(dirname(resolvedPath), { recursive: true });
      appendFileSync(
        resolvedPath,
        JSON.stringify({ ...event, failedAt: nowMs() }) + "\n"
      );
    } catch (err) {
      console.error("Failed to write event failure log:", err);
    }
  }

  // ── Drain loop ──────────────────────────────────────────────────────────────

  async function drainLoop(): Promise<void> {
    while (true) {
      const event = queue[0];
      if (event === undefined) break;

      const success = await attemptDelivery(event);
      if (success) {
        queue.shift();
      } else {
        event.attempts += 1;
        if (event.attempts >= maxAttempts) {
          await writeFallbackLog(event);
          queue.shift();
        } else {
          await sleep(BASE_DELAY_MS * Math.pow(2, event.attempts - 1));
        }
      }
    }
  }

  function startDrain(): void {
    draining = true;
    drainPromise = drainLoop().finally(() => {
      draining = false;
      drainPromise = null;
    });
  }

  // ── Public interface ────────────────────────────────────────────────────────

  return {
    emit(kind, endpoint, payload) {
      queue.push({ kind, endpoint, payload, enqueuedAt: nowMs(), attempts: 0 });
      if (!draining) {
        startDrain();
      }
    },

    async flush() {
      if (drainPromise !== null) {
        await drainPromise;
      }
    },
  };
}
