import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Governance } from "./pages/Governance";
import { Usage } from "./pages/Usage";
import { Settings } from "./pages/Settings";

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{title}</h1>
      <p style={{ color: "#6b7280", marginTop: "0.5rem" }}>Coming soon.</p>
    </div>
  );
}

export function App() {
  return (
    <MemoryRouter initialEntries={["/"]} initialIndex={0}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/servers" element={<Placeholder title="Servers" />} />
          <Route path="/skills" element={<Placeholder title="Skills" />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/onboarding" element={<Placeholder title="Onboarding" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
