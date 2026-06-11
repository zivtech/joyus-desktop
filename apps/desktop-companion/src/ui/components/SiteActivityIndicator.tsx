import { formatRelativeTime } from "../utils/formatTime.js";

interface SiteActivityIndicatorProps {
  readonly lastActivityAt: number | undefined;
}

export function SiteActivityIndicator({ lastActivityAt }: SiteActivityIndicatorProps) {
  if (lastActivityAt === undefined) {
    return (
      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
        {"—"}
      </span>
    );
  }

  return (
    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
      Last active {formatRelativeTime(lastActivityAt)}
    </span>
  );
}
