import {
  loadConfigFromEnv,
  createControlPlaneClient,
  openReplayCache,
  createTokenRefreshService,
  createAsyncEventEmitter,
} from "@joyus/policy-client";
import type {
  FetchLike,
  ReplayCache,
  TokenRefreshService,
  AsyncEventEmitter,
} from "@joyus/policy-client";

// ---------------------------------------------------------------------------
// Wired component bundle
// ---------------------------------------------------------------------------

export interface WiredComponents {
  fetch: FetchLike;
  replayCache: ReplayCache;
  tokenRefresh: TokenRefreshService;
  eventEmitter: AsyncEventEmitter;
}

// ---------------------------------------------------------------------------
// Factory — reads env, constructs all four components
// ---------------------------------------------------------------------------

export function createWiredComponents(): WiredComponents {
  const config = loadConfigFromEnv();
  const fetchClient = createControlPlaneClient(config);

  // Build replay cache options — only pass dbPath when env var is set
  // (exactOptionalPropertyTypes disallows assigning string | undefined to dbPath?: string)
  const dbPath = process.env["JOYUS_REPLAY_CACHE_PATH"];
  const replayCache = openReplayCache(
    dbPath !== undefined ? { dbPath } : undefined
  );
  replayCache.prune();

  // Token refresh — requestDecision is a placeholder; callers wire real decision
  // logic by calling schedule() after each policy decision and checking getInFlight()
  // before re-requesting. The requestDecision callback fires only when a proactive
  // timer expires without the caller having provided an updated response.
  const tokenRefresh = createTokenRefreshService({
    requestDecision: (_actionKey: string) => {
      return Promise.reject(
        new Error("Token refresh requestDecision is not wired")
      );
    },
  });

  const eventEmitter = createAsyncEventEmitter({
    fetch: fetchClient,
    baseUrl: config.baseUrl,
  });

  return {
    fetch: fetchClient,
    replayCache,
    tokenRefresh,
    eventEmitter,
  };
}

// ---------------------------------------------------------------------------
// Shutdown — flush events, cancel timers, close DB, then exit
// ---------------------------------------------------------------------------

export function registerShutdownHandlers(components: WiredComponents): void {
  async function shutdown(): Promise<void> {
    await components.eventEmitter.flush();
    components.tokenRefresh.cancelAll();
    components.replayCache.close();
    process.exit(0);
  }

  process.once("SIGTERM", () => {
    void shutdown();
  });

  process.once("SIGINT", () => {
    void shutdown();
  });
}
