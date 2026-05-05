import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalSiteCard, type LocalSite } from "../../../src/ui/components/LocalSiteCard";

const noop = () => {};

function makeSite(overrides: Partial<LocalSite> = {}): LocalSite {
  return {
    id: "site-1",
    projectName: "My Project",
    repoUrl: "https://github.com/acme/web.git",
    repoPath: "/repos/acme/web",
    ddevProjectName: "web",
    status: "running",
    ...overrides,
  };
}

describe("LocalSiteCard", () => {
  it("renders the project name", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("My Project");
  });

  it("renders Running status for running sites", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite({ status: "running" }), onRemoved: noop }),
    );
    expect(html).toContain("Running");
  });

  it("renders Stopped status for stopped sites", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite({ status: "stopped" }), onRemoved: noop }),
    );
    expect(html).toContain("Stopped");
  });

  it("renders error message when status is error and errorMessage is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ status: "error", errorMessage: "DDEV crashed" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("Error");
    expect(html).toContain("DDEV crashed");
  });

  it("renders repo path", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("/repos/acme/web");
  });

  it("renders HTTPS link when httpsUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("HTTPS");
    expect(html).toContain("https://web.ddev.site");
  });

  it("renders HTTP link when httpUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpUrl: "http://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("HTTP");
    expect(html).toContain("http://web.ddev.site");
  });

  it("renders action buttons", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("Start");
    expect(html).toContain("Stop");
    expect(html).toContain("Restart");
    expect(html).toContain("Remove");
  });

  it("renders Open button when a URL is available", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("Open");
  });

  it("omits Open button when no URL is available", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpUrl: undefined, httpsUrl: undefined }),
        onRemoved: noop,
      }),
    );
    const buttons = html.match(/>Open</g);
    expect(buttons).toBeNull();
  });

  it("renders chevron when onToggleExpand is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        onToggleExpand: noop,
        expanded: false,
      }),
    );
    expect(html).toContain("aria-expanded=\"false\"");
  });

  it("renders expanded chevron and children when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        onToggleExpand: noop,
        expanded: true,
      }, createElement("div", null, "Expanded content")),
    );
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("Expanded content");
    expect(html).toContain("role=\"region\"");
  });

  it("renders branch count badge when branchCounts is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        branchCounts: { active: 2, total: 5 },
      }),
    );
    expect(html).toContain("2 active / 5 total");
  });

  it("renders activity indicator when lastBranchActivity is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        lastBranchActivity: Date.now() - 60_000,
      }),
    );
    expect(html).toContain("Last active");
  });
});
