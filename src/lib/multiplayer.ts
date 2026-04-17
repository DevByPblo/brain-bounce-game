// Multiplayer RPC + realtime helpers built on Lovable Cloud.
import { supabase } from "@/integrations/supabase/client";

export type MatchStatus = "waiting" | "playing" | "finished" | "abandoned";

export type MatchRow = {
  id: string;
  status: MatchStatus;
  start_title: string | null;
  target_title: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  winner_player_id: string | null;
};

export type MatchPlayerRow = {
  id: string;
  match_id: string;
  player_id: string;
  display_name: string;
  clicks: number;
  current_title: string | null;
  path: string[];
  finished_at: string | null;
  time_ms: number | null;
  joined_at: string;
};

export async function joinQuickMatch(args: {
  playerId: string;
  displayName: string;
  start: string;
  target: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("join_quick_match", {
    p_player_id: args.playerId,
    p_display_name: args.displayName,
    p_start: args.start,
    p_target: args.target,
  });
  if (error) throw error;
  return data as string;
}

export async function createPrivateRoom(args: {
  playerId: string;
  displayName: string;
  start: string;
  target: string;
}): Promise<{ matchId: string; roomCode: string }> {
  const { data, error } = await supabase.rpc("create_private_room", {
    p_player_id: args.playerId,
    p_display_name: args.displayName,
    p_start: args.start,
    p_target: args.target,
  });
  if (error) throw error;
  const row = (data as Array<{ match_id: string; room_code: string }>)[0];
  return { matchId: row.match_id, roomCode: row.room_code };
}

export async function joinPrivateRoom(args: {
  playerId: string;
  displayName: string;
  code: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("join_private_room", {
    p_player_id: args.playerId,
    p_display_name: args.displayName,
    p_code: args.code.trim().toUpperCase(),
  });
  if (error) throw error;
  return data as string;
}

export async function addBotToMatch(args: {
  matchId: string;
  playerId: string;
  botName: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("add_bot_to_match", {
    p_match_id: args.matchId,
    p_player_id: args.playerId,
    p_bot_name: args.botName,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelMatch(matchId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_match", {
    p_match_id: matchId,
    p_player_id: playerId,
  });
  if (error) throw error;
}

export async function reportProgress(args: {
  matchId: string;
  playerId: string;
  currentTitle: string;
  clicks: number;
  path: string[];
}): Promise<void> {
  const { error } = await supabase.rpc("report_progress", {
    p_match_id: args.matchId,
    p_player_id: args.playerId,
    p_current_title: args.currentTitle,
    p_clicks: args.clicks,
    p_path: args.path,
  });
  if (error) throw error;
}

export async function finishMatch(args: {
  matchId: string;
  playerId: string;
  clicks: number;
  timeMs: number;
  path: string[];
}): Promise<void> {
  const { error } = await supabase.rpc("finish_match", {
    p_match_id: args.matchId,
    p_player_id: args.playerId,
    p_clicks: args.clicks,
    p_time_ms: args.timeMs,
    p_path: args.path,
  });
  if (error) throw error;
}

export async function fetchMatch(matchId: string): Promise<MatchRow | null> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw error;
  return (data as MatchRow) ?? null;
}

export async function fetchMatchPlayers(matchId: string): Promise<MatchPlayerRow[]> {
  const { data, error } = await supabase
    .from("match_players")
    .select("*")
    .eq("match_id", matchId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d) => ({
    ...(d as MatchPlayerRow),
    path: Array.isArray((d as { path: unknown }).path)
      ? ((d as { path: string[] }).path)
      : [],
  }));
}

/**
 * Subscribe to live match + player updates.
 * Returns an unsubscribe function.
 */
export function subscribeMatch(
  matchId: string,
  handlers: {
    onMatch: (row: MatchRow) => void;
    onPlayer: (row: MatchPlayerRow) => void;
  }
): () => void {
  const channel = supabase
    .channel(`match:${matchId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as MatchRow;
        if (row) handlers.onMatch(row);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "match_players",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        const raw = (payload.new ?? payload.old) as MatchPlayerRow;
        if (!raw) return;
        handlers.onPlayer({
          ...raw,
          path: Array.isArray((raw as { path: unknown }).path)
            ? (raw as { path: string[] }).path
            : [],
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
