import type { RemoteEnvironment } from "./RemoteEnvironmentCard.js";

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

interface RemoteEnvRowProps {
  readonly env: RemoteEnvironment;
}

export function RemoteEnvRow({ env }: RemoteEnvRowProps) {
  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #f3f4f6",
        borderRadius: "6px",
        padding: "0.5rem 0.75rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: TYPE_COLORS[env.environmentType],
            background: `${TYPE_COLORS[env.environmentType]}14`,
            borderRadius: "3px",
            padding: "0.0625rem 0.375rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}
        >
          {TYPE_LABELS[env.environmentType]}
        </span>
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: statusColor(env.status),
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: "0.75rem", color: "#374151" }}>
          {env.status}
        </span>
        {env.prUrl !== undefined && (
          <a
            href={env.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.75rem", color: "#1a73e8", textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            PR #{env.prNumber}
          </a>
        )}
      </span>
      {env.environmentUrl !== undefined && (
        <a
          href={env.environmentUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.75rem",
            color: "#1a73e8",
            textDecoration: "none",
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </a>
      )}
    </div>
  );
}
