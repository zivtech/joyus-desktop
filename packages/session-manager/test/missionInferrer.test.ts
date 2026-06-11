import { describe, expect, it, vi, afterEach } from "vitest";

import { inferMissionLabel, slugify } from "../src/missionInferrer";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("some_module_name")).toBe("some-module-name");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("---test---")).toBe("test");
  });

  it("truncates at 40 chars", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBe(40);
  });

  it("handles special characters", () => {
    expect(slugify("pkg@scope/name!")).toBe("pkg-scope-name");
  });

  it("returns empty string for all-special-char input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("inferMissionLabel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns date-prefixed session fallback for empty paths", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel([]);
    expect(result).toBe("2026-03-19-session");
  });

  it("picks the most frequent top-level directory", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel([
      "packages/foo/src/a.ts",
      "packages/foo/src/b.ts",
      "apps/bar/index.ts",
    ]);
    expect(result).toBe("2026-03-19-packages");
  });

  it("returns slugified and date-prefixed result", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel(["My Module/file.ts"]);
    expect(result).toBe("2026-03-19-my-module");
  });

  it("handles paths with leading slashes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel(["/src/index.ts", "/src/utils.ts"]);
    expect(result).toBe("2026-03-19-src");
  });

  it("handles paths with leading ./", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel(["./lib/helper.ts"]);
    expect(result).toBe("2026-03-19-lib");
  });

  it("falls back to session when all paths are empty strings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel([""]);
    expect(result).toBe("2026-03-19-session");
  });

  it("slug is at most 40 chars excluding date prefix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const longDir = "a".repeat(60);
    const result = inferMissionLabel([`${longDir}/file.ts`]);
    // date prefix is "2026-03-19-" (11 chars), slug is 40 chars
    expect(result).toBe(`2026-03-19-${"a".repeat(40)}`);
  });

  it("handles single file with no directory", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel(["README.md"]);
    expect(result).toBe("2026-03-19-readme-md");
  });

  it("falls back to session when top-level dir slugifies to empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const result = inferMissionLabel(["!!!/file.ts"]);
    expect(result).toBe("2026-03-19-session");
  });
});
