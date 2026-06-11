import { describe, expect, it, vi } from "vitest";
import { createGitPusher } from "../src/gitPusher";

describe("createGitPusher", () => {
  it("pushes with default remote 'origin'", async () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const pusher = createGitPusher({ execGit });

    await pusher.push("/repo", "joyus/2026-04-01-feature");

    expect(execGit).toHaveBeenCalledWith(
      ["push", "-u", "origin", "joyus/2026-04-01-feature"],
      "/repo",
    );
  });

  it("pushes with a custom remote", async () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const pusher = createGitPusher({ execGit });

    await pusher.push("/repo", "feature-branch", "upstream");

    expect(execGit).toHaveBeenCalledWith(
      ["push", "-u", "upstream", "feature-branch"],
      "/repo",
    );
  });

  it("propagates errors from execGit", async () => {
    const execGit = vi
      .fn()
      .mockRejectedValue(new Error("remote: Permission denied"));
    const pusher = createGitPusher({ execGit });

    await expect(pusher.push("/repo", "main")).rejects.toThrow(
      "remote: Permission denied",
    );
  });
});
