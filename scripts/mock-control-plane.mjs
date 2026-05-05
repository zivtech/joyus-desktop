#!/usr/bin/env node
/**
 * Mock control plane server for local testing.
 * Thin wrapper around the integration test harness.
 *
 * Usage:
 *   node scripts/mock-control-plane.mjs [--port 9400]
 *
 * Then set:
 *   JOYUS_API_URL=http://localhost:9400
 *   JOYUS_API_TOKEN=test-token
 */

import { startTestControlPlane } from "../packages/policy-client/test/fixtures/control-plane-harness.ts";

const PORT = parseInt(process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1] ?? "9400"
  : "9400", 10);

const harness = await startTestControlPlane({ port: PORT });

console.log(`\n  Joyus Mock Control Plane (harness-backed)`);
console.log(`  ──────────────────────────────────────────`);
console.log(`  Listening: ${harness.baseUrl}`);
console.log(`  Health:    ${harness.baseUrl}/health`);
console.log(`  MCP:       POST ${harness.baseUrl}/mcp`);
console.log(`\n  Tools: verify_before_action, initiate_handoff, complete_handoff,`);
console.log(`         handoff_status, request_workspace, get_provenance`);
console.log(`  tus upload stubs enabled for handoff testing.`);
console.log(`\n  Set these env vars for the desktop companion:`);
console.log(`    JOYUS_API_URL=${harness.baseUrl}`);
console.log(`    JOYUS_API_TOKEN=test-token`);
console.log(`\n  All policy decisions default to "allow". Press Ctrl+C to stop.\n`);

process.on("SIGINT", async () => {
  await harness.close();
  process.exit(0);
});
