import { execFile as execFileCb } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSessionWiring } from "../../src/sidecar/sessionWiring.js";
import type { SessionWiring } from "../../src/sidecar/sessionWiring.js";

const execFile = promisify(execFileCb);

export async function createTestRepo(): Promise<{ repoPath: string; cleanup: () => void }> {
  // realpathSync resolves macOS /tmp -> /private/tmp symlink so git worktree
  // list --porcelain output matches the paths stored in the database.
  const repoPath = realpathSync(mkdtempSync(join(tmpdir(), "joyus-test-")));
  await execFile("git", ["init"], { cwd: repoPath });
  await execFile("git", ["config", "user.email", "test@test.com"], { cwd: repoPath });
  await execFile("git", ["config", "user.name", "Test"], { cwd: repoPath });
  writeFileSync(join(repoPath, "README.md"), "# test");
  await execFile("git", ["add", "."], { cwd: repoPath });
  await execFile("git", ["commit", "-m", "init"], { cwd: repoPath });
  return {
    repoPath,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}

export interface TestWiring {
  wiring: SessionWiring;
  notifications: Array<{ method: string; params: Record<string, unknown> }>;
  dbDir: string;
}

export async function createTestWiring(opts?: {
  pollIntervalMs?: number;
  staleDays?: number;
}): Promise<TestWiring> {
  const dbDir = realpathSync(mkdtempSync(join(tmpdir(), "joyus-db-")));
  const dbPath = join(dbDir, "test.db");
  const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
  const sendNotification = (method: string, params: unknown) => {
    notifications.push({ method, params: params as Record<string, unknown> });
  };
  const wiring = await createSessionWiring({
    sendNotification,
    dbPath,
    pollIntervalMs: opts?.pollIntervalMs ?? 60_000,
    ...(opts?.staleDays !== undefined ? { staleDays: opts.staleDays } : {}),
  });
  return { wiring, notifications, dbDir };
}

export function cleanupWiring(testWiring: TestWiring, dbDir: string): void {
  rmSync(dbDir, { recursive: true, force: true });
}
