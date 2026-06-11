interface BranchCountBadgeProps {
  readonly active: number;
  readonly total: number;
}

export function BranchCountBadge({ active, total }: BranchCountBadgeProps) {
  if (total === 0) {
    return (
      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
        No branches
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.75rem",
        color: "#6b7280",
        background: "#f3f4f6",
        borderRadius: "4px",
        padding: "0.125rem 0.5rem",
        fontWeight: 500,
      }}
    >
      {active} active / {total} total
    </span>
  );
}
