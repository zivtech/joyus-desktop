import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RemoteEnvRow } from "../../../src/ui/components/RemoteEnvRow";
import type { RemoteEnvironment } from "../../../src/ui/components/RemoteEnvironmentCard";

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

describe("RemoteEnvRow", () => {
  it("renders the environment type label", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv() }));
    expect(html).toContain("Probo");
  });

  it("renders joyus-ai-hosted type", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentType: "joyus-ai-hosted" }) }),
    );
    expect(html).toContain("Joyus AI");
  });

  it("renders the status text", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv({ status: "building" }) }));
    expect(html).toContain("building");
  });

  it("renders PR link when prUrl and prNumber are set", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, {
        env: makeEnv({ prUrl: "https://github.com/acme/web/pull/42", prNumber: 42 }),
      }),
    );
    expect(html).toContain("PR #42");
    expect(html).toContain("https://github.com/acme/web/pull/42");
  });

  it("renders Open link when environmentUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentUrl: "https://env.example.com" }) }),
    );
    expect(html).toContain("Open");
    expect(html).toContain("https://env.example.com");
  });

  it("omits Open link when environmentUrl is undefined", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentUrl: undefined }) }),
    );
    expect(html).not.toContain("Open");
  });
});
