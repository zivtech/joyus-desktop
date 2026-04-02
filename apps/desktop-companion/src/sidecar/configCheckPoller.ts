import { createHash } from "node:crypto";
import { validateManifest } from "@joyus/settings-reconciler";
import type { DistributionManifest } from "@joyus/settings-reconciler";

export interface ConfigCheckConfig {
  readonly manifestUrl: string;
  readonly intervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onChangeDetected: (manifest: DistributionManifest) => Promise<void>;
  readonly onPollError?: (error: Error) => void;
  readonly now?: () => Date;
}

export interface ConfigCheckState {
  lastCheckAt?: string;
  lastChangeAt?: string;
  lastVersionHash?: string;
  consecutiveFailures: number;
}

export interface PollerHandle {
  stop: () => void;
  getState: () => Readonly<ConfigCheckState>;
}

function hashManifestContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function startConfigCheckPoller(config: ConfigCheckConfig): PollerHandle {
  const state: ConfigCheckState = { consecutiveFailures: 0 };
  const fetcher = config.fetchImpl ?? fetch;
  const nowFn = config.now ?? (() => new Date());
  let polling = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  async function tick(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      let responseText: string;
      try {
        const response = await fetcher(config.manifestUrl);
        responseText = await response.text();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.consecutiveFailures++;
        state.lastCheckAt = nowFn().toISOString();
        config.onPollError?.(error);
        return;
      }

      const newHash = hashManifestContent(responseText);
      state.lastCheckAt = nowFn().toISOString();

      if (newHash === state.lastVersionHash) {
        state.consecutiveFailures = 0;
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText) as unknown;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.consecutiveFailures++;
        config.onPollError?.(error);
        return;
      }

      let manifest: DistributionManifest;
      try {
        manifest = validateManifest(parsed);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.consecutiveFailures++;
        config.onPollError?.(error);
        return;
      }

      try {
        await config.onChangeDetected(manifest);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.consecutiveFailures++;
        config.onPollError?.(error);
        return;
      }

      state.lastVersionHash = newHash;
      state.lastChangeAt = nowFn().toISOString();
      state.consecutiveFailures = 0;
    } finally {
      polling = false;
    }
  }

  void tick();
  intervalId = setInterval(() => void tick(), config.intervalMs ?? 300_000);

  function stop(): void {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  }

  function getState(): Readonly<ConfigCheckState> {
    return { ...state };
  }

  return { stop, getState };
}
