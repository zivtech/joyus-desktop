import { useEffect, useState } from "react";
import { useSyncStatus } from "../hooks/useSyncStatus";
import type { SkillInfo } from "../components/SkillList";
import { SkillsView } from "./SkillsView";

async function safeInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

function useSyncedSkills(): { skills: SkillInfo[]; loading: boolean } {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void safeInvoke<SkillInfo[]>("get_skills").then((result) => {
      if (result !== undefined) {
        setSkills(result);
      }
      setLoading(false);
    });
  }, []);

  return { skills, loading };
}

export function Skills() {
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const { status, lastSync, version } = useSyncStatus();
  const { skills, loading } = useSyncedSkills();

  const handleSyncNow = () => {
    setSyncing(true);
    void safeInvoke("trigger_sync").then(() => {
      setSyncing(false);
    });
  };

  return (
    <SkillsView
      skills={skills}
      loading={loading}
      status={status}
      lastSync={lastSync}
      version={version}
      filter={filter}
      syncing={syncing}
      onFilterChange={(e) => { setFilter(e.target.value); }}
      onSyncNow={handleSyncNow}
    />
  );
}
