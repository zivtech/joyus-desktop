import type { IpcHandler } from "./ipc-handler";

export type EventType =
  | "tool_call"
  | "sync"
  | "governance_decision"
  | "server_event";

export interface UsageEvent {
  eventType: EventType;
  source: string;
  action: string;
  outcome: "success" | "error" | "blocked";
  durationMs: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageQueryParams {
  eventType?: EventType;
  source?: string;
  since?: string;
  limit?: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface ToolCount {
  action: string;
  count: number;
}

export interface ServerCount {
  source: string;
  count: number;
}

export interface UsageSummary {
  totalToolCalls: number;
  totalSyncs: number;
  totalGovernanceDecisions: number;
  serverCrashes: number;
  topTools: ToolCount[];
  topServers: ServerCount[];
  dailyCounts: DailyCount[];
}

export interface UsageCollectorDeps {
  nowFn: () => string;
  pruneAfterDays: number;
}

export interface UsageCollector {
  recordEvent: (event: Omit<UsageEvent, "createdAt">) => void;
  queryEvents: (params: UsageQueryParams) => UsageEvent[];
  getSummary: (days: number) => UsageSummary;
  pruneOldEvents: () => number;
}

export function createUsageCollector(
  ipc: IpcHandler,
  deps: UsageCollectorDeps,
): UsageCollector {
  const events: UsageEvent[] = [];

  function recordEvent(event: Omit<UsageEvent, "createdAt">): void {
    const full: UsageEvent = { ...event, createdAt: deps.nowFn() };
    events.push(full);
    ipc.sendNotification("usage.record", full);
  }

  function queryEvents(params: UsageQueryParams): UsageEvent[] {
    let result = events.slice();

    if (params.eventType !== undefined) {
      const et = params.eventType;
      result = result.filter((e) => e.eventType === et);
    }

    if (params.source !== undefined) {
      const src = params.source;
      result = result.filter((e) => e.source === src);
    }

    if (params.since !== undefined) {
      const since = params.since;
      result = result.filter((e) => e.createdAt >= since);
    }

    const limit = params.limit ?? result.length;
    return result.slice(0, limit);
  }

  function getSummary(days: number): UsageSummary {
    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const scoped = events.filter((e) => e.createdAt >= cutoff);

    const totalToolCalls = scoped.filter(
      (e) => e.eventType === "tool_call",
    ).length;
    const totalSyncs = scoped.filter((e) => e.eventType === "sync").length;
    const totalGovernanceDecisions = scoped.filter(
      (e) => e.eventType === "governance_decision",
    ).length;
    const serverCrashes = scoped.filter(
      (e) => e.eventType === "server_event" && e.action === "crash",
    ).length;

    // topTools: group by action, count, limit 10
    const toolCounts = new Map<string, number>();
    for (const e of scoped.filter((ev) => ev.eventType === "tool_call")) {
      toolCounts.set(e.action, (toolCounts.get(e.action) ?? 0) + 1);
    }
    const topTools: ToolCount[] = [...toolCounts.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // topServers: group by source, count, limit 10
    const serverCounts = new Map<string, number>();
    for (const e of scoped) {
      serverCounts.set(e.source, (serverCounts.get(e.source) ?? 0) + 1);
    }
    const topServers: ServerCount[] = [...serverCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // dailyCounts: group by date portion of createdAt
    const dailyMap = new Map<string, number>();
    for (const e of scoped) {
      const date = e.createdAt.slice(0, 10);
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
    }
    const dailyCounts: DailyCount[] = [...dailyMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalToolCalls,
      totalSyncs,
      totalGovernanceDecisions,
      serverCrashes,
      topTools,
      topServers,
      dailyCounts,
    };
  }

  function pruneOldEvents(): number {
    const cutoff = new Date(
      Date.now() - deps.pruneAfterDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const before = events.length;
    let i = 0;
    while (i < events.length) {
      if ((events[i] as UsageEvent).createdAt < cutoff) {
        events.splice(i, 1);
      } else {
        i++;
      }
    }
    return before - events.length;
  }

  return { recordEvent, queryEvents, getSummary, pruneOldEvents };
}

export function registerUsageMethods(
  ipc: IpcHandler,
  collector: UsageCollector,
): void {
  ipc.registerMethod("usage.query", async (params: unknown) => {
    const p = (params ?? {}) as UsageQueryParams;
    return collector.queryEvents(p);
  });

  ipc.registerMethod("usage.summary", async (params: unknown) => {
    const p = (params ?? {}) as { days?: number };
    return collector.getSummary(p.days ?? 30);
  });
}
