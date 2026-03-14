import { describe, expect, it, vi } from "vitest";
import {
  createIpcHandler,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
} from "../../src/sidecar/ipc-handler";

function parseResponse(raw: string): JsonRpcResponse {
  return JSON.parse(raw) as JsonRpcResponse;
}

describe("createIpcHandler", () => {
  describe("handleRequest", () => {
    it("returns correct response for valid request", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("echo", async (params) => params);

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "echo",
        params: { hello: "world" },
        id: 1,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        result: { hello: "world" },
        id: 1,
      });
    });

    it("returns -32700 for invalid JSON", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const result = parseResponse(await ipc.handleRequest("{not valid json"));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: "Parse error" },
        id: null,
      });
    });

    it("returns -32601 for unknown method", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "nonexistent",
        id: 42,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          message: "Method not found",
        },
        id: 42,
      });
    });

    it("returns -32600 for missing method field", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: "Invalid Request",
        },
        id: null,
      });
    });

    it("returns -32600 for missing id field", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "test",
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: "Invalid Request",
        },
        id: null,
      });
    });

    it("returns -32600 for missing jsonrpc version", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify({
        method: "test",
        id: 1,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: "Invalid Request",
        },
        id: null,
      });
    });

    it("returns -32600 for non-object parsed value", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify("just a string");

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: "Invalid Request",
        },
        id: null,
      });
    });

    it("returns -32600 for null parsed value", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      const raw = JSON.stringify(null);

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: "Invalid Request",
        },
        id: null,
      });
    });

    it("returns -32603 when handler throws an Error", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("failing", async () => {
        throw new Error("handler broke");
      });

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "failing",
        id: 99,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: "handler broke",
        },
        id: 99,
      });
    });

    it("returns -32603 when handler throws a non-Error", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("failing", async () => {
        throw "string error";
      });

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "failing",
        id: 100,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: "string error",
        },
        id: 100,
      });
    });

    it("handles string id", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("ping", async () => "pong");

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "ping",
        id: "abc-123",
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        result: "pong",
        id: "abc-123",
      });
    });

    it("handles request with no params", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("no-params", async (params) => ({
        received: params,
      }));

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "no-params",
        id: 5,
      });

      const result = parseResponse(await ipc.handleRequest(raw));

      expect(result).toEqual({
        jsonrpc: "2.0",
        result: { received: undefined },
        id: 5,
      });
    });
  });

  describe("sendNotification", () => {
    it("writes notification without id field", () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.sendNotification("log.event", { level: "info" });

      expect(writeFn).toHaveBeenCalledOnce();
      const written = writeFn.mock.calls[0]?.[0] as string;
      expect(written).toMatch(/\n$/);

      const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
      expect(parsed).toEqual({
        jsonrpc: "2.0",
        method: "log.event",
        params: { level: "info" },
      });
      expect("id" in parsed).toBe(false);
    });
  });

  describe("registerMethod", () => {
    it("registers and dispatches methods correctly", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("add", async (params) => {
        const p = params as { a: number; b: number };
        return p.a + p.b;
      });

      ipc.registerMethod("multiply", async (params) => {
        const p = params as { a: number; b: number };
        return p.a * p.b;
      });

      const addResult = parseResponse(
        await ipc.handleRequest(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "add",
            params: { a: 2, b: 3 },
            id: 1,
          }),
        ),
      );

      const multiplyResult = parseResponse(
        await ipc.handleRequest(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "multiply",
            params: { a: 4, b: 5 },
            id: 2,
          }),
        ),
      );

      expect(addResult.result).toBe(5);
      expect(multiplyResult.result).toBe(20);
    });

    it("overwrites existing method handler", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("greet", async () => "hello");
      ipc.registerMethod("greet", async () => "hi");

      const result = parseResponse(
        await ipc.handleRequest(
          JSON.stringify({ jsonrpc: "2.0", method: "greet", id: 1 }),
        ),
      );

      expect(result.result).toBe("hi");
    });
  });
});
