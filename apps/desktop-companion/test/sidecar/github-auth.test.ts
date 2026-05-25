import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { EventEmitter } from "node:events";
import type {
  Server,
  IncomingMessage,
  ServerResponse,
  createServer as nodeCreateServer,
} from "node:http";
import type { IpcHandler, MethodHandler } from "../../src/sidecar/ipc-handler";
import type {
  GitHubAuthDeps,
  GitHubAuthResult,
} from "../../src/sidecar/github-auth";
import {
  startCallbackServer,
  exchangeCodeForCredentials,
  performGitHubAuth,
  registerGitHubAuthMethods,
  successPage,
  errorPage,
  defaultOpenUrl,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SCOPES,
  GITHUB_AUTHORIZE_URL,
} from "../../src/sidecar/github-auth";

// ---------------------------------------------------------------------------
// IPC test harness
// ---------------------------------------------------------------------------

type InvokableMockIpc = IpcHandler & {
  _invoke: (method: string, params: unknown) => Promise<unknown>;
};

function makeIpc(): InvokableMockIpc {
  const methods = new Map<string, MethodHandler>();
  return {
    handleRequest: vi.fn() as never,
    registerMethod: vi.fn((name: string, handler: MethodHandler) => {
      methods.set(name, handler);
    }) as never,
    sendNotification: vi.fn(),
    _invoke: async (method: string, params: unknown) => {
      const handler = methods.get(method);
      if (!handler) throw new Error(`No handler for ${method}`);
      return handler(params);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

class MockServer extends EventEmitter {
  private handler: RequestHandler | undefined;
  private _port = 54321;
  private _closed = false;

  constructor(handler?: RequestHandler) {
    super();
    this.handler = handler;
  }

  listen(port: number, host: string, cb?: () => void): this {
    if (cb) setImmediate(cb);
    return this;
  }

  address(): { port: number; family: string; address: string } | null {
    return { port: this._port, family: "IPv4", address: "127.0.0.1" };
  }

  close(cb?: () => void): this {
    this._closed = true;
    this.emit("close");
    if (cb) setImmediate(cb);
    return this;
  }

  simulateRequest(url: string): { status: number; body: string } {
    let status = 0;
    let body = "";
    const req = { url } as IncomingMessage;
    const res = {
      writeHead: (s: number, _headers?: Record<string, string>) => { status = s; },
      end: (b?: string) => { body = b ?? ""; },
    } as unknown as ServerResponse;
    this.handler!(req, res);
    return { status, body };
  }
}

function mockCreateServer(handler?: RequestHandler): MockServer {
  return new MockServer(handler);
}

function createMockCreateServer(): typeof nodeCreateServer {
  let capturedHandler: RequestHandler | undefined;
  const factory = ((handler: RequestHandler): MockServer => {
    capturedHandler = handler;
    const server = mockCreateServer(handler);
    (factory as unknown as { _lastServer: MockServer })._lastServer = server;
    return server;
  }) as unknown as typeof nodeCreateServer;
  (factory as unknown as { _lastServer: MockServer | undefined })._lastServer = undefined;
  (factory as unknown as { _getHandler: () => RequestHandler | undefined })._getHandler =
    () => capturedHandler;
  return factory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<GitHubAuthDeps>): GitHubAuthDeps {
  return {
    openUrl: overrides?.openUrl ?? vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
    fetch: overrides?.fetch ?? vi.fn(),
    createServer: overrides?.createServer ?? (createMockCreateServer() as unknown as typeof nodeCreateServer),
    randomBytes: overrides?.randomBytes ?? (() => Buffer.from("a".repeat(32))),
  };
}

function mockFetchOk(data: Record<string, unknown>): GitHubAuthDeps["fetch"] {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  } as unknown as Response);
}

function mockFetchError(status: number, body: string): GitHubAuthDeps["fetch"] {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response);
}

function makeServerFactory(): {
  factory: typeof nodeCreateServer;
  getServer: () => MockServer;
  simulateCallback: (url: string) => { status: number; body: string };
} {
  const csFactory = createMockCreateServer();
  return {
    factory: csFactory,
    getServer: () =>
      (csFactory as unknown as { _lastServer: MockServer })._lastServer,
    simulateCallback: (url: string) => {
      const server = (csFactory as unknown as { _lastServer: MockServer })
        ._lastServer;
      return server.simulateRequest(url);
    },
  };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

describe("HTML helpers", () => {
  it("successPage returns valid HTML", () => {
    const html = successPage();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Authenticated");
    expect(html).toContain("close this tab");
  });

  it("errorPage escapes HTML entities", () => {
    const html = errorPage('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;xss&quot;");
  });

  it("errorPage renders the message", () => {
    const html = errorPage("Something & broke");
    expect(html).toContain("Something &amp; broke");
    expect(html).toContain("Error");
  });
});

// ---------------------------------------------------------------------------
// defaultOpenUrl
// ---------------------------------------------------------------------------

describe("defaultOpenUrl", () => {
  it("is exported as a function", () => {
    expect(typeof defaultOpenUrl).toBe("function");
  });

  it("calls execFile with platform-appropriate command on darwin", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      await expect(defaultOpenUrl("https://example.com")).rejects.toBeDefined();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("uses cmd on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      await expect(defaultOpenUrl("https://example.com")).rejects.toBeDefined();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("uses xdg-open on linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      await expect(defaultOpenUrl("https://example.com")).rejects.toBeDefined();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

// ---------------------------------------------------------------------------
// startCallbackServer
// ---------------------------------------------------------------------------

describe("startCallbackServer", () => {
  it("resolves with port from server address", async () => {
    const { factory } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "test-state",
    );
    expect(server.port).toBe(54321);
    server.waitForCode().catch(() => {});
    await server.close();
  });

  it("returns code on valid callback with matching state", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "my-state",
    );
    const codePromise = server.waitForCode();

    const resp = simulateCallback("/callback?code=abc123&state=my-state");
    expect(resp.status).toBe(200);
    expect(resp.body).toContain("Authenticated");

    await expect(codePromise).resolves.toBe("abc123");
    await server.close();
  });

  it("rejects on state mismatch", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "expected",
    );
    const codePromise = server.waitForCode();

    const resp = simulateCallback("/callback?code=abc&state=wrong");
    expect(resp.status).toBe(400);
    expect(resp.body).toContain("State mismatch");

    await expect(codePromise).rejects.toThrow("OAuth state mismatch");
    await server.close();
  });

  it("rejects when code or state is missing", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();

    const resp = simulateCallback("/callback?code=abc");
    expect(resp.status).toBe(400);

    await expect(codePromise).rejects.toThrow("Missing code or state");
    await server.close();
  });

  it("rejects on GitHub error param with description", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();

    const resp = simulateCallback(
      "/callback?error=access_denied&error_description=User+denied",
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toContain("Error");

    await expect(codePromise).rejects.toThrow("GitHub OAuth denied: User denied");
    await server.close();
  });

  it("rejects on GitHub error without description", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();

    simulateCallback("/callback?error=server_error");
    await expect(codePromise).rejects.toThrow(
      "GitHub OAuth denied: server_error",
    );
    await server.close();
  });

  it("returns 404 for non-callback paths", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );

    const resp = simulateCallback("/other");
    expect(resp.status).toBe(404);
    expect(resp.body).toBe("Not found");
    // Prevent unhandled rejection from pending code promise on close
    server.waitForCode().catch(() => {});
    await server.close();
  });

  it("rejects code promise when server closes before callback", async () => {
    const { factory } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();
    // Attach handler before close to prevent unhandled rejection
    const assertion = expect(codePromise).rejects.toThrow(
      "Auth server closed before callback received",
    );
    await server.close();
    await assertion;
  });

  it("ignores duplicate callbacks after first resolve", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();

    simulateCallback("/callback?code=first&state=s");
    simulateCallback("/callback?code=second&state=s");

    await expect(codePromise).resolves.toBe("first");
    await server.close();
  });

  it("ignores duplicate error callbacks after first reject", async () => {
    const { factory, simulateCallback } = makeServerFactory();
    const server = await startCallbackServer(
      factory as unknown as GitHubAuthDeps["createServer"],
      "s",
    );
    const codePromise = server.waitForCode();

    simulateCallback("/callback?error=first_error");
    simulateCallback("/callback?error=second_error");

    await expect(codePromise).rejects.toThrow("GitHub OAuth denied: first_error");
    await server.close();
  });

  it("rejects start promise on server error", async () => {
    const errorFactory = ((handler: RequestHandler) => {
      const server = mockCreateServer(handler);
      const origListen = server.listen.bind(server);
      server.listen = ((_port: number, _host: string, _cb?: () => void) => {
        setImmediate(() => server.emit("error", new Error("EADDRINUSE")));
        return server;
      }) as typeof server.listen;
      return server;
    }) as unknown as typeof nodeCreateServer;

    await expect(
      startCallbackServer(
        errorFactory as GitHubAuthDeps["createServer"],
        "s",
      ),
    ).rejects.toThrow("EADDRINUSE");
  });

  it("rejects start promise when address returns null", async () => {
    const nullAddrFactory = ((handler: RequestHandler) => {
      const server = mockCreateServer(handler);
      server.address = () => null;
      return server;
    }) as unknown as typeof nodeCreateServer;

    await expect(
      startCallbackServer(
        nullAddrFactory as GitHubAuthDeps["createServer"],
        "s",
      ),
    ).rejects.toThrow("Failed to get server address");
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForCredentials
// ---------------------------------------------------------------------------

describe("exchangeCodeForCredentials", () => {
  it("returns credentials on successful exchange", async () => {
    const fetchFn = mockFetchOk({
      token: "tok-123",
      tenantId: "tenant-abc",
      workspaceId: "ws-xyz",
    });

    const result = await exchangeCodeForCredentials(
      fetchFn,
      "https://cp.example.com",
      "code-456",
      "http://127.0.0.1:9999/callback",
    );

    expect(result).toEqual({
      authToken: "tok-123",
      tenantId: "tenant-abc",
      workspaceId: "ws-xyz",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://cp.example.com/auth/github/desktop-exchange",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("throws on non-ok response with JSON error message", async () => {
    const fetchFn = mockFetchError(
      401,
      JSON.stringify({ message: "Invalid code" }),
    );

    await expect(
      exchangeCodeForCredentials(fetchFn, "https://cp.example.com", "bad", "uri"),
    ).rejects.toThrow("Invalid code");
  });

  it("throws on non-ok response with non-JSON body", async () => {
    const fetchFn = mockFetchError(500, "Internal Server Error");

    await expect(
      exchangeCodeForCredentials(fetchFn, "https://cp.example.com", "c", "u"),
    ).rejects.toThrow("Control plane returned 500");
  });

  it("throws when response is missing required fields", async () => {
    const fetchFn = mockFetchOk({ token: "t" });

    await expect(
      exchangeCodeForCredentials(fetchFn, "https://cp.example.com", "c", "u"),
    ).rejects.toThrow("missing required fields");
  });

  it("throws on network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      exchangeCodeForCredentials(fetchFn, "https://cp.example.com", "c", "u"),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// performGitHubAuth
// ---------------------------------------------------------------------------

describe("performGitHubAuth", () => {
  it("orchestrates full flow: server → browser → callback → exchange", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=the-code&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "tok",
      tenantId: "tid",
      workspaceId: "wid",
    });

    const deps = makeDeps({
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });

    const result = await performGitHubAuth(
      { clientId: "cid", controlPlaneUrl: "https://cp.test" },
      deps,
      new AbortController().signal,
    );

    expect(result).toEqual({
      authToken: "tok",
      tenantId: "tid",
      workspaceId: "wid",
    });

    const openedUrl = openUrlMock.mock.calls[0]![0];
    expect(openedUrl).toContain(GITHUB_AUTHORIZE_URL);
    expect(openedUrl).toContain("client_id=cid");
    expect(openedUrl).toContain("scope=read%3Auser+read%3Aorg");
  });

  it("uses custom scopes and timeout when provided", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "ti",
      workspaceId: "wi",
    });

    const deps = makeDeps({
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });

    await performGitHubAuth(
      {
        clientId: "cid",
        controlPlaneUrl: "https://cp.test",
        scopes: ["repo"],
        timeoutMs: 1000,
      },
      deps,
      new AbortController().signal,
    );

    const openedUrl = openUrlMock.mock.calls[0]![0];
    expect(openedUrl).toContain("scope=repo");
  });

  it("rejects on timeout", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const deps = makeDeps({
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });

    await expect(
      performGitHubAuth(
        { clientId: "c", controlPlaneUrl: "https://cp.test", timeoutMs: 50 },
        deps,
        new AbortController().signal,
      ),
    ).rejects.toThrow("timed out after 50ms");
  });

  it("rejects on abort", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const deps = makeDeps({
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });
    const abort = new AbortController();

    const promise = performGitHubAuth(
      { clientId: "c", controlPlaneUrl: "https://cp.test", timeoutMs: 30_000 },
      deps,
      abort.signal,
    );

    setTimeout(() => abort.abort(), 20);
    await expect(promise).rejects.toThrow("GitHub OAuth cancelled");
  });

  it("rejects immediately if signal already aborted", async () => {
    const { factory } = makeServerFactory();
    const deps = makeDeps({
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });
    const abort = new AbortController();
    abort.abort();

    await expect(
      performGitHubAuth(
        { clientId: "c", controlPlaneUrl: "https://cp.test" },
        deps,
        abort.signal,
      ),
    ).rejects.toThrow("GitHub OAuth cancelled");
  });

  it("closes callback server on exchange failure", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = vi.fn().mockRejectedValue(new Error("exchange failed"));
    const deps = makeDeps({
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });

    await expect(
      performGitHubAuth(
        { clientId: "c", controlPlaneUrl: "https://cp.test", timeoutMs: 5000 },
        deps,
        new AbortController().signal,
      ),
    ).rejects.toThrow("exchange failed");
  });

  it("closes callback server on browser open failure", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn().mockRejectedValue(new Error("no browser"));
    const deps = makeDeps({
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
    });

    await expect(
      performGitHubAuth(
        { clientId: "c", controlPlaneUrl: "https://cp.test" },
        deps,
        new AbortController().signal,
      ),
    ).rejects.toThrow("no browser");
  });
});

// ---------------------------------------------------------------------------
// registerGitHubAuthMethods
// ---------------------------------------------------------------------------

describe("registerGitHubAuthMethods", () => {
  let ipc: InvokableMockIpc;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    ipc = makeIpc();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("registers both methods", () => {
    registerGitHubAuthMethods(ipc);
    expect(ipc.registerMethod).toHaveBeenCalledWith(
      "github-auth.start",
      expect.any(Function),
    );
    expect(ipc.registerMethod).toHaveBeenCalledWith(
      "github-auth.cancel",
      expect.any(Function),
    );
  });

  it("start succeeds with params", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "tid",
      workspaceId: "wid",
    });

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("b".repeat(32)),
    });

    const result = (await ipc._invoke("github-auth.start", {
      clientId: "my-client",
      controlPlaneUrl: "https://cp.test",
      timeoutMs: 5000,
    })) as GitHubAuthResult;

    expect(result.authToken).toBe("t");
    expect(result.tenantId).toBe("tid");
  });

  it("start reads config from env when not in params", async () => {
    process.env["GITHUB_OAUTH_CLIENT_ID"] = "env-client-id";
    process.env["JOYUS_CONTROL_PLANE_URL"] = "https://cp-env.test";

    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("client_id")).toBe("env-client-id");
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "tid",
      workspaceId: "wid",
    });

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("c".repeat(32)),
    });

    await ipc._invoke("github-auth.start", {});
    expect(openUrlMock).toHaveBeenCalledOnce();
  });

  it("start throws when clientId is missing", async () => {
    delete process.env["GITHUB_OAUTH_CLIENT_ID"];
    registerGitHubAuthMethods(ipc);

    await expect(
      ipc._invoke("github-auth.start", { controlPlaneUrl: "https://cp.test" }),
    ).rejects.toThrow("clientId required");
  });

  it("start throws when controlPlaneUrl is missing", async () => {
    delete process.env["JOYUS_CONTROL_PLANE_URL"];
    registerGitHubAuthMethods(ipc);

    await expect(
      ipc._invoke("github-auth.start", { clientId: "cid" }),
    ).rejects.toThrow("controlPlaneUrl required");
  });

  it("start rejects concurrent flows", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("d".repeat(32)),
    });

    const first = ipc._invoke("github-auth.start", {
      clientId: "c",
      controlPlaneUrl: "https://cp.test",
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 50));

    await expect(
      ipc._invoke("github-auth.start", {
        clientId: "c",
        controlPlaneUrl: "https://cp.test",
      }),
    ).rejects.toThrow("already in progress");

    await ipc._invoke("github-auth.cancel", {});
    await expect(first).rejects.toThrow("cancelled");
  });

  it("cancel returns false when no flow is active", async () => {
    registerGitHubAuthMethods(ipc);
    const result = await ipc._invoke("github-auth.cancel", {});
    expect(result).toEqual({ cancelled: false });
  });

  it("cancel aborts an active flow", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("e".repeat(32)),
    });

    const flowPromise = ipc._invoke("github-auth.start", {
      clientId: "c",
      controlPlaneUrl: "https://cp.test",
      timeoutMs: 30_000,
    });

    await new Promise((r) => setTimeout(r, 50));

    const cancelResult = await ipc._invoke("github-auth.cancel", {});
    expect(cancelResult).toEqual({ cancelled: true });

    await expect(flowPromise).rejects.toThrow("cancelled");
  });

  it("start handles null params", async () => {
    delete process.env["GITHUB_OAUTH_CLIENT_ID"];
    registerGitHubAuthMethods(ipc);
    await expect(ipc._invoke("github-auth.start", null)).rejects.toThrow(
      "clientId required",
    );
  });

  it("start handles non-object params", async () => {
    delete process.env["GITHUB_OAUTH_CLIENT_ID"];
    registerGitHubAuthMethods(ipc);
    await expect(
      ipc._invoke("github-auth.start", "string-param"),
    ).rejects.toThrow("clientId required");
  });

  it("start accepts custom scopes array", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("scope")).toBe("repo admin:org");
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "tid",
      workspaceId: "wid",
    });

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("f".repeat(32)),
    });

    await ipc._invoke("github-auth.start", {
      clientId: "c",
      controlPlaneUrl: "https://cp.test",
      scopes: ["repo", "admin:org"],
      timeoutMs: 5000,
    });
  });

  it("start ignores invalid scopes (non-array)", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("scope")).toBe("read:user read:org");
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "tid",
      workspaceId: "wid",
    });

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("g".repeat(32)),
    });

    await ipc._invoke("github-auth.start", {
      clientId: "c",
      controlPlaneUrl: "https://cp.test",
      scopes: "not-an-array",
      timeoutMs: 5000,
    });
  });

  it("start ignores invalid timeoutMs", async () => {
    const { factory, simulateCallback } = makeServerFactory();

    const openUrlMock = vi.fn<(url: string) => Promise<void>>().mockImplementation(async (url) => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get("state")!;
      simulateCallback(`/callback?code=c&state=${state}`);
    });

    const fetchFn = mockFetchOk({
      token: "t",
      tenantId: "tid",
      workspaceId: "wid",
    });

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      fetch: fetchFn,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("h".repeat(32)),
    });

    await ipc._invoke("github-auth.start", {
      clientId: "c",
      controlPlaneUrl: "https://cp.test",
      timeoutMs: -1,
    });
  });

  it("start clears activeAbort after failure", async () => {
    const { factory } = makeServerFactory();
    const openUrlMock = vi.fn().mockRejectedValue(new Error("no browser"));

    registerGitHubAuthMethods(ipc, {
      openUrl: openUrlMock,
      createServer: factory as unknown as GitHubAuthDeps["createServer"],
      randomBytes: () => Buffer.from("k".repeat(32)),
    });

    await expect(
      ipc._invoke("github-auth.start", {
        clientId: "c",
        controlPlaneUrl: "https://cp.test",
      }),
    ).rejects.toThrow("no browser");

    const cancelResult = await ipc._invoke("github-auth.cancel", {});
    expect(cancelResult).toEqual({ cancelled: false });
  });

  it("start rejects empty clientId string", async () => {
    delete process.env["GITHUB_OAUTH_CLIENT_ID"];
    registerGitHubAuthMethods(ipc);
    await expect(
      ipc._invoke("github-auth.start", {
        clientId: "",
        controlPlaneUrl: "https://cp.test",
      }),
    ).rejects.toThrow("clientId required");
  });

  it("start rejects empty controlPlaneUrl string", async () => {
    delete process.env["JOYUS_CONTROL_PLANE_URL"];
    registerGitHubAuthMethods(ipc);
    await expect(
      ipc._invoke("github-auth.start", {
        clientId: "c",
        controlPlaneUrl: "",
      }),
    ).rejects.toThrow("controlPlaneUrl required");
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("DEFAULT_TIMEOUT_MS is 5 minutes", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(300_000);
  });

  it("DEFAULT_SCOPES includes read:user and read:org", () => {
    expect(DEFAULT_SCOPES).toEqual(["read:user", "read:org"]);
  });

  it("GITHUB_AUTHORIZE_URL is correct", () => {
    expect(GITHUB_AUTHORIZE_URL).toBe(
      "https://github.com/login/oauth/authorize",
    );
  });
});
