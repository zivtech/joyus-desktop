#!/usr/bin/env node
/**
 * Mock control plane server for local testing.
 * Implements the MCP JSON-RPC interface expected by @joyus/policy-client.
 *
 * Usage:
 *   node scripts/mock-control-plane.mjs [--port 9400]
 *
 * Then set:
 *   JOYUS_API_URL=http://localhost:9400
 *   JOYUS_API_TOKEN=test-token
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1] ?? "9400"
  : "9400", 10);

function makeToken() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "mock-user",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: randomUUID(),
  })).toString("base64url");
  const sig = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function handleVerifyBeforeAction(args) {
  return {
    decision: "allow",
    reason: "Mock control plane: all actions permitted in test mode",
    token: makeToken(),
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    jti: randomUUID(),
    risk_level: args.risk_level ?? "low",
  };
}

function handleRequestWorkspace(args) {
  return {
    workspace_id: `ws-mock-${randomUUID().slice(0, 8)}`,
    tenant_id: args.tenant_id ?? "mock-tenant",
    mode: args.mode ?? "managed_remote",
    created_by: "mock-user",
    label: args.label ?? null,
    created_at: new Date().toISOString(),
    status: "ready",
  };
}

function handleGetProvenance(args) {
  return {
    artifact_id: args.artifact_id ?? "unknown",
    origin: "mock-control-plane",
    created_at: new Date().toISOString(),
    signatures: [],
    chain: [],
  };
}

const TOOL_HANDLERS = {
  verify_before_action: handleVerifyBeforeAction,
  request_workspace: handleRequestWorkspace,
  get_provenance: handleGetProvenance,
};

function handleMcpRequest(body) {
  const toolName = body?.params?.name;
  const args = body?.params?.arguments ?? {};

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    };
  }

  const result = handler(args);
  return {
    jsonrpc: "2.0",
    id: body?.id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
    },
  };
}

const server = createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", mode: "mock" }));
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && req.url === "/mcp") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const toolName = parsed?.params?.name ?? "unknown";
        console.log(`[mock] tools/call → ${toolName}`);
        const response = handleMcpRequest(parsed);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error("[mock] Parse error:", err.message);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: -32700, message: "Parse error" } }));
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Joyus Mock Control Plane`);
  console.log(`  ─────────────────────────`);
  console.log(`  Listening: http://localhost:${PORT}`);
  console.log(`  Health:    http://localhost:${PORT}/health`);
  console.log(`  MCP:       POST http://localhost:${PORT}/mcp`);
  console.log(`\n  Set these env vars for the desktop companion:`);
  console.log(`    JOYUS_API_URL=http://localhost:${PORT}`);
  console.log(`    JOYUS_API_TOKEN=test-token`);
  console.log(`\n  All policy decisions return "allow". Press Ctrl+C to stop.\n`);
});
