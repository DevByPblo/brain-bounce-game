// Browser-side bot opponent for multiplayer.
// The bot navigates Wikipedia from start → target by picking links out of
// the article HTML. Difficulty scales with the player's recent best.
import { supabase } from "@/integrations/supabase/client";
import { getArticleHtml, normaliseTitle } from "@/lib/wiki";

export type BotDifficulty = {
  /** ms between hops (lower = faster) */
  hopDelayMs: number;
  /** 0..1 — chance of picking a smart (target-relevant) link vs a random one */
  smartness: number;
  /** maximum hops before the bot gives up */
  maxHops: number;
  label: string;
};

/**
 * Pick a difficulty based on the local player's best (lowest) recent
 * race time/clicks. The better the player, the harder the bot.
 */
export function difficultyFromHistory(opts: {
  bestClicks?: number | null;
  bestTimeMs?: number | null;
}): BotDifficulty {
  const c = opts.bestClicks ?? 99;
  const t = opts.bestTimeMs ?? 999_999;

  // Score: lower is better.
  // ~5 clicks in 30s → very strong; ~15 clicks in 3min → casual.
  const skill =
    (c <= 6 ? 3 : c <= 9 ? 2 : c <= 13 ? 1 : 0) +
    (t <= 45_000 ? 3 : t <= 90_000 ? 2 : t <= 180_000 ? 1 : 0);

  if (skill >= 5) {
    return { hopDelayMs: 2200, smartness: 0.85, maxHops: 14, label: "Expert bot" };
  }
  if (skill >= 3) {
    return { hopDelayMs: 3200, smartness: 0.65, maxHops: 16, label: "Skilled bot" };
  }
  if (skill >= 1) {
    return { hopDelayMs: 4500, smartness: 0.45, maxHops: 18, label: "Casual bot" };
  }
  return { hopDelayMs: 6000, smartness: 0.25, maxHops: 20, label: "Rookie bot" };
}

/** Pull this player's best recent race (clicks + time) from the leaderboard. */
export async function fetchPersonalBest(playerName: string): Promise<{
  bestClicks: number | null;
  bestTimeMs: number | null;
}> {
  // We don't have an authed user_id for the local player here, so use the
  // display_name on past races as a soft proxy (good enough for tuning).
  const { data } = await supabase
    .from("match_players")
    .select("clicks,time_ms")
    .eq("display_name", playerName)
    .not("finished_at", "is", null)
    .order("time_ms", { ascending: true })
    .limit(5);
  const rows = data ?? [];
  if (!rows.length) return { bestClicks: null, bestTimeMs: null };
  return {
    bestClicks: Math.min(...rows.map((r) => r.clicks ?? 99)),
    bestTimeMs: Math.min(...rows.map((r) => r.time_ms ?? 999999)),
  };
}

/** Extract candidate internal article links from parsed Wikipedia HTML. */
export function extractLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Match <a href="/wiki/Title" ...>
  const re = /<a[^>]+href="\/wiki\/([^"#?]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = decodeURIComponent(m[1]).replace(/_/g, " ");
    if (!raw) continue;
    if (/^(File|Help|Special|Wikipedia|Portal|Category|Template):/i.test(raw)) continue;
    if (raw.includes("(disambiguation)")) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= 200) break;
  }
  return out;
}

/** Score a link by simple similarity to the target title. */
function scoreLink(link: string, target: string): number {
  const l = link.toLowerCase();
  const t = target.toLowerCase();
  if (l === t) return 1000;
  let score = 0;
  const tokens = t.split(/\s+/).filter((x) => x.length > 2);
  for (const tok of tokens) if (l.includes(tok)) score += 5;
  // Prefer broader category-ish links (countries, fields) when target is obscure.
  if (l.length > 3 && t.includes(l.split(" ")[0])) score += 2;
  return score;
}

export type BotRunner = {
  stop: () => void;
};

/**
 * Drives the bot: loads its current article, picks a link, reports progress,
 * and finishes when it reaches the target.
 */
export function runBot(args: {
  matchId: string;
  botPlayerId: string;
  start: string;
  target: string;
  difficulty: BotDifficulty;
  startedAt: number;
}): BotRunner {
  let stopped = false;

  const tick = async () => {
    let current = args.start;
    const path: string[] = [args.start];
    let hops = 0;
    console.log("[bot] tick start", { current, target: args.target });

    while (!stopped && hops < args.difficulty.maxHops) {
      // Reached target?
      if (normaliseTitle(current) === normaliseTitle(args.target)) {
        console.log("[bot] reached target");
        await supabase.rpc("finish_match", {
          p_match_id: args.matchId,
          p_player_id: args.botPlayerId,
          p_clicks: hops,
          p_time_ms: Date.now() - args.startedAt,
          p_path: path,
        });
        return;
      }

      // Wait between hops.
      await new Promise((r) => setTimeout(r, args.difficulty.hopDelayMs));
      if (stopped) { console.log("[bot] stopped during wait"); return; }

      let next: string | null = null;
      try {
        const art = await getArticleHtml(current);
        const links = extractLinks(art.html).filter(
          (l) => !path.some((p) => normaliseTitle(p) === normaliseTitle(l))
        );
        console.log("[bot] fetched", current, "links:", links.length);
        if (!links.length) { console.log("[bot] no links, giving up"); return; }

        // Direct hit?
        const direct = links.find(
          (l) => normaliseTitle(l) === normaliseTitle(args.target)
        );
        if (direct) {
          next = direct;
        } else if (Math.random() < args.difficulty.smartness) {
          const ranked = [...links]
            .map((l) => ({ l, s: scoreLink(l, args.target) }))
            .sort((a, b) => b.s - a.s);
          const top = ranked.slice(0, 5);
          next = top[Math.floor(Math.random() * top.length)].l;
        } else {
          const pool = links.slice(0, 50);
          next = pool[Math.floor(Math.random() * pool.length)];
        }
      } catch (e) {
        console.log("[bot] fetch error", e);
        return;
      }

      if (!next || stopped) return;
      hops += 1;
      path.push(next);
      current = next;
      console.log("[bot] hop", hops, "→", next);

      void supabase.rpc("report_progress", {
        p_match_id: args.matchId,
        p_player_id: args.botPlayerId,
        p_current_title: next,
        p_clicks: hops,
        p_path: path,
      });
    }
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

const BOT_NAMES = [
  "Otto the Otter", "Quill", "Inkwell", "Margin", "Sidebar Sam",
  "Footnote Fred", "Daisy Draft", "Marginalia", "Volume IX",
];

export const randomBotName = () =>
  BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
