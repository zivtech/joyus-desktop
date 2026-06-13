import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { ReconDashboard } from "../../src/ui/pages/ReconDashboard";
import { installTauriInternals } from "./tauriInternals";
import {
  changeInput,
  changeSelect,
  clickButton,
  clickButtonContaining,
  findButton,
  getReactButtonProps,
  mount,
  setupDom,
  teardownDom,
  waitFor,
  type PageHarness,
} from "./pageTestUtils";

let harness: PageHarness;

const requiredCredentials = [
  "ANTHROPIC_API_KEY",
  "DATAFORSEO_USERNAME",
  "DATAFORSEO_PASSWORD",
  "CRUX_API_KEY",
];

function installReadyReconBridge(overrides: Partial<{
  createFails: boolean;
  launchFails: boolean;
  engagements: unknown[];
  keychainList: Promise<string[]>;
}> = {}) {
  return installTauriInternals(harness.dom.window, (cmd) => {
    switch (cmd) {
      case "credentials_list":
        return requiredCredentials.map((key) => ({ key, isSet: true }));
      case "check_skill_file":
        return { found: true };
      case "keychain_list":
        return overrides.keychainList ?? [...requiredCredentials, "EXTRA_KEY"];
      case "get_sync_status":
        return { status: "synced", state: "idle", version: "2.0.0", lastSync: "2026-06-13T10:00:00Z" };
      case "credentials_verify":
        return [
          { key: "DATAFORSEO_USERNAME", valid: true },
          { key: "ANTHROPIC_API_KEY", valid: true },
        ];
      case "list_engagements":
        return overrides.engagements ?? [
          {
            engagementId: "eng-existing",
            engagementDir: "/tmp/eng-existing",
            clientName: "Existing Client",
            url: "https://example.com/a/very/long/path/that/will/be/truncated",
            accessMode: "rfp",
            createdAt: "2026-06-13T10:00:00Z",
            status: "Complete",
          },
          {
            engagementId: "eng-short",
            engagementDir: "/tmp/eng-short",
            clientName: "Short Client",
            url: "https://short.example.com",
            accessMode: "discovery",
          },
        ];
      case "create_engagement":
        return overrides.createFails === true
          ? undefined
          : { engagementDir: "/tmp/eng-new", engagementId: "eng-new", clientSlug: "new-client" };
      case "launch_recon":
        return overrides.launchFails === true
          ? undefined
          : { pid: 1234, launchTime: "2026-06-13T10:01:00Z", engagementId: "eng-new" };
      default:
        return undefined;
    }
  });
}

async function openValidNewEngagementForm(): Promise<void> {
  await waitFor(() => {
    const target = Array.from(harness.container.querySelectorAll("button"))
      .find((button) => button.textContent === "New Engagement");
    return target instanceof harness.dom.window.HTMLButtonElement && !target.disabled;
  });
  await clickButton(harness, "New Engagement");
  await waitFor(() => harness.container.textContent?.includes("Start Engagement") === true);
}

describe("ReconDashboard page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("passes readiness, starts an engagement, and returns to the past list", async () => {
    let releaseReadiness: ((keys: string[]) => void) | undefined;
    const keychainList = new Promise<string[]>((resolve) => {
      releaseReadiness = resolve;
    });
    const tauri = installReadyReconBridge({ keychainList });

    mount(harness, createElement(ReconDashboard), { initialEntries: ["/recon"] });
    await waitFor(() => harness.container.textContent?.includes("Recon Engagements") === true);
    expect(harness.container.textContent).toContain("Complete required items");

    releaseReadiness?.([...requiredCredentials, "EXTRA_KEY"]);
    await waitFor(() => harness.container.textContent?.includes("Existing Client") === true);
    await waitFor(() => !findButton(harness, "New Engagement").disabled);

    await clickButton(harness, "Run Preflight");
    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "credentials_verify").length >= 2);

    await clickButton(harness, "New Engagement");
    const disabledStart = findButton(harness, "Start Engagement");
    await act(async () => {
      getReactButtonProps(disabledStart)?.onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tauri.invoke.mock.calls.some(([cmd]) => cmd === "create_engagement")).toBe(false);

    const inputs = Array.from(harness.container.querySelectorAll("input"));
    const client = inputs[0];
    const url = inputs[1];
    const mode = harness.container.querySelector("select");
    if (
      !(client instanceof harness.dom.window.HTMLInputElement) ||
      !(url instanceof harness.dom.window.HTMLInputElement) ||
      !(mode instanceof harness.dom.window.HTMLSelectElement)
    ) {
      throw new Error("New engagement fields not found");
    }

    await changeInput(harness, client, "New Client");
    await changeInput(harness, url, "not a url");
    expect(harness.container.textContent).toContain("Enter a valid URL");
    await changeSelect(harness, mode, "full");
    await changeInput(harness, url, "https://new.example.com");
    await clickButton(harness, "Start Engagement");
    await waitFor(() => harness.container.textContent?.includes("eng-new") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("create_engagement", {
      params: { clientName: "New Client", url: "https://new.example.com", accessMode: "full" },
    }, undefined);
    expect(tauri.invoke).toHaveBeenCalledWith("launch_recon", {
      client_name: "New Client",
      engagement_dir: "/tmp/eng-new",
      engagement_id: "eng-new",
    }, undefined);

    await clickButton(harness, "Back");
    await waitFor(() => harness.container.textContent?.includes("Past Engagements") === true);
    await waitFor(() => harness.container.textContent?.includes("Existing Client") === true);

    await clickButtonContaining(harness, "Existing Client");
    await waitFor(() => harness.container.textContent?.includes("eng-existing") === true);
  });

  it("shows empty and setup-guarded states", async () => {
    installReadyReconBridge({ engagements: [] });

    mount(harness, createElement(ReconDashboard), { initialEntries: ["/recon"] });
    await waitFor(() => harness.container.textContent?.includes("No engagements yet.") === true);
    expect(harness.container.textContent).toContain("Start your first engagement above.");
  });

  it("redirects away when recon setup is incomplete", async () => {
    installTauriInternals(harness.dom.window, (cmd) => {
      if (cmd === "credentials_list") return [];
      if (cmd === "check_skill_file") return { found: false };
      return undefined;
    });

    mount(harness, createElement(
      Routes,
      null,
      createElement(Route, { path: "/recon", element: createElement(ReconDashboard) }),
      createElement(Route, { path: "/recon/setup", element: createElement("div", null, "Setup Redirect") }),
    ), { initialEntries: ["/recon"] });
    await waitFor(() => harness.container.textContent?.includes("Setup Redirect") === true);
  });

  it("falls back to an empty engagement list when listing throws", async () => {
    installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "credentials_list":
          return requiredCredentials.map((key) => ({ key, isSet: true }));
        case "check_skill_file":
          return { found: true };
        case "keychain_list":
          return requiredCredentials;
        case "get_sync_status":
          return { status: "synced", version: "2.0.0" };
        case "credentials_verify":
          return [{ key: "DATAFORSEO_USERNAME", valid: true }];
        case "list_engagements":
          throw new Error("list failed");
        default:
          return undefined;
      }
    });

    mount(harness, createElement(ReconDashboard), { initialEntries: ["/recon"] });
    await waitFor(() => harness.container.textContent?.includes("No engagements yet.") === true);
  });

  it("surfaces create and launch failures from the new engagement form", async () => {
    installReadyReconBridge({ createFails: true });
    mount(harness, createElement(ReconDashboard), { initialEntries: ["/recon"] });
    await openValidNewEngagementForm();

    const firstInputs = Array.from(harness.container.querySelectorAll("input"));
    await changeInput(harness, firstInputs[0] as HTMLInputElement, "Broken Client");
    await changeInput(harness, firstInputs[1] as HTMLInputElement, "https://broken.example.com");
    await clickButton(harness, "Start Engagement");
    await waitFor(() => harness.container.textContent?.includes("Failed to create engagement") === true);
    await clickButton(harness, "Cancel");

    await teardownDom(harness);
    harness = setupDom();
    installReadyReconBridge({ launchFails: true });
    mount(harness, createElement(ReconDashboard), { initialEntries: ["/recon"] });
    await openValidNewEngagementForm();

    const secondInputs = Array.from(harness.container.querySelectorAll("input"));
    await changeInput(harness, secondInputs[0] as HTMLInputElement, "Launch Broken");
    await changeInput(harness, secondInputs[1] as HTMLInputElement, "https://launch.example.com");
    await clickButton(harness, "Start Engagement");
    await waitFor(() => harness.container.textContent?.includes("Engagement created but failed to launch") === true);
  });
});
