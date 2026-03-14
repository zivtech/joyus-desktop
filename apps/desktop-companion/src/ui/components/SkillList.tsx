export interface SkillInfo {
  name: string;
  version: string;
  bundle: string;
  path: string;
}

interface SkillListProps {
  skills: SkillInfo[];
}

export function SkillList({ skills }: SkillListProps) {
  if (skills.length === 0) {
    return (
      <p style={{ color: "#6b7280", fontSize: "0.875rem", textAlign: "center", padding: "1rem" }}>
        No skills installed.
      </p>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
          {(["Name", "Version", "Bundle", "Path"] as const).map((h) => (
            <th
              key={h}
              style={{
                textAlign: "left",
                padding: "0.5rem 0.75rem",
                color: "#6b7280",
                fontWeight: 500,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {skills.map((skill) => (
          <tr key={skill.name} style={{ borderBottom: "1px solid #f3f4f6" }}>
            <td style={{ padding: "0.5rem 0.75rem", color: "#111827", fontWeight: 500 }}>
              {skill.name}
            </td>
            <td style={{ padding: "0.5rem 0.75rem", color: "#374151" }}>{skill.version}</td>
            <td style={{ padding: "0.5rem 0.75rem", color: "#374151" }}>{skill.bundle}</td>
            <td
              style={{
                padding: "0.5rem 0.75rem",
                color: "#6b7280",
                fontFamily: "monospace",
                fontSize: "0.813rem",
              }}
            >
              {skill.path}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
