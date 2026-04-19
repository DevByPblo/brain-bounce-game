// Local-first achievements system. Stats + unlocks live in localStorage.
// Each game-finish handler calls `recordRun(...)` which returns any newly
// unlocked badges so the UI can toast them.

export type BadgeCategory = "milestone" | "skill" | "mode";

export type Badge = {
  id: string;
  label: string;
  description: string;
  category: BadgeCategory;
  /** lucide icon name we render via a small lookup in BadgeIcon */
  icon:
    | "trophy"
    | "medal"
    | "crown"
    | "zap"
    | "timer"
    | "lightbulb-off"
    | "undo2-off"
    | "swords"
    | "target"
    | "eye-off"
    | "calendar"
    | "shuffle"
    | "pencil"
    | "users"
    | "compass"
    | "globe"
    | "library"
    | "layers";
};

export type RunMode =
  | "race-random"
  | "race-daily"
  | "race-custom"
  | "collector"
  | "nomove"
  | "multiplayer";

export type RunResult = {
  mode: RunMode;
  /** Did the player win / complete? Collector is always "completed". */
  won: boolean;
  clicks: number;
  timeMs: number;
  hintsUsed: number;
  undos: number;
  /** Optional: category label this race targeted (race-random with a category). */
  category?: string;
};

export type Stats = {
  totalWins: number;
  winsByMode: Record<RunMode, number>;
  bestClicksRace: number | null;
  bestTimeRaceMs: number | null;
  /** Per-category win counts (race-random + category). */
  winsByCategory: Record<string, number>;
};

const STATS_KEY = "wikirace.stats.v1";
const UNLOCKED_KEY = "wikirace.achievements.v1";

// ───────────────────────────── Catalog ─────────────────────────────

export const BADGES: Badge[] = [
  // Milestones
  { id: "first-win", label: "First Dispatch", description: "Win your first race.", category: "milestone", icon: "trophy" },
  { id: "ten-wins", label: "Regular Reader", description: "Win 10 races.", category: "milestone", icon: "medal" },
  { id: "fifty-wins", label: "Editor-in-Chief", description: "Win 50 races.", category: "milestone", icon: "crown" },
  { id: "hundred-wins", label: "Legendary Cartographer", description: "Win 100 races.", category: "milestone", icon: "crown" },

  // Skill
  { id: "sub-3-clicks", label: "Three-Hop Wonder", description: "Win a race in 3 clicks or fewer.", category: "skill", icon: "zap" },
  { id: "sub-30s", label: "Sub-30", description: "Win a race in under 30 seconds.", category: "skill", icon: "timer" },
  { id: "no-hint-win", label: "Purist", description: "Win a race without using any hint.", category: "skill", icon: "lightbulb-off" },
  { id: "no-undo-win", label: "Forward Only", description: "Win a race without ever undoing.", category: "skill", icon: "undo2-off" },

  // Mode badges
  { id: "mode-random", label: "Random Roller", description: "Win a Random race.", category: "mode", icon: "shuffle" },
  { id: "mode-daily", label: "Daily Devotee", description: "Win a Daily challenge.", category: "mode", icon: "calendar" },
  { id: "mode-custom", label: "Cartographer", description: "Win a Custom-target race.", category: "mode", icon: "pencil" },
  { id: "mode-collector", label: "Link Collector", description: "Finish a Collector round.", category: "mode", icon: "target" },
  { id: "mode-nomove", label: "Blind Pilgrim", description: "Win a No-Move race.", category: "mode", icon: "eye-off" },
  { id: "mode-multiplayer", label: "Duelist", description: "Win a multiplayer match.", category: "mode", icon: "swords" },
];

export const BADGE_BY_ID: Record<string, Badge> = Object.fromEntries(
  BADGES.map((b) => [b.id, b])
);

// ───────────────────────────── Storage ─────────────────────────────

const emptyStats = (): Stats => ({
  totalWins: 0,
  winsByMode: {
    "race-random": 0,
    "race-daily": 0,
    "race-custom": 0,
    collector: 0,
    nomove: 0,
    multiplayer: 0,
  },
  bestClicksRace: null,
  bestTimeRaceMs: null,
});

export function getStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as Partial<Stats>;
    return { ...emptyStats(), ...parsed, winsByMode: { ...emptyStats().winsByMode, ...(parsed.winsByMode ?? {}) } };
  } catch {
    return emptyStats();
  }
}

function writeStats(s: Stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function getUnlockedIds(): string[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeUnlocked(ids: string[]) {
  try { localStorage.setItem(UNLOCKED_KEY, JSON.stringify(Array.from(new Set(ids)))); } catch { /* ignore */ }
}

export function isUnlocked(id: string): boolean {
  return getUnlockedIds().includes(id);
}

export function getUnlockedCount(): number {
  return getUnlockedIds().length;
}

// ───────────────────────────── Evaluation ─────────────────────────────

/**
 * Records a finished run and returns any badges that were *newly* unlocked.
 * Safe to call even if `won === false` — only stat side-effects relevant to
 * losses (none today) would apply.
 */
export function recordRun(run: RunResult): Badge[] {
  const stats = getStats();

  if (run.won) {
    stats.totalWins += 1;
    stats.winsByMode[run.mode] = (stats.winsByMode[run.mode] ?? 0) + 1;
    if (run.mode.startsWith("race-") || run.mode === "multiplayer") {
      if (stats.bestClicksRace == null || run.clicks < stats.bestClicksRace) {
        stats.bestClicksRace = run.clicks;
      }
      if (stats.bestTimeRaceMs == null || run.timeMs < stats.bestTimeRaceMs) {
        stats.bestTimeRaceMs = run.timeMs;
      }
    }
  }
  writeStats(stats);

  const already = new Set(getUnlockedIds());
  const newlyEarned: Badge[] = [];
  const earn = (id: string) => {
    if (already.has(id)) return;
    const b = BADGE_BY_ID[id];
    if (!b) return;
    already.add(id);
    newlyEarned.push(b);
  };

  if (run.won) {
    // Milestones
    if (stats.totalWins >= 1) earn("first-win");
    if (stats.totalWins >= 10) earn("ten-wins");
    if (stats.totalWins >= 50) earn("fifty-wins");
    if (stats.totalWins >= 100) earn("hundred-wins");

    // Skill (only on race-style modes where clicks/time/hints/undos are meaningful)
    const isRaceLike =
      run.mode === "race-random" ||
      run.mode === "race-daily" ||
      run.mode === "race-custom" ||
      run.mode === "multiplayer" ||
      run.mode === "nomove";
    if (isRaceLike) {
      if (run.clicks > 0 && run.clicks <= 3) earn("sub-3-clicks");
      if (run.timeMs > 0 && run.timeMs < 30_000) earn("sub-30s");
      if (run.hintsUsed === 0) earn("no-hint-win");
      if (run.undos === 0) earn("no-undo-win");
    }

    // Mode badges
    if (run.mode === "race-random") earn("mode-random");
    if (run.mode === "race-daily") earn("mode-daily");
    if (run.mode === "race-custom") earn("mode-custom");
    if (run.mode === "collector") earn("mode-collector");
    if (run.mode === "nomove") earn("mode-nomove");
    if (run.mode === "multiplayer") earn("mode-multiplayer");
  }

  if (newlyEarned.length > 0) writeUnlocked(Array.from(already));
  return newlyEarned;
}
