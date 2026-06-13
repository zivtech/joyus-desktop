import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "../../src/ui/pages/Onboarding";
import { installTauriInternals } from "./tauriInternals";
import {
  changeInput,
  clickButton,
  findButton,
  getReactButtonProps,
  mount,
  setupDom,
  teardownDom,
  waitFor,
  type PageHarness,
} from "./pageTestUtils";

let harness: PageHarness;

async function fillManualCredentials(): Promise<void> {
  await clickButton(harness, "Enter credentials manually");
  const inputs = Array.from(harness.container.querySelectorAll("input"));
  const [org, token, tenant, workspace] = inputs;
  if (
    !(org instanceof harness.dom.window.HTMLInputElement) ||
    !(token instanceof harness.dom.window.HTMLInputElement) ||
    !(tenant instanceof harness.dom.window.HTMLInputElement) ||
    !(workspace instanceof harness.dom.window.HTMLInputElement)
  ) {
    throw new Error("Manual credential inputs not found");
  }
  await changeInput(harness, org, "Acme Corp");
  await changeInput(harness, token, "tok");
  await changeInput(harness, tenant, "tenant-1");
  await changeInput(harness, workspace, "workspace-1");
}

describe("Onboarding page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("validates auth, handles MCP failures, skips to sync, and completes from events", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_config":
          return undefined;
        case "start_onboarding":
          return { success: true, serversStarted: 2, skillsSynced: true, errors: [] };
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Onboarding));
    await waitFor(() => harness.container.textContent?.includes("Welcome to Joyus") === true);

    await clickButton(harness, "Enter credentials manually");
    await clickButton(harness, "Connect");
    expect(harness.container.textContent).toContain("Auth token, tenant ID, and workspace ID are required.");

    await clickButton(harness, "Back to GitHub login");
    await fillManualCredentials();
    await clickButton(harness, "Connect");
    await waitFor(() => harness.container.textContent?.includes("Registering and starting MCP servers") === true);
    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "plugin:event|listen").length >= 4);

    await act(async () => {
      tauri.emit("state:server-changed", {
        id: "policy",
        name: "Policy MCP",
        status: "running",
        restartCount: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      tauri.emit("state:server-changed", {
        id: "sync",
        name: "Sync MCP",
        status: "starting",
        restartCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => harness.container.textContent?.includes("starting") === true);
    await act(async () => {
      tauri.emit("state:server-changed", {
        id: "sync",
        name: "Sync MCP",
        status: "error",
        restartCount: 2,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => harness.container.textContent?.includes("1 server(s) failed to start.") === true);

    await clickButton(harness, "Retry Failed");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "retry_servers"));
    expect(tauri.invoke).toHaveBeenCalledWith("retry_servers", { ids: ["sync"] }, undefined);

    await clickButton(harness, "Skip");
    await waitFor(() => harness.container.textContent?.includes("Downloading skills") === true);
    act(() => {
      tauri.emit("state:sync-progress", 42);
    });
    await waitFor(() => harness.container.textContent?.includes("42% complete") === true);

    act(() => {
      tauri.emit("state:sync-progress", 100);
    });
    await waitFor(() => harness.container.textContent?.includes("Sync complete") === true);

    act(() => {
      tauri.emit("state:sync-completed", { skillCount: 5, version: "1.2.3" });
    });
    await waitFor(() => harness.container.textContent?.includes("5 skills synced at version 1.2.3.") === true);

    await clickButton(harness, "Open Dashboard");
    expect(tauri.invoke).toHaveBeenCalledWith("set_config", { key: "onboarding_complete", value: "true" }, undefined);
  });

  it("surfaces start-onboarding sync failures and supports retry or skip", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_config":
          return undefined;
        case "start_onboarding":
          return {
            success: false,
            serversStarted: 2,
            skillsSynced: false,
            errors: ["sync: git failed"],
          };
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Onboarding));
    await fillManualCredentials();
    await clickButton(harness, "Connect");
    await waitFor(() => harness.container.textContent?.includes("git failed") === true);

    await clickButton(harness, "Retry Sync");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "retry_skill_sync"));
    expect(tauri.invoke).toHaveBeenCalledWith("retry_skill_sync", {}, undefined);

    act(() => {
      tauri.emit("state:sync-failed", { message: "still failed" });
    });
    await waitFor(() => harness.container.textContent?.includes("Skill sync failed.") === true);
    act(() => {
      tauri.emit("state:sync-failed", "still failed");
    });
    await waitFor(() => harness.container.textContent?.includes("still failed") === true);

    await clickButton(harness, "Skip");
    await waitFor(() => harness.container.textContent?.includes("You're all set!") === true);
  });

  it("supports GitHub auth cancellation and unavailable login fallback", async () => {
    let resolveLogin: ((value: unknown) => void) | undefined;
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      if (cmd === "get_config") return undefined;
      if (cmd === "github_auth_start") {
        return new Promise((resolve) => {
          resolveLogin = resolve;
        });
      }
      return undefined;
    });

    mount(harness, createElement(Onboarding));
    await waitFor(() => harness.container.textContent?.includes("Login with GitHub") === true);
    await clickButton(harness, "Login with GitHub");
    await waitFor(() => harness.container.textContent?.includes("Waiting for browser authentication") === true);
    await clickButton(harness, "Cancel");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "github_auth_cancel"));
    expect(tauri.invoke).toHaveBeenCalledWith("github_auth_cancel", {}, undefined);

    act(() => {
      resolveLogin?.(undefined);
    });
    await waitFor(() => harness.container.textContent?.includes("GitHub login unavailable outside of Joyus Desktop.") === true);
  });

  it("supports successful GitHub auth and auto-advances when expected MCP servers are running", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_config":
          return undefined;
        case "github_auth_start":
          return { authToken: "gh-token", tenantId: "tenant-gh", workspaceId: "workspace-gh" };
        case "start_onboarding":
          return { success: true, serversStarted: 1, skillsSynced: true, errors: [] };
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Onboarding));
    await waitFor(() => harness.container.textContent?.includes("Login with GitHub") === true);
    const login = findButton(harness, "Login with GitHub");
    const loginProps = getReactButtonProps(login);
    await act(async () => {
      loginProps?.onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => harness.container.textContent?.includes("Registering and starting MCP servers") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("set_config", { key: "auth_token", value: "gh-token" }, undefined);

    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "plugin:event|listen").length >= 4);
    await act(async () => {
      loginProps?.onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "plugin:event|listen").length >= 8);
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "plugin:event|unlisten"));
    act(() => {
      tauri.emit("state:server-changed", {
        id: "policy",
        name: "Policy MCP",
        status: "running",
        restartCount: 0,
      });
    });
    await waitFor(() => harness.container.textContent?.includes("Downloading skills") === true);
  });

  it("uses a generic sync failure when onboarding reports no synced skills without details", async () => {
    installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_config":
          return undefined;
        case "start_onboarding":
          return {
            success: false,
            serversStarted: 1,
            skillsSynced: false,
            errors: ["servers: registry unavailable"],
          };
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Onboarding));
    await fillManualCredentials();
    await clickButton(harness, "Connect");
    await waitFor(() => harness.container.textContent?.includes("Skill sync did not complete.") === true);
  });

  it("falls back cleanly when the desktop bridge is unavailable during manual auth", async () => {
    mount(harness, createElement(Onboarding));
    await fillManualCredentials();
    await clickButton(harness, "Connect");
    await waitFor(() => harness.container.textContent?.includes("Registering and starting MCP servers") === true);
  });

  it("resumes saved onboarding phases", async () => {
    installTauriInternals(harness.dom.window, (cmd, args) => {
      if (cmd === "get_config" && args["key"] === "onboarding_phase") {
        return "sync";
      }
      return undefined;
    });

    mount(harness, createElement(Onboarding));
    await waitFor(() => harness.container.textContent?.includes("Downloading skills") === true);
    expect(harness.container.textContent).toContain("0% complete");
  });
});
