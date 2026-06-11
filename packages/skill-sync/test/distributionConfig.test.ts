import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadDistributionConfigFromFile,
  loadDistributionConfigFromUrl,
  resolveConfigPath,
  resolvePinnedVersion
} from "../src/distributionConfig";

describe("distributionConfig", () => {
  it("resolves relative and absolute paths", () => {
    expect(resolveConfigPath("config/distribution-config.json", "/tmp/root")).toBe(
      "/tmp/root/config/distribution-config.json"
    );
    expect(resolveConfigPath("/tmp/a.json", "/tmp/root")).toBe("/tmp/a.json");
  });

  it("loads valid config from file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "pm-bundle": { version: "v1.1.0" }
        }
      }),
      "utf8"
    );

    const config = await loadDistributionConfigFromFile(path);
    expect(config.default_version).toBe("v1.0.0");
  });

  it("rejects invalid config from file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(path, JSON.stringify({ bad: true }), "utf8");

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("rejects null config payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(path, "null", "utf8");

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("rejects config missing schema_version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        default_version: "v1.0.0",
        bundles: {}
      }),
      "utf8"
    );

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("rejects config missing default_version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        bundles: {}
      }),
      "utf8"
    );

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("rejects config with non-object bundles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: "invalid"
      }),
      "utf8"
    );

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("rejects config with malformed bundle entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "pm-bundle": { version: 123 }
        }
      }),
      "utf8"
    );

    await expect(loadDistributionConfigFromFile(path)).rejects.toThrow(/Invalid distribution config/);
  });

  it("loads config from URL via fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "developer-bundle": { version: "v1.2.0" }
        }
      })
    });

    const config = await loadDistributionConfigFromUrl("https://example.com/config", fetchImpl as unknown as typeof fetch);
    expect(config.bundles["developer-bundle"]?.version).toBe("v1.2.0");
  });

  it("handles URL fetch failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    });

    await expect(
      loadDistributionConfigFromUrl("https://example.com/config", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/Failed to fetch distribution config/);
  });

  it("rejects invalid config payload fetched from URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schema_version: "1" })
    });

    await expect(
      loadDistributionConfigFromUrl("https://example.com/config", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/Invalid distribution config fetched/);
  });

  it("resolves pinned version by bundle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "developer-bundle": { version: "v2.0.0" }
        }
      }),
      "utf8"
    );

    const resolved = await resolvePinnedVersion({
      bundleName: "developer-bundle",
      configPath: path
    });

    expect(resolved).toEqual({
      bundleName: "developer-bundle",
      source: "bundle",
      version: "v2.0.0"
    });
  });

  it("falls back to default version when bundle missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dist-config-"));
    const path = join(dir, "distribution-config.json");
    await writeFile(
      path,
      JSON.stringify({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "pm-bundle": { version: "v1.0.1" }
        }
      }),
      "utf8"
    );

    const resolved = await resolvePinnedVersion({
      bundleName: "developer-bundle",
      configPath: path
    });

    expect(resolved).toEqual({
      source: "default",
      version: "v1.0.0"
    });
  });

  it("resolves pinned version from config URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schema_version: "1",
        default_version: "v1.0.0",
        bundles: {
          "full-bundle": { version: "v9.9.9" }
        }
      })
    });

    const resolved = await resolvePinnedVersion({
      bundleName: "full-bundle",
      configUrl: "https://example.com/config",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(resolved.version).toBe("v9.9.9");
  });
});
