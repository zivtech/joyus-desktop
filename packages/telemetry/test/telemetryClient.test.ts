import { describe, expect, it } from "vitest";
import {
  sendTelemetryEvent,
  sendTelemetryBatch,
} from "../src/telemetryClient";
import type { FetchLike, TelemetryClientConfig } from "../src/telemetryClient";
import type { TelemetryEvent } from "../src/schema";
import { SCHEMA_VERSION } from "../src/schema";

const config: TelemetryClientConfig = {
  endpoint: "https://example.com/api/telemetry/events",
  apiKey: "test-key",
};

const sampleEvent: TelemetryEvent = {
  event_id: "evt-1",
  timestamp: "2026-03-11T00:00:00Z",
  user_id: "user-1",
  org_id: "org-1",
  channel: "cli",
  event_type: "skill_invocation",
  name: "my-skill",
  outcome: "success",
  schema_version: SCHEMA_VERSION,
};

function createMockFetch(response: {
  ok: boolean;
  status: number;
  text?: string;
}): FetchLike {
  return async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.text ?? "",
  });
}

describe("sendTelemetryEvent", () => {
  it("returns accepted on 2xx response", async () => {
    const fetchLike = createMockFetch({ ok: true, status: 200 });
    const result = await sendTelemetryEvent(fetchLike, config, sampleEvent);

    expect(result.accepted).toBe(true);
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it("returns not accepted on non-ok response", async () => {
    const fetchLike = createMockFetch({
      ok: false,
      status: 400,
      text: "Bad Request",
    });
    const result = await sendTelemetryEvent(fetchLike, config, sampleEvent);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe("Bad Request");
  });

  it("returns not accepted when fetch throws", async () => {
    const fetchLike: FetchLike = async () => {
      throw new Error("Network error");
    };
    const result = await sendTelemetryEvent(fetchLike, config, sampleEvent);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe("Network error");
  });

  it("handles non-Error throw", async () => {
    const fetchLike: FetchLike = async () => {
      throw "string error";
    };
    const result = await sendTelemetryEvent(fetchLike, config, sampleEvent);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe("string error");
  });

  it("sends correct headers and body", async () => {
    let capturedUrl = "";
    let capturedInit: { method: string; headers: Record<string, string>; body?: string } | undefined;

    const fetchLike: FetchLike = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, text: async () => "" };
    };

    await sendTelemetryEvent(fetchLike, config, sampleEvent);

    expect(capturedUrl).toBe(config.endpoint);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers["Content-Type"]).toBe("application/json");
    expect(capturedInit?.headers["Authorization"]).toBe("Bearer test-key");
    expect(capturedInit?.body).toBe(JSON.stringify(sampleEvent));
  });
});

describe("sendTelemetryBatch", () => {
  it("returns accepted on 2xx response", async () => {
    const fetchLike = createMockFetch({ ok: true, status: 200 });
    const result = await sendTelemetryBatch(fetchLike, config, [sampleEvent]);

    expect(result.accepted).toBe(true);
    expect(result.status).toBe(200);
  });

  it("returns error for empty batch", async () => {
    const fetchLike = createMockFetch({ ok: true, status: 200 });
    const result = await sendTelemetryBatch(fetchLike, config, []);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe("Empty batch");
  });

  it("returns not accepted on non-ok response", async () => {
    const fetchLike = createMockFetch({
      ok: false,
      status: 500,
      text: "Server Error",
    });
    const result = await sendTelemetryBatch(fetchLike, config, [sampleEvent]);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe("Server Error");
  });

  it("returns not accepted when fetch throws", async () => {
    const fetchLike: FetchLike = async () => {
      throw new Error("Timeout");
    };
    const result = await sendTelemetryBatch(fetchLike, config, [sampleEvent]);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe("Timeout");
  });

  it("handles non-Error throw", async () => {
    const fetchLike: FetchLike = async () => {
      throw 42;
    };
    const result = await sendTelemetryBatch(fetchLike, config, [sampleEvent]);

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe("42");
  });
});
