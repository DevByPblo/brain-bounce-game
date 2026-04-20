import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WikiArticle } from "@/components/WikiArticle";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clock,
  Copy,
  Flag,
  KeyRound,
  Lightbulb,
  Loader2,
  Lock,
  MousePointerClick,
  RotateCcw,
  Swords,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import {
  getArticleHtml,
  getRandomTitle,
  getSummary,
  normaliseTitle,
  type WikiSummary,
} from "@/lib/wiki";
import { CATEGORIES, OTHER_CATEGORIES, POPULAR_CATEGORIES, getTitleForCategory } from "@/lib/categories";
import { recordCategoryUse } from "@/lib/categoryStats";
import { useFavoriteCategories } from "@/hooks/use-favorite-categories";
import { getPlayerId, getPlayerName, setPlayerName } from "@/lib/player";
import {
  addBotToMatch,
  cancelMatch,
  createPrivateRoom,
  fetchMatch,
  fetchMatchPlayers,
  finishMatch,
  joinPrivateRoom,
  joinQuickMatch,
  reportProgress,
  subscribeMatch,
  type MatchPlayerRow,
  type MatchRow,
} from "@/lib/multiplayer";
import {
  difficultyFromHistory,
  fetchPersonalBest,
  randomBotName,
  runBot,
  type BotRunner,
} from "@/lib/bot";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setRaceActive } from "@/hooks/use-race-active";
import { HintCard } from "@/components/HintCard";
import { recordRun } from "@/lib/achievements";
import { celebrateBadges } from "@/lib/achievementToast";
import { useBlockFind } from "@/hooks/use-block-find";
import { useScrolled } from "@/hooks/use-scrolled";

type Phase = "lobby" | "searching" | "room" | "briefing" | "racing" | "finished";
type Mode = "quick" | "private";

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

// If a quick match has no opponent within this window, drop in a bot.
const BOT_FALLBACK_MS = 12_000;

const Multiplayer = () => {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [mode, setMode] = useState<Mode>("quick");
  const [name, setName] = useState<string>(() => getPlayerName());
  useBlockFind(phase === "racing");
  const [category, setCategory] = useState<string>("");
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [disableHints, setDisableHints] = useState<boolean>(false);
  const playerId = useMemo(() => getPlayerId(), []);
  const [error, setError] = useState<string | null>(null);

  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [players, setPlayers] = useState<MatchPlayerRow[]>([]);

  const [startSummary, setStartSummary] = useState<WikiSummary | null>(null);
  const [targetSummary, setTargetSummary] = useState<WikiSummary | null>(null);

  const [currentTitle, setCurrentTitle] = useState<string>("");
  const [articleHtml, setArticleHtml] = useState<string>("");
  const [path, setPath] = useState<string[]>([]);
  const [clicks, setClicks] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [opponentHopKey, setOpponentHopKey] = useState(0);
  const lastOpponentTitleRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const botRunnerRef = useRef<BotRunner | null>(null);
  const botFallbackRef = useRef<number | null>(null);
  const channelRef = useRef<{ sendRematch: (id: string) => void; sendLeft: (id: string) => void } | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [opponentRematch, setOpponentRematch] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const compact = useScrolled(60);

  const me = useMemo(
    () => players.find((p) => p.player_id === playerId) ?? null,
    [players, playerId]
  );
  const opponent = useMemo(
    () => players.find((p) => p.player_id !== playerId) ?? null,
    [players, playerId]
  );

  // ─── Realtime subscription ───
  useEffect(() => {
    if (!matchId) return;
    const sub = subscribeMatch(matchId, {
      onMatch: (row) => setMatch(row),
      onPlayer: (row) => {
        setPlayers((prev) => {
          const idx = prev.findIndex((p) => p.id === row.id);
          if (idx === -1) return [...prev, row];
          const next = [...prev];
          next[idx] = row;
          return next;
        });
      },
      onRematch: (fromPid) => {
        if (fromPid !== playerId) setOpponentRematch(true);
      },
      onLeft: (fromPid) => {
        if (fromPid !== playerId) setOpponentLeft(true);
      },
    });
    channelRef.current = { sendRematch: sub.sendRematch, sendLeft: sub.sendLeft };
    void (async () => {
      const [m, ps] = await Promise.all([fetchMatch(matchId), fetchMatchPlayers(matchId)]);
      if (m) setMatch(m);
      if (ps.length) setPlayers(ps);
    })();
    return () => {
      sub.unsubscribe();
      channelRef.current = null;
    };
  }, [matchId, playerId]);

  // ─── Auto-fallback to a bot on quick match if nobody joins ───
  useEffect(() => {
    if (phase !== "searching" || mode !== "quick" || !matchId || !match) return;
    if (match.status !== "waiting") return;
    if (players.length >= 2) return;
    // Schedule a bot fallback.
    botFallbackRef.current = window.setTimeout(async () => {
      try {
        const botName = randomBotName();
        await addBotToMatch({ matchId, playerId, botName: `🤖 ${botName}` });
        toast.info("No challenger online — a bot is stepping in.");
      } catch (e) {
        console.error("bot fallback failed", e);
      }
    }, BOT_FALLBACK_MS);
    return () => {
      if (botFallbackRef.current) {
        clearTimeout(botFallbackRef.current);
        botFallbackRef.current = null;
      }
    };
  }, [phase, mode, matchId, match, players.length, playerId]);

  // ─── React to match status changes ───
  useEffect(() => {
    if (!match) return;

    if (match.status === "playing" && (phase === "searching" || phase === "room")) {
      // Show briefing immediately while we preload article + summaries.
      setPhase("briefing");
      void (async () => {
        try {
          const [sSum, tSum, art] = await Promise.all([
            getSummary(match.start_title!),
            getSummary(match.target_title!),
            getArticleHtml(match.start_title!),
          ]);
          setStartSummary(sSum);
          setTargetSummary(tSum);
          setCurrentTitle(art.title);
          setArticleHtml(art.html);
          setPath([art.title]);
        } catch (e) {
          console.error(e);
          setError("Couldn't load the articles. Please try again.");
        }
      })();
    }

    if (match.status === "finished" && phase !== "finished") {
      setPhase("finished");
      // Achievements: only the actual winner unlocks the multiplayer badges.
      if (match.winner_player_id === playerId) {
        const me = players.find((p) => p.player_id === playerId);
        const earned = recordRun({
          mode: "multiplayer",
          won: true,
          clicks: me?.clicks ?? 0,
          timeMs: me?.time_ms ?? (Date.now() - startedAtRef.current),
          hintsUsed: 0,
          undos: 0,
        });
        if (earned.length) celebrateBadges(earned);
      }
    }
  }, [match, phase, playerId, players]);

  // ─── Begin race when briefing is dismissed (countdown finished) ───
  const handleBriefingDone = useCallback(() => {
    if (!articleHtml || !startSummary || !targetSummary) return;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("racing");
  }, [articleHtml, startSummary, targetSummary]);

  // ─── Drive the bot when one is in the match ───
  // IMPORTANT: depend on stable identifiers only. Depending on `players` or the
  // full `match` row causes this effect to re-run on every realtime tick and
  // restart the bot before it can take a single hop.
  const botPlayerId = useMemo(
    () => players.find((p) => p.is_bot)?.player_id ?? null,
    [players]
  );
  const startTitle = match?.start_title ?? null;
  const targetTitle = match?.target_title ?? null;
  useEffect(() => {
    if (phase !== "racing" || !matchId || !botPlayerId) return;
    if (!startTitle || !targetTitle) return;
    if (botRunnerRef.current) return;
    console.log("[bot] starting runner", { botPlayerId, startTitle, targetTitle });
    void (async () => {
      const best = await fetchPersonalBest(name);
      const difficulty = difficultyFromHistory(best);
      console.log("[bot] difficulty", difficulty);
      botRunnerRef.current = runBot({
        matchId,
        botPlayerId,
        start: startTitle,
        target: targetTitle,
        difficulty,
        startedAt: startedAtRef.current,
      });
    })();
    return () => {
      console.log("[bot] stopping runner (effect cleanup)");
      botRunnerRef.current?.stop();
      botRunnerRef.current = null;
    };
  }, [phase, matchId, botPlayerId, startTitle, targetTitle, name]);

  // Stop bot when match finishes/leaves.
  useEffect(() => {
    if (phase === "finished" || phase === "lobby") {
      botRunnerRef.current?.stop();
      botRunnerRef.current = null;
    }
  }, [phase]);

  // ─── Tick timer ───
  useEffect(() => {
    if (phase !== "racing") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  // ─── Track race-active state globally so chrome (e.g. AuthMenu) can hide ───
  useEffect(() => {
    setRaceActive(phase === "racing" || phase === "briefing");
    return () => setRaceActive(false);
  }, [phase]);

  // ─── Pulse the opponent card whenever their current article changes ───
  // Bumping a counter forces the PlayerCard to remount its animated wrapper,
  // re-triggering the CSS pulse without needing to clear/reapply a class.
  useEffect(() => {
    const t = opponent?.current_title ?? null;
    if (t && t !== lastOpponentTitleRef.current) {
      // Skip the very first observation (it's the opponent's starting article,
      // not a hop) — only pulse on actual changes.
      if (lastOpponentTitleRef.current !== null) {
        setOpponentHopKey((k) => k + 1);
      }
      lastOpponentTitleRef.current = t;
    }
  }, [opponent?.current_title]);

  // ─── Save name on change ───
  useEffect(() => {
    setPlayerName(name);
  }, [name]);

  // ─── Pick a random start/target pair (target may be category-constrained) ───
  const pickPair = useCallback(async () => {
    const s = await getRandomTitle();
    const pickTarget = () =>
      category ? getTitleForCategory(category, difficulty) : getRandomTitle();
    let t = await pickTarget();
    let guard = 0;
    while (normaliseTitle(s) === normaliseTitle(t) && guard++ < 4) {
      t = await pickTarget();
    }
    if (category) recordCategoryUse(category);
    return { start: s, target: t };
  }, [category, difficulty]);

  // ─── Find a quick match ───
  const findMatch = useCallback(async () => {
    setError(null);
    setMode("quick");
    setPhase("searching");
    try {
      const { start, target } = await pickPair();
      const id = await joinQuickMatch({
        playerId,
        displayName: name.trim() || "Anonymous",
        start,
        target,
        hintsDisabled: disableHints,
      });
      setMatchId(id);
    } catch (e) {
      console.error(e);
      setError("Couldn't reach the matchmaker. Please try again.");
      setPhase("lobby");
    }
  }, [name, playerId, pickPair, disableHints]);

  // ─── Create a private room ───
  const createRoom = useCallback(async () => {
    setError(null);
    setMode("private");
    setPhase("searching");
    try {
      const { start, target } = await pickPair();
      const { matchId: id } = await createPrivateRoom({
        playerId,
        displayName: name.trim() || "Anonymous",
        start,
        target,
        hintsDisabled: disableHints,
      });
      setMatchId(id);
      setPhase("room");
    } catch (e) {
      console.error(e);
      setError("Couldn't create the room. Please try again.");
      setPhase("lobby");
    }
  }, [name, playerId, pickPair, disableHints]);

  // ─── Join a private room by code ───
  const joinRoom = useCallback(
    async (code: string) => {
      setError(null);
      setMode("private");
      setPhase("searching");
      try {
        const id = await joinPrivateRoom({
          playerId,
          displayName: name.trim() || "Anonymous",
          code,
          hintsDisabled: disableHints,
        });
        setMatchId(id);
      } catch (e) {
        console.error(e);
        const msg =
          (e as { message?: string })?.message ?? "Couldn't join that room.";
        setError(msg.includes("not found") ? "Room not found or already finished." : msg);
        setPhase("lobby");
      }
    },
    [name, playerId, disableHints]
  );

  const addBotNow = useCallback(async () => {
    if (!matchId) return;
    // If a bot (or anyone else) already joined, the server-side RPC is now
    // idempotent and will just return the existing bot's id — no error.
    try {
      await addBotToMatch({
        matchId,
        playerId,
        botName: `🤖 ${randomBotName()}`,
      });
    } catch (e: unknown) {
      console.error("addBotToMatch failed", e);
      const msg =
        (e as { message?: string })?.message ?? "Couldn't add a bot.";
      toast.error(msg);
    }
  }, [matchId, playerId]);

  // ─── Cancel ───
  const cancelSearch = useCallback(async () => {
    if (matchId) {
      try {
        await cancelMatch(matchId, playerId);
      } catch {
        /* ignore */
      }
    }
    botRunnerRef.current?.stop();
    botRunnerRef.current = null;
    setMatchId(null);
    setMatch(null);
    setPlayers([]);
    setPhase("lobby");
  }, [matchId, playerId]);

  // ─── Navigate ───
  const navigate = useCallback(
    async (title: string) => {
      if (!matchId || !match?.target_title || finishedRef.current) return;
      const newClicks = clicks + 1;
      setClicks(newClicks);
      try {
        const art = await getArticleHtml(title);
        const newPath = [...path, art.title];
        setCurrentTitle(art.title);
        setArticleHtml(art.html);
        setPath(newPath);

        void reportProgress({
          matchId,
          playerId,
          currentTitle: art.title,
          clicks: newClicks,
          path: newPath,
        });

        if (normaliseTitle(art.title) === normaliseTitle(match.target_title)) {
          finishedRef.current = true;
          const finalElapsed = Date.now() - startedAtRef.current;
          setElapsed(finalElapsed);
          await finishMatch({
            matchId,
            playerId,
            clicks: newClicks,
            timeMs: finalElapsed,
            path: newPath,
          });
        }
      } catch (e) {
        console.error(e);
      }
    },
    [matchId, match, clicks, path, playerId]
  );

  const resetToLobby = useCallback(() => {
    botRunnerRef.current?.stop();
    botRunnerRef.current = null;
    setMatchId(null);
    setMatch(null);
    setPlayers([]);
    setStartSummary(null);
    setTargetSummary(null);
    setCurrentTitle("");
    setArticleHtml("");
    setPath([]);
    setClicks(0);
    setElapsed(0);
    setHintsUsed(0);
    setRematchRequested(false);
    setOpponentRematch(false);
    setOpponentLeft(false);
    finishedRef.current = false;
    setPhase("lobby");
  }, []);

  const playAgain = useCallback(() => {
    // Bots: instant rematch (no handshake needed).
    if (opponent?.is_bot || !opponent) {
      resetToLobby();
      return;
    }
    if (opponentLeft) {
      toast.error("Your opponent left the game.");
      resetToLobby();
      return;
    }
    // Broadcast our intent and wait for the opponent.
    setRematchRequested(true);
    channelRef.current?.sendRematch(playerId);
  }, [opponent, opponentLeft, playerId, resetToLobby]);

  // When BOTH players have requested a rematch, head back to the lobby together.
  useEffect(() => {
    if (rematchRequested && opponentRematch) {
      toast.success("Both players are in. Find a new match!");
      resetToLobby();
    }
  }, [rematchRequested, opponentRematch, resetToLobby]);

  // If we're waiting on the opponent and they've now left, surface it.
  useEffect(() => {
    if (rematchRequested && opponentLeft) {
      toast.error("Your opponent left the game.");
      resetToLobby();
    }
  }, [rematchRequested, opponentLeft, resetToLobby]);

  // Timeout the rematch wait after 15s.
  useEffect(() => {
    if (!rematchRequested || opponentRematch) return;
    const id = window.setTimeout(() => {
      toast.error("Your opponent didn't respond. They may have left.");
      resetToLobby();
    }, 15_000);
    return () => window.clearTimeout(id);
  }, [rematchRequested, opponentRematch, resetToLobby]);

  // Tell the other side when WE leave (only meaningful in finished/racing states).
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        channelRef.current.sendLeft(playerId);
      }
    };
  }, [playerId]);

  // ─────────────────────────── UI ───────────────────────────

  if (phase === "lobby") {
    return (
      <Lobby
        name={name}
        setName={setName}
        category={category}
        setCategory={setCategory}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        disableHints={disableHints}
        setDisableHints={setDisableHints}
        onFind={findMatch}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        error={error}
      />
    );
  }

  if (phase === "searching") {
    return (
      <Searching
        mode={mode}
        onCancel={cancelSearch}
        onAddBot={mode === "quick" ? addBotNow : undefined}
      />
    );
  }

  if (phase === "room" && match?.room_code) {
    return (
      <RoomWaiting
        code={match.room_code}
        onCancel={cancelSearch}
        onAddBot={addBotNow}
      />
    );
  }

  if (phase === "briefing") {
    return (
      <Briefing
        startSummary={startSummary}
        targetSummary={targetSummary}
        startTitle={match?.start_title ?? ""}
        targetTitle={match?.target_title ?? ""}
        ready={!!articleHtml && !!startSummary && !!targetSummary}
        onStart={handleBriefingDone}
      />
    );
  }

  if (phase === "finished") {
    return (
      <Results
        match={match}
        me={me}
        opponent={opponent}
        playerId={playerId}
        onPlayAgain={playAgain}
        onLeave={resetToLobby}
        rematchRequested={rematchRequested}
        opponentRematch={opponentRematch}
        opponentLeft={opponentLeft}
      />
    );
  }

  // racing
  const opponentClicks = opponent?.clicks ?? 0;
  const opponentFinished = !!opponent?.finished_at;
  const opponentTitle = opponent?.current_title ?? null;
  

  // A bit of theatrical tension for the player: as their opponent racks up
  // clicks, surface increasingly-anxious flavour text on the player's own
  // card. We never show the player their own current article (they can see
  // it in the article header) — this slot is reserved for psychological
  // pressure based on the opponent's pace.
  const tensionLine = (() => {
    if (opponentFinished) return "Your rival has filed their copy.";
    const lead = opponentClicks - clicks;
    if (lead >= 4) return "Your rival is sprinting ahead.";
    if (lead >= 2) return "Your rival is gaining ground.";
    if (lead === 1) return "Your rival just turned a page.";
    if (lead === 0 && opponentClicks > 0) return "Neck and neck.";
    if (lead <= -2 && clicks > 0) return "You're pulling away.";
    return "The press is quiet… for now.";
  })();

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <header className="border-b border-rule bg-card/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3 sm:gap-6">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/" className="serif text-lg sm:text-2xl font-extrabold whitespace-nowrap">
              Wiki<span className="italic text-primary">Race</span>
            </Link>
            <span className="small-caps text-[10px] text-ink-faint hidden md:inline">
              Live duel
            </span>
          </div>
          <div className="flex items-center gap-3 sm:gap-5 ticker">
            <Metric label="Time" value={formatTime(elapsed)} />
            {!match?.hints_disabled && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 sm:px-3"
                onClick={() => setHintOpen(true)}
                title={
                  hintsUsed >= 3
                    ? "All hints used"
                    : `Reveal a hint about your target`
                }
              >
                <Lightbulb className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">
                  Hint{hintsUsed > 0 ? ` ${hintsUsed}/3` : ""}
                </span>
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3">
                  <span className="hidden sm:inline">Forfeit</span>
                  <span className="sm:hidden">Quit</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Forfeit this race?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your opponent will be awarded the win. You can't rejoin this match.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep racing</AlertDialogCancel>
                  <AlertDialogAction onClick={cancelSearch}>
                    Yes, forfeit
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
          <PlayerCard
            label="You"
            name={me?.display_name ?? name}
            clicks={clicks}
            currentTitle={null}
            tensionLine={tensionLine}
            finished={!!me?.finished_at}
            self
          />
          <PlayerCard
            label={opponent?.is_bot ? "Bot" : "Opponent"}
            name={opponent?.display_name ?? "Waiting…"}
            clicks={opponentClicks}
            currentTitle={opponentTitle}
            finished={opponentFinished}
            isBot={opponent?.is_bot}
            pulseKey={opponentHopKey}
          />
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-3 sm:pb-4">
          <div className="paper-card flex flex-col sm:flex-row sm:items-stretch overflow-hidden">
            <RailEnd
              icon={<Flag className="w-3.5 h-3.5" />}
              label="From"
              title={startSummary?.title ?? match?.start_title ?? ""}
              subtitle={startSummary?.extract ?? ""}
            />
            <div className="hidden sm:flex items-center px-4 text-ink-faint">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="sm:hidden border-t border-rule flex items-center justify-center py-1 text-ink-faint">
              <ArrowRight className="w-4 h-4 rotate-90" />
            </div>
            <RailEnd
              icon={<Target className="w-3.5 h-3.5" />}
              label="To"
              title={targetSummary?.title ?? match?.target_title ?? ""}
              subtitle={targetSummary?.extract ?? ""}
              accent
            />
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-4 sm:px-8 pt-4 sm:pt-6 pb-3 border-b border-rule flex items-baseline justify-between gap-3">
            <h1 className="serif text-xl sm:text-3xl font-extrabold truncate">{currentTitle}</h1>
            <span className="mono text-xs text-ink-faint whitespace-nowrap">hop {path.length - 1}</span>
          </div>
          <div className="flex-1 min-h-0">
            <WikiArticle
              key={currentTitle}
              html={articleHtml}
              targetTitle={match?.target_title ?? ""}
              onNavigate={navigate}
            />
          </div>
        </article>
      </div>

      <HintCard
        open={hintOpen}
        onOpenChange={setHintOpen}
        target={targetSummary}
        hintsUsed={hintsUsed}
        onPurchase={() => {
          setHintsUsed((n) => n + 1);
          toast.info("Hint revealed");
        }}
        costLabel={() => "free in multiplayer"}
      />
    </main>
  );
};

// ─────────────────────────── Sub-components ───────────────────────────

const Lobby = ({
  name,
  setName,
  category,
  setCategory,
  difficulty,
  setDifficulty,
  disableHints,
  setDisableHints,
  onFind,
  onCreateRoom,
  onJoinRoom,
  error,
}: {
  name: string;
  setName: (n: string) => void;
  category: string;
  setCategory: (c: string) => void;
  difficulty: "easy" | "normal" | "hard";
  setDifficulty: (d: "easy" | "normal" | "hard") => void;
  disableHints: boolean;
  setDisableHints: (v: boolean) => void;
  onFind: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  error: string | null;
}) => {
  const [code, setCode] = useState("");
  const favorites = useFavoriteCategories(3);
  const favoriteDefs = favorites
    .map((label) => CATEGORIES.find((c) => c.label === label))
    .filter((c): c is (typeof CATEGORIES)[number] => Boolean(c));
  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-xl w-full text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-6 sm:mb-8"
        >
          <ArrowLeft className="w-3 h-3" /> Back to single player
        </Link>
        <div className="small-caps text-xs text-ink-soft mb-4 sm:mb-6">
          Vol. I · No. 2 · A live editorial duel
        </div>
        <h1 className="serif text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-3">
          Race a <span className="italic text-primary">stranger</span>.
        </h1>
        <p className="serif italic text-base sm:text-lg text-muted-foreground mb-6 sm:mb-8">
          Two readers. One target. First to arrive wins.
        </p>
        <div className="hairline my-4 sm:my-6 mx-auto w-24" />

        <div className="paper-card p-6 text-left mb-6">
          <label className="small-caps text-[10px] text-ink-faint mb-2 block">
            Display name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anonymous"
            maxLength={32}
            className="serif text-lg"
          />
          <p className="text-[11px] text-ink-faint mt-2">
            This is shown to your opponent during the race.
          </p>
        </div>

        <div className="paper-card p-5 text-left mb-6">
          <label
            htmlFor="mp-category-select"
            className="small-caps text-[10px] text-ink-faint mb-2 flex items-center justify-between"
          >
            <span>Target category (optional)</span>
            {category && (
              <button
                type="button"
                onClick={() => setCategory("")}
                className="text-[10px] text-primary hover:underline normal-case"
              >
                Clear
              </button>
            )}
          </label>
          <select
            id="mp-category-select"
            className="select-category w-full h-10 rounded-md border border-input bg-background px-3 serif text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Any Category</option>
            {favoriteDefs.length > 0 && (
              <optgroup label="★ Your favorites">
                {favoriteDefs.map((c) => (
                  <option key={`fav-${c.label}`} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="★ Popular">
              {POPULAR_CATEGORIES.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="All categories">
              {OTHER_CATEGORIES.map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="text-[11px] text-ink-faint mt-2">
            When set, both racers head toward a target inside this category.
          </p>
        </div>

        <div className="paper-card p-5 text-left mb-6">
          <label className="small-caps text-[10px] text-ink-faint mb-2 block">
            Target difficulty
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["easy", "normal", "hard"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={`serif text-sm py-2 rounded-md border transition-colors capitalize ${
                  difficulty === d
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-accent"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint mt-2">
            Easy = household names · Normal = mixed · Hard = obscure picks.
          </p>
        </div>

        <label className="paper-card p-4 mb-6 flex items-start gap-3 cursor-pointer text-left hover:bg-accent/20 transition-colors">
          <input
            type="checkbox"
            checked={disableHints}
            onChange={(e) => setDisableHints(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
          />
          <div className="flex-1">
            <div className="serif font-semibold text-sm flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" /> Disable hints (purist mode)
            </div>
            <p className="text-[11px] text-ink-faint mt-0.5">
              Hides the Hint button for both racers. If either of you ticks this, hints are off for the match.
            </p>
          </div>
        </label>

        {error && <p className="text-destructive text-sm mb-4">{error}</p>}

        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <Button size="lg" onClick={onFind} className="py-6 text-base">
            <Swords className="w-4 h-4 mr-2" /> Quick match
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={onCreateRoom}
            className="py-6 text-base"
          >
            <Lock className="w-4 h-4 mr-2" /> Private room
          </Button>
        </div>

        <div className="paper-card p-5 text-left">
          <label className="small-caps text-[10px] text-ink-faint mb-2 flex items-center gap-1.5">
            <KeyRound className="w-3 h-3" /> Have an invite code?
          </label>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="serif text-lg tracking-widest uppercase"
            />
            <Button
              onClick={() => code.trim() && onJoinRoom(code.trim())}
              disabled={code.trim().length < 4}
            >
              Join
            </Button>
          </div>
          <p className="text-[11px] text-ink-faint mt-2">
            Friends share their 6-character room code to race together.
          </p>
        </div>

        <p className="text-[11px] text-ink-faint mt-6">
          No challenger online? A skill-matched bot will step in after a few seconds.
        </p>
      </div>
    </main>
  );
};

const Searching = ({
  mode,
  onCancel,
  onAddBot,
}: {
  mode: Mode;
  onCancel: () => void;
  onAddBot?: () => void;
}) => (
  <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
    <div className="max-w-md w-full text-center paper-card p-10">
      <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin mb-5" />
      <div className="small-caps text-xs text-ink-soft mb-2">
        {mode === "quick" ? "Awaiting a challenger" : "Joining room"}
      </div>
      <h2 className="serif text-3xl font-extrabold mb-3">
        {mode === "quick" ? "Searching the lobby…" : "One moment…"}
      </h2>
      <p className="text-sm text-ink-soft mb-6">
        {mode === "quick"
          ? "If nobody shows up in a few seconds, a bot will step in."
          : "Connecting you to the room."}
      </p>
      <div className="flex justify-center gap-2">
        {onAddBot && (
          <Button variant="secondary" onClick={onAddBot}>
            <Bot className="w-4 h-4 mr-2" /> Race a bot now
          </Button>
        )}
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  </main>
);

const RoomWaiting = ({
  code,
  onCancel,
  onAddBot,
}: {
  code: string;
  onCancel: () => void;
  onAddBot: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Room code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center paper-card p-10">
        <Lock className="w-7 h-7 mx-auto text-primary mb-4" />
        <div className="small-caps text-xs text-ink-soft mb-2">Private room</div>
        <h2 className="serif text-3xl font-extrabold mb-2">Share your code</h2>
        <p className="text-sm text-ink-soft mb-6">
          Send this code to a friend. They enter it from the multiplayer page.
        </p>

        <button
          onClick={copy}
          className="group block w-full paper-card p-6 mb-5 hover:border-primary transition"
        >
          <div className="mono text-5xl font-extrabold tracking-[0.4em] text-primary">
            {code}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 small-caps text-[10px] text-ink-faint group-hover:text-primary">
            {copied ? (
              <>
                <Check className="w-3 h-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> Click to copy
              </>
            )}
          </div>
        </button>

        <div className="flex justify-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={onAddBot}>
            <Bot className="w-4 h-4 mr-2" /> Add a bot
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Close room
          </Button>
        </div>
        <p className="text-[11px] text-ink-faint mt-6">
          Waiting for your friend to join…
        </p>
      </div>
    </main>
  );
};

const Briefing = ({
  startSummary,
  targetSummary,
  startTitle,
  targetTitle,
  ready,
  onStart,
}: {
  startSummary: WikiSummary | null;
  targetSummary: WikiSummary | null;
  startTitle: string;
  targetTitle: string;
  ready: boolean;
  onStart: () => void;
}) => {
  const [count, setCount] = useState<number>(3);
  const fired = useRef(false);

  // Once everything is loaded, run a 3 → 2 → 1 → GO countdown, then start.
  useEffect(() => {
    if (!ready) return;
    setCount(3);
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          if (!fired.current) {
            fired.current = true;
            // Tiny delay so the user sees "GO!"
            window.setTimeout(onStart, 450);
          }
          return 0;
        }
        return c - 1;
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [ready, onStart]);

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-6">
          <div className="small-caps text-xs text-ink-soft mb-2">The brief</div>
          <h2 className="serif text-4xl md:text-5xl font-extrabold mb-2">
            Get ready to race.
          </h2>
          <p className="serif italic text-muted-foreground">
            From this article, find your way to the target — using only links.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <BriefingCard
            label="You start at"
            icon={<Flag className="w-3.5 h-3.5" />}
            title={startSummary?.title ?? startTitle}
            extract={startSummary?.extract}
            thumbnail={startSummary?.thumbnail}
          />
          <BriefingCard
            label="You must reach"
            icon={<Target className="w-3.5 h-3.5" />}
            title={targetSummary?.title ?? targetTitle}
            extract={targetSummary?.extract}
            thumbnail={targetSummary?.thumbnail}
            accent
          />
        </div>

        <div className="paper-card p-8 text-center">
          {!ready ? (
            <>
              <Loader2 className="w-7 h-7 mx-auto animate-spin text-primary mb-3" />
              <div className="small-caps text-xs text-ink-faint">
                Loading articles…
              </div>
            </>
          ) : (
            <>
              <div className="small-caps text-[10px] text-ink-faint mb-1">
                Starting in
              </div>
              <div
                key={count}
                className="serif text-7xl md:text-8xl font-extrabold text-primary leading-none animate-in zoom-in duration-300"
              >
                {count > 0 ? count : "GO!"}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
};

const BriefingCard = ({
  label,
  icon,
  title,
  extract,
  thumbnail,
  accent,
}: {
  label: string;
  icon: React.ReactNode;
  title: string;
  extract?: string;
  thumbnail?: string;
  accent?: boolean;
}) => (
  <div
    className={`paper-card p-5 ${accent ? "ring-2 ring-primary/40" : ""}`}
  >
    <div className="flex items-center gap-2 mb-2">
      <span className={accent ? "text-primary" : "text-ink-soft"}>{icon}</span>
      <span className="small-caps text-[10px] text-ink-faint">{label}</span>
    </div>
    <div className="flex gap-4">
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          className="w-20 h-20 object-cover rounded border border-rule flex-shrink-0"
          loading="eager"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3
          className={`serif text-2xl font-extrabold leading-tight mb-1 ${
            accent ? "text-primary" : ""
          }`}
        >
          {title}
        </h3>
        <p className="serif text-sm text-ink-soft line-clamp-4">
          {extract || "…"}
        </p>
      </div>
    </div>
  </div>
);

const Results = ({
  match,
  me,
  opponent,
  playerId,
  onPlayAgain,
}: {
  match: MatchRow | null;
  me: MatchPlayerRow | null;
  opponent: MatchPlayerRow | null;
  playerId: string;
  onPlayAgain: () => void;
}) => {
  const winnerId = match?.winner_player_id;
  const iWon = winnerId === playerId;
  const verdict = !winnerId
    ? "Draw"
    : iWon
    ? "You win."
    : `${opponent?.display_name ?? "Opponent"} wins.`;

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-4xl w-full grid gap-6">
        <div className="paper-card p-10 text-center">
          <Trophy
            className={`w-10 h-10 mx-auto mb-4 ${
              iWon ? "text-primary" : "text-ink-faint"
            }`}
          />
          <div className="small-caps text-xs text-ink-soft mb-2">Final dispatch</div>
          <h2 className="serif text-4xl font-extrabold mb-2">{verdict}</h2>
          <p className="serif italic text-muted-foreground mb-8">
            {match?.start_title} → <span className="text-primary">{match?.target_title}</span>
          </p>

          <div className="grid md:grid-cols-2 gap-4 text-left">
            <PlayerResult
              title={`You (${me?.display_name ?? ""})`}
              player={me}
              winner={iWon}
            />
            <PlayerResult
              title={opponent?.display_name ?? "Opponent"}
              player={opponent}
              winner={!!winnerId && !iWon}
            />
          </div>

          <Button onClick={onPlayAgain} size="lg" className="mt-8">
            <RotateCcw className="w-4 h-4 mr-2" /> Race again
          </Button>
          <Link to="/" className="ml-3">
            <Button variant="outline" size="lg">
              Single player
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
};

const PlayerResult = ({
  title,
  player,
  winner,
}: {
  title: string;
  player: MatchPlayerRow | null;
  winner: boolean;
}) => (
  <div className={`paper-card p-5 ${winner ? "ring-2 ring-primary" : ""}`}>
    <div className="flex items-center justify-between mb-3">
      <div className="serif font-bold truncate flex items-center gap-2">
        {player?.is_bot && <Bot className="w-3.5 h-3.5 text-ink-faint" />}
        {title}
      </div>
      {winner && (
        <span className="small-caps text-[10px] text-primary">Winner</span>
      )}
    </div>
    {!player ? (
      <div className="text-xs text-ink-faint">Did not finish.</div>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Stat
            icon={<MousePointerClick className="w-3 h-3" />}
            label="Clicks"
            value={String(player.clicks)}
          />
          <Stat
            icon={<Clock className="w-3 h-3" />}
            label="Time"
            value={
              player.time_ms != null ? formatTime(player.time_ms) : "—"
            }
          />
        </div>
        <div className="small-caps text-[10px] text-ink-faint mb-1">Path</div>
        <ol className="serif text-xs space-y-1 max-h-48 overflow-y-auto">
          {(player.path ?? []).map((title, i, arr) => (
            <li key={i} className="flex gap-2">
              <span className="mono text-[10px] text-ink-faint w-5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={i === arr.length - 1 ? "text-primary font-semibold" : ""}>
                {title}
              </span>
            </li>
          ))}
        </ol>
      </>
    )}
  </div>
);

const Stat = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="paper-card p-3">
    <div className="flex items-center gap-1 small-caps text-[10px] text-ink-faint mb-1">
      {icon}
      {label}
    </div>
    <div className="mono text-lg font-semibold ticker">{value}</div>
  </div>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="text-right">
    <div className="small-caps text-[9px] text-ink-faint leading-none">{label}</div>
    <div className="mono text-sm font-semibold leading-tight">{value}</div>
  </div>
);

const PlayerCard = ({
  label,
  name,
  clicks,
  currentTitle,
  tensionLine,
  finished,
  self,
  isBot,
  pulseKey,
}: {
  label: string;
  name: string;
  clicks: number;
  currentTitle: string | null;
  tensionLine?: string;
  finished: boolean;
  self?: boolean;
  isBot?: boolean;
  pulseKey?: number;
}) => (
  <div
    // `key` forces a remount on each pulseKey bump, re-running the CSS animation.
    key={pulseKey ?? "static"}
    className={`paper-card p-3 flex items-center justify-between gap-3 ${
      self ? "ring-1 ring-primary/40" : ""
    } ${pulseKey ? "opponent-hop-pulse" : ""}`}
  >
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        {isBot ? (
          <Bot className="w-3 h-3 text-ink-faint" />
        ) : (
          <Users className="w-3 h-3 text-ink-faint" />
        )}
        <span className="small-caps text-[10px] text-ink-faint">{label}</span>
        {finished && (
          <span className="small-caps text-[10px] text-primary">· finished</span>
        )}
      </div>
      <div className="serif font-bold truncate">{name}</div>
      {self ? (
        tensionLine && (
          <div className="text-[11px] text-ink-soft italic truncate">
            {tensionLine}
          </div>
        )
      ) : finished ? null : currentTitle ? (
        <div className="text-[11px] text-ink-soft truncate">
          reading <span className="italic">“{currentTitle}”</span>
        </div>
      ) : (
        <div className="text-[11px] text-ink-faint italic">warming up…</div>
      )}
    </div>
    <div className="text-right">
      <div className="small-caps text-[9px] text-ink-faint leading-none">Clicks</div>
      <div className="mono text-xl font-bold leading-tight ticker">{clicks}</div>
    </div>
  </div>
);

const RailEnd = ({
  icon,
  label,
  title,
  subtitle,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) => (
  <div className="flex-1 p-4 min-w-0">
    <div className="flex items-center gap-2 mb-1">
      <span className={accent ? "text-primary" : "text-ink-soft"}>{icon}</span>
      <span className="small-caps text-[10px] text-ink-faint">{label}</span>
    </div>
    <div className={`serif text-lg font-bold truncate ${accent ? "text-primary" : ""}`}>
      {title}
    </div>
    <div className="text-xs text-ink-soft line-clamp-1 mt-0.5">{subtitle}</div>
  </div>
);

export default Multiplayer;
