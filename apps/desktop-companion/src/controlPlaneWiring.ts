import {
  loadConfigFromEnv,
  createControlPlaneClient,
  openReplayCache,
  createTokenRefreshService,
  createAsyncEventEmitter,
  requestPolicyDecision,
  buildPolicyDecideRequest,
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

  // Token refresh — wired to the control plane so proactive refresh actually
  // fetches a fresh policy decision when a timer expires without the caller
  // having provided an updated response.
  const tokenRefresh = createTokenRefreshService({
    requestDecision: (actionKey: string) => {
      const tenantId = process.env["JOYUS_TENANT_ID"] ?? "";
      const sessionId = process.env["JOYUS_SESSION_ID"] ?? "";
      const request = buildPolicyDecideRequest({
        actionName: actionKey,
        riskLevel: "low",
        tenantId,
        sessionId,
      });
      return requestPolicyDecision(fetchClient, {
        baseUrl: config.baseUrl,
        bearerToken: config.bearerToken,
        request,
      });
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
