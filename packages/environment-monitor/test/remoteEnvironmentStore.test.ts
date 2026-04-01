import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openRemoteEnvironmentStore,
  mapRowToRemoteEnvironment,
} from "../src/remoteEnvironmentStore";
import type {
  RemoteEnvironmentStore,
  RemoteEnvironment,
} from "../src/remoteEnvironmentStore";

function makeTmpDbPath(): string {
  return join(
    tmpdir(),
    `environment-monitor-test-${randomUUID()}`,
    "environment-monitor.db",
  );
}

function cleanupPath(dbPath: string): void {
  try {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function makeEnvInput(
  overrides?: Partial<Omit<RemoteEnvironment, "id" | "createdAt">>,
): Omit<RemoteEnvironment, "id" | "createdAt"> {
  const o = overrides ?? {};
  return {
    repoOwner: "repoOwner" in o ? (o.repoOwner as string) : "acme-org",
    repoName: "repoName" in o ? (o.repoName as string) : "my-repo",
    environmentType:
      "environmentType" in o
        ? (o.environmentType as EnvironmentType)
        : "probo",
    prNumber: "prNumber" in o ? o.prNumber : 42,
    prUrl:
      "prUrl" in o
        ? o.prUrl
        : "https://github.com/acme-org/my-repo/pull/42",
    prTitle: "prTitle" in o ? o.prTitle : "Add feature",
    deploymentId: "deploymentId" in o ? o.deploymentId : 9001,
    environmentUrl:
      "environmentUrl" in o ? o.environmentUrl : "https://pr-42.proboapp.io",
    status: "status" in o ? (o.status as RemoteEnvironmentStatus) : "building",
    taskBranchId: "taskBranchId" in o ? o.taskBranchId : undefined,
    errorMessage: "errorMessage" in o ? o.errorMessage : undefined,
    lastCheckedAt: "lastCheckedAt" in o ? (o.lastCheckedAt as number) : Date.now(),
  };
}

describe("openRemoteEnvironmentStore", () => {
  it("creates DB at custom path", () => {
    const dbPath = makeTmpDbPath();
    const store = openRemoteEnvironmentStore(dbPath);
    expect(store).toBeDefined();
    store.close();
    cleanupPath(dbPath);
  });

  it("creates parent directory if missing", () => {
    const dbPath = makeTmpDbPath();
    const store = openRemoteEnvironmentStore(dbPath);
    store.close();
    cleanupPath(dbPath);
  });

  it("schema is idempotent — opening twice works", () => {
    const dbPath = makeTmpDbPath();
    const store1 = openRemoteEnvironmentStore(dbPath);
    store1.close();
    const store2 = openRemoteEnvironmentStore(dbPath);
    store2.close();
    cleanupPath(dbPath);
  });

  it("creates DB at default path when no args given", () => {
    const fakeHome = join(tmpdir(), `fake-home-em-${randomUUID()}`);
    mkdirSync(fakeHome, { recursive: true });
    const originalHome = process.env["HOME"];
    process.env["HOME"] = fakeHome;

    try {
      const store = openRemoteEnvironmentStore();
      expect(store).toBeDefined();
      store.close();
    } finally {
      if (originalHome !== undefined) {
        process.env["HOME"] = originalHome;
      } else {
        delete process.env["HOME"];
      }
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe("upsertFromDeployment — insert", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("inserts a new environment and returns it with id and createdAt", () => {
    const input = makeEnvInput({ deploymentId: 1001 });
    const result = store.upsertFromDeployment(input);

    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.repoOwner).toBe("acme-org");
    expect(result.repoName).toBe("my-repo");
    expect(result.environmentType).toBe("probo");
    expect(result.prNumber).toBe(42);
    expect(result.deploymentId).toBe(1001);
    expect(result.status).toBe("building");
  });

  it("persists all optional fields correctly", () => {
    const input = makeEnvInput({
      deploymentId: 1002,
      taskBranchId: "tb-abc-123",
      errorMessage: "build failed",
    });
    const result = store.upsertFromDeployment(input);

    expect(result.taskBranchId).toBe("tb-abc-123");
    expect(result.errorMessage).toBe("build failed");
  });

  it("inserts with undefined optional fields as undefined", () => {
    const input = makeEnvInput({
      deploymentId: 1003,
      prNumber: undefined,
      prUrl: undefined,
      prTitle: undefined,
      taskBranchId: undefined,
      errorMessage: undefined,
      environmentUrl: undefined,
    });
    const result = store.upsertFromDeployment(input);

    expect(result.prNumber).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
    expect(result.prTitle).toBeUndefined();
    expect(result.taskBranchId).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
    expect(result.environmentUrl).toBeUndefined();
  });

  it("inserts without deploymentId (no deployment_id unique conflict)", () => {
    const input = makeEnvInput({ deploymentId: undefined, environmentType: "joyus-ai-hosted", status: "provisioning" });
    const result = store.upsertFromDeployment(input);
    expect(result.deploymentId).toBeUndefined();
    expect(result.status).toBe("provisioning");
  });

  it("inserts two records without deploymentId without conflict", () => {
    const a = store.upsertFromDeployment(makeEnvInput({ deploymentId: undefined, prNumber: 1 }));
    const b = store.upsertFromDeployment(makeEnvInput({ deploymentId: undefined, prNumber: 2 }));
    expect(a.id).not.toBe(b.id);
  });
});

describe("upsertFromDeployment — update", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("updates existing record when deploymentId matches, preserves id and createdAt", () => {
    const first = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 2001, status: "building" }),
    );

    const updated = store.upsertFromDeployment(
      makeEnvInput({
        deploymentId: 2001,
        status: "ready",
        environmentUrl: "https://pr-42-ready.proboapp.io",
      }),
    );

    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.status).toBe("ready");
    expect(updated.environmentUrl).toBe("https://pr-42-ready.proboapp.io");
  });

  it("updates task_branch_id on second upsert", () => {
    store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 2002, taskBranchId: undefined }),
    );
    const updated = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 2002, taskBranchId: "tb-xyz" }),
    );
    expect(updated.taskBranchId).toBe("tb-xyz");
  });

  it("upserts update with all optional fields undefined", () => {
    store.upsertFromDeployment(makeEnvInput({ deploymentId: 2003 }));
    const updated = store.upsertFromDeployment(
      makeEnvInput({
        deploymentId: 2003,
        prNumber: undefined,
        prUrl: undefined,
        prTitle: undefined,
        environmentUrl: undefined,
        taskBranchId: undefined,
        errorMessage: undefined,
      }),
    );
    expect(updated.prNumber).toBeUndefined();
    expect(updated.prUrl).toBeUndefined();
    expect(updated.prTitle).toBeUndefined();
    expect(updated.environmentUrl).toBeUndefined();
    expect(updated.taskBranchId).toBeUndefined();
    expect(updated.errorMessage).toBeUndefined();
  });
});

describe("findById", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("finds by id", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 3001 }));
    const found = store.findById(created.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it("returns undefined for unknown id", () => {
    expect(store.findById("no-such-id")).toBeUndefined();
  });

  it("returns undefined for soft-deleted record", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 3002 }));
    store.softDelete(created.id);
    expect(store.findById(created.id)).toBeUndefined();
  });
});

describe("findByDeploymentId", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("finds by deploymentId", () => {
    store.upsertFromDeployment(makeEnvInput({ deploymentId: 4001 }));
    const found = store.findByDeploymentId(4001);
    expect(found).toBeDefined();
    expect(found?.deploymentId).toBe(4001);
  });

  it("returns undefined for unknown deploymentId", () => {
    expect(store.findByDeploymentId(99999)).toBeUndefined();
  });

  it("returns undefined when deployment soft-deleted", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 4002 }));
    store.softDelete(created.id);
    expect(store.findByDeploymentId(4002)).toBeUndefined();
  });
});

describe("findByTaskBranchId", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("finds by taskBranchId", () => {
    store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 5001, taskBranchId: "tb-find-me" }),
    );
    const found = store.findByTaskBranchId("tb-find-me");
    expect(found).toBeDefined();
    expect(found?.taskBranchId).toBe("tb-find-me");
  });

  it("returns undefined for unknown taskBranchId", () => {
    expect(store.findByTaskBranchId("tb-ghost")).toBeUndefined();
  });

  it("returns undefined when soft-deleted", () => {
    const created = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 5002, taskBranchId: "tb-deleted" }),
    );
    store.softDelete(created.id);
    expect(store.findByTaskBranchId("tb-deleted")).toBeUndefined();
  });
});

describe("listByRepo", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty array when no records", () => {
    expect(store.listByRepo("org", "repo")).toEqual([]);
  });

  it("returns only records for the given repo", () => {
    store.upsertFromDeployment(
      makeEnvInput({ repoOwner: "org-a", repoName: "repo-1", deploymentId: 6001 }),
    );
    store.upsertFromDeployment(
      makeEnvInput({ repoOwner: "org-b", repoName: "repo-2", deploymentId: 6002 }),
    );

    const results = store.listByRepo("org-a", "repo-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.repoOwner).toBe("org-a");
  });

  it("excludes soft-deleted records", () => {
    const created = store.upsertFromDeployment(
      makeEnvInput({ repoOwner: "org-del", repoName: "repo-del", deploymentId: 6003 }),
    );
    store.softDelete(created.id);
    expect(store.listByRepo("org-del", "repo-del")).toHaveLength(0);
  });

  it("returns multiple records for same repo", () => {
    store.upsertFromDeployment(
      makeEnvInput({ repoOwner: "multi-org", repoName: "multi-repo", deploymentId: 6004, prNumber: 1 }),
    );
    store.upsertFromDeployment(
      makeEnvInput({ repoOwner: "multi-org", repoName: "multi-repo", deploymentId: 6005, prNumber: 2 }),
    );
    expect(store.listByRepo("multi-org", "multi-repo")).toHaveLength(2);
  });
});

describe("listAll", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty array when no records", () => {
    expect(store.listAll()).toEqual([]);
  });

  it("returns all non-deleted records", () => {
    store.upsertFromDeployment(makeEnvInput({ deploymentId: 7001 }));
    store.upsertFromDeployment(makeEnvInput({ deploymentId: 7002, prNumber: 43 }));
    expect(store.listAll()).toHaveLength(2);
  });

  it("excludes soft-deleted records", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 7003 }));
    store.softDelete(created.id);
    expect(store.listAll()).toHaveLength(0);
  });
});

describe("updateStatus", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("transitions status", () => {
    const created = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 8001, status: "building" }),
    );
    store.updateStatus(created.id, "ready");
    const found = store.findById(created.id);
    expect(found?.status).toBe("ready");
  });

  it("updates environmentUrl when provided", () => {
    const created = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 8002, status: "building", environmentUrl: undefined }),
    );
    store.updateStatus(created.id, "ready", "https://env.example.com");
    const found = store.findById(created.id);
    expect(found?.status).toBe("ready");
    expect(found?.environmentUrl).toBe("https://env.example.com");
  });

  it("preserves existing environmentUrl when not provided", () => {
    const created = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 8003, status: "building", environmentUrl: "https://existing.example.com" }),
    );
    store.updateStatus(created.id, "failed");
    const found = store.findById(created.id);
    expect(found?.environmentUrl).toBe("https://existing.example.com");
  });
});

describe("updateLastChecked", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("updates lastCheckedAt to current time", () => {
    const before = Date.now();
    const created = store.upsertFromDeployment(
      makeEnvInput({ deploymentId: 9001, lastCheckedAt: 1000 }),
    );
    expect(created.lastCheckedAt).toBe(1000);

    store.updateLastChecked(created.id);
    const found = store.findById(created.id);
    expect(found?.lastCheckedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("softDelete", () => {
  let store: RemoteEnvironmentStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openRemoteEnvironmentStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("excludes record from findById", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 10001 }));
    store.softDelete(created.id);
    expect(store.findById(created.id)).toBeUndefined();
  });

  it("excludes record from listAll", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 10002 }));
    store.softDelete(created.id);
    expect(store.listAll()).toHaveLength(0);
  });

  it("excludes record from findByDeploymentId", () => {
    const created = store.upsertFromDeployment(makeEnvInput({ deploymentId: 10003 }));
    store.softDelete(created.id);
    expect(store.findByDeploymentId(10003)).toBeUndefined();
  });
});

describe("close", () => {
  it("closes without error", () => {
    const dbPath = makeTmpDbPath();
    const store = openRemoteEnvironmentStore(dbPath);
    expect(() => store.close()).not.toThrow();
    cleanupPath(dbPath);
  });

  it("is idempotent — closing twice does not throw", () => {
    const dbPath = makeTmpDbPath();
    const store = openRemoteEnvironmentStore(dbPath);
    store.close();
    expect(() => store.close()).not.toThrow();
    cleanupPath(dbPath);
  });
});

describe("mapRowToRemoteEnvironment", () => {
  it("maps a full row correctly", () => {
    const row = {
      id: "env-1",
      repo_owner: "acme",
      repo_name: "site",
      environment_type: "probo",
      pr_number: 10,
      pr_url: "https://github.com/acme/site/pull/10",
      pr_title: "My PR",
      deployment_id: 42,
      environment_url: "https://pr-10.proboapp.io",
      status: "ready",
      task_branch_id: "tb-1",
      error_message: null,
      last_checked_at: 9000,
      created_at: 8000,
      deleted_at: null,
    };

    const result = mapRowToRemoteEnvironment(row);

    expect(result).toEqual({
      id: "env-1",
      repoOwner: "acme",
      repoName: "site",
      environmentType: "probo",
      prNumber: 10,
      prUrl: "https://github.com/acme/site/pull/10",
      prTitle: "My PR",
      deploymentId: 42,
      environmentUrl: "https://pr-10.proboapp.io",
      status: "ready",
      taskBranchId: "tb-1",
      errorMessage: undefined,
      lastCheckedAt: 9000,
      createdAt: 8000,
    });
  });

  it("maps null optional fields to undefined", () => {
    const row = {
      id: "env-2",
      repo_owner: "acme",
      repo_name: "site",
      environment_type: "joyus-ai-hosted",
      pr_number: null,
      pr_url: null,
      pr_title: null,
      deployment_id: null,
      environment_url: null,
      status: "provisioning",
      task_branch_id: null,
      error_message: null,
      last_checked_at: 1000,
      created_at: 500,
      deleted_at: null,
    };

    const result = mapRowToRemoteEnvironment(row);

    expect(result.prNumber).toBeUndefined();
    expect(result.prUrl).toBeUndefined();
    expect(result.prTitle).toBeUndefined();
    expect(result.deploymentId).toBeUndefined();
    expect(result.environmentUrl).toBeUndefined();
    expect(result.taskBranchId).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
  });
});

describe("index re-exports", () => {
  it("exports all public API from index", async () => {
    const indexModule = await import("../src/index");
    expect(indexModule.createProboDetector).toBeDefined();
    expect(indexModule.openRemoteEnvironmentStore).toBeDefined();
    expect(indexModule.mapRowToRemoteEnvironment).toBeDefined();
  });
});
