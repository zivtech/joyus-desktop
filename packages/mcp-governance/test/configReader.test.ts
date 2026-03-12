import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readGovernanceConfig, createConfigPoller } from "../src/configReader";

function createDeps(fileContent?: string, readError?: Error) {
  return {
    log: vi.fn() as (level: "info" | "warn" | "error", message: string) => void,
    fs: {
      readFile: readError
        ? vi.fn().mockRejectedValue(readError)
        : vi.fn().mockResolvedValue(fileContent ?? "")
    }
  };
}

describe("readGovernanceConfig", () => {
  it("reads valid governance config", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "enforce", updatedAt: "2026-01-01" } })
    );

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "enforce", updatedAt: "2026-01-01" });
  });

  it("reads audit mode", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "audit", updatedAt: "2026-02-01" } })
    );

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "audit", updatedAt: "2026-02-01" });
  });

  it("reads off mode", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "off", updatedAt: "" } })
    );

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
  });

  it("defaults updatedAt to empty string when not a string", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "enforce", updatedAt: 12345 } })
    );

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "enforce", updatedAt: "" });
  });

  it("returns defaults when file not found", async () => {
    const deps = createDeps(undefined, new Error("ENOENT"));

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "Governance config not found at /path/config.json, using defaults"
    );
  });

  it("returns defaults when file is not valid JSON", async () => {
    const deps = createDeps("not json {{{");

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "Governance config at /path/config.json is not valid JSON, using defaults"
    );
  });

  it("returns defaults when parsed value is not an object", async () => {
    const deps = createDeps(JSON.stringify("just a string"));

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "Governance config at /path/config.json is not an object, using defaults"
    );
  });

  it("returns defaults when parsed value is null", async () => {
    const deps = createDeps(JSON.stringify(null));

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "Governance config at /path/config.json is not an object, using defaults"
    );
  });

  it("returns defaults when no governance section", async () => {
    const deps = createDeps(JSON.stringify({ other: "data" }));

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "No governance section in config at /path/config.json, using defaults"
    );
  });

  it("returns defaults when governance section is not an object", async () => {
    const deps = createDeps(JSON.stringify({ governance: "string" }));

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "No governance section in config at /path/config.json, using defaults"
    );
  });

  it("returns defaults when governance mode is invalid", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "invalid", updatedAt: "" } })
    );

    const config = await readGovernanceConfig("/path/config.json", deps);

    expect(config).toEqual({ mode: "off", updatedAt: "" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      "Invalid governance mode in config at /path/config.json, using defaults"
    );
  });
});

describe("createConfigPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default config before start", () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "enforce", updatedAt: "2026-01-01" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);

    expect(poller.getConfig()).toEqual({ mode: "off", updatedAt: "" });
  });

  it("polls config on start and returns updated config", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "enforce", updatedAt: "2026-01-01" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    await poller.start();

    expect(poller.getConfig()).toEqual({ mode: "enforce", updatedAt: "2026-01-01" });
    poller.stop();
  });

  it("polls at intervals", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "audit", updatedAt: "2026-01-01" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    await poller.start();

    await vi.advanceTimersByTimeAsync(3500);

    // Initial poll (awaited in start) + 3 interval polls = 4 calls
    expect(deps.fs.readFile).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("keeps previous config on poll error", async () => {
    let callCount = 0;
    const deps = {
      log: vi.fn() as (level: "info" | "warn" | "error", message: string) => void,
      fs: {
        readFile: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return JSON.stringify({ governance: { mode: "enforce", updatedAt: "2026-01-01" } });
          }
          throw new Error("network error");
        })
      }
    };

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    await poller.start();

    expect(poller.getConfig()).toEqual({ mode: "enforce", updatedAt: "2026-01-01" });

    // Trigger interval poll that will fail
    await vi.advanceTimersByTimeAsync(1000);
    expect(poller.getConfig()).toEqual({ mode: "enforce", updatedAt: "2026-01-01" });
    expect(deps.log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("Config poll failed")
    );
    poller.stop();
  });

  it("stop clears interval", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "off", updatedAt: "" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    await poller.start();
    poller.stop();

    const callsBefore = (deps.fs.readFile as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    const callsAfter = (deps.fs.readFile as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callsAfter).toBe(callsBefore);
  });

  it("start is idempotent when already started", async () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "off", updatedAt: "" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    await poller.start();
    await poller.start(); // should not create another timer

    // Only 1 initial poll, not 2
    expect(deps.fs.readFile).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("stop is safe to call when not started", () => {
    const deps = createDeps(
      JSON.stringify({ governance: { mode: "off", updatedAt: "" } })
    );

    const poller = createConfigPoller("/path/config.json", 1000, deps);
    expect(() => poller.stop()).not.toThrow();
  });
});
