import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readSyncMetadata } from "../src/metadata";
import { GitCommandError, resolveHomePath, syncSkills } from "../src/sync";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function setupTaggedRepo(root: string): Promise<{ repoPath: string }> {
  const repoPath = join(root, "skills-repo");
  await git(["init", repoPath]);
  await git(["-C", repoPath, "config", "user.email", "skill-sync@test.local"]);
  await git(["-C", repoPath, "config", "user.name", "Skill Sync Test"]);

  await mkdir(join(repoPath, "skills", "proposal"), { recursive: true });
  await mkdir(join(repoPath, "skills", "copy"), { recursive: true });
  await writeFile(join(repoPath, "skills", "proposal", "SKILL.md"), "# Proposal v1\n", "utf8");
  await writeFile(join(repoPath, "skills", "copy", "SKILL.md"), "# Copy v1\n", "utf8");

  await git(["-C", repoPath, "add", "."]);
  await git(["-C", repoPath, "commit", "-m", "v1"]);
  await git(["-C", repoPath, "tag", "v1.0.0"]);

  await writeFile(join(repoPath, "skills", "proposal", "SKILL.md"), "# Proposal v1.1\n", "utf8");
  await git(["-C", repoPath, "rm", "skills/copy/SKILL.md"]);
  await mkdir(join(repoPath, "skills", "strategy"), { recursive: true });
  await writeFile(join(repoPath, "skills", "strategy", "SKILL.md"), "# Strategy v1.1\n", "utf8");
  await git(["-C", repoPath, "add", "."]);
  await git(["-C", repoPath, "commit", "-m", "v1.1"]);
  await git(["-C", repoPath, "tag", "v1.1.0"]);

  return { repoPath };
}

describe("syncSkills", () => {
  it("syncs from repo root when no skills directory exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const repoPath = join(root, "root-repo");
    await git(["init", repoPath]);
    await git(["-C", repoPath, "config", "user.email", "skill-sync@test.local"]);
    await git(["-C", repoPath, "config", "user.name", "Skill Sync Test"]);
    await writeFile(join(repoPath, "SKILL.md"), "# Root Skill\n", "utf8");
    await git(["-C", repoPath, "add", "."]);
    await git(["-C", repoPath, "commit", "-m", "root"]);
    await git(["-C", repoPath, "tag", "v1.0.0"]);

    const dest = join(root, "dest");
    const cache = join(root, "cache");
    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(result.status).toBe("success");
    const synced = await readFile(join(dest, "SKILL.md"), "utf8");
    expect(synced).toContain("Root Skill");
  });

  it("expands home paths", () => {
    expect(resolveHomePath("~")).not.toBe("~");
    expect(resolveHomePath("~/abc")).toContain("abc");
    expect(resolveHomePath("/tmp/abc")).toBe("/tmp/abc");
  });

  it("performs first-run clone and sync, then no-op on same version", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    const first = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(first.status).toBe("success");
    expect(first.noop).toBe(false);

    const skill = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(skill).toContain("v1");

    const second = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(second.status).toBe("success");
    expect(second.noop).toBe(true);

    const metadata = await readSyncMetadata(join(dest, ".sync-metadata.json"));
    expect(metadata?.version).toBe("v1.0.0");
    expect(metadata?.managedFiles).toHaveProperty("proposal/SKILL.md");
  });

  it("updates when target version changes and removes stale files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.1.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(result.status).toBe("success");
    expect(result.noop).toBe(false);
    const updated = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(updated).toContain("v1.1");

    await expect(readFile(join(dest, "copy", "SKILL.md"), "utf8")).rejects.toThrow();
    const strategy = await readFile(join(dest, "strategy", "SKILL.md"), "utf8");
    expect(strategy).toContain("v1.1");
  });

  it("backs up modified files and prunes old backups", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");
    const backup = join(root, "backups");

    let tick = 0;
    const now = () => {
      tick += 1;
      return new Date(Date.UTC(2026, 2, 10, 12, 0, tick));
    };

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      backupDir: backup,
      maxBackups: 2,
      now
    });

    await writeFile(join(dest, "proposal", "SKILL.md"), "local edit 1", "utf8");
    const first = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      backupDir: backup,
      maxBackups: 2,
      now
    });

    expect(first.backupPath).toBeTruthy();

    await writeFile(join(dest, "proposal", "SKILL.md"), "local edit 2", "utf8");
    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      backupDir: backup,
      maxBackups: 2,
      now
    });

    await writeFile(join(dest, "proposal", "SKILL.md"), "local edit 3", "utf8");
    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      backupDir: backup,
      maxBackups: 2,
      now
    });

    const backupDirs = (await readdir(backup)).sort();
    expect(backupDirs.length).toBe(2);

    const restored = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(restored).toContain("Proposal v1");
  });

  it("fails gracefully in offline mode and preserves last good state", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    const prior = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.1.0",
      destDir: dest,
      cacheDir: cache,
      commandRunner: async () => {
        throw new GitCommandError("offline", "Could not resolve host: github.com");
      }
    });

    expect(result.status).toBe("offline");
    expect(result.noop).toBe(true);

    const stillThere = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(stillThere).toBe(prior);

    const metadata = await readSyncMetadata(join(dest, ".sync-metadata.json"));
    expect(metadata?.status).toBe("offline");
    expect(metadata?.lastSuccess).toBeDefined();
  });

  it("throws on invalid target version", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    await expect(
      syncSkills({
        repoUrl: repoPath,
        targetVersion: "v9.9.9",
        destDir: dest,
        cacheDir: cache,
        commandRunner: async () => {
          throw new GitCommandError("invalid", "fatal: couldn't find remote ref refs/tags/v9.9.9");
        }
      })
    ).rejects.toThrow(/Invalid target version/);

    const metadata = await readSyncMetadata(join(dest, ".sync-metadata.json"));
    expect(metadata?.status).toBe("error");
  });

  it("returns locked status when another sync holds the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, ".sync.lock"), "locked", "utf8");

    const result = await syncSkills({
      repoUrl: "https://example.com/repo.git",
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      lockRetries: 0
    });

    expect(result.status).toBe("locked");
    expect(result.noop).toBe(true);
  });

  it("retries lock acquisition and succeeds when lock clears", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await mkdir(cache, { recursive: true });
    const lockPath = join(cache, ".sync.lock");
    await writeFile(lockPath, "locked", "utf8");
    setTimeout(() => {
      void rm(lockPath, { force: true });
    }, 10);

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache,
      lockRetries: 10,
      lockRetryDelayMs: 5
    });

    expect(result.status).toBe("success");
  });

  it("recovers when a managed destination file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    await rm(join(dest, "proposal", "SKILL.md"));

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(result.status).toBe("success");
    expect(result.noop).toBe(false);
    const restored = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(restored).toContain("Proposal v1");
  });

  it("re-syncs when cache content changes for same pinned version", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    await writeFile(join(cache, "repo", "skills", "proposal", "SKILL.md"), "# Proposal cache-drift\n", "utf8");

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(result.noop).toBe(false);
    const updated = await readFile(join(dest, "proposal", "SKILL.md"), "utf8");
    expect(updated).toContain("cache-drift");
  });

  it("throws for unknown git failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await expect(
      syncSkills({
        repoUrl: "https://example.com/repo.git",
        targetVersion: "v1.0.0",
        destDir: dest,
        cacheDir: cache,
        commandRunner: async () => {
          throw new GitCommandError("unknown", "fatal: exploded");
        }
      })
    ).rejects.toThrow(/unknown/);
  });

  it("throws unknown errors from git with stderr attached", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const dest = join(root, "dest");
    const cache = join(root, "cache");
    const missingRepo = join(root, "missing-repo");

    await expect(
      syncSkills({
        repoUrl: missingRepo,
        targetVersion: "v1.0.0",
        destDir: dest,
        cacheDir: cache
      })
    ).rejects.toThrow();
  });

  it("handles git binary execution failures without stderr", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await expect(
      syncSkills({
        repoUrl: "https://example.com/repo.git",
        targetVersion: "v1.0.0",
        destDir: dest,
        cacheDir: cache,
        gitBinary: "git-binary-that-does-not-exist"
      })
    ).rejects.toThrow(/git clone/);
  });

  it("handles key-length drift between metadata and cache manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    await mkdir(join(cache, "repo", "skills", "extra"), { recursive: true });
    await writeFile(join(cache, "repo", "skills", "extra", "SKILL.md"), "# Extra\n", "utf8");
    await mkdir(join(dest, "extra"), { recursive: true });
    await writeFile(join(dest, "extra", "SKILL.md"), "# Extra\n", "utf8");

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    expect(result.noop).toBe(false);
    expect(result.filesUpdated).toBeGreaterThan(0);
  });

  it("supports injected commandRunner success path", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const { repoPath } = await setupTaggedRepo(root);
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v1.0.0",
      destDir: dest,
      cacheDir: cache
    });

    const result = await syncSkills({
      repoUrl: repoPath,
      targetVersion: "v2.0.0",
      destDir: dest,
      cacheDir: cache,
      commandRunner: async () => undefined
    });

    expect(result.status).toBe("success");
  });

  it("handles non-Error throws in sync catch path", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-sync-"));
    const dest = join(root, "dest");
    const cache = join(root, "cache");

    await expect(
      syncSkills({
        repoUrl: "https://example.com/repo.git",
        targetVersion: "v1.0.0",
        destDir: dest,
        cacheDir: cache,
        commandRunner: async () => {
          throw "string failure";
        }
      })
    ).rejects.toEqual("string failure");

    const metadata = await readSyncMetadata(join(dest, ".sync-metadata.json"));
    expect(metadata?.status).toBe("error");
    expect(metadata?.error).toContain("string failure");
  });

  it("rejects invalid repoUrl (flag-injectable)", async () => {
    await expect(
      syncSkills({
        repoUrl: "--upload-pack=malicious",
        targetVersion: "v1.0.0",
        destDir: "/tmp/dest",
        cacheDir: "/tmp/cache",
      })
    ).rejects.toThrow("Invalid repoUrl");
  });

  it("rejects invalid targetVersion (flag-injectable)", async () => {
    await expect(
      syncSkills({
        repoUrl: "https://example.com/repo.git",
        targetVersion: "--exec=malicious",
        destDir: "/tmp/dest",
        cacheDir: "/tmp/cache",
      })
    ).rejects.toThrow("Invalid targetVersion");
  });

});
