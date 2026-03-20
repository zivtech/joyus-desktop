import { describe, expect, it } from "vitest";

import {
  buildControlPlaneUrl,
  buildPolicyDecideRequest,
  callMcpTool,
  getArtifactProvenance,
  parsePolicyDecideResponse,
  requestPolicyDecision,
  requestWorkspace
} from "../src/controlPlaneContracts";

describe("buildControlPlaneUrl", () => {
  it("joins base URL and path without duplicate slashes", () => {
    expect(buildControlPlaneUrl("https://example.com/", "/v1/policy/decide")).toBe(
      "https://example.com/v1/policy/decide"
    );
  });

  it("adds leading slash when path is not absolute", () => {
    expect(buildControlPlaneUrl("https://example.com", "v1/events")).toBe("https://example.com/v1/events");
  });
});

describe("buildPolicyDecideRequest", () => {
  it("maps client-friendly input to control-plane schema", () => {
    expect(
      buildPolicyDecideRequest({
        actionName: "run_command",
        riskLevel: "medium",
        tenantId: "tenant-a",
        sessionId: "session-1",
        workspaceId: "ws-1",
        target: "terminal",
        details: { cmd: "npm test" },
        metadata: { source: "desktop" }
      })
    ).toEqual({
      action: {
        name: "run_command",
        risk_level: "medium",
        target: "terminal",
        details: { cmd: "npm test" }
      },
      session: {
        session_id: "session-1",
        tenant_id: "tenant-a",
        workspace_id: "ws-1"
      },
      metadata: { source: "desktop" }
    });
  });

  it("omits optional fields when they are not provided", () => {
    expect(
      buildPolicyDecideRequest({
        actionName: "read_file",
        riskLevel: "low",
        tenantId: "tenant-a",
        sessionId: "session-1"
      })
    ).toEqual({
      action: {
        name: "read_file",
        risk_level: "low"
      },
      session: {
        session_id: "session-1",
        tenant_id: "tenant-a"
      }
    });
  });
});

describe("parsePolicyDecideResponse", () => {
  it("accepts a valid policy decision response", () => {
    const parsed = parsePolicyDecideResponse({
      decision: "allow",
      reason: "risk policy allows action",
      token: "payload.signature",
      token_expires_at: "2026-03-05T13:00:00.000Z",
      jti: "jti-1",
      risk_level: "low"
    });

    expect(parsed.decision).toBe("allow");
    expect(parsed.risk_level).toBe("low");
  });

  it("rejects non-object input", () => {
    expect(() => parsePolicyDecideResponse(null)).toThrow("expected object");
  });

  it("rejects invalid decision values", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "approve",
        reason: "x",
        token: "payload.signature",
        token_expires_at: "x",
        jti: "j",
        risk_level: "low"
      })
    ).toThrow("decision");
  });

  it("rejects empty reason values", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "allow",
        reason: " ",
        token: "payload.signature",
        token_expires_at: "x",
        jti: "j",
        risk_level: "low"
      })
    ).toThrow("reason");
  });

  it("rejects invalid token shapes", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "allow",
        reason: "x",
        token: "nosignature",
        token_expires_at: "x",
        jti: "j",
        risk_level: "low"
      })
    ).toThrow("token");
  });

  it("rejects missing token expiry values", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "allow",
        reason: "x",
        token: "payload.signature",
        token_expires_at: " ",
        jti: "j",
        risk_level: "low"
      })
    ).toThrow("token_expires_at");
  });

  it("rejects empty jti values", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "allow",
        reason: "x",
        token: "payload.signature",
        token_expires_at: "x",
        jti: " ",
        risk_level: "low"
      })
    ).toThrow("jti");
  });

  it("rejects invalid risk levels", () => {
    expect(() =>
      parsePolicyDecideResponse({
        decision: "allow",
        reason: "x",
        token: "payload.signature",
        token_expires_at: "x",
        jti: "j",
        risk_level: "extreme"
      })
    ).toThrow("risk_level");
  });
});

describe("requestPolicyDecision", () => {
  it("calls verify_before_action through MCP tools/call", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    const fetchLike = async (url: string, init: { body?: string }) => {
      requests.push({
        url,
        body: init.body ? JSON.parse(init.body) : null
      });

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    decision: "allow",
                    reason: "ok",
                    token: "payload.signature",
                    token_expires_at: "2026-03-05T13:00:00.000Z",
                    jti: "jti-1",
                    risk_level: "low"
                  })
                }
              ]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const response = await requestPolicyDecision(fetchLike, {
      baseUrl: "https://control-plane.example.com/",
      bearerToken: "tok-1",
      request: buildPolicyDecideRequest({
        actionName: "run_command",
        riskLevel: "low",
        tenantId: "tenant-a",
        sessionId: "session-1"
      })
    });

    expect(response.decision).toBe("allow");
    expect(response.jti).toBe("jti-1");
    expect(requests[0]?.url).toBe("https://control-plane.example.com/mcp");
    expect(requests[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "verify_before_action",
        arguments: {
          tenant_id: "tenant-a",
          workspace_id: undefined,
          session_id: "session-1",
          action_name: "run_command",
          risk_level: "low",
          target: undefined,
          details: undefined,
          metadata: undefined
        }
      }
    });
  });

  it("throws when MCP call responds non-2xx", async () => {
    const fetchLike = async () => ({
      ok: false,
      status: 502,
      async json() {
        return {};
      },
      async text() {
        return "bad gateway";
      }
    });

    await expect(
      requestPolicyDecision(fetchLike, {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        request: buildPolicyDecideRequest({
          actionName: "run_command",
          riskLevel: "low",
          tenantId: "tenant-a",
          sessionId: "session-1"
        })
      })
    ).rejects.toThrow("MCP request failed (502): bad gateway");
  });
});

describe("callMcpTool", () => {
  it("parses valid JSON text content from MCP tool result", async () => {
    const result = await callMcpTool(
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: "{\"ok\":true}" }]
            }
          };
        },
        async text() {
          return "";
        }
      }),
      {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        toolName: "verify_before_action",
        arguments: { tenant_id: "tenant-a" }
      }
    );

    expect(result).toEqual({ ok: true });
  });

  it("throws when response body is not an object", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return null;
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("expected object");
  });

  it("throws when MCP returns tool error payload", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return { error: { code: -32001, message: "boom" } };
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("MCP tool call failed (-32001): boom");
  });

  it("uses default MCP error code/message when fields are missing", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return { error: {} };
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("MCP tool call failed (unknown): Unknown error");
  });

  it("throws when content is missing", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return { result: {} };
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("missing content");
  });

  it("throws when text content is malformed", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return { result: { content: [{ type: "json", text: "" }] } };
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("missing text content");
  });

  it("throws when text content is not valid JSON", async () => {
    await expect(
      callMcpTool(
        async () => ({
          ok: true,
          status: 200,
          async json() {
            return { result: { content: [{ type: "text", text: "not-json" }] } };
          },
          async text() {
            return "";
          }
        }),
        {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          toolName: "verify_before_action",
          arguments: {}
        }
      )
    ).rejects.toThrow("content is not valid JSON");
  });
});

describe("requestWorkspace", () => {
  it("calls request_workspace through MCP", async () => {
    const requests: Array<unknown> = [];

    const workspace = await requestWorkspace(
      async (_url: string, init: { body?: string }) => {
        requests.push(init.body ? JSON.parse(init.body) : null);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      workspace_id: "ws-1",
                      tenant_id: "tenant-a",
                      mode: "managed_remote",
                      created_by: "u-1",
                      label: null,
                      created_at: "2026-03-05T13:00:00.000Z",
                      status: "ready"
                    })
                  }
                ]
              }
            };
          },
          async text() {
            return "";
          }
        };
      },
      {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        tenantId: "tenant-a"
      }
    );

    expect(workspace.workspace_id).toBe("ws-1");
    expect(requests[0]).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "request_workspace",
        arguments: {
          tenant_id: "tenant-a",
          mode: "managed_remote",
          label: undefined
        }
      }
    });
  });
});

describe("getArtifactProvenance", () => {
  it("calls get_provenance through MCP", async () => {
    const requests: Array<unknown> = [];

    const provenance = await getArtifactProvenance(
      async (_url: string, init: { body?: string }) => {
        requests.push(init.body ? JSON.parse(init.body) : null);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ artifact: { artifact_id: "art-1" }, related_events: [] })
                  }
                ]
              }
            };
          },
          async text() {
            return "";
          }
        };
      },
      {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        artifactId: "art-1"
      }
    );

    expect(provenance).toEqual({ artifact: { artifact_id: "art-1" }, related_events: [] });
    expect(requests[0]).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "get_provenance",
        arguments: {
          artifact_id: "art-1"
        }
      }
    });
  });
});

describe("parseWorkspaceRecord (via requestWorkspace)", () => {
  function makeFetch(payload: unknown) {
    return async (_url: string, _init: unknown) => ({
      ok: true,
      status: 200,
      async json() {
        return { result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
      },
      async text() { return ""; },
    });
  }

  const base = {
    baseUrl: "https://cp.example.com",
    bearerToken: "tok",
    tenantId: "t-1",
  };

  it("rejects non-object response", async () => {
    await expect(
      requestWorkspace(makeFetch("not-an-object"), base)
    ).rejects.toThrow("expected object");
  });

  it("rejects response with missing workspace_id", async () => {
    await expect(
      requestWorkspace(makeFetch({
        tenant_id: "t-1", mode: "managed_remote", created_by: "u-1",
        label: null, created_at: "2026-01-01T00:00:00.000Z", status: "ready"
      }), base)
    ).rejects.toThrow("workspace_id");
  });

  it("rejects response with missing tenant_id", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", mode: "managed_remote", created_by: "u-1",
        label: null, created_at: "2026-01-01T00:00:00.000Z", status: "ready"
      }), base)
    ).rejects.toThrow("tenant_id");
  });

  it("rejects response with invalid mode", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", tenant_id: "t-1", mode: "unknown",
        created_by: "u-1", label: null, created_at: "2026-01-01T00:00:00.000Z", status: "ready"
      }), base)
    ).rejects.toThrow("mode");
  });

  it("rejects response with missing created_by", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", tenant_id: "t-1", mode: "managed_remote",
        label: null, created_at: "2026-01-01T00:00:00.000Z", status: "ready"
      }), base)
    ).rejects.toThrow("created_by");
  });

  it("rejects response with invalid label (not null, not string)", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", tenant_id: "t-1", mode: "managed_remote",
        created_by: "u-1", label: 42, created_at: "2026-01-01T00:00:00.000Z", status: "ready"
      }), base)
    ).rejects.toThrow("label");
  });

  it("rejects response missing created_at", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", tenant_id: "t-1", mode: "managed_remote",
        created_by: "u-1", label: null, status: "ready"
      }), base)
    ).rejects.toThrow("created_at");
  });

  it("rejects response with invalid status", async () => {
    await expect(
      requestWorkspace(makeFetch({
        workspace_id: "ws-1", tenant_id: "t-1", mode: "managed_remote",
        created_by: "u-1", label: null, created_at: "2026-01-01T00:00:00.000Z",
        status: "pending"
      }), base)
    ).rejects.toThrow("status");
  });
});
