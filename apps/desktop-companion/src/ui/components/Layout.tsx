import { NavLink, Outlet } from "react-router-dom";
import { UpdateBanner } from "./UpdateBanner";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "⊞" },
  { to: "/servers", label: "Servers", icon: "⬡" },
  { to: "/skills", label: "Skills", icon: "◈" },
  { to: "/sessions", label: "Tasks", icon: "◫" },
  { to: "/governance", label: "Governance", icon: "⛨" },
  { to: "/usage", label: "Usage", icon: "◷" },
  { to: "/settings", label: "Settings", icon: "⚙" },
  { to: "/onboarding", label: "Onboarding", icon: "◉" },
] as const;

export function Layout() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        minWidth: "800px",
        minHeight: "600px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111827",
        background: "#f9fafb",
      }}
    >
      <UpdateBanner />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <nav
          style={{
            width: "200px",
            flexShrink: 0,
            background: "#fff",
            borderRight: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            padding: "1rem 0",
          }}
        >
          <div
            style={{
              padding: "0 1rem 1rem",
              borderBottom: "1px solid #f3f4f6",
              marginBottom: "0.5rem",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "1rem", color: "#1a73e8" }}>
              Joyus
            </span>
          </div>
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.5rem 1rem",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#1a73e8" : "#374151",
                background: isActive ? "#eff6ff" : "transparent",
                borderLeft: isActive ? "3px solid #1a73e8" : "3px solid transparent",
              })}
            >
              <span style={{ fontSize: "1rem" }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
          <Outlet />
        </main>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  return (
    <div
      style={{
        height: "28px",
        background: "#fff",
        borderTop: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        padding: "0 1rem",
        gap: "1.5rem",
        fontSize: "0.75rem",
        color: "#6b7280",
      }}
    >
      <StatusBarItem label="Sidecar" value="Connected" valueColor="#22c55e" />
    </div>
  );
}

interface StatusBarItemProps {
  label: string;
  value: string;
  valueColor?: string;
}

function StatusBarItem({ label, value, valueColor }: StatusBarItemProps) {
  return (
    <span>
      {label}:{" "}
      <span style={{ color: valueColor ?? "#374151", fontWeight: 500 }}>{value}</span>
    </span>
  );
}
