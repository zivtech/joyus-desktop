import { describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "../../src/ui/utils/formatTime";

describe("formatRelativeTime", () => {
  it("returns minutes for less than 60 minutes", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5 minutes ago");
    vi.useRealTimers();
  });

  it("uses singular 'minute' for exactly 1 minute", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 60_000)).toBe("1 minute ago");
    vi.useRealTimers();
  });

  it("returns 0 minutes for timestamps in the present", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now)).toBe("0 minutes ago");
    vi.useRealTimers();
  });

  it("returns hours for 60 minutes to 23 hours", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe("3 hours ago");
    vi.useRealTimers();
  });

  it("uses singular 'hour' for exactly 1 hour", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 3_600_000)).toBe("1 hour ago");
    vi.useRealTimers();
  });

  it("returns days for 24 hours or more", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 2 * 86_400_000)).toBe("2 days ago");
    vi.useRealTimers();
  });

  it("uses singular 'day' for exactly 1 day", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 86_400_000)).toBe("1 day ago");
    vi.useRealTimers();
  });
});
