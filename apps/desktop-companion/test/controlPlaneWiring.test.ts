import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock @joyus/policy-client before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("@joyus/policy-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@joyus/policy-client")>();
  return {
    ...actual,
    loadConfigFromEnv: vi.fn(),
    createControlPlaneClient: vi.fn(),
    openReplayCache: vi.fn(),
    createTokenRefreshService: vi.fn(),
    createAsyncEventEmitter: vi.fn(),
  };
});

import * as policyClient from "@joyus/policy-client";
import {
  createWiredComponents,
  registerShutdownHandlers,
  type WiredComponents,
} from "../src/controlPlaneWiring";

// ---------------------------------------------------------------------------
// Mock references
// ---------------------------------------------------------------------------

const loadConfigFromEnvMock = policyClient.loadConfigFromEnv as Mock;
const createControlPlaneClientMock =
  policyClient.createControlPlaneClient as Mock;
const openReplayCacheMock = policyClient.openReplayCache as Mock;
const createTokenRefreshServiceMock =
  policyClient.createTokenRefreshService as Mock;
const createAsyncEventEmitterMock =
  policyClient.createAsyncEventEmitter as Mock;

// ---------------------------------------------------------------------------
// Shared test doubles
// ---------------------------------------------------------------------------

const mockConfig = {
  baseUrl: "https://api.example.com",
  bearerToken: "tok-secret",
  mtlsCertPath: undefined,
  mtlsKeyPath: undefined,
  mtlsCaPath: undefined,
  requestTimeoutMs: 5000,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 200,
};

const mockFetch = vi.fn();

const mockReplayCache = {
  consume: vi.fn(),
  prune: vi.fn().mockReturnValue(0),
  close: vi.fn(),
};

const mockTokenRefresh = {
  schedule: vi.fn(),
  getInFlight: vi.fn(),
  cancelAll: vi.fn(),
};

const mockEventEmitter = {
  emit: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  loadConfigFromEnvMock.mockReturnValue(mockConfig);
  createControlPlaneClientMock.mockReturnValue(mockFetch);
  openReplayCacheMock.mockReturnValue(mockReplayCache);
  createTokenRefreshServiceMock.mockReturnValue(mockTokenRefresh);
  createAsyncEventEmitterMock.mockReturnValue(mockEventEmitter);
});

// ---------------------------------------------------------------------------
// createWiredComponents
// ---------------------------------------------------------------------------

describe("createWiredComponents", () => {
  it("returns all four wired components", () => {
    const components = createWiredComponents();

    expect(components.fetch).toBe(mockFetch);
    expect(components.replayCache).toBe(mockReplayCache);
    expect(components.tokenRefresh).toBe(mockTokenRefresh);
    expect(components.eventEmitter).toBe(mockEventEmitter);
  });

  it("loads config and passes it to createControlPlaneClient", () => {
    createWiredComponents();

    expect(loadConfigFromEnvMock).toHaveBeenCalledOnce();
    expect(createControlPlaneClientMock).toHaveBeenCalledWith(mockConfig);
  });

  it("calls replayCache.prune() on init", () => {
    createWiredComponents();

    expect(mockReplayCache.prune).toHaveBeenCalledOnce();
  });

  it("passes fetch and baseUrl to createAsyncEventEmitter", () => {
    createWiredComponents();

    expect(createAsyncEventEmitterMock).toHaveBeenCalledWith({
      fetch: mockFetch,
      baseUrl: mockConfig.baseUrl,
    });
  });

  it("passes undefined to openReplayCache when JOYUS_REPLAY_CACHE_PATH is not set", () => {
    const savedPath = process.env["JOYUS_REPLAY_CACHE_PATH"];
    delete process.env["JOYUS_REPLAY_CACHE_PATH"];

    createWiredComponents();

    expect(openReplayCacheMock).toHaveBeenCalledWith(undefined);

    if (savedPath !== undefined) {
      process.env["JOYUS_REPLAY_CACHE_PATH"] = savedPath;
    }
  });

  it("passes dbPath to openReplayCache when JOYUS_REPLAY_CACHE_PATH is set", () => {
    const savedPath = process.env["JOYUS_REPLAY_CACHE_PATH"];
    process.env["JOYUS_REPLAY_CACHE_PATH"] = "/tmp/test-cache.db";

    createWiredComponents();

    expect(openReplayCacheMock).toHaveBeenCalledWith({
      dbPath: "/tmp/test-cache.db",
    });

    if (savedPath === undefined) {
      delete process.env["JOYUS_REPLAY_CACHE_PATH"];
    } else {
      process.env["JOYUS_REPLAY_CACHE_PATH"] = savedPath;
    }
  });

  it("throws when loadConfigFromEnv throws (JOYUS_API_URL missing)", () => {
    loadConfigFromEnvMock.mockImplementation(() => {
      throw new Error("Missing required env var: JOYUS_API_URL");
    });

    expect(() => createWiredComponents()).toThrow("JOYUS_API_URL");
  });

  it("throws when loadConfigFromEnv throws (JOYUS_API_TOKEN missing)", () => {
    loadConfigFromEnvMock.mockImplementation(() => {
      throw new Error("Missing required env var: JOYUS_API_TOKEN");
    });

    expect(() => createWiredComponents()).toThrow("JOYUS_API_TOKEN");
  });

  it("requestDecision stub rejects with 'not wired' error", async () => {
    createWiredComponents();

    type TokenRefreshDepsCapture = {
      requestDecision: (key: string) => Promise<unknown>;
    };
    const calls =
      createTokenRefreshServiceMock.mock.calls as Array<
        [TokenRefreshDepsCapture]
      >;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const capturedDeps = firstCall![0];

    await expect(capturedDeps.requestDecision("test-key")).rejects.toThrow(
      "not wired"
    );
  });
});

// ---------------------------------------------------------------------------
// registerShutdownHandlers
// ---------------------------------------------------------------------------

function makeComponents(): WiredComponents {
  return {
    fetch: mockFetch as unknown as import("@joyus/policy-client").FetchLike,
    replayCache: {
      consume: vi.fn(),
      prune: vi.fn().mockReturnValue(0),
      close: vi.fn(),
    },
    tokenRefresh: {
      schedule: vi.fn(),
      getInFlight: vi.fn(),
      cancelAll: vi.fn(),
    },
    eventEmitter: {
      emit: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("registerShutdownHandlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers SIGTERM and SIGINT handlers", () => {
    const capturedHandlers = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      capturedHandlers.set(event as string, listener as () => void);
      return process;
    });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    registerShutdownHandlers(makeComponents());

    expect(capturedHandlers.has("SIGTERM")).toBe(true);
    expect(capturedHandlers.has("SIGINT")).toBe(true);
  });

  it("SIGTERM: calls flush, cancelAll, close in order then exits", async () => {
    const order: string[] = [];
    const capturedHandlers = new Map<string, () => void>();

    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      capturedHandlers.set(event as string, listener as () => void);
      return process;
    });
    vi.spyOn(process, "exit").mockImplementation(() => {
      order.push("exit");
      return undefined as never;
    });

    const components = makeComponents();
    components.eventEmitter.flush = vi.fn(async () => {
      order.push("flush");
    });
    components.tokenRefresh.cancelAll = vi.fn(() => {
      order.push("cancelAll");
    });
    components.replayCache.close = vi.fn(() => {
      order.push("close");
    });

    registerShutdownHandlers(components);

    const handler = capturedHandlers.get("SIGTERM");
    expect(handler).toBeDefined();
    handler!();

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(order).toEqual(["flush", "cancelAll", "close", "exit"]);
  });

  it("SIGINT: calls flush, cancelAll, close in order then exits", async () => {
    const order: string[] = [];
    const capturedHandlers = new Map<string, () => void>();

    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      capturedHandlers.set(event as string, listener as () => void);
      return process;
    });
    vi.spyOn(process, "exit").mockImplementation(() => {
      order.push("exit");
      return undefined as never;
    });

    const components = makeComponents();
    components.eventEmitter.flush = vi.fn(async () => {
      order.push("flush");
    });
    components.tokenRefresh.cancelAll = vi.fn(() => {
      order.push("cancelAll");
    });
    components.replayCache.close = vi.fn(() => {
      order.push("close");
    });

    registerShutdownHandlers(components);

    const handler = capturedHandlers.get("SIGINT");
    expect(handler).toBeDefined();
    handler!();

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(order).toEqual(["flush", "cancelAll", "close", "exit"]);
  });
});
