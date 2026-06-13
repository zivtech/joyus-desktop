export interface RemoteEnvironment {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly environmentType: "probo" | "joyus-ai-hosted";
  readonly prNumber?: number;
  readonly prUrl?: string;
  readonly prTitle?: string;
  readonly environmentUrl?: string;
  readonly status: string;
  readonly taskBranchId?: string;
  readonly errorMessage?: string;
  readonly lastCheckedAt?: number;
}

const TYPE_COLORS: Record<RemoteEnvironment["environmentType"], string> = {
  probo: "#8b5cf6",
  "joyus-ai-hosted": "#1a73e8",
};

const TYPE_LABELS: Record<RemoteEnvironment["environmentType"], string> = {
  probo: "Probo",
  "joyus-ai-hosted": "Joyus AI",
};

function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "#22c55e";
    case "building":
    case "starting":
      return "#f59e0b";
    case "failed":
    case "error":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function formatTimestamp(epochMs: number | undefined): string {
  if (epochMs === undefined) return "\u2014";
  return new Date(epochMs).toLocaleString();
}

interface RemoteEnvironmentCardProps {
  env: RemoteEnvironment;
}

export function RemoteEnvironmentCard({ env }: RemoteEnvironmentCardProps) {
  const sColor = statusColor(env.status);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {/* Repo name, type badge, and status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: "0.938rem", color: "#111827" }}>
          {env.repoOwner}/{env.repoName}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              padding: "0.125rem 0.5rem",
              borderRadius: "9999px",
              color: "#fff",
              background: TYPE_COLORS[env.environmentType],
            }}
          >
            {TYPE_LABELS[env.environmentType]}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: sColor,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "0.813rem", color: "#374151" }}>
              {env.status.charAt(0).toUpperCase() + env.status.slice(1)}
            </span>
          </span>
        </div>
      </div>

      {/* PR link and environment URL */}
      <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.813rem" }}>
        {env.prUrl !== undefined && (
          <a
            href={env.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#1a73e8", textDecoration: "none" }}
          >
            PR #{env.prNumber}{env.prTitle !== undefined ? `: ${env.prTitle}` : ""}
          </a>
        )}
        {env.environmentUrl !== undefined && (
          <a
            href={env.environmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#1a73e8", textDecoration: "none" }}
          >
            Open Environment
          </a>
        )}
      </div>

      {/* Error message */}
      {env.errorMessage !== undefined && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "4px",
            padding: "0.375rem 0.625rem",
            fontSize: "0.813rem",
            color: "#991b1b",
          }}
        >
          {env.errorMessage}
        </div>
      )}

      {/* Last checked */}
      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
        Last checked: {formatTimestamp(env.lastCheckedAt)}
      </div>
    </div>
  );
}
