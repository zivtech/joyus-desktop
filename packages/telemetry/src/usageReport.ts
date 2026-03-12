import type { TelemetryEvent } from "./schema";

export interface UsageMetrics {
  activeUserCount: number;
  totalUsers: number;
  totalInvocations: number;
  topSkills: Array<{ name: string; count: number }>;
  topMcpTools: Array<{ name: string; count: number }>;
  neverUsedSkills: string[];
  successRate: number;
}

export interface ReportOptions {
  orgId: string;
  startDate: string;
  endDate: string;
  allKnownSkills?: string[];
}

export function computeUsageMetrics(
  events: TelemetryEvent[],
  options: ReportOptions,
): UsageMetrics {
  const filtered = events.filter(
    (e) =>
      e.org_id === options.orgId &&
      e.timestamp >= options.startDate &&
      e.timestamp <= options.endDate,
  );

  const userIds = new Set<string>();
  const skillCounts = new Map<string, number>();
  const mcpToolCounts = new Map<string, number>();
  let successCount = 0;

  for (const event of filtered) {
    userIds.add(event.user_id);

    if (event.event_type === "skill_invocation") {
      skillCounts.set(event.name, (skillCounts.get(event.name) ?? 0) + 1);
    } else if (event.event_type === "mcp_tool_call") {
      mcpToolCounts.set(event.name, (mcpToolCounts.get(event.name) ?? 0) + 1);
    }

    if (event.outcome === "success") {
      successCount++;
    }
  }

  const topSkills = [...skillCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const topMcpTools = [...mcpToolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const usedSkillNames = new Set(skillCounts.keys());
  const neverUsedSkills =
    options.allKnownSkills !== undefined
      ? options.allKnownSkills.filter((s) => !usedSkillNames.has(s))
      : [];

  const successRate = filtered.length > 0 ? successCount / filtered.length : 0;

  return {
    activeUserCount: userIds.size,
    totalUsers: userIds.size,
    totalInvocations: filtered.length,
    topSkills,
    topMcpTools,
    neverUsedSkills,
    successRate,
  };
}

export function formatUsageReport(
  metrics: UsageMetrics,
  options: ReportOptions,
): string {
  const lines: string[] = [];

  lines.push("# Usage Report");
  lines.push("");
  lines.push(`**Organization:** ${options.orgId}`);
  lines.push(`**Period:** ${options.startDate} to ${options.endDate}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Active Users | ${String(metrics.activeUserCount)} |`);
  lines.push(`| Total Invocations | ${String(metrics.totalInvocations)} |`);
  lines.push(
    `| Success Rate | ${String(Math.round(metrics.successRate * 100))}% |`,
  );
  lines.push("");

  if (metrics.topSkills.length > 0) {
    lines.push("## Top Skills");
    lines.push("");
    lines.push("| Skill | Count |");
    lines.push("| --- | --- |");
    for (const skill of metrics.topSkills) {
      lines.push(`| ${skill.name} | ${String(skill.count)} |`);
    }
    lines.push("");
  }

  if (metrics.topMcpTools.length > 0) {
    lines.push("## Top MCP Tools");
    lines.push("");
    lines.push("| Tool | Count |");
    lines.push("| --- | --- |");
    for (const tool of metrics.topMcpTools) {
      lines.push(`| ${tool.name} | ${String(tool.count)} |`);
    }
    lines.push("");
  }

  if (metrics.neverUsedSkills.length > 0) {
    lines.push("## Never Used Skills");
    lines.push("");
    for (const skill of metrics.neverUsedSkills) {
      lines.push(`- ${skill}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
