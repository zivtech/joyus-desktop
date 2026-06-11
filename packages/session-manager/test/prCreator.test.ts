import { describe, expect, it, vi } from "vitest";
import {
  createPrCreator,
  parsePrNumberFromUrl,
} from "../src/prCreator";

describe("parsePrNumberFromUrl", () => {
  it("extracts PR number from a standard GitHub URL", () => {
    expect(
      parsePrNumberFromUrl("https://github.com/owner/repo/pull/42"),
    ).toBe(42);
  });

  it("handles trailing whitespace/newline", () => {
    expect(
      parsePrNumberFromUrl("https://github.com/owner/repo/pull/100\n"),
    ).toBe(100);
  });

  it("returns undefined for a non-matching URL", () => {
    expect(parsePrNumberFromUrl("https://github.com/owner/repo")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parsePrNumberFromUrl("")).toBeUndefined();
  });
});

describe("createPrCreator", () => {
  it("creates a draft PR and returns prNumber, prUrl, prTitle", async () => {
    const execCommand = vi.fn().mockResolvedValue({
      stdout: "https://github.com/zivtech/my-site/pull/7\n",
      stderr: "",
    });
    const creator = createPrCreator({ execCommand });

    const result = await creator.createDraftPr(
      "/repo",
      "joyus/2026-04-01-fix",
      "QA: fix layout",
    );

    expect(result.prNumber).toBe(7);
    expect(result.prUrl).toBe("https://github.com/zivtech/my-site/pull/7");
    expect(result.prTitle).toBe("QA: fix layout");
  });

  it("passes --body when body is provided", async () => {
    const execCommand = vi.fn().mockResolvedValue({
      stdout: "https://github.com/owner/repo/pull/12",
      stderr: "",
    });
    const creator = createPrCreator({ execCommand });

    await creator.createDraftPr(
      "/repo",
      "branch",
      "My PR",
      "Detailed description",
    );

    expect(execCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--body", "Detailed description"]),
      "/repo",
    );
  });

  it("passes empty --body when body is undefined", async () => {
    const execCommand = vi.fn().mockResolvedValue({
      stdout: "https://github.com/owner/repo/pull/12",
      stderr: "",
    });
    const creator = createPrCreator({ execCommand });

    await creator.createDraftPr("/repo", "branch", "My PR");

    expect(execCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--body", ""]),
      "/repo",
    );
  });

  it("includes --draft and --head flags", async () => {
    const execCommand = vi.fn().mockResolvedValue({
      stdout: "https://github.com/owner/repo/pull/1",
      stderr: "",
    });
    const creator = createPrCreator({ execCommand });

    await creator.createDraftPr("/repo", "my-branch", "Title");

    expect(execCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--draft", "--head", "my-branch"]),
      "/repo",
    );
  });

  it("throws when gh output is not a recognizable PR URL", async () => {
    const execCommand = vi.fn().mockResolvedValue({
      stdout: "error: no commits yet\n",
      stderr: "",
    });
    const creator = createPrCreator({ execCommand });

    await expect(
      creator.createDraftPr("/repo", "branch", "Title"),
    ).rejects.toThrow("Failed to parse PR number");
  });

  it("propagates execCommand errors", async () => {
    const execCommand = vi
      .fn()
      .mockRejectedValue(new Error("gh: command not found"));
    const creator = createPrCreator({ execCommand });

    await expect(
      creator.createDraftPr("/repo", "branch", "Title"),
    ).rejects.toThrow("gh: command not found");
  });
});
