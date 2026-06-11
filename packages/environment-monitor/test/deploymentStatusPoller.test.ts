import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDeploymentStatusPoller,
  mapGitHubStateToStatus,
} from "../src/deploymentStatusPoller.js";
import type {
  ExecCommand,
  DeploymentStatusPollerDeps,
} from "../src/deploymentStatusPoller.js";
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
    taskBranchId: undefined,
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

function prViewJson(sha: string): string {
  return JSON.stringify({ headRefOid: sha });
}

function deploymentsJson(deployments: object[]): string {
  return JSON.stringify(deployments);
}

function statusesJson(statuses: object[]): string {
  return JSON.stringify(statuses);
}

function makeExecCommand(
  responses: Record<string, { stdout: string; stderr: string } | Error>,
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) return Promise.reject(response);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected command: ${key}`));
  });
}

function ok(stdout: string): { stdout: string; stderr: string } {
  return { stdout, stderr: "" };
}

// ─── mapGitHubStateToStatus ───────────────────────────────────────────────────

describe("mapGitHubStateToStatus", () => {
  it.each([
    ["pending", "building"],
    ["queued", "building"],
    ["in_progress", "building"],
    ["waiting", "building"],
    ["success", "ready"],
    ["failure", "failed"],
    ["error", "failed"],
    ["inactive", "expired"],
    ["abandoned", "expired"],
  ] as [string, RemoteEnvironmentStatus][])(
    "maps GitHub state %s → %s",
    (ghState, expected) => {
      expect(mapGitHubStateToStatus(ghState)).toBe(expected);
    },
  );

  it("maps unknown state to 'building'", () => {
    expect(mapGitHubStateToStatus("unknown_state")).toBe("building");
  });

  it("is case-insensitive", () => {
    expect(mapGitHubStateToStatus("SUCCESS")).toBe("ready");
    expect(mapGitHubStateToStatus("FAILURE")).toBe("failed");
  });
});

// ─── pollForPr ────────────────────────────────────────────────────────────────

describe("pollForPr", () => {
  it("returns undefined when gh pr view returns no headRefOid", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(
        JSON.stringify({}),
      ),
    });
    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });

    const result = await poller.pollForPr("acme-org", "my-repo", 42);
    expect(result).toBeUndefined();
  });

  it("returns undefined when headRefOid is empty string", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(
        JSON.stringify({ headRefOid: "" }),
      ),
    });
    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });

    const result = await poller.pollForPr("acme-org", "my-repo", 42);
    expect(result).toBeUndefined();
  });

  it("returns undefined when deployments array is empty", async () => {
    const sha = "abc123def456";
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([]),
      ),
    });
    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });

    const result = await poller.pollForPr("acme-org", "my-repo", 42);
    expect(result).toBeUndefined();
  });

  it("upserts a new environment when no existing record found", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const envUrl = "https://pr-42.proboapp.io";

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: envUrl }]),
      ),
    });

    const upserted = makeEnv({ id: "new-env", deploymentId, status: "ready", environmentUrl: envUrl });
    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([]),
      upsertFromDeployment: vi.fn().mockReturnValue(upserted),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeDefined();
    expect(result?.status).toBe("ready");
    expect(result?.environmentUrl).toBe(envUrl);
    expect(result?.deploymentId).toBe(deploymentId);
    expect(result?.rateLimited).toBe(false);
    expect(store.upsertFromDeployment).toHaveBeenCalledOnce();
  });

  it("updates existing environment when deploymentId matches", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const envUrl = "https://pr-42.proboapp.io";
    const existingEnv = makeEnv({ id: "existing-env", deploymentId, status: "building" });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: envUrl }]),
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(existingEnv),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeDefined();
    expect(result?.environmentId).toBe("existing-env");
    expect(result?.status).toBe("ready");
    expect(store.updateStatus).toHaveBeenCalledWith("existing-env", "ready", envUrl);
    expect(store.updateLastChecked).toHaveBeenCalledWith("existing-env");
    expect(store.upsertFromDeployment).not.toHaveBeenCalled();
  });

  it("updates existing PR environment when deploymentId not yet tracked", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const envUrl = "https://pr-42.proboapp.io";
    const prEnv = makeEnv({ id: "pr-env", deploymentId: undefined, status: "building" });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: envUrl }]),
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([prEnv]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.environmentId).toBe("pr-env");
    expect(store.updateStatus).toHaveBeenCalledWith("pr-env", "ready", envUrl);
    expect(store.upsertFromDeployment).not.toHaveBeenCalled();
  });

  it("maps building status correctly when statuses array is empty", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([]),
      ),
    });

    const upserted = makeEnv({ status: "building", environmentUrl: undefined });
    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([]),
      upsertFromDeployment: vi.fn().mockReturnValue(upserted),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.status).toBe("building");
    expect(result?.environmentUrl).toBeUndefined();
  });

  it("handles null environment_url in status", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "in_progress", environment_url: null }]),
      ),
    });

    const upserted = makeEnv({ status: "building", environmentUrl: undefined });
    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([]),
      upsertFromDeployment: vi.fn().mockReturnValue(upserted),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.status).toBe("building");
    expect(result?.environmentUrl).toBeUndefined();
  });

  it("handles invalid JSON from gh pr view gracefully", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok("not-json"),
    });
    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });

    const result = await poller.pollForPr("acme-org", "my-repo", 42);
    expect(result).toBeUndefined();
  });

  it("handles invalid JSON from deployments API gracefully", async () => {
    const sha = "abc123def456";

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok("bad-json"),
    });
    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });

    const result = await poller.pollForPr("acme-org", "my-repo", 42);
    expect(result).toBeUndefined();
  });
});

// ─── Rate limit handling ──────────────────────────────────────────────────────

describe("pollForPr — rate limit handling", () => {
  it("returns rateLimited=true and last-known status when gh pr view returns 403", async () => {
    const existingEnv = makeEnv({ id: "env-rl", status: "building", environmentUrl: undefined });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": new Error(
        "gh: 403 rate limit exceeded",
      ),
    });

    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([existingEnv]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeDefined();
    expect(result?.rateLimited).toBe(true);
    expect(result?.status).toBe("building");
    expect(store.updateLastChecked).toHaveBeenCalledWith("env-rl");
  });

  it("returns undefined when rate limited and no existing environment found", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": new Error(
        "403 rate_limit",
      ),
    });

    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeUndefined();
  });

  it("returns rateLimited=true when deployments API returns 403", async () => {
    const sha = "abc123def456";
    const existingEnv = makeEnv({ id: "env-rl2", status: "ready" });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: new Error(
        "403 rate limit exceeded",
      ),
    });

    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([existingEnv]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.rateLimited).toBe(true);
    expect(result?.status).toBe("ready");
  });

  it("returns undefined when deployments API rate-limited and no env found", async () => {
    const sha = "abc123def456";

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: new Error(
        "403 rate limit exceeded",
      ),
    });

    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeUndefined();
  });

  it("returns rateLimited=true when statuses API returns 403 with existing record", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const existingEnv = makeEnv({ id: "env-rl3", deploymentId, status: "building" });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: new Error(
        "403 rate limit",
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(existingEnv),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.rateLimited).toBe(true);
    expect(result?.status).toBe("building");
    expect(store.updateLastChecked).toHaveBeenCalledWith("env-rl3");
  });

  it("returns undefined when statuses API rate-limited and no deployment record exists", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: new Error(
        "403 rate limit",
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeUndefined();
  });

  it("detects rate limit via 'rate limit' string (no 403)", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": new Error(
        "API rate limit exceeded for user",
      ),
    });

    const store = makeStore({
      listByRepo: vi.fn().mockReturnValue([makeEnv()]),
    });

    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result?.rateLimited).toBe(true);
  });
});

// ─── Non-rate-limited failures ────────────────────────────────────────────────

describe("pollForPr — non-rate-limited gh failures", () => {
  it("handles non-Error rejection from gh CLI", async () => {
    const execCommand = vi.fn().mockRejectedValue("non-error string") as ExecCommand;

    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeUndefined();
  });

  it("returns undefined when gh pr view fails without rate limit signal", async () => {
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": new Error(
        "gh: PR not found",
      ),
    });

    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeUndefined();
  });

  it("returns undefined (empty array) when deployments API fails without rate limit", async () => {
    const sha = "abc123def456";
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: new Error(
        "gh: API error 500",
      ),
    });

    const store = makeStore();
    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    // empty deployments → undefined
    expect(result).toBeUndefined();
  });

  it("treats deployment statuses API failure as building status", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: new Error(
        "gh: Internal Server Error",
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([]),
    });
    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeDefined();
    expect(result?.status).toBe("building");
  });

  it("treats deployment statuses API returning invalid JSON as building status", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        "not-valid-json{{{",
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(undefined),
      listByRepo: vi.fn().mockReturnValue([]),
    });
    const poller = createDeploymentStatusPoller({ execCommand, store });
    const result = await poller.pollForPr("acme-org", "my-repo", 42);

    expect(result).toBeDefined();
    expect(result?.status).toBe("building");
  });
});

// ─── Polling lifecycle ────────────────────────────────────────────────────────

describe("startPolling / stopPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls pollAllEnvironments after poll interval elapses", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const env = makeEnv({ prNumber: 42 });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: "https://pr-42.proboapp.io" }]),
      ),
    });

    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env]),
      findByDeploymentId: vi.fn().mockReturnValue(env),
    });

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    expect(store.listAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.listAll).toHaveBeenCalled();
    poller.stopPolling();
  });

  it("does not fire before the interval elapses", async () => {
    const store = makeStore();
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    await vi.advanceTimersByTimeAsync(59_999);

    expect(store.listAll).not.toHaveBeenCalled();
    poller.stopPolling();
  });

  it("fires multiple times on repeated intervals", async () => {
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([]),
    });
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(store.listAll).toHaveBeenCalledTimes(3);
    poller.stopPolling();
  });

  it("stopPolling prevents further polls", async () => {
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([]),
    });
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.listAll).toHaveBeenCalledTimes(1);

    poller.stopPolling();
    await vi.advanceTimersByTimeAsync(120_000);
    // Should not have been called again
    expect(store.listAll).toHaveBeenCalledTimes(1);
  });

  it("startPolling is idempotent — calling twice does not double-fire", async () => {
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([]),
    });
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    poller.startPolling(); // second call should be ignored

    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.listAll).toHaveBeenCalledTimes(1);
    poller.stopPolling();
  });

  it("stopPolling is safe to call when not started", () => {
    const store = makeStore();
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({ execCommand, store });
    expect(() => poller.stopPolling()).not.toThrow();
  });

  it("skips environments without prNumber during poll", async () => {
    const envNoPr = makeEnv({ prNumber: undefined });
    const store = makeStore({
      listAll: vi.fn().mockReturnValue([envNoPr]),
    });
    const execCommand = vi.fn() as unknown as ExecCommand;

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    await vi.advanceTimersByTimeAsync(60_000);

    // execCommand should never be called — no PR to poll
    expect(execCommand).not.toHaveBeenCalled();
    poller.stopPolling();
  });

  it("deduplicates polling calls for same repo/PR across multiple environments", async () => {
    const env1 = makeEnv({ id: "env-a", prNumber: 42, deploymentId: 9001 });
    const env2 = makeEnv({ id: "env-b", prNumber: 42, deploymentId: 9001 });

    const sha = "abc123def456";
    const deploymentId = 9001;
    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: "https://pr-42.proboapp.io" }]),
      ),
    });

    const store = makeStore({
      listAll: vi.fn().mockReturnValue([env1, env2]),
      findByDeploymentId: vi.fn().mockReturnValue(env1),
    });

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      pollIntervalMs: 60_000,
    });

    poller.startPolling();
    await vi.advanceTimersByTimeAsync(60_000);

    // Should only call gh pr view once, not twice (deduplication)
    expect(execCommand).toHaveBeenCalledTimes(3); // pr view + deployments + statuses
    poller.stopPolling();
  });
});

// ─── triggerImmediatePoll ─────────────────────────────────────────────────────

describe("triggerImmediatePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers a poll after the debounce delay", async () => {
    const sha = "abc123def456";
    const deploymentId = 9001;
    const env = makeEnv({ deploymentId });

    const execCommand = makeExecCommand({
      "gh pr view 42 --repo acme-org/my-repo --json headRefOid": ok(prViewJson(sha)),
      [`gh api repos/acme-org/my-repo/deployments?sha=${sha}&per_page=20`]: ok(
        deploymentsJson([{ id: deploymentId, sha }]),
      ),
      [`gh api repos/acme-org/my-repo/deployments/${deploymentId}/statuses?per_page=10`]: ok(
        statusesJson([{ state: "success", environment_url: "https://pr-42.proboapp.io" }]),
      ),
    });

    const store = makeStore({
      findByDeploymentId: vi.fn().mockReturnValue(env),
    });

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      debounceMs: 500,
    });

    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    expect(execCommand).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(execCommand).toHaveBeenCalled();
  });

  it("debounces multiple rapid calls — only fires once", async () => {
    const execCommand = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ headRefOid: "" }), stderr: "" }) as ExecCommand;
    const store = makeStore();

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      debounceMs: 500,
    });

    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    poller.triggerImmediatePoll("acme-org", "my-repo", 42);

    await vi.advanceTimersByTimeAsync(500);

    // Only one gh pr view call — debounce collapsed three triggers into one
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("does not fire before the debounce delay", async () => {
    const execCommand = vi.fn() as unknown as ExecCommand;
    const store = makeStore();

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      debounceMs: 500,
    });

    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    await vi.advanceTimersByTimeAsync(499);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it("stopPolling cancels pending debounced triggers", async () => {
    const execCommand = vi.fn() as unknown as ExecCommand;
    const store = makeStore();

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      debounceMs: 500,
    });

    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    poller.stopPolling();

    await vi.advanceTimersByTimeAsync(500);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it("independent debounce keys for different PRs", async () => {
    const execCommand = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ headRefOid: "" }), stderr: "" }) as ExecCommand;
    const store = makeStore();

    const poller = createDeploymentStatusPoller({
      execCommand,
      store,
      debounceMs: 500,
    });

    poller.triggerImmediatePoll("acme-org", "my-repo", 42);
    poller.triggerImmediatePoll("acme-org", "my-repo", 43);

    await vi.advanceTimersByTimeAsync(500);

    // Both PRs should be polled — they have different debounce keys
    expect(execCommand).toHaveBeenCalledTimes(2);
  });
});
