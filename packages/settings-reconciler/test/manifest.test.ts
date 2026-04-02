import { describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  fetchManifest,
  isValidManifest,
  validateManifest,
} from "../src/manifest.js";
// Import from index.ts to ensure its re-exports are covered
import * as publicApi from "../src/index.js";

const MINIMAL_VALID = {
  schema_version: "1.0",
  tenant_id: "tenant-abc",
  bundles: {},
};

const FULL_VALID = {
  schema_version: "1.0",
  tenant_id: "tenant-abc",
  bundles: {
    "default-bundle": {
      version: "1.0.0",
      hooks: [
        {
          id: "joyus:pre-tool",
          event: "PreToolUse",
          matcher: ".*",
          command: "echo hello",
          timeout: 5000,
          target: "global",
        },
      ],
      mcpServers: [
        {
          id: "joyus:my-server",
          command: "node",
          args: ["server.js"],
          env: { PORT: "3000" },
          target: "project",
        },
      ],
      config: { foo: "bar" },
    },
  },
  config_path: "/etc/joyus/settings.json",
};

describe("index re-exports", () => {
  it("re-exports all public API members from index.ts", () => {
    expect(publicApi.SUPPORTED_SCHEMA_VERSIONS).toContain("1.0");
    expect(typeof publicApi.isValidManifest).toBe("function");
    expect(typeof publicApi.validateManifest).toBe("function");
    expect(typeof publicApi.fetchManifest).toBe("function");
  });
});

describe("SUPPORTED_SCHEMA_VERSIONS", () => {
  it("contains 1.0", () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain("1.0");
  });
});

describe("isValidManifest", () => {
  it("returns true for a minimal valid manifest (empty bundles)", () => {
    expect(isValidManifest(MINIMAL_VALID)).toBe(true);
  });

  it("returns true for a full valid manifest with hooks and MCPs", () => {
    expect(isValidManifest(FULL_VALID)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidManifest(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidManifest(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isValidManifest("hello")).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isValidManifest([])).toBe(false);
  });

  it("returns false when schema_version is missing", () => {
    expect(isValidManifest({ tenant_id: "t", bundles: {} })).toBe(false);
  });

  it("returns false when tenant_id is missing", () => {
    expect(isValidManifest({ schema_version: "1.0", bundles: {} })).toBe(false);
  });

  it("returns false when bundles is not an object", () => {
    expect(isValidManifest({ schema_version: "1.0", tenant_id: "t", bundles: "bad" })).toBe(false);
  });

  it("returns false when bundles is null", () => {
    expect(isValidManifest({ schema_version: "1.0", tenant_id: "t", bundles: null })).toBe(false);
  });

  it("returns false when bundles is an array", () => {
    expect(isValidManifest({ schema_version: "1.0", tenant_id: "t", bundles: [] })).toBe(false);
  });

  it("returns false when a bundle is missing version", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: { hooks: [] } },
      })
    ).toBe(false);
  });

  it("returns false when a hook is missing id", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            hooks: [{ event: "PreToolUse", matcher: ".*", command: "echo" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when a hook id lacks joyus: prefix", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            hooks: [{ id: "bad-prefix", event: "PreToolUse", matcher: ".*", command: "echo" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when a hook has an invalid event type", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            hooks: [{ id: "joyus:h", event: "InvalidEvent", matcher: ".*", command: "echo" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when a hook has an empty command", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            hooks: [{ id: "joyus:h", event: "PreToolUse", matcher: ".*", command: "" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when a hook is missing matcher", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            hooks: [{ id: "joyus:h", event: "PreToolUse", command: "echo" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when an MCP server is missing command", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            mcpServers: [{ id: "joyus:s" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when an MCP server id lacks joyus: prefix", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: {
          b: {
            version: "1.0",
            mcpServers: [{ id: "bad", command: "node" }],
          },
        },
      })
    ).toBe(false);
  });

  it("returns false when hooks is not an array", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: { version: "1.0", hooks: "not-array" } },
      })
    ).toBe(false);
  });

  it("returns false when mcpServers is not an array", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: { version: "1.0", mcpServers: "not-array" } },
      })
    ).toBe(false);
  });

  it("returns false when a hook entry is null", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: { version: "1.0", hooks: [null] } },
      })
    ).toBe(false);
  });

  it("returns false when an MCP server entry is null", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: { version: "1.0", mcpServers: [null] } },
      })
    ).toBe(false);
  });

  it("returns false when a bundle entry is null", () => {
    expect(
      isValidManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { b: null },
      })
    ).toBe(false);
  });
});

describe("validateManifest", () => {
  it("returns the manifest for valid input", () => {
    const result = validateManifest(MINIMAL_VALID);
    expect(result.schema_version).toBe("1.0");
    expect(result.tenant_id).toBe("tenant-abc");
  });

  it("returns full manifest with hooks and MCPs", () => {
    const result = validateManifest(FULL_VALID);
    expect(result.bundles["default-bundle"]?.version).toBe("1.0.0");
  });

  it("throws for non-object input", () => {
    expect(() => validateManifest(null)).toThrow(/Invalid manifest/);
    expect(() => validateManifest(undefined)).toThrow(/Invalid manifest/);
    expect(() => validateManifest("string")).toThrow(/Invalid manifest/);
    expect(() => validateManifest([])).toThrow(/Invalid manifest/);
  });

  it("throws with descriptive message for missing schema_version", () => {
    expect(() => validateManifest({ tenant_id: "t", bundles: {} })).toThrow(
      /schema_version/
    );
  });

  it("throws for unsupported schema_version", () => {
    expect(() =>
      validateManifest({ schema_version: "99.0", tenant_id: "t", bundles: {} })
    ).toThrow(/unsupported schema_version/);
  });

  it("throws with descriptive message for missing tenant_id", () => {
    expect(() => validateManifest({ schema_version: "1.0", bundles: {} })).toThrow(
      /tenant_id/
    );
  });

  it("throws with descriptive message for invalid bundles", () => {
    expect(() =>
      validateManifest({ schema_version: "1.0", tenant_id: "t", bundles: null })
    ).toThrow(/bundles/);
  });

  it("throws with bundle name in message for invalid bundle", () => {
    expect(() =>
      validateManifest({
        schema_version: "1.0",
        tenant_id: "t",
        bundles: { "my-bundle": { hooks: [] } },
      })
    ).toThrow(/my-bundle/);
  });

  it("accepts empty bundles (revocation case)", () => {
    const result = validateManifest({ schema_version: "1.0", tenant_id: "t", bundles: {} });
    expect(result.bundles).toEqual({});
  });
});

describe("fetchManifest", () => {
  it("returns a valid manifest on successful fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MINIMAL_VALID,
    });

    const result = await fetchManifest("https://example.com/manifest.json", fetchImpl as unknown as typeof fetch);
    expect(result.tenant_id).toBe("tenant-abc");
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/manifest.json");
  });

  it("throws with status on non-200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    await expect(
      fetchManifest("https://example.com/manifest.json", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("403");
  });

  it("throws on non-200 with 404 status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await expect(
      fetchManifest("https://example.com/manifest.json", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/404/);
  });

  it("throws on invalid JSON response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });

    await expect(
      fetchManifest("https://example.com/manifest.json", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow();
  });

  it("throws with validation error when JSON is valid but manifest is invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schema_version: "1.0" }),
    });

    await expect(
      fetchManifest("https://example.com/manifest.json", fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow(/Invalid manifest/);
  });

  it("uses global fetch when fetchImpl is not provided", async () => {
    const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MINIMAL_VALID,
    } as Response);

    const result = await fetchManifest("https://example.com/manifest.json");
    expect(result.tenant_id).toBe("tenant-abc");
    expect(globalFetchSpy).toHaveBeenCalledWith("https://example.com/manifest.json");
    globalFetchSpy.mockRestore();
  });
});
