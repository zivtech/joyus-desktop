import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_DETECT_COMMAND } from "../../src/ui/pages/Servers";

const serverStatusState = vi.hoisted(() => ({
  chromeAvailable: undefined as boolean | undefined,
  status: {
    servers: [] as Array<{ id: string; name: string; status: "running" | "stopped" | "error" | "starting"; restartCount: number }>,
    loading: false,
    error: undefined as string | undefined,
  },
}));

vi.mock("../../src/ui/hooks/useServerStatus", () => ({
  useServerStatus: () => ({
    ...serverStatusState.status,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../src/ui/hooks/useChromeAvailable", () => ({
  CHROME_DETECT_COMMAND: "detect_chrome",
  useChromeAvailable: () => serverStatusState.chromeAvailable,
}));

vi.mock("../../src/ui/components/ServerCard", () => ({
  ServerCard: ({ server }: { server: { name: string } }) => createElement("article", null, server.name),
}));

import { Servers } from "../../src/ui/pages/Servers";

function renderServers(): string {
  return renderToStaticMarkup(createElement(Servers));
}

describe("Servers page", () => {
  beforeEach(() => {
    serverStatusState.chromeAvailable = undefined;
    serverStatusState.status = {
      servers: [],
      loading: false,
      error: undefined,
    };
  });

  it("uses the existing Tauri chrome detection command name", () => {
    expect(CHROME_DETECT_COMMAND).toBe("detect_chrome");
  });

  it("shows the loading skeleton without a count while server status is loading", () => {
    serverStatusState.status = {
      servers: [],
      loading: true,
      error: undefined,
    };

    const html = renderServers();

    expect(html).toContain("MCP Servers");
    expect(html).not.toContain("running");
    expect(html).not.toContain("No servers registered");
  });

  it("shows the empty state and zero count when no servers are registered", () => {
    const html = renderServers();

    expect(html).toContain("0 of 0 running");
    expect(html).toContain("No servers registered");
  });

  it("shows Chrome and server errors without showing the empty state", () => {
    serverStatusState.chromeAvailable = false;
    serverStatusState.status = {
      servers: [],
      loading: false,
      error: "sidecar unavailable",
    };

    const html = renderServers();

    expect(html).toContain("Google Chrome was not detected");
    expect(html).toContain("Error loading servers:");
    expect(html).toContain("sidecar unavailable");
    expect(html).not.toContain("No servers registered");
  });

  it("shows running counts and server rows when servers are present", () => {
    serverStatusState.chromeAvailable = true;
    serverStatusState.status = {
      servers: [
        { id: "browser", name: "browser", status: "running", restartCount: 0 },
        { id: "github", name: "github", status: "stopped", restartCount: 1 },
      ],
      loading: false,
      error: undefined,
    };

    const html = renderServers();

    expect(html).toContain("1 of 2 running");
    expect(html).toContain("browser");
    expect(html).toContain("github");
    expect(html).not.toContain("No servers registered");
  });
});
