import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RemoteEnvironmentCard,
  type RemoteEnvironment,
} from "../../../src/ui/components/RemoteEnvironmentCard";

function makeEnv(overrides: Partial<RemoteEnvironment> = {}): RemoteEnvironment {
  return {
    id: "env-1",
    repoOwner: "acme",
    repoName: "web",
    environmentType: "probo",
    status: "active",
    ...overrides,
  };
}

describe("RemoteEnvironmentCard", () => {
  it("renders repo, type, and active status", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvironmentCard, { env: makeEnv() }));

    expect(html).toContain("acme/web");
    expect(html).toContain("Probo");
    expect(html).toContain("Active");
  });

  it("renders Joyus AI hosted environments", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({ environmentType: "joyus-ai-hosted", status: "running" }),
      }),
    );

    expect(html).toContain("Joyus AI");
    expect(html).toContain("Running");
  });

  it("renders starting environments through the warning status path", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({ status: "starting" }),
      }),
    );

    expect(html).toContain("Starting");
  });

  it("renders building environments through the warning status path", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({ status: "building" }),
      }),
    );

    expect(html).toContain("Building");
  });

  it("renders links and error detail when present", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({
          prNumber: 42,
          prUrl: "https://github.com/acme/web/pull/42",
          prTitle: "Preview build",
          environmentUrl: "https://preview.example.com",
          status: "failed",
          errorMessage: "Build failed",
          lastCheckedAt: Date.UTC(2026, 5, 13, 12, 0, 0),
        }),
      }),
    );

    expect(html).toContain("PR #42: Preview build");
    expect(html).toContain("https://github.com/acme/web/pull/42");
    expect(html).toContain("Open Environment");
    expect(html).toContain("https://preview.example.com");
    expect(html).toContain("Failed");
    expect(html).toContain("Build failed");
    expect(html).not.toContain("Last checked: —");
  });

  it("renders fallback status color and missing timestamp placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({ status: "paused", lastCheckedAt: undefined }),
      }),
    );

    expect(html).toContain("Paused");
    expect(html).toContain("Last checked: —");
  });

  it("renders a PR link without title text when the title is missing", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvironmentCard, {
        env: makeEnv({
          prNumber: 7,
          prUrl: "https://github.com/acme/web/pull/7",
          prTitle: undefined,
        }),
      }),
    );

    expect(html).toContain("PR #7");
    expect(html).not.toContain("PR #7:");
  });
});
