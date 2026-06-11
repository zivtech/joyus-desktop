import { describe, expect, it, vi } from "vitest";
import { hasVersionChanged, readVersionPin, updateSyncMetadata } from "../src/versionPin";

describe("readVersionPin", () => {
  it("reads version from valid distribution config", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "core-skills": { version: "v1.2.0" },
          },
        })
      ),
    };

    const version = await readVersionPin("/config.json", "core-skills", deps);
    expect(version).toBe("v1.2.0");
    expect(deps.readFile).toHaveBeenCalledWith("/config.json", "utf-8");
  });

  it("throws when bundles key is missing", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ other: "data" })),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      "Invalid distribution config: missing bundles"
    );
  });

  it("throws when bundles is null", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ bundles: null })),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      "Invalid distribution config: missing bundles"
    );
  });

  it("throws when bundles is not an object", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ bundles: "string" })),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      "Invalid distribution config: missing bundles"
    );
  });

  it("throws when config is not an object", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify("just a string")),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      "Invalid distribution config: missing bundles"
    );
  });

  it("throws when config is null", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue("null"),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      "Invalid distribution config: missing bundles"
    );
  });

  it("throws when bundle name is not found", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "other-bundle": { version: "v1.0.0" },
          },
        })
      ),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      'Bundle "core-skills" not found or missing version'
    );
  });

  it("throws when bundle is null", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "core-skills": null,
          },
        })
      ),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      'Bundle "core-skills" not found or missing version'
    );
  });

  it("throws when bundle is not an object", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "core-skills": "not-an-object",
          },
        })
      ),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      'Bundle "core-skills" not found or missing version'
    );
  });

  it("throws when bundle version is missing", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "core-skills": { name: "core" },
          },
        })
      ),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      'Bundle "core-skills" not found or missing version'
    );
  });

  it("throws when bundle version is not a string", async () => {
    const deps = {
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          bundles: {
            "core-skills": { version: 123 },
          },
        })
      ),
    };

    await expect(readVersionPin("/config.json", "core-skills", deps)).rejects.toThrow(
      'Bundle "core-skills" not found or missing version'
    );
  });
});

describe("hasVersionChanged", () => {
  it("returns true when versions differ", () => {
    expect(hasVersionChanged("v1.0.0", "v1.1.0")).toBe(true);
  });

  it("returns false when versions are the same", () => {
    expect(hasVersionChanged("v1.0.0", "v1.0.0")).toBe(false);
  });
});

describe("updateSyncMetadata", () => {
  it("writes metadata and returns it", async () => {
    const deps = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValue("2026-03-11T00:00:00Z"),
    };

    const result = await updateSyncMetadata("/meta.json", "v1.2.0", deps);

    expect(result).toEqual({
      version: "v1.2.0",
      syncedAt: "2026-03-11T00:00:00Z",
      lastCheckAt: "2026-03-11T00:00:00Z",
    });
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/meta.json",
      JSON.stringify(
        {
          version: "v1.2.0",
          syncedAt: "2026-03-11T00:00:00Z",
          lastCheckAt: "2026-03-11T00:00:00Z",
        },
        null,
        2
      ),
      "utf-8"
    );
  });
});
