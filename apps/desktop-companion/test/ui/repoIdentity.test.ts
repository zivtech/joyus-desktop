import { describe, expect, it } from "vitest";
import { parseRepoIdentity } from "../../src/ui/utils/repoIdentity";

describe("parseRepoIdentity", () => {
  it("parses HTTPS URL with .git suffix", () => {
    const result = parseRepoIdentity("https://github.com/zivtech/joyus-desktop.git");
    expect(result).toEqual({ owner: "zivtech", name: "joyus-desktop" });
  });

  it("parses HTTPS URL without .git suffix", () => {
    const result = parseRepoIdentity("https://github.com/zivtech/joyus-desktop");
    expect(result).toEqual({ owner: "zivtech", name: "joyus-desktop" });
  });

  it("parses SSH URL with .git suffix", () => {
    const result = parseRepoIdentity("git@github.com:zivtech/joyus-desktop.git");
    expect(result).toEqual({ owner: "zivtech", name: "joyus-desktop" });
  });

  it("parses SSH URL without .git suffix", () => {
    const result = parseRepoIdentity("git@github.com:zivtech/joyus-desktop");
    expect(result).toEqual({ owner: "zivtech", name: "joyus-desktop" });
  });

  it("returns undefined for empty string", () => {
    expect(parseRepoIdentity("")).toBeUndefined();
  });

  it("returns undefined for plain path without slash", () => {
    expect(parseRepoIdentity("not-a-url")).toBeUndefined();
  });

  it("handles GitLab HTTPS URLs", () => {
    const result = parseRepoIdentity("https://gitlab.com/org/project.git");
    expect(result).toEqual({ owner: "org", name: "project" });
  });

  it("handles SSH URLs with different hosts", () => {
    const result = parseRepoIdentity("git@gitlab.com:org/project.git");
    expect(result).toEqual({ owner: "org", name: "project" });
  });
});
