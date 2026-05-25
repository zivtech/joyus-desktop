/**
 * GitHub OAuth convenience login for desktop.
 *
 * Starts a temporary localhost HTTP server, opens the user's browser to
 * GitHub's OAuth authorize page, handles the callback, and exchanges the
 * authorization code with the Joyus control plane for credentials.
 *
 * Control plane contract (POST /auth/github/desktop-exchange):
 *   Request:  { code: string, redirectUri: string }
 *   Response: { token: string, tenantId: string, workspaceId: string }
 */

import {
  createServer as nodeCreateServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import type { IpcHandler } from "./ipc-handler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_SCOPES: readonly string[] = ["read:user", "read:org"];
export const GITHUB_AUTHORIZE_URL =
  "https://github.com/login/oauth/authorize";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubAuthDeps {
  openUrl: (url: string) => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  createServer: typeof nodeCreateServer;
  randomBytes: (size: number) => Buffer;
}

export interface GitHubAuthResult {
  authToken: string;
  tenantId: string;
  workspaceId: string;
}

export interface CallbackServer {
  port: number;
  waitForCode: () => Promise<string>;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function successPage(): string {
  return [
    "<!DOCTYPE html><html><head><title>Joyus</title></head>",
    '<body style="font-family:system-ui;display:flex;align-items:center;',
    'justify-content:center;min-height:100vh;margin:0;background:#f0f4ff">',
    '<div style="text-align:center">',
    '<h1 style="color:#1a73e8">Authenticated</h1>',
    '<p style="color:#6b7280">You can close this tab and return to Joyus Desktop.</p>',
    "</div></body></html>",
  ].join("");
}

export function errorPage(message: string): string {
  return [
    "<!DOCTYPE html><html><head><title>Joyus</title></head>",
    '<body style="font-family:system-ui;display:flex;align-items:center;',
    'justify-content:center;min-height:100vh;margin:0;background:#fef2f2">',
    '<div style="text-align:center">',
    '<h1 style="color:#dc2626">Error</h1>',
    `<p style="color:#6b7280">${escapeHtml(message)}</p>`,
    "</div></body></html>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Default browser opener
// ---------------------------------------------------------------------------

export function defaultOpenUrl(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    nodeExecFile(cmd, args, (err) => {
      if (err !== null) reject(err);
      /* v8 ignore next */
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Callback server
// ---------------------------------------------------------------------------

export function startCallbackServer(
  createServerFn: GitHubAuthDeps["createServer"],
  expectedState: string,
): Promise<CallbackServer> {
  return new Promise<CallbackServer>((resolveStart, rejectStart) => {
    let settled = false;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    function settleCode(
      action: "resolve" | "reject",
      value: string | Error,
    ): void {
      if (settled) return;
      settled = true;
      if (action === "resolve") {
        resolveCode(value as string);
      } else {
        rejectCode(value as Error);
      }
    }

    const server: Server = createServerFn(
      (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");

        if (url.pathname !== "/callback") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }

        const error = url.searchParams.get("error");
        if (error !== null) {
          const desc = url.searchParams.get("error_description") ?? error;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(errorPage(desc));
          settleCode("reject", new Error(`GitHub OAuth denied: ${desc}`));
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (code === null || state === null) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorPage("Missing code or state parameter."));
          settleCode(
            "reject",
            new Error("Missing code or state in OAuth callback"),
          );
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorPage("State mismatch — possible CSRF attack."));
          settleCode("reject", new Error("OAuth state mismatch"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successPage());
        settleCode("resolve", code);
      },
    );

    server.on("close", () => {
      settleCode(
        "reject",
        new Error("Auth server closed before callback received"),
      );
    });

    server.on("error", (err: Error) => {
      rejectStart(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        rejectStart(new Error("Failed to get server address"));
        return;
      }
      resolveStart({
        port: addr.port,
        waitForCode: () => codePromise,
        close: () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Code exchange with control plane
// ---------------------------------------------------------------------------

export async function exchangeCodeForCredentials(
  fetchFn: GitHubAuthDeps["fetch"],
  controlPlaneUrl: string,
  code: string,
  redirectUri: string,
): Promise<GitHubAuthResult> {
  const url = `${controlPlaneUrl}/auth/github/desktop-exchange`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = `Control plane returned ${response.status}`;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed["message"] === "string") {
        message = parsed["message"];
      }
    } catch {
      // body is not JSON — use status-based message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (
    typeof data["token"] !== "string" ||
    typeof data["tenantId"] !== "string" ||
    typeof data["workspaceId"] !== "string"
  ) {
    throw new Error(
      "Control plane response missing required fields: token, tenantId, workspaceId",
    );
  }

  return {
    authToken: data["token"],
    tenantId: data["tenantId"],
    workspaceId: data["workspaceId"],
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function performGitHubAuth(
  config: {
    clientId: string;
    controlPlaneUrl: string;
    scopes?: readonly string[];
    timeoutMs?: number;
  },
  deps: GitHubAuthDeps,
  signal: AbortSignal,
): Promise<GitHubAuthResult> {
  const state = deps.randomBytes(32).toString("hex");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  const callbackServer = await startCallbackServer(deps.createServer, state);
  const redirectUri = `http://127.0.0.1:${callbackServer.port}/callback`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
  });
  const authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;

  try {
    await deps.openUrl(authorizeUrl);

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`GitHub OAuth timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error("GitHub OAuth cancelled"));
      };

      if (signal.aborted) {
        clearTimeout(timer);
        reject(new Error("GitHub OAuth cancelled"));
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });

      void callbackServer.waitForCode().then(
        (c) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(c);
        },
        (err) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(err as Error);
        },
      );
    });

    return await exchangeCodeForCredentials(
      deps.fetch,
      config.controlPlaneUrl,
      code,
      redirectUri,
    );
  } finally {
    // Suppress unhandled rejection: close() rejects the code promise if
    // still pending, but we have already settled via timeout/abort/error.
    callbackServer.waitForCode().catch(() => {});
    await callbackServer.close();
  }
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerGitHubAuthMethods(
  ipc: IpcHandler,
  deps?: Partial<GitHubAuthDeps>,
): void {
  const resolvedDeps: GitHubAuthDeps = {
    openUrl: deps?.openUrl ?? defaultOpenUrl,
    fetch: deps?.fetch ?? globalThis.fetch.bind(globalThis),
    createServer: deps?.createServer ?? nodeCreateServer,
    randomBytes: deps?.randomBytes ?? nodeRandomBytes,
  };

  let activeAbort: AbortController | undefined;

  ipc.registerMethod(
    "github-auth.start",
    async (params: unknown): Promise<unknown> => {
      if (activeAbort !== undefined) {
        throw new Error(
          "A GitHub authentication flow is already in progress",
        );
      }

      const p =
        params !== null && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {};

      const clientId =
        typeof p["clientId"] === "string" && p["clientId"] !== ""
          ? p["clientId"]
          : process.env["GITHUB_OAUTH_CLIENT_ID"];

      if (clientId === undefined || clientId === "") {
        throw new Error(
          "github-auth.start: clientId required (pass in params or set GITHUB_OAUTH_CLIENT_ID)",
        );
      }

      const controlPlaneUrl =
        typeof p["controlPlaneUrl"] === "string" &&
        p["controlPlaneUrl"] !== ""
          ? p["controlPlaneUrl"]
          : process.env["JOYUS_CONTROL_PLANE_URL"];

      if (controlPlaneUrl === undefined || controlPlaneUrl === "") {
        throw new Error(
          "github-auth.start: controlPlaneUrl required (pass in params or set JOYUS_CONTROL_PLANE_URL)",
        );
      }

      const scopes =
        Array.isArray(p["scopes"]) &&
        (p["scopes"] as unknown[]).every(
          (s: unknown) => typeof s === "string",
        )
          ? (p["scopes"] as string[])
          : undefined;

      const timeoutMs =
        typeof p["timeoutMs"] === "number" && p["timeoutMs"] > 0
          ? p["timeoutMs"]
          : undefined;

      const abort = new AbortController();
      activeAbort = abort;

      try {
        const config: {
          clientId: string;
          controlPlaneUrl: string;
          scopes?: readonly string[];
          timeoutMs?: number;
        } = { clientId, controlPlaneUrl };
        if (scopes !== undefined) config.scopes = scopes;
        if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;

        return await performGitHubAuth(
          config,
          resolvedDeps,
          abort.signal,
        );
      } finally {
        activeAbort = undefined;
      }
    },
  );

  ipc.registerMethod(
    "github-auth.cancel",
    async (): Promise<unknown> => {
      if (activeAbort === undefined) {
        return { cancelled: false };
      }
      activeAbort.abort();
      return { cancelled: true };
    },
  );
}
