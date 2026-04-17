// Online leaderboard (Lovable Cloud) — submit & fetch scores per mode.
import { supabase } from "@/integrations/supabase/client";

export type OnlineMode = "race" | "collector" | "nomove";

export type OnlineScore = {
  id: string;
  user_id: string;
  mode: OnlineMode;
  score: number;
  clicks: number;
  time_ms: number;
  details: Record<string, unknown>;
  created_at: string;
  display_name?: string;
};

export async function submitScore(args: {
  mode: OnlineMode;
  score: number;
  clicks: number;
  timeMs: number;
  details?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("scores").insert({
    user_id: uid,
    mode: args.mode,
    score: args.score,
    clicks: args.clicks,
    time_ms: args.timeMs,
    details: args.details ?? {},
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchTopScores(
  mode: OnlineMode,
  limit = 20
): Promise<OnlineScore[]> {
  const { data, error } = await supabase
    .from("scores")
    .select("id, user_id, mode, score, clicks, time_ms, details, created_at")
    .eq("mode", mode)
    .order("score", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return [];
  }
  const rows = (data ?? []) as Omit<OnlineScore, "display_name">[];
  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  const nameMap = new Map<string, string>();
  (profiles ?? []).forEach((p) =>
    nameMap.set((p as { user_id: string }).user_id, (p as { display_name: string }).display_name)
  );

  return rows.map((r) => ({
    ...r,
    details: (r.details ?? {}) as Record<string, unknown>,
    display_name: nameMap.get(r.user_id) ?? "Anonymous",
  }));
}
