import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";

describe("cli", () => {
  it("prints help", async () => {
    const log = vi.fn();
    const error = vi.fn();

    const code = await runCli(["--help"], {
      sync: vi.fn(),
      readMetadata: vi.fn(),
      stdout: { log },
      stderr: { error }
    });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it("returns unknown status when metadata missing", async () => {
    const log = vi.fn();

    const code = await runCli(["--status"], {
      sync: vi.fn(),
      readMetadata: vi.fn().mockResolvedValue(undefined),
      stdout: { log },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ status: "unknown" }, null, 2));
  });

  it("fails sync when required config is missing", async () => {
    const error = vi.fn();
    const code = await runCli(["--sync"], {
      sync: vi.fn(),
      readMetadata: vi.fn(),
      stdout: { log: vi.fn() },
      stderr: { error }
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("runs sync with explicit args", async () => {
    const sync = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 10,
      metadataPath: "/tmp/meta.json",
      version: "v1.0.0",
      noop: false
    });
    const log = vi.fn();

    const code = await runCli([
      "--sync",
      "--repo-url",
      "https://example.com/repo.git",
      "--version",
      "v1.0.0",
      "--dest-dir",
      "/tmp/skills",
      "--cache-dir",
      "/tmp/cache"
    ], {
      sync,
      readMetadata: vi.fn(),
      stdout: { log },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(sync).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });

  it("resolves target version from distribution config when explicit version is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-sync-cli-"));
    const configPath = join(dir, "distribution-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "developer-bundle": { version: "v2.1.0" }
        }
      }),
      "utf8"
    );

    const sync = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 1,
      metadataPath: "/tmp/meta.json",
      version: "v2.1.0",
      noop: false
    });

    const code = await runCli([
      "--sync",
      "--repo-url",
      "https://example.com/repo.git",
      "--bundle",
      "developer-bundle",
      "--distribution-config",
      configPath
    ], {
      sync,
      readMetadata: vi.fn(),
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        targetVersion: "v2.1.0"
      })
    );
  });

  it("accepts distribution-config-url flag", async () => {
    const sync = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 1,
      metadataPath: "/tmp/meta.json",
      version: "v3.0.0",
      noop: false
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: "1",
        default_version: "v3.0.0",
        bundles: {}
      })
    } as Response);

    const code = await runCli([
      "--sync",
      "--repo-url",
      "https://example.com/repo.git",
      "--distribution-config-url",
      "https://example.com/distribution-config.json"
    ], {
      sync,
      readMetadata: vi.fn(),
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        targetVersion: "v3.0.0"
      })
    );
    fetchSpy.mockRestore();
  });

  it("suppresses sync output in quiet mode", async () => {
    const sync = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 0,
      metadataPath: "/tmp/meta.json",
      version: "v1.0.0",
      noop: true
    });
    const log = vi.fn();

    const code = await runCli([
      "--sync",
      "--quiet",
      "--repo-url",
      "https://example.com/repo.git",
      "--version",
      "v1.0.0"
    ], {
      sync,
      readMetadata: vi.fn(),
      stdout: { log },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(sync).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it("accepts explicit metadata path and pin-file flags while checking status", async () => {
    const readMetadata = vi.fn().mockResolvedValue({ status: "success", managedFiles: {} });
    const log = vi.fn();

    const code = await runCli([
      "--status",
      "--metadata",
      "/tmp/custom-metadata.json",
      "--pin-file",
      "/tmp/pin.json"
    ], {
      sync: vi.fn(),
      readMetadata,
      stdout: { log },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
    expect(readMetadata).toHaveBeenCalledWith("/tmp/custom-metadata.json");
    expect(log).toHaveBeenCalledOnce();
  });

  it("ignores dangling flags that have no value", async () => {
    const code = await runCli([
      "--status",
      "--metadata",
      "--pin-file"
    ], {
      sync: vi.fn(),
      readMetadata: vi.fn().mockResolvedValue(undefined),
      stdout: { log: vi.fn() },
      stderr: { error: vi.fn() }
    });

    expect(code).toBe(0);
  });

  it("returns non-zero when sync throws", async () => {
    const error = vi.fn();

    const code = await runCli([
      "--sync",
      "--repo-url",
      "https://example.com/repo.git",
      "--version",
      "v1.0.0"
    ], {
      sync: vi.fn().mockRejectedValue(new Error("boom")),
      readMetadata: vi.fn(),
      stdout: { log: vi.fn() },
      stderr: { error }
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("boom");
  });

  it("handles non-Error throw values from sync", async () => {
    const error = vi.fn();

    const code = await runCli([
      "--sync",
      "--repo-url",
      "https://example.com/repo.git",
      "--version",
      "v1.0.0"
    ], {
      sync: vi.fn().mockRejectedValue("plain failure"),
      readMetadata: vi.fn(),
      stdout: { log: vi.fn() },
      stderr: { error }
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("plain failure");
  });
});
