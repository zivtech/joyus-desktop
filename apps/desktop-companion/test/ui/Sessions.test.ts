import { describe, expect, it } from "vitest";
import { buildGitHubDesktopUrl } from "../../src/ui/pages/Sessions";

// Tests for the pure utility re-exported from Sessions for testability (T035).
// The Sessions component itself and its Tauri-wired behaviour are covered by
// the integration + pilot-acceptance suites in test/integration/.

describe("buildGitHubDesktopUrl", () => {
  it("returns a valid x-github-client URI for a plain path", () => {
    const url = buildGitHubDesktopUrl("/Users/alex/projects/my-repo");
    expect(url).toBe(
      "x-github-client://openRepo/%2FUsers%2Falex%2Fprojects%2Fmy-repo"
    );
  });

  it("encodes spaces in the repo path", () => {
    const url = buildGitHubDesktopUrl("/Users/alex/my projects/repo");
    expect(url).toContain("x-github-client://openRepo/");
    expect(url).toContain("%20");
  });

  it("encodes special characters", () => {
    const url = buildGitHubDesktopUrl("/path/with?query=1&other=2");
    expect(url).toContain("%3F");
    expect(url).toContain("%3D");
    expect(url).toContain("%26");
  });

  it("always starts with the x-github-client scheme", () => {
    expect(buildGitHubDesktopUrl("/any/path")).toMatch(
      /^x-github-client:\/\/openRepo\//
    );
  });
});
