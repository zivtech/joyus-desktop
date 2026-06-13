import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../../src/ui/pages/Settings";
import { installTauriInternals } from "./tauriInternals";
import {
  clickButton,
  findButton,
  mount,
  setupDom,
  teardownDom,
  waitFor,
  type PageHarness,
} from "./pageTestUtils";

let harness: PageHarness;

interface ReactCheckedInputProps {
  onChange?: (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void;
}

interface ReactButtonProps {
  onClick?: () => void;
}

function getReactButtonProps(button: HTMLButtonElement): ReactButtonProps | undefined {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (button as unknown as Record<string, unknown>)[propsKey] as ReactButtonProps;
}

function getReactCheckedInputProps(input: HTMLInputElement): ReactCheckedInputProps | undefined {
  const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (input as unknown as Record<string, unknown>)[propsKey] as ReactCheckedInputProps;
}

async function clickSwitch(index: number): Promise<void> {
  const switches = Array.from(harness.container.querySelectorAll("button[role='switch']"));
  const target = switches[index];
  if (!(target instanceof harness.dom.window.HTMLButtonElement)) {
    throw new Error(`Switch not found: ${String(index)}`);
  }
  await act(async () => {
    target.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setRadioChecked(input: HTMLInputElement): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "checked")?.set;
  await act(async () => {
    setter?.call(input, true);
    getReactCheckedInputProps(input)?.onChange?.({ target: input, currentTarget: input });
    input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Settings page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("loads config, toggles settings, runs maintenance actions, and completes reset", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_config":
          return {
            autoStart: true,
            telemetryEnabled: false,
            version: "1.0.0",
            buildDate: "2026-06-13",
          };
        case "check_for_update":
          return "Update available.";
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Settings));
    await waitFor(() => harness.container.textContent?.includes("Version: 1.0.0") === true);

    await clickSwitch(0);
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "toggle_autostart"));
    expect(tauri.invoke).toHaveBeenCalledWith("set_config", { key: "autoStart", value: false }, undefined);
    expect(tauri.invoke).toHaveBeenCalledWith("toggle_autostart", { enabled: false }, undefined);

    await clickSwitch(1);
    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "set_config").length >= 2);
    expect(tauri.invoke).toHaveBeenCalledWith("set_config", { key: "telemetryEnabled", value: true }, undefined);

    await clickButton(harness, "Sync Now");
    await waitFor(() => harness.container.textContent?.includes("Sync complete.") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("trigger_sync", {}, undefined);

    await clickButton(harness, "Check Now");
    await waitFor(() => harness.container.textContent?.includes("Update available.") === true);

    await clickButton(harness, "Clear Data");
    expect(harness.container.textContent).toContain("Click again to confirm");
    await clickButton(harness, "Cancel");
    expect(harness.container.textContent).not.toContain("Click again to confirm");
    await clickButton(harness, "Clear Data");
    await clickButton(harness, "Confirm Clear");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "clear_usage_data"));

    await clickButton(harness, "Reset…");
    await waitFor(() => harness.container.textContent?.includes("Choose what to remove") === true);
    const radios = harness.container.querySelectorAll("input[name='resetMode']");
    const removeEverything = radios[1];
    const removeAppOnly = radios[0];
    if (
      !(removeAppOnly instanceof harness.dom.window.HTMLInputElement) ||
      !(removeEverything instanceof harness.dom.window.HTMLInputElement)
    ) {
      throw new Error("Reset data radio not found");
    }
    await setRadioChecked(removeEverything);
    await setRadioChecked(removeAppOnly);
    await setRadioChecked(removeEverything);
    await clickButton(harness, "Confirm Reset");
    await waitFor(() => harness.container.textContent?.includes("Reset complete.") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("reset_desktop_companion", { deleteData: true }, undefined);

    await clickButton(harness, "Dismiss");
    expect(findButton(harness, "Reset…")).toBeDefined();
  });

  it("surfaces reset failures and allows canceling the reset flow", async () => {
    installTauriInternals(harness.dom.window, (cmd) => {
      if (cmd === "get_config") {
        return { autoStart: false, telemetryEnabled: true, version: "1.0.0" };
      }
      if (cmd === "reset_desktop_companion") {
        throw new Error("reset failed");
      }
      return undefined;
    });

    mount(harness, createElement(Settings));
    await waitFor(() => harness.container.textContent?.includes("Version: 1.0.0") === true);

    await clickButton(harness, "Reset…");
    await clickButton(harness, "Confirm Reset");
    await waitFor(() => harness.container.textContent?.includes("Error: Error: reset failed") === true);

    await clickButton(harness, "Cancel");
    expect(harness.container.textContent).not.toContain("Error: Error: reset failed");
  });

  it("renders disabled defaults when config cannot be loaded", async () => {
    mount(harness, createElement(Settings));
    await waitFor(() => harness.container.textContent?.includes("Version: —") === true);

    const firstSwitch = harness.container.querySelector("button[role='switch']");
    expect(firstSwitch).toBeInstanceOf(harness.dom.window.HTMLButtonElement);
    expect((firstSwitch as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      getReactButtonProps(firstSwitch as HTMLButtonElement)?.onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await clickButton(harness, "Check Now");
    await waitFor(() => harness.container.textContent?.includes("Up to date.") === true);
  });
});
