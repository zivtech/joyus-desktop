export interface SkillInfo {
  name: string;
  version: string;
  bundle: string;
  path: string;
}

export interface SkillScannerDeps {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: string) => Promise<string>;
}

function parseSkillMeta(
  raw: string,
  skillPath: string,
): { name: string; version: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name: skillPath, version: "0.0.0" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { name: skillPath, version: "0.0.0" };
  }

  const obj = parsed as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? obj["name"] : skillPath;
  const version =
    typeof obj["version"] === "string" ? obj["version"] : "0.0.0";

  return { name, version };
}

export async function scanSkills(
  destDir: string,
  bundleName: string,
  deps: SkillScannerDeps,
): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = await deps.readdir(destDir);
  } catch {
    return [];
  }

  const results: SkillInfo[] = [];

  for (const entry of entries) {
    const skillPath = `${destDir}/${entry}`;
    const metaPath = `${skillPath}/package.json`;

    let meta: { name: string; version: string };
    try {
      const raw = await deps.readFile(metaPath, "utf-8");
      meta = parseSkillMeta(raw, entry);
    } catch {
      meta = { name: entry, version: "0.0.0" };
    }

    results.push({
      name: meta.name,
      version: meta.version,
      bundle: bundleName,
      path: skillPath,
    });
  }

  return results;
}
