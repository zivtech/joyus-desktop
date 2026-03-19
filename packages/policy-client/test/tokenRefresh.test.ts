import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PolicyDecideResponse } from "../src/controlPlaneContracts";
import { createTokenRefreshService } from "../src/tokenRefresh";

// Flush microtask queue (promise callbacks) without advancing fake timers
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeResponse(expiresInMs: number): PolicyDecideResponse {
  return {
    decision: "allow",
    reason: "ok",
    token: "header.payload.sig",
    token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    jti: "jti-1",
    risk_level: "low"
  };
}

describe("createTokenRefreshService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schedule", () => {
    it("schedules refresh at 80% TTL", () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));
      const service = createTokenRefreshService({ requestDecision });

      // Token expires in 10 000 ms → refresh at 8 000 ms
      const response = makeResponse(10_000);
      service.schedule("action-a", response);

      // Nothing fired yet at 7 999 ms
      vi.advanceTimersByTime(7_999);
      expect(requestDecision).not.toHaveBeenCalled();

      // Fires at 8 000 ms
      vi.advanceTimersByTime(1);
      expect(requestDecision).toHaveBeenCalledOnce();
      expect(requestDecision).toHaveBeenCalledWith("action-a");

      service.cancelAll();
    });

    it("no-op if already scheduled for same actionKey", () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));
      const service = createTokenRefreshService({ requestDecision });

      const response = makeResponse(10_000);
      service.schedule("action-a", response);
      service.schedule("action-a", response); // second call should be a no-op

      vi.advanceTimersByTime(10_000);
      expect(requestDecision).toHaveBeenCalledOnce();

      service.cancelAll();
    });

    it("refreshes immediately if token already past 80% TTL (refreshDelayMs <= 0)", () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));

      // Now is already past 80% of TTL: token has only 100 ms left but 80% of total would require
      // setting nowMs to return a value where expiresAt - now is negative.
      // Use a fixed nowMs that is past the expiry.
      const fixedNow = Date.now() + 5_000; // "now" is 5 s in the future — token already expired from that perspective
      const response = makeResponse(1_000); // expires 1 s from real now; fixedNow is 5 s ahead → negative delay

      const service = createTokenRefreshService({
        requestDecision,
        nowMs: () => fixedNow
      });

      service.schedule("action-a", response);

      // No timer should be set — requestDecision called synchronously (promise scheduled microtask)
      expect(requestDecision).toHaveBeenCalledOnce();

      service.cancelAll();
    });

    it("calls requestDecision when timer fires", () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));

      vi.advanceTimersByTime(8_000);
      expect(requestDecision).toHaveBeenCalledWith("action-a");

      service.cancelAll();
    });

    it("reschedules after successful refresh", async () => {
      const firstResponse = makeResponse(10_000);
      const secondResponse = makeResponse(10_000);
      const requestDecision = vi.fn().mockResolvedValueOnce(secondResponse).mockResolvedValue(makeResponse(10_000));

      const service = createTokenRefreshService({ requestDecision });
      service.schedule("action-a", firstResponse);

      // Fire first refresh
      vi.advanceTimersByTime(8_000);
      expect(requestDecision).toHaveBeenCalledTimes(1);

      // Let the promise settle so reschedule runs
      await flushMicrotasks();

      // Fire second refresh (another 8 000 ms)
      vi.advanceTimersByTime(8_000);
      expect(requestDecision).toHaveBeenCalledTimes(2);

      service.cancelAll();
    });

    it("does not reschedule after failed refresh (error swallowed)", async () => {
      const requestDecision = vi.fn().mockRejectedValue(new Error("network error"));
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));

      vi.advanceTimersByTime(8_000);
      await flushMicrotasks();

      // No second timer → advancing time further triggers nothing
      vi.advanceTimersByTime(100_000);
      expect(requestDecision).toHaveBeenCalledTimes(1);

      service.cancelAll();
    });
  });

  describe("getInFlight", () => {
    it("returns undefined when no in-flight refresh", () => {
      const service = createTokenRefreshService({ requestDecision: vi.fn() });
      expect(service.getInFlight("action-a")).toBeUndefined();
    });

    it("returns promise when refresh is in-flight", async () => {
      let resolveRefresh!: (r: PolicyDecideResponse) => void;
      const inflightPromise = new Promise<PolicyDecideResponse>((resolve) => {
        resolveRefresh = resolve;
      });

      const requestDecision = vi.fn().mockReturnValue(inflightPromise);
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));
      vi.advanceTimersByTime(8_000);

      expect(service.getInFlight("action-a")).toBeInstanceOf(Promise);

      // Clean up
      resolveRefresh(makeResponse(10_000));
      await flushMicrotasks();
      service.cancelAll();
    });

    it("returns undefined after refresh completes", async () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));
      vi.advanceTimersByTime(8_000);

      await flushMicrotasks();

      expect(service.getInFlight("action-a")).toBeUndefined();

      service.cancelAll();
    });
  });

  describe("cancelAll", () => {
    it("clears all pending timers", () => {
      const requestDecision = vi.fn().mockResolvedValue(makeResponse(10_000));
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));
      service.schedule("action-b", makeResponse(20_000));

      service.cancelAll();

      vi.advanceTimersByTime(100_000);
      expect(requestDecision).not.toHaveBeenCalled();
    });

    it("clears all in-flight promises", async () => {
      let resolveRefresh!: (r: PolicyDecideResponse) => void;
      const inflightPromise = new Promise<PolicyDecideResponse>((resolve) => {
        resolveRefresh = resolve;
      });

      const requestDecision = vi.fn().mockReturnValue(inflightPromise);
      const service = createTokenRefreshService({ requestDecision });

      service.schedule("action-a", makeResponse(10_000));
      vi.advanceTimersByTime(8_000);

      // In-flight is set
      expect(service.getInFlight("action-a")).toBeInstanceOf(Promise);

      service.cancelAll();

      // After cancelAll, getInFlight returns undefined
      expect(service.getInFlight("action-a")).toBeUndefined();

      // Settle the underlying promise (no crash expected)
      resolveRefresh(makeResponse(10_000));
      await flushMicrotasks();
    });
  });
});
