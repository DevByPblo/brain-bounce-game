// Aggregated player stats for the Achievements banner.
// - Online (signed-in users): total score & games sourced from the `scores` table.
// - Local (guests): falls back to localStorage stats.
// - Per-mode breakdown is always derived from local wins (cheap, accurate for
//   the modes that don't submit online — e.g. multiplayer & nomove counts).
import { supabase } from "@/integrations/supabase/client";
import { getStats, type RunMode } from "@/lib/achievements";

export type PlayerStats = {
  totalScore: number;
  gamesPlayed: number;
  source: "online" | "local";
  /** games (or wins) per mode for the breakdown row */
  perMode: { mode: RunMode; label: string; count: number }[];
};

const MODE_LABELS: Record<RunMode, string> = {
  "race-random": "Random",
  "race-daily": "Daily",
  "race-custom": "Custom",
  collector: "Collector",
  nomove: "No-Move",
  multiplayer: "Multiplayer",
};

function localStats(): PlayerStats {
  const s = getStats();
  // Local total score is unknown (we never stored per-run score locally), so
  // approximate with totalWins × 1000 — only used as a guest fallback.
  const totalScore = s.totalWins * 1000;
  const perMode = (Object.keys(MODE_LABELS) as RunMode[]).map((m) => ({
    mode: m,
    label: MODE_LABELS[m],
    count: s.winsByMode[m] ?? 0,
  }));
  return {
    totalScore,
    gamesPlayed: s.totalWins,
    source: "local",
    perMode,
  };
}

/**
 * Returns aggregated stats for the player banner. If `userId` is provided we
 * try the online scores table; otherwise we read from localStorage.
 */
export async function loadPlayerStats(userId: string | null): Promise<PlayerStats> {
  // Per-mode breakdown always comes from local wins so we can show modes that
  // don't submit online (e.g. multiplayer wins are a local achievement).
  const local = localStats();

  if (!userId) return local;

  const { data, error } = await supabase
    .from("scores")
    .select("score, mode")
    .eq("user_id", userId);
  if (error || !data) return local;

  const totalScore = data.reduce((acc, r) => acc + (r.score ?? 0), 0);
  const gamesPlayed = data.length;
  return {
    totalScore,
    gamesPlayed,
    source: "online",
    // Keep the local per-mode breakdown — it covers more modes than `scores`.
    perMode: local.perMode,
  };
}
