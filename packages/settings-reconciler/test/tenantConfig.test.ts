import { mkdtemp, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  aggregateTenantConfig,
  resolveConfigPath,
  resolveHomePath,
  writeTenantConfig,
} from "../src/index";
import type { DistributionManifest } from "../src/index";

const FIXED_DATE = new Date("2026-04-01T12:00:00.000Z");
const now = () => FIXED_DATE;

function makeManifest(
  overrides: Partial<DistributionManifest> = {}
): DistributionManifest {
  return {
    schema_version: "1.0",
    tenant_id: "tenant-abc",
    bundles: {},
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tenant-config-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("aggregateTenantConfig", () => {
  it("returns empty parameters when no bundles", () => {
    const manifest = makeManifest({ bundles: {} });
    const result = aggregateTenantConfig(manifest, now);
    expect(result).toEqual({
      tenant_id: "tenant-abc",
      parameters: {},
      updated_at: FIXED_DATE.toISOString(),
    });
  });

  it("returns empty parameters when bundles have no config fields", () => {
    const manifest = makeManifest({
      bundles: {
        "bundle-a": { version: "1.0.0" },
        "bundle-b": { version: "2.0.0" },
      },
    });
    const result = aggregateTenantConfig(manifest, now);
    expect(result.parameters).toEqual({});
  });

  it("returns config from a single bundle", () => {
    const manifest = makeManifest({
      bundles: {
        "bundle-a": {
          version: "1.0.0",
          config: { threshold: 5, label: "short" },
        },
      },
    });
    const result = aggregateTenantConfig(manifest, now);
    expect(result.parameters).toEqual({ threshold: 5, label: "short" });
  });

  it("merges configs from multiple bundles with later (sorted) keys overriding earlier", () => {
    const manifest = makeManifest({
      bundles: {
        "bundle-b": {
          version: "1.0.0",
          config: { key1: "from-b", key2: "b-only" },
        },
        "bundle-a": {
          version: "1.0.0",
          config: { key1: "from-a", key3: "a-only" },
        },
      },
    });
    // Sorted order: bundle-a < bundle-b, so bundle-b overrides bundle-a for key1
    const result = aggregateTenantConfig(manifest, now);
    expect(result.parameters).toEqual({
      key1: "from-b",
      key2: "b-only",
      key3: "a-only",
    });
  });

  it("uses sorted key order (deterministic), not insertion order", () => {
    const manifest = makeManifest({
      bundles: {
        "zzz-last": { version: "1.0.0", config: { shared: "from-zzz" } },
        "aaa-first": { version: "1.0.0", config: { shared: "from-aaa" } },
      },
    });
    // aaa-first < zzz-last → zzz-last overrides
    const result = aggregateTenantConfig(manifest, now);
    expect(result.parameters["shared"]).toBe("from-zzz");
  });

  it("carries tenant_id from manifest", () => {
    const manifest = makeManifest({ tenant_id: "my-org" });
    const result = aggregateTenantConfig(manifest, now);
    expect(result.tenant_id).toBe("my-org");
  });

  it("sets updated_at from clock", () => {
    const manifest = makeManifest();
    const result = aggregateTenantConfig(manifest, now);
    expect(result.updated_at).toBe(FIXED_DATE.toISOString());
  });

  it("uses real clock when now is omitted", () => {
    const manifest = makeManifest();
    const before = Date.now();
    const result = aggregateTenantConfig(manifest);
    const after = Date.now();
    const ms = new Date(result.updated_at).getTime();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("does shallow merge — object values replace, not deep-merge", () => {
    const manifest = makeManifest({
      bundles: {
        "bundle-a": {
          version: "1.0.0",
          config: { nested: { x: 1, y: 2 } },
        },
        "bundle-b": {
          version: "1.0.0",
          config: { nested: { x: 99 } },
        },
      },
    });
    const result = aggregateTenantConfig(manifest, now);
    // bundle-b overwrites nested entirely (shallow merge)
    expect(result.parameters["nested"]).toEqual({ x: 99 });
  });
});

describe("writeTenantConfig", () => {
  it("writes valid pretty-printed JSON with trailing newline", async () => {
    const configPath = join(tmpDir, ".joyus-config.json");
    const config = {
      tenant_id: "t1",
      parameters: { foo: "bar" },
      updated_at: FIXED_DATE.toISOString(),
    };
    await writeTenantConfig(config, configPath);
    const raw = await readFile(configPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(config);
    expect(raw).toBe(JSON.stringify(config, null, 2) + "\n");
  });

  it("creates parent directories if missing", async () => {
    const configPath = join(tmpDir, "deep", "nested", ".joyus-config.json");
    const config = {
      tenant_id: "t1",
      parameters: {},
      updated_at: FIXED_DATE.toISOString(),
    };
    await writeTenantConfig(config, configPath);
    const raw = await readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual(config);
  });

  it("uses atomic write — no tmp file after success", async () => {
    const configPath = join(tmpDir, ".joyus-config.json");
    const config = {
      tenant_id: "t1",
      parameters: {},
      updated_at: FIXED_DATE.toISOString(),
    };
    await writeTenantConfig(config, configPath);
    const tmpPath = `${configPath}.tmp`;
    await expect(stat(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("overwrites existing file", async () => {
    const configPath = join(tmpDir, ".joyus-config.json");
    const config1 = { tenant_id: "t1", parameters: { v: 1 }, updated_at: "a" };
    const config2 = { tenant_id: "t1", parameters: { v: 2 }, updated_at: "b" };
    await writeTenantConfig(config1, configPath);
    await writeTenantConfig(config2, configPath);
    const raw = await readFile(configPath, "utf8");
    expect(JSON.parse(raw)).toEqual(config2);
  });
});

describe("resolveHomePath", () => {
  it("expands ~ alone to homedir", () => {
    expect(resolveHomePath("~")).toBe(homedir());
  });

  it("expands ~/... to homedir + path", () => {
    expect(resolveHomePath("~/.claude/.joyus-config.json")).toBe(
      homedir() + "/.claude/.joyus-config.json"
    );
  });

  it("leaves absolute paths unchanged", () => {
    expect(resolveHomePath("/tmp/config.json")).toBe("/tmp/config.json");
  });

  it("leaves relative paths unchanged", () => {
    expect(resolveHomePath("relative/path.json")).toBe("relative/path.json");
  });
});

describe("resolveConfigPath", () => {
  it("returns default path when manifest has no config_path", () => {
    const manifest = makeManifest();
    const result = resolveConfigPath(manifest);
    expect(result).toBe(homedir() + "/.claude/.joyus-config.json");
  });

  it("returns resolved config_path when manifest has config_path set", () => {
    const manifest = makeManifest({ config_path: "/custom/path/config.json" });
    const result = resolveConfigPath(manifest);
    expect(result).toBe("/custom/path/config.json");
  });

  it("expands ~ in config_path override", () => {
    const manifest = makeManifest({ config_path: "~/.custom/config.json" });
    const result = resolveConfigPath(manifest);
    expect(result).toBe(homedir() + "/.custom/config.json");
  });
});
