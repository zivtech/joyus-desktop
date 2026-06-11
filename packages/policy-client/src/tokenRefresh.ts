import type { PolicyDecideResponse } from "./controlPlaneContracts";

export interface TokenRefreshDeps {
  requestDecision: (actionKey: string) => Promise<PolicyDecideResponse>;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TokenRefreshService {
  schedule(actionKey: string, response: PolicyDecideResponse): void;
  getInFlight(actionKey: string): Promise<PolicyDecideResponse> | undefined;
  cancelAll(): void;
}

export function createTokenRefreshService(deps: TokenRefreshDeps): TokenRefreshService {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Map<string, Promise<PolicyDecideResponse>>();

  const nowMs = deps.nowMs ?? (() => Date.now());

  function scheduleRefresh(actionKey: string, response: PolicyDecideResponse): void {
    if (timers.has(actionKey) || inFlight.has(actionKey)) {
      return;
    }

    const expiresAtMs = new Date(response.token_expires_at).getTime();
    const refreshDelayMs = Math.floor((expiresAtMs - nowMs()) * 0.8);

    if (refreshDelayMs <= 0) {
      doRefresh(actionKey);
      return;
    }

    const timer = setTimeout(() => {
      timers.delete(actionKey);
      doRefresh(actionKey);
    }, refreshDelayMs);

    timers.set(actionKey, timer);
  }

  function doRefresh(actionKey: string): void {
    const promise = deps.requestDecision(actionKey).then(
      (newResponse) => {
        inFlight.delete(actionKey);
        scheduleRefresh(actionKey, newResponse);
        return newResponse;
      },
      (_err: unknown) => {
        inFlight.delete(actionKey);
        throw _err;
      }
    );

    inFlight.set(actionKey, promise);

    // Swallow unhandled rejection — callers who want the result use getInFlight()
    promise.catch(() => undefined);
  }

  return {
    schedule(actionKey: string, response: PolicyDecideResponse): void {
      scheduleRefresh(actionKey, response);
    },

    getInFlight(actionKey: string): Promise<PolicyDecideResponse> | undefined {
      return inFlight.get(actionKey);
    },

    cancelAll(): void {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      inFlight.clear();
    }
  };
}
