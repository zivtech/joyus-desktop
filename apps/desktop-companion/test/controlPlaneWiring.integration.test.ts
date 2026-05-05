/**
 * Integration test: controlPlaneWiring end-to-end against the mock control plane.
 *
 * Spawns scripts/mock-control-plane.mjs on port 9402, sets required env vars,
 * creates wired components via createWiredComponents(), and exercises
 * requestPolicyDecision through the real fetch client to verify end-to-end
 * communication with the JSON-RPC MCP server.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  requestPolicyDecision,
  buildPolicyDecideRequest,
} from "@joyus/policy-client";

import { createWiredComponents } from "../src/controlPlaneWiring.js";
import type { WiredComponents } from "../src/controlPlaneWiring.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = 9402;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MOCK_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/mock-control-plane.mjs"
);

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverProcess: ReturnType<typeof spawn> | null = null;
let components: WiredComponents | null = null;
let replayCacheDbPath: string;

async function pollUntilReady(
  url: string,
  maxAttempts = 50,
  intervalMs = 100
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not yet listening
    }
    if (attempt < maxAttempts) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `Mock control plane at ${url} did not become ready within ${maxAttempts * intervalMs}ms`
  );
}

beforeAll(async () => {
  // Isolated replay cache DB to avoid cross-contaminating other runs
  replayCacheDbPath = join(
    tmpdir(),
    `integration-replay-${randomUUID()}`,
    "replay.db"
  );

  // Spawn the mock server on a dedicated port
  serverProcess = spawn(
    process.execPath,
    ["--import", "tsx/esm", MOCK_SCRIPT, "--port", String(PORT)],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[mock-server] ${String(chunk)}`);
  });

  // Wait for the server to be ready before running any test
  await pollUntilReady(`${BASE_URL}/health`);

  // Set env vars before calling createWiredComponents so loadConfigFromEnv
  // picks them up at call time (not at module load)
  process.env["JOYUS_API_URL"] = BASE_URL;
  process.env["JOYUS_API_TOKEN"] = "test-token";
  process.env["JOYUS_REPLAY_CACHE_PATH"] = replayCacheDbPath;
  // Disable retries for faster test execution
  process.env["JOYUS_RETRY_MAX_ATTEMPTS"] = "1";

  components = createWiredComponents();
}, 10_000);

afterAll(async () => {
  // Flush events, cancel timers, and close DB before killing the server
  if (components !== null) {
    await components.eventEmitter.flush();
    components.tokenRefresh.cancelAll();
    components.replayCache.close();
  }

  // Terminate the mock server and wait for it to exit
  if (serverProcess !== null) {
    serverProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      serverProcess!.once("exit", () => resolve());
      // Force-resolve after 3 s in case SIGTERM is slow
      setTimeout(resolve, 3_000);
    });
    serverProcess = null;
  }

  // Clean up the replay cache DB directory
  try {
    rmSync(join(replayCacheDbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore — may not have been created if openReplayCache is lazy
  }

  // Restore env vars
  delete process.env["JOYUS_API_URL"];
  delete process.env["JOYUS_API_TOKEN"];
  delete process.env["JOYUS_REPLAY_CACHE_PATH"];
  delete process.env["JOYUS_RETRY_MAX_ATTEMPTS"];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("controlPlaneWiring end-to-end against mock server", () => {
  it("requestPolicyDecision returns an allow decision from the mock control plane", async () => {
    const { fetch: fetchClient } = components!;

    const request = buildPolicyDecideRequest({
      actionName: "file.read",
      riskLevel: "low",
      tenantId: "tenant-integration",
      sessionId: "sess-integration-001",
    });

    const result = await requestPolicyDecision(fetchClient, {
      baseUrl: BASE_URL,
      bearerToken: "test-token",
      request,
    });

    // The mock server always returns decision=allow
    expect(result.decision).toBe("allow");

    // Verify the token round-tripped through the mock's makeToken()
    // (three dot-separated Base64url segments: header.payload.sig)
    expect(result.token.split(".")).toHaveLength(3);

    // Verify the remaining required fields are present and well-formed
    expect(typeof result.jti).toBe("string");
    expect(result.jti.length).toBeGreaterThan(0);
    expect(typeof result.token_expires_at).toBe("string");
    expect(result.token_expires_at.length).toBeGreaterThan(0);
    expect(result.risk_level).toBe("low");
  });

  it("createWiredComponents produces a fetch client that communicates with the real server", async () => {
    const { fetch: fetchClient } = components!;

    // Call a second action to verify the fetch client is reusable
    const request = buildPolicyDecideRequest({
      actionName: "data.export",
      riskLevel: "medium",
      tenantId: "tenant-integration",
      sessionId: "sess-integration-002",
    });

    const result = await requestPolicyDecision(fetchClient, {
      baseUrl: BASE_URL,
      bearerToken: "test-token",
      request,
    });

    expect(result.decision).toBe("allow");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("wired components bundle contains all four component types", () => {
    expect(components).not.toBeNull();
    expect(typeof components!.fetch).toBe("function");
    expect(components!.replayCache).toBeDefined();
    expect(components!.tokenRefresh).toBeDefined();
    expect(components!.eventEmitter).toBeDefined();
  });
});
