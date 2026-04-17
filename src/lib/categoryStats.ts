// Tracks how many times the local player has picked each category as a race
// target. Used to surface a "★ Your favorites" group at the top of the
// category dropdown. Stored in localStorage so it persists across sessions
// without needing the backend.

const KEY = "wikirace.categoryUsage.v1";

type UsageMap = Record<string, number>;

const read = (): UsageMap => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as UsageMap) : {};
  } catch {
    return {};
  }
};

const write = (map: UsageMap) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — ignore */
  }
};

/** Increment usage for a single category label. No-op for empty strings. */
export function recordCategoryUse(label: string) {
  if (!label) return;
  const map = read();
  map[label] = (map[label] ?? 0) + 1;
  write(map);
  // Notify listeners in the same tab (storage event only fires cross-tab).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("category-usage-change"));
  }
}

/** Top-N most-used category labels, descending. Excludes labels with 0 uses. */
export function getFavoriteCategories(limit = 3): string[] {
  const map = read();
  return Object.entries(map)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}
