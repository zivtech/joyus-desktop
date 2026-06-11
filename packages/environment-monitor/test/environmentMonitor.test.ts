import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createEnvironmentMonitor } from "../src/environmentMonitor.js";
import type { EnvironmentMonitorDeps } from "../src/environmentMonitor.js";
import type { ActivityLog, ActivityLogEntry } from "../src/activityLog.js";
import type { DeploymentStatusPoller, ExecCommand, PollResult } from "../src/deploymentStatusPoller.js";
import type {
  RemoteEnvironment,
  RemoteEnvironmentStatus,
  RemoteEnvironmentStore,
} from "../src/remoteEnvironmentStore.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnv(overrides?: Partial<RemoteEnvironment>): RemoteEnvironment {
  return {
    id: "env-1",
    repoOwner: "acme-org",
    repoName: "my-repo",
    environmentType: "probo",
    prNumber: 42,
    prUrl: "https://github.com/acme-org/my-repo/pull/42",
    prTitle: "Add feature",
    deploymentId: 9001,
    environmentUrl: "https://pr-42.proboapp.io",
    status: "building",
    taskBranchId: "tb-1",
    errorMessage: undefined,
    lastCheckedAt: 1000,
    createdAt: 500,
    ...overrides,
  };
}

function makeStore(overrides?: Partial<RemoteEnvironmentStore>): RemoteEnvironmentStore {
  return {
    upsertFromDeployment: vi.fn().mockReturnValue(makeEnv()),
    findById: vi.fn().mockReturnValue(undefined),
    findByDeploymentId: vi.fn().mockReturnValue(undefined),
    findByTaskBranchId: vi.fn().mockReturnValue(undefined),
    listByRepo: vi.fn().mockReturnValue([]),
    listAll: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    updateLastChecked: vi.fn(),
    softDelete: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function makeActivityLog(overrides?: Partial<ActivityLog>): ActivityLog {
  return {
    append: vi.fn().mockImplementation((input) => ({
      id: "log-1",
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      eventType: input.eventType,
      detail: input.detail ?? undefined,
      occurredAt: input.occurredAt ?? Date.now(),
    })) as ActivityLog["append"],
    listRecent: vi.fn().mockReturnValue([]) as ActivityLog["listRecent"],
    listByRepo: vi.fn().mockReturnValue([]) as ActivityLog["listByRepo"],
    pruneOlderThan: vi.fn().mockReturnValue(0) as ActivityLog["pruneOlderThan"],
    ...overrides,
  };
}

function makePoller(overrides?: Partial<DeploymentStatusPoller>): DeploymentStatusPoller {
  return {
    pollForPr: vi.fn().mockResolvedValue(undefined) as DeploymentStatusPoller["pollForPr"],
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    triggerImmediatePoll: vi.fn(),
    ...overrides,
  };
}

function makeExecCommand(
  responses: Record<string, { stdout: string; stderr: string } | Error> = {},
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) return Promise.reject(response);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.resolve({ stdout: "{}", stderr: "" });
  });
}

function ok(stdout: string): { stdout: string; stderr: string } {
  return { stdout, stderr: "" };
}

function makeDeps(overrides?: Partial<EnvironmentMonitorDeps>): EnvironmentMonitorDeps {
  return {
    store: makeStore(),
    activityLog: makeActivityLog(),
    poller: makePoller(),
    execCommand: makeExecCommand(),
    ...overrides,
  };
}

// ─── onPrCreated ──────────────────────────────────────────────────────────────

describe("onPrCreated", () => {
  it("upserts a RemoteEnvironment with probo type, building status, and taskBranchId", async () => {
    const store = makeStore();
    const deps = makeDeps({ store });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    expect(store.upsertFromDeployment).toHaveBeenCalledOnce();
    const call = vi.mocked(store.upsertFromDeployment).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      repoOwner: "acme-org",
      repoName: "my-repo",
      environmentType: "probo",
      prNumber: 42,
      status: "building",
      taskBranchId: "tb-1",
    });
  });

  it("fetches PR title via gh api and stores it", async () => {
    const store = makeStore();
    const execCommand = makeExecCommand({
      "gh api repos/acme-org/my-repo/pulls/42": ok(
        JSON.stringify({ title: "My PR Title", url: "https://github.com/acme-org/my-repo/pull/42" }),
      ),
    });
    const deps = makeDeps({ store, execCommand });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    const call = vi.mocked(store.upsertFromDeployment).mock.calls[0]?.[0];
    expect(call?.prTitle).toBe("My PR Title");
    expect(call?.prUrl).toBe("https://github.com/acme-org/my-repo/pull/42");
  });

  it("stores undefined prTitle when gh api call fails", async () => {
    const store = makeStore();
    const execCommand = makeExecCommand({
      "gh api repos/acme-org/my-repo/pulls/42": new Error("gh: not found"),
    });
    const deps = makeDeps({ store, execCommand });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    const call = vi.mocked(store.upsertFromDeployment).mock.calls[0]?.[0];
    expect(call?.prTitle).toBeUndefined();
    expect(call?.prUrl).toBeUndefined();
  });

  it("stores undefined prTitle when gh api returns invalid JSON", async () => {
    const store = makeStore();
    const execCommand = makeExecCommand({
      "gh api repos/acme-org/my-repo/pulls/42": ok("not-json"),
    });
    const deps = makeDeps({ store, execCommand });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    const call = vi.mocked(store.upsertFromDeployment).mock.calls[0]?.[0];
    expect(call?.prTitle).toBeUndefined();
  });

  it("logs environment_created activity with PR info", async () => {
    const activityLog = makeActivityLog();
    const execCommand = makeExecCommand({
      "gh api repos/acme-org/my-repo/pulls/42": ok(
        JSON.stringify({ title: "My PR Title", url: "https://github.com/acme-org/my-repo/pull/42" }),
      ),
    });
    const deps = makeDeps({ activityLog, execCommand });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const createdCall = appendCalls.find((c) => c[0]?.eventType === "environment_created");
    expect(createdCall).toBeDefined();
    expect(createdCall?.[0]?.repoOwner).toBe("acme-org");
    expect(createdCall?.[0]?.repoName).toBe("my-repo");
    expect(createdCall?.[0]?.detail).toContain("PR #42");
    expect(createdCall?.[0]?.detail).toContain("My PR Title");
  });

  it("logs environment_created with PR number when title unavailable", async () => {
    const activityLog = makeActivityLog();
    const execCommand = makeExecCommand({
      "gh api repos/acme-org/my-repo/pulls/42": new Error("not found"),
    });
    const deps = makeDeps({ activityLog, execCommand });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const createdCall = appendCalls.find((c) => c[0]?.eventType === "environment_created");
    expect(createdCall?.[0]?.detail).toContain("PR #42");
  });

  it("triggers an immediate poll after creating the environment", async () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.onPrCreated("acme-org", "my-repo", 42, "tb-1");

    expect(poller.triggerImmediatePoll).toHaveBeenCalledOnce();
    expect(poller.triggerImmediatePoll).toHaveBeenCalledWith("acme-org", "my-repo", 42);
  });
});

// ─── requestHostedEnvironment ─────────────────────────────────────────────────

describe("requestHostedEnvironment", () => {
  it("upserts a joyus-ai-hosted environment with provisioning status", async () => {
    const hostedEnv = makeEnv({
      environmentType: "joyus-ai-hosted",
      status: "provisioning",
      prNumber: undefined,
      deploymentId: undefined,
    });
    const store = makeStore({
      upsertFromDeployment: vi.fn().mockReturnValue(hostedEnv),
    });
    const deps = makeDeps({ store });
    const monitor = createEnvironmentMonitor(deps);

    const result = await monitor.requestHostedEnvironment("acme-org", "my-repo");

    expect(result.environmentType).toBe("joyus-ai-hosted");
    expect(result.status).toBe("provisioning");
    const call = vi.mocked(store.upsertFromDeployment).mock.calls[0]?.[0];
    expect(call?.environmentType).toBe("joyus-ai-hosted");
    expect(call?.status).toBe("provisioning");
    expect(call?.repoOwner).toBe("acme-org");
    expect(call?.repoName).toBe("my-repo");
  });

  it("logs environment_created activity mentioning provisioning", async () => {
    const activityLog = makeActivityLog();
    const deps = makeDeps({ activityLog });
    const monitor = createEnvironmentMonitor(deps);

    await monitor.requestHostedEnvironment("acme-org", "my-repo");

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const createdCall = appendCalls.find((c) => c[0]?.eventType === "environment_created");
    expect(createdCall).toBeDefined();
    expect(createdCall?.[0]?.repoOwner).toBe("acme-org");
    expect(createdCall?.[0]?.repoName).toBe("my-repo");
    expect(createdCall?.[0]?.detail).toContain("provisioning");
  });

  it("returns the upserted environment object", async () => {
    const hostedEnv = makeEnv({
      id: "hosted-env-1",
      environmentType: "joyus-ai-hosted",
      status: "provisioning",
    });
    const store = makeStore({
      upsertFromDeployment: vi.fn().mockReturnValue(hostedEnv),
    });
    const deps = makeDeps({ store });
    const monitor = createEnvironmentMonitor(deps);

    const result = await monitor.requestHostedEnvironment("acme-org", "my-repo");
    expect(result.id).toBe("hosted-env-1");
  });
});

// ─── start / stop ─────────────────────────────────────────────────────────────

describe("start / stop — polling lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() calls poller.startPolling()", () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();

    expect(poller.startPolling).toHaveBeenCalledOnce();
  });

  it("stop() calls poller.stopPolling()", () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    monitor.stop();

    expect(poller.stopPolling).toHaveBeenCalledOnce();
  });

  it("start() is idempotent — double-start does not double-register poller", () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    monitor.start();

    expect(poller.startPolling).toHaveBeenCalledOnce();
  });

  it("stop() before start() does not call poller.stopPolling()", () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.stop();

    expect(poller.stopPolling).not.toHaveBeenCalled();
  });

  it("start() triggers an initial sync for all tracked PR environments", async () => {
    const env = makeEnv({ prNumber: 42, status: "building" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(env),
    });
    const pollResult: PollResult = {
      environmentId: "env-1",
      deploymentId: 9001,
      status: "building",
      environmentUrl: undefined,
      rateLimited: false,
    };
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue(pollResult),
    });
    const deps = makeDeps({ store, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    // Let the async initial sync complete
    await vi.runAllTimersAsync();

    expect(poller.pollForPr).toHaveBeenCalledWith("acme-org", "my-repo", 42);
  });

  it("initial sync skips environments without prNumber", async () => {
    const envNoPr = makeEnv({ prNumber: undefined });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([envNoPr]),
    });
    const poller = makePoller();
    const deps = makeDeps({ store, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    expect(poller.pollForPr).not.toHaveBeenCalled();
  });

  it("initial sync deduplicates same repo/PR across multiple environments", async () => {
    const env1 = makeEnv({ id: "env-a", prNumber: 42 });
    const env2 = makeEnv({ id: "env-b", prNumber: 42 });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env1, env2]),
      findById: vi.fn().mockReturnValue(env1),
    });
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-a",
        deploymentId: 9001,
        status: "building",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    expect(poller.pollForPr).toHaveBeenCalledOnce();
  });

  it("start() after stop() re-registers polling", () => {
    const poller = makePoller();
    const deps = makeDeps({ poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    monitor.stop();
    monitor.start();

    expect(poller.startPolling).toHaveBeenCalledTimes(2);
    expect(poller.stopPolling).toHaveBeenCalledTimes(1);
  });
});

// ─── listAll / listByRepo ──────────────────────────────────────────────────────

describe("listAll", () => {
  it("delegates to store.listAll()", () => {
    const env = makeEnv();
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
    });
    const deps = makeDeps({ store });
    const monitor = createEnvironmentMonitor(deps);

    const result = monitor.listAll();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("env-1");
    expect(store.listAll).toHaveBeenCalledOnce();
  });

  it("returns empty array when store has no environments", () => {
    const deps = makeDeps();
    const monitor = createEnvironmentMonitor(deps);

    const result = monitor.listAll();
    expect(result).toEqual([]);
  });
});

describe("listByRepo", () => {
  it("delegates to store.listByRepo() with correct args", () => {
    const env = makeEnv();
    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([env]),
    });
    const deps = makeDeps({ store });
    const monitor = createEnvironmentMonitor(deps);

    const result = monitor.listByRepo("acme-org", "my-repo");

    expect(result).toHaveLength(1);
    expect(store.listByRepo).toHaveBeenCalledWith("acme-org", "my-repo");
  });

  it("returns empty array for unknown repo", () => {
    const deps = makeDeps();
    const monitor = createEnvironmentMonitor(deps);

    const result = monitor.listByRepo("unknown-org", "unknown-repo");
    expect(result).toEqual([]);
  });
});

// ─── getActivityLog ────────────────────────────────────────────────────────────

describe("getActivityLog", () => {
  it("returns the injected activity log instance", () => {
    const activityLog = makeActivityLog();
    const deps = makeDeps({ activityLog });
    const monitor = createEnvironmentMonitor(deps);

    expect(monitor.getActivityLog()).toBe(activityLog);
  });
});

// ─── Status transitions ────────────────────────────────────────────────────────

describe("initial sync — status transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs status_changed when poll result differs from previous status", async () => {
    const env = makeEnv({ id: "env-1", status: "building" });
    const updatedEnv = makeEnv({ id: "env-1", status: "ready" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(updatedEnv),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "ready",
        environmentUrl: "https://pr-42.proboapp.io",
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const statusCall = appendCalls.find((c) => c[0]?.eventType === "status_changed");
    expect(statusCall).toBeDefined();
    expect(statusCall?.[0]?.detail).toContain("building");
    expect(statusCall?.[0]?.detail).toContain("ready");
  });

  it("logs environment_expired when status transitions to expired", async () => {
    const env = makeEnv({ id: "env-1", status: "ready" });
    const expiredEnv = makeEnv({ id: "env-1", status: "expired" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(expiredEnv),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "expired",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const expiredCall = appendCalls.find((c) => c[0]?.eventType === "environment_expired");
    expect(expiredCall).toBeDefined();
  });

  it("logs environment_failed when status transitions to failed", async () => {
    const env = makeEnv({ id: "env-1", status: "building" });
    const failedEnv = makeEnv({ id: "env-1", status: "failed" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(failedEnv),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "failed",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const failedCall = appendCalls.find((c) => c[0]?.eventType === "environment_failed");
    expect(failedCall).toBeDefined();
  });

  it("does not log status_changed when status is unchanged", async () => {
    const env = makeEnv({ id: "env-1", status: "building" });
    const sameEnv = makeEnv({ id: "env-1", status: "building" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(sameEnv),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "building",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const statusCall = appendCalls.find((c) => c[0]?.eventType === "status_changed");
    expect(statusCall).toBeUndefined();
  });

  it("logs check_performed after each initial sync poll", async () => {
    const env = makeEnv({ id: "env-1", status: "building" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(env),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "building",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const checkCall = appendCalls.find((c) => c[0]?.eventType === "check_performed");
    expect(checkCall).toBeDefined();
  });

  it("skips sync entry when store.findById returns undefined after poll", async () => {
    const env = makeEnv({ id: "env-1", prNumber: 42, status: "building" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(undefined),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "ready",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    // No status_changed or check_performed should be logged since findById returned undefined
    const statusCall = appendCalls.find((c) => c[0]?.eventType === "status_changed");
    const checkCall = appendCalls.find((c) => c[0]?.eventType === "check_performed");
    expect(statusCall).toBeUndefined();
    expect(checkCall).toBeUndefined();
  });

  it("skips sync entry when poll returns undefined", async () => {
    const env = makeEnv({ id: "env-1", prNumber: 42, status: "building" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
    });
    const activityLog = makeActivityLog();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue(undefined),
    });
    const deps = makeDeps({ store, activityLog, poller });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    const appendCalls = vi.mocked(activityLog.append).mock.calls;
    const checkCall = appendCalls.find((c) => c[0]?.eventType === "check_performed");
    expect(checkCall).toBeUndefined();
  });

  it("calls onPollResult callback when provided after sync poll", async () => {
    const env = makeEnv({ id: "env-1", status: "building" });
    const updatedEnv = makeEnv({ id: "env-1", status: "ready" });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findById: vi.fn().mockReturnValue(updatedEnv),
    });
    const onPollResult = vi.fn();
    const poller = makePoller({
      pollForPr: vi.fn().mockResolvedValue({
        environmentId: "env-1",
        deploymentId: 9001,
        status: "ready",
        environmentUrl: undefined,
        rateLimited: false,
      } satisfies PollResult),
    });
    const deps = makeDeps({ store, poller, onPollResult });
    const monitor = createEnvironmentMonitor(deps);

    monitor.start();
    await vi.runAllTimersAsync();

    expect(onPollResult).toHaveBeenCalledOnce();
    expect(onPollResult).toHaveBeenCalledWith(updatedEnv, "building");
  });
});

// ─── Index re-exports ──────────────────────────────────────────────────────────

describe("index re-exports", () => {
  it("exports createEnvironmentMonitor from index", async () => {
    const indexModule = await import("../src/index.js");
    expect(indexModule.createEnvironmentMonitor).toBeDefined();
  });
});
