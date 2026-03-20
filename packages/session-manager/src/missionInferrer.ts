// ─── Slugify ─────────────────────────────────────────────────────────────────

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40);
}

// ─── Mission Inferrer ────────────────────────────────────────────────────────

function currentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function inferMissionLabel(filePaths: readonly string[]): string {
  const datePrefix = currentDateString();

  if (filePaths.length === 0) {
    return `${datePrefix}-session`;
  }

  // Count top-level directory frequencies
  const dirCounts = new Map<string, number>();

  for (const filePath of filePaths) {
    // Normalize: strip leading slash or ./ for relative paths
    const normalized = filePath.replace(/^\.?\//, "");
    const firstSegment = normalized.split("/").at(0);
    if (firstSegment !== undefined && firstSegment !== "") {
      dirCounts.set(firstSegment, (dirCounts.get(firstSegment) ?? 0) + 1);
    }
  }

  if (dirCounts.size === 0) {
    return `${datePrefix}-session`;
  }

  // Find the most frequent directory
  let topDir = "";
  let topCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > topCount) {
      topDir = dir;
      topCount = count;
    }
  }

  const slug = slugify(topDir);

  if (slug === "") {
    return `${datePrefix}-session`;
  }

  return `${datePrefix}-${slug}`;
}
