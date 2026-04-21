// Co-op Time Attack: Supabase-backed helpers + realtime.
import { supabase } from "@/integrations/supabase/client";

export type CoopStatus = "waiting" | "playing" | "finished" | "abandoned";

export type CoopMatchRow = {
  id: string;
  room_code: string | null;
  status: CoopStatus;
  start_title: string;
  word_list: string[];
  duration_ms: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  team_score: number;
};

export type CoopPlayerRow = {
  id: string;
  match_id: string;
  player_id: string;
  display_name: string;
  current_title: string | null;
  chasing_word: string | null;
  claims: number;
  score: number;
  joined_at: string;
};

export type CoopClaimRow = {
  id: string;
  match_id: string;
  word: string;
  claimed_by: string;
  claimed_at: string;
};

const normMatch = (r: Record<string, unknown> | null): CoopMatchRow | null => {
  if (!r) return null;
  const wl = (r as { word_list?: unknown }).word_list;
  return {
    ...(r as unknown as CoopMatchRow),
    word_list: Array.isArray(wl) ? (wl as string[]) : [],
  };
};

export async function createCoopRoom(args: {
  playerId: string;
  displayName: string;
  start: string;
  wordList: string[];
}): Promise<{ matchId: string; roomCode: string }> {
  const { data, error } = await supabase.rpc("create_coop_room", {
    p_player_id: args.playerId,
    p_display_name: args.displayName,
    p_start: args.start,
    p_word_list: args.wordList,
  });
  if (error) throw error;
  const row = (data as { match_id: string; room_code: string }[])?.[0];
  if (!row) throw new Error("No room returned");
  return { matchId: row.match_id, roomCode: row.room_code };
}

export async function joinCoopRoom(args: {
  playerId: string;
  displayName: string;
  code: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("join_coop_room", {
    p_player_id: args.playerId,
    p_display_name: args.displayName,
    p_code: args.code,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function setCoopChasing(args: {
  matchId: string;
  playerId: string;
  currentTitle: string;
  chasingWord: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("set_coop_chasing", {
    p_match_id: args.matchId,
    p_player_id: args.playerId,
    p_current_title: args.currentTitle,
    p_chasing_word: args.chasingWord,
  });
  if (error) throw error;
}

export async function claimCoopWord(args: {
  matchId: string;
  playerId: string;
  word: string;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_coop_word", {
    p_match_id: args.matchId,
    p_player_id: args.playerId,
    p_word: args.word,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function finishCoopMatch(matchId: string, playerId: string): Promise<void> {
  await supabase.rpc("finish_coop_match", { p_match_id: matchId, p_player_id: playerId });
}

export async function cancelCoopMatch(matchId: string, playerId: string): Promise<void> {
  await supabase.rpc("cancel_coop_match", { p_match_id: matchId, p_player_id: playerId });
}

export async function fetchCoopMatch(matchId: string): Promise<CoopMatchRow | null> {
  const { data, error } = await supabase
    .from("coop_matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  if (error) return null;
  return normMatch(data as Record<string, unknown> | null);
}

export async function fetchCoopPlayers(matchId: string): Promise<CoopPlayerRow[]> {
  const { data, error } = await supabase
    .from("coop_players")
    .select("*")
    .eq("match_id", matchId);
  if (error) return [];
  return (data ?? []) as CoopPlayerRow[];
}

export async function fetchCoopClaims(matchId: string): Promise<CoopClaimRow[]> {
  const { data, error } = await supabase
    .from("coop_word_claims")
    .select("*")
    .eq("match_id", matchId);
  if (error) return [];
  return (data ?? []) as CoopClaimRow[];
}

export function subscribeCoop(
  matchId: string,
  handlers: {
    onMatch: (row: CoopMatchRow) => void;
    onPlayer: (row: CoopPlayerRow) => void;
    onClaim: (row: CoopClaimRow) => void;
  }
) {
  const channel = supabase
    .channel(`coop:${matchId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "coop_matches", filter: `id=eq.${matchId}` },
      (p) => {
        const row = normMatch(p.new as Record<string, unknown>);
        if (row) handlers.onMatch(row);
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "coop_players", filter: `match_id=eq.${matchId}` },
      (p) => handlers.onPlayer(p.new as CoopPlayerRow)
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "coop_word_claims", filter: `match_id=eq.${matchId}` },
      (p) => handlers.onClaim(p.new as CoopClaimRow)
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}