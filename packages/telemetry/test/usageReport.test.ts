import { describe, expect, it } from "vitest";
import {
  computeUsageMetrics,
  formatUsageReport,
} from "../src/usageReport";
import type { ReportOptions, UsageMetrics } from "../src/usageReport";
import type { TelemetryEvent } from "../src/schema";
import { SCHEMA_VERSION } from "../src/schema";

function makeEvent(overrides: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    event_id: "evt-1",
    timestamp: "2026-03-01T12:00:00Z",
    user_id: "user-1",
    org_id: "org-1",
    channel: "cli",
    event_type: "skill_invocation",
    name: "skill-a",
    outcome: "success",
    schema_version: SCHEMA_VERSION,
    ...overrides,
  };
}

const baseOptions: ReportOptions = {
  orgId: "org-1",
  startDate: "2026-03-01T00:00:00Z",
  endDate: "2026-03-31T23:59:59Z",
};

describe("computeUsageMetrics", () => {
  it("filters events by org_id", () => {
    const events = [
      makeEvent({ org_id: "org-1" }),
      makeEvent({ org_id: "org-2" }),
    ];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.totalInvocations).toBe(1);
  });

  it("filters events by date range", () => {
    const events = [
      makeEvent({ timestamp: "2026-02-28T00:00:00Z" }), // before
      makeEvent({ timestamp: "2026-03-15T00:00:00Z" }), // in range
      makeEvent({ timestamp: "2026-04-01T00:00:00Z" }), // after
    ];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.totalInvocations).toBe(1);
  });

  it("counts unique users", () => {
    const events = [
      makeEvent({ user_id: "user-1" }),
      makeEvent({ user_id: "user-1" }),
      makeEvent({ user_id: "user-2" }),
    ];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.activeUserCount).toBe(2);
    expect(metrics.totalUsers).toBe(2);
  });

  it("groups skills and mcp tools separately", () => {
    const events = [
      makeEvent({ event_type: "skill_invocation", name: "skill-a" }),
      makeEvent({ event_type: "skill_invocation", name: "skill-a" }),
      makeEvent({ event_type: "skill_invocation", name: "skill-b" }),
      makeEvent({ event_type: "mcp_tool_call", name: "tool-x" }),
      makeEvent({ event_type: "mcp_tool_call", name: "tool-x" }),
      makeEvent({ event_type: "mcp_tool_call", name: "tool-y" }),
    ];
    const metrics = computeUsageMetrics(events, baseOptions);

    expect(metrics.topSkills).toEqual([
      { name: "skill-a", count: 2 },
      { name: "skill-b", count: 1 },
    ]);
    expect(metrics.topMcpTools).toEqual([
      { name: "tool-x", count: 2 },
      { name: "tool-y", count: 1 },
    ]);
  });

  it("sorts top skills by count descending", () => {
    const events = [
      makeEvent({ name: "rare" }),
      makeEvent({ name: "popular" }),
      makeEvent({ name: "popular" }),
      makeEvent({ name: "popular" }),
    ];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.topSkills[0]!.name).toBe("popular");
    expect(metrics.topSkills[1]!.name).toBe("rare");
  });

  it("computes success rate", () => {
    const events = [
      makeEvent({ outcome: "success" }),
      makeEvent({ outcome: "success" }),
      makeEvent({ outcome: "failure" }),
      makeEvent({ outcome: "timeout" }),
    ];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.successRate).toBe(0.5);
  });

  it("returns 0 success rate for no events", () => {
    const metrics = computeUsageMetrics([], baseOptions);
    expect(metrics.successRate).toBe(0);
    expect(metrics.totalInvocations).toBe(0);
    expect(metrics.activeUserCount).toBe(0);
  });

  it("computes never-used skills", () => {
    const events = [
      makeEvent({ event_type: "skill_invocation", name: "skill-a" }),
    ];
    const options: ReportOptions = {
      ...baseOptions,
      allKnownSkills: ["skill-a", "skill-b", "skill-c"],
    };
    const metrics = computeUsageMetrics(events, options);
    expect(metrics.neverUsedSkills).toEqual(["skill-b", "skill-c"]);
  });

  it("returns empty never-used when allKnownSkills not provided", () => {
    const events = [makeEvent({})];
    const metrics = computeUsageMetrics(events, baseOptions);
    expect(metrics.neverUsedSkills).toEqual([]);
  });
});

describe("formatUsageReport", () => {
  const metrics: UsageMetrics = {
    activeUserCount: 5,
    totalUsers: 5,
    totalInvocations: 100,
    topSkills: [
      { name: "skill-a", count: 50 },
      { name: "skill-b", count: 30 },
    ],
    topMcpTools: [{ name: "tool-x", count: 20 }],
    neverUsedSkills: ["skill-c"],
    successRate: 0.95,
  };

  it("includes organization and period", () => {
    const report = formatUsageReport(metrics, baseOptions);
    expect(report).toContain("org-1");
    expect(report).toContain(baseOptions.startDate);
    expect(report).toContain(baseOptions.endDate);
  });

  it("includes summary metrics", () => {
    const report = formatUsageReport(metrics, baseOptions);
    expect(report).toContain("Active Users");
    expect(report).toContain("5");
    expect(report).toContain("Total Invocations");
    expect(report).toContain("100");
    expect(report).toContain("Success Rate");
    expect(report).toContain("95%");
  });

  it("includes top skills section", () => {
    const report = formatUsageReport(metrics, baseOptions);
    expect(report).toContain("Top Skills");
    expect(report).toContain("skill-a");
    expect(report).toContain("50");
    expect(report).toContain("skill-b");
    expect(report).toContain("30");
  });

  it("includes top mcp tools section", () => {
    const report = formatUsageReport(metrics, baseOptions);
    expect(report).toContain("Top MCP Tools");
    expect(report).toContain("tool-x");
    expect(report).toContain("20");
  });

  it("includes never used skills section", () => {
    const report = formatUsageReport(metrics, baseOptions);
    expect(report).toContain("Never Used Skills");
    expect(report).toContain("skill-c");
  });

  it("omits skills section when empty", () => {
    const emptyMetrics: UsageMetrics = {
      ...metrics,
      topSkills: [],
    };
    const report = formatUsageReport(emptyMetrics, baseOptions);
    expect(report).not.toContain("Top Skills");
  });

  it("omits mcp tools section when empty", () => {
    const emptyMetrics: UsageMetrics = {
      ...metrics,
      topMcpTools: [],
    };
    const report = formatUsageReport(emptyMetrics, baseOptions);
    expect(report).not.toContain("Top MCP Tools");
  });

  it("omits never used section when empty", () => {
    const emptyMetrics: UsageMetrics = {
      ...metrics,
      neverUsedSkills: [],
    };
    const report = formatUsageReport(emptyMetrics, baseOptions);
    expect(report).not.toContain("Never Used Skills");
  });
});
