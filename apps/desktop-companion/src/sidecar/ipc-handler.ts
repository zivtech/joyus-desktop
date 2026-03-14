export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: string | number;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type MethodHandler = (params: unknown) => Promise<unknown>;
export type WriteFn = (data: string) => void;

export interface IpcHandler {
  handleRequest: (raw: string) => Promise<string>;
  registerMethod: (name: string, handler: MethodHandler) => void;
  sendNotification: (method: string, params: unknown) => void;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj["jsonrpc"] === "2.0" &&
    typeof obj["method"] === "string" &&
    ("id" in obj &&
      (typeof obj["id"] === "string" || typeof obj["id"] === "number"))
  );
}

function makeErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    error: { code, message },
    id,
  };
}

function makeSuccessResponse(
  id: string | number,
  result: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    result,
    id,
  };
}

export function createIpcHandler(writeFn: WriteFn): IpcHandler {
  const methods = new Map<string, MethodHandler>();

  async function handleRequest(raw: string): Promise<string> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return JSON.stringify(
        makeErrorResponse(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error"),
      );
    }

    if (!isJsonRpcRequest(parsed)) {
      return JSON.stringify(
        makeErrorResponse(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          "Invalid Request",
        ),
      );
    }

    const handler = methods.get(parsed.method);
    if (!handler) {
      return JSON.stringify(
        makeErrorResponse(
          parsed.id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          "Method not found",
        ),
      );
    }

    try {
      const result = await handler(parsed.params);
      return JSON.stringify(makeSuccessResponse(parsed.id, result));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify(
        makeErrorResponse(
          parsed.id,
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          message,
        ),
      );
    }
  }

  function registerMethod(name: string, handler: MethodHandler): void {
    methods.set(name, handler);
  }

  function sendNotification(method: string, params: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    writeFn(JSON.stringify(notification) + "\n");
  }

  return {
    handleRequest,
    registerMethod,
    sendNotification,
  };
}
