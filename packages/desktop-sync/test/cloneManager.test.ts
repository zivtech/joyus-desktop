import { describe, expect, it, vi } from "vitest";
import {
  cloneOrUpdate,
  copySkillsAtomic,
  ensureCloneDir,
  isNetworkAvailable,
  readCloneMetadata,
} from "../src/cloneManager";

describe("ensureCloneDir", () => {
  it("creates the cache directory recursively", async () => {
    const deps = {
      mkdir: vi.fn().mockResolvedValue(undefined),
    };

    await ensureCloneDir("/cache/dir", deps);

    expect(deps.mkdir).toHaveBeenCalledWith("/cache/dir", { recursive: true });
  });
});

describe("cloneOrUpdate", () => {
  it("clones when .git directory does not exist", async () => {
    const deps = {
      execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
      exists: vi.fn().mockResolvedValue(false),
    };

    await cloneOrUpdate("https://repo.git", "/cache", "v1.0.0", deps);

    expect(deps.exists).toHaveBeenCalledWith("/cache/.git");
    expect(deps.execGit).toHaveBeenCalledWith([
      "clone",
      "--depth",
      "1",
      "--branch",
      "v1.0.0",
      "https://repo.git",
      "/cache",
    ]);
  });

  it("fetches and checks out when .git directory exists", async () => {
    const deps = {
      execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
      exists: vi.fn().mockResolvedValue(true),
    };

    await cloneOrUpdate("https://repo.git", "/cache", "v2.0.0", deps);

    expect(deps.exists).toHaveBeenCalledWith("/cache/.git");
    expect(deps.execGit).toHaveBeenCalledWith(
      ["fetch", "origin", "tag", "v2.0.0", "--depth", "1"],
      "/cache"
    );
    expect(deps.execGit).toHaveBeenCalledWith(["checkout", "v2.0.0"], "/cache");
  });
});

describe("copySkillsAtomic", () => {
  it("copies via temp dir when dest does not exist", async () => {
    const deps = {
      copyDir: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
    };

    await copySkillsAtomic("/cache", "/dest", deps);

    expect(deps.mkdir).toHaveBeenCalledWith("/dest.tmp", { recursive: true });
    expect(deps.copyDir).toHaveBeenCalledWith("/cache/skills", "/dest.tmp");
    expect(deps.exists).toHaveBeenCalledWith("/dest");
    expect(deps.copyDir).toHaveBeenCalledWith("/dest.tmp", "/dest");
    expect(deps.copyDir).toHaveBeenCalledTimes(2);
  });

  it("backs up existing dest before copying", async () => {
    const deps = {
      copyDir: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    };

    await copySkillsAtomic("/cache", "/dest", deps);

    expect(deps.mkdir).toHaveBeenCalledWith("/dest.tmp", { recursive: true });
    expect(deps.copyDir).toHaveBeenCalledWith("/cache/skills", "/dest.tmp");
    expect(deps.exists).toHaveBeenCalledWith("/dest");
    expect(deps.copyDir).toHaveBeenCalledWith("/dest", "/dest.bak");
    expect(deps.copyDir).toHaveBeenCalledWith("/dest.tmp", "/dest");
    expect(deps.copyDir).toHaveBeenCalledTimes(3);
  });
});

describe("readCloneMetadata", () => {
  it("reads the current tag from git describe", async () => {
    const deps = {
      execGit: vi.fn().mockResolvedValue({ stdout: "v1.2.0\n", stderr: "" }),
    };

    const version = await readCloneMetadata("/cache", deps);

    expect(version).toBe("v1.2.0");
    expect(deps.execGit).toHaveBeenCalledWith(
      ["describe", "--tags", "--exact-match"],
      "/cache"
    );
  });
});

describe("isNetworkAvailable", () => {
  it("returns true when ls-remote succeeds", async () => {
    const deps = {
      execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    };

    const result = await isNetworkAvailable("https://repo.git", deps);

    expect(result).toBe(true);
    expect(deps.execGit).toHaveBeenCalledWith([
      "ls-remote",
      "--exit-code",
      "https://repo.git",
    ]);
  });

  it("returns false when ls-remote fails", async () => {
    const deps = {
      execGit: vi.fn().mockRejectedValue(new Error("network error")),
    };

    const result = await isNetworkAvailable("https://repo.git", deps);

    expect(result).toBe(false);
  });
});
