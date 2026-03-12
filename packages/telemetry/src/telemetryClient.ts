import type { TelemetryEvent } from "./schema";

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchLikeResponse>;

export interface SendResult {
  accepted: boolean;
  status: number;
  error?: string;
}

export interface TelemetryClientConfig {
  endpoint: string;
  apiKey: string;
}

export async function sendTelemetryEvent(
  fetchLike: FetchLike,
  config: TelemetryClientConfig,
  event: TelemetryEvent,
): Promise<SendResult> {
  try {
    const response = await fetchLike(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(event),
    });

    if (response.ok) {
      return { accepted: true, status: response.status };
    }

    const text = await response.text();
    return { accepted: false, status: response.status, error: text };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { accepted: false, status: 0, error: message };
  }
}

export async function sendTelemetryBatch(
  fetchLike: FetchLike,
  config: TelemetryClientConfig,
  events: TelemetryEvent[],
): Promise<SendResult> {
  if (events.length === 0) {
    return { accepted: false, status: 0, error: "Empty batch" };
  }

  try {
    const response = await fetchLike(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(events),
    });

    if (response.ok) {
      return { accepted: true, status: response.status };
    }

    const text = await response.text();
    return { accepted: false, status: response.status, error: text };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { accepted: false, status: 0, error: message };
  }
}
