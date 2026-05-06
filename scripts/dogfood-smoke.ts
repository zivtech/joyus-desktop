#!/usr/bin/env tsx

interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: string;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

interface ToolsListResult {
  tools?: Array<{ name?: string }>;
}

interface SessionResponse {
  sessionId?: string;
  id?: string;
}

interface MessageResponse {
  message?: string;
  citations?: Array<{ title?: string; sourceId?: string; itemId?: string }>;
  metadata?: {
    sourcesSearched?: number;
    sourcesUsed?: number;
    responseTime?: number;
  };
}

const controlPlaneBaseUrl = stripTrailingSlash(
  process.env["JOYUS_API_URL"] ?? process.env["JOYUS_MCP_BASE_URL"] ?? "",
);
const controlPlaneToken =
  process.env["JOYUS_API_TOKEN"] ?? process.env["JOYUS_MCP_BEARER_TOKEN"] ?? "";
const mediationBaseUrl = stripTrailingSlash(
  process.env["JOYUS_MEDIATION_BASE_URL"] || controlPlaneBaseUrl || "http://localhost:3000",
);
const mediationApiKey =
  process.env["JOYUS_MEDIATION_API_KEY"] ?? process.env["API_KEY"] ?? "";
const mediationBearerToken =
  process.env["JOYUS_MEDIATION_BEARER_TOKEN"] ?? process.env["JOYUS_DEV_JWT_TOKEN"] ?? "";
const smokeMessage =
  process.env["JOYUS_SMOKE_MESSAGE"] ?? "multi tenant architecture accessibility citations";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postMcp<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!controlPlaneBaseUrl) {
    throw new Error("JOYUS_API_URL or JOYUS_MCP_BASE_URL is required for MCP smoke");
  }
  if (!controlPlaneToken) {
    throw new Error("JOYUS_API_TOKEN or JOYUS_MCP_BEARER_TOKEN is required for MCP smoke");
  }

  const response = await fetch(`${controlPlaneBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${controlPlaneToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `dogfood-${method}`,
      method,
      params,
    }),
  });

  const payload = (await readJsonResponse(response)) as JsonRpcResponse<T>;
  if (!response.ok) {
    throw new Error(`MCP ${method} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (payload.error) {
    throw new Error(`MCP ${method} failed: ${payload.error.message ?? "unknown error"}`);
  }
  return payload.result as T;
}

async function postMediation<T>(path: string, body: unknown): Promise<T> {
  if (!mediationApiKey) {
    throw new Error("JOYUS_MEDIATION_API_KEY or API_KEY is required for mediation smoke");
  }
  if (!mediationBearerToken) {
    throw new Error(
      "JOYUS_MEDIATION_BEARER_TOKEN or JOYUS_DEV_JWT_TOKEN is required for mediation smoke",
    );
  }

  const response = await fetch(`${mediationBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": mediationApiKey,
      authorization: `Bearer ${mediationBearerToken}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function checkMcp(): Promise<void> {
  await postMcp("initialize");
  const toolsResult = await postMcp<ToolsListResult>("tools/list");
  const toolNames = (toolsResult.tools ?? [])
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === "string");

  if (!toolNames.includes("content_search")) {
    throw new Error("MCP smoke failed: content_search tool is not listed");
  }

  console.log(`MCP ok: ${toolNames.length} tools listed`);
  console.log(`MCP content tools: ${toolNames.filter((name) => name.startsWith("content_")).join(", ")}`);
}

async function checkMediation(): Promise<void> {
  const health = await fetch(`${mediationBaseUrl}/api/mediation/health`, {
    headers: {
      "x-api-key": mediationApiKey,
      authorization: `Bearer ${mediationBearerToken}`,
    },
  });
  if (!health.ok) {
    throw new Error(`Mediation health failed with HTTP ${health.status}`);
  }

  const session = await postMediation<SessionResponse>("/api/mediation/sessions", {});
  const sessionId = session.sessionId ?? session.id;
  if (!sessionId) {
    throw new Error(`Mediation session response did not include an id: ${JSON.stringify(session)}`);
  }

  const result = await postMediation<MessageResponse>(
    `/api/mediation/sessions/${sessionId}/messages`,
    { message: smokeMessage, maxSources: 5 },
  );

  const sourcesUsed = result.metadata?.sourcesUsed ?? 0;
  const citations = result.citations ?? [];
  const message = result.message ?? "";

  if (sourcesUsed < 1) {
    throw new Error(`Mediation smoke failed: expected at least one source, got ${sourcesUsed}`);
  }

  console.log(`Mediation ok: session ${sessionId}`);
  console.log(`Mediation retrieval: ${sourcesUsed} source(s) used`);

  if (message.includes("[Generation not configured]")) {
    console.log("Live generation blocked: PlaceholderGenerationProvider is active");
    process.exitCode = 2;
    return;
  }

  if (citations.length < 1) {
    throw new Error("Mediation smoke failed: expected at least one citation");
  }

  console.log(`Live generation ok: ${citations.length} citation(s) returned`);
  console.log(`Response time: ${result.metadata?.responseTime ?? "unknown"}ms`);
}

await checkMcp();
await checkMediation();
