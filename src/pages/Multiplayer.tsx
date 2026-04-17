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
  const startedAtRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const botRunnerRef = useRef<BotRunner | null>(null);
  const botFallbackRef = useRef<number | null>(null);

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
    const unsub = subscribeMatch(matchId, {
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
    });
    void (async () => {
      const [m, ps] = await Promise.all([fetchMatch(matchId), fetchMatchPlayers(matchId)]);
      if (m) setMatch(m);
      if (ps.length) setPlayers(ps);
    })();
    return unsub;
  }, [matchId]);

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
    }
  }, [match, phase]);

  // ─── Begin race when briefing is dismissed (countdown finished) ───
  const handleBriefingDone = useCallback(() => {
    if (!articleHtml || !startSummary || !targetSummary) return;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("racing");
  }, [articleHtml, startSummary, targetSummary]);

  // ─── Drive the bot when one is in the match ───
  useEffect(() => {
    if (phase !== "racing" || !match || !matchId) return;
    const bot = players.find((p) => p.is_bot);
    if (!bot || botRunnerRef.current) return;
    void (async () => {
      const best = await fetchPersonalBest(name);
      const difficulty = difficultyFromHistory(best);
      botRunnerRef.current = runBot({
        matchId,
        botPlayerId: bot.player_id,
        start: match.start_title!,
        target: match.target_title!,
        difficulty,
        startedAt: startedAtRef.current,
      });
    })();
    return () => {
      botRunnerRef.current?.stop();
      botRunnerRef.current = null;
    };
  }, [phase, match, matchId, players, name]);

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

  // ─── Save name on change ───
  useEffect(() => {
    setPlayerName(name);
  }, [name]);

  // ─── Pick a random start/target pair ───
  const pickPair = useCallback(async () => {
    let s = await getRandomTitle();
    let t = await getRandomTitle();
    let guard = 0;
    while (normaliseTitle(s) === normaliseTitle(t) && guard++ < 4) {
      t = await getRandomTitle();
    }
    return { start: s, target: t };
  }, []);

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
      });
      setMatchId(id);
    } catch (e) {
      console.error(e);
      setError("Couldn't reach the matchmaker. Please try again.");
      setPhase("lobby");
    }
  }, [name, playerId, pickPair]);

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
      });
      setMatchId(id);
      setPhase("room");
    } catch (e) {
      console.error(e);
      setError("Couldn't create the room. Please try again.");
      setPhase("lobby");
    }
  }, [name, playerId, pickPair]);

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
    [name, playerId]
  );

  const addBotNow = useCallback(async () => {
    if (!matchId) return;
    try {
      await addBotToMatch({
        matchId,
        playerId,
        botName: `🤖 ${randomBotName()}`,
      });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add a bot.");
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

  const playAgain = useCallback(() => {
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
    finishedRef.current = false;
    setPhase("lobby");
  }, []);

  // ─────────────────────────── UI ───────────────────────────

  if (phase === "lobby") {
    return (
      <Lobby
        name={name}
        setName={setName}
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
      />
    );
  }

  // racing
  const opponentClicks = opponent?.clicks ?? 0;
  const opponentFinished = !!opponent?.finished_at;
  const myTitle = currentTitle;

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <header className="border-b border-rule bg-card/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="serif text-2xl font-extrabold">
              Wiki<span className="italic text-primary">Race</span>
            </Link>
            <span className="small-caps text-[10px] text-ink-faint hidden md:inline">
              Live duel
            </span>
          </div>
          <div className="flex items-center gap-5 ticker">
            <Metric label="Time" value={formatTime(elapsed)} />
            <Button variant="outline" size="sm" onClick={cancelSearch}>
              Forfeit
            </Button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlayerCard
            label="You"
            name={me?.display_name ?? name}
            clicks={clicks}
            currentTitle={myTitle}
            finished={!!me?.finished_at}
            self
          />
          <PlayerCard
            label={opponent?.is_bot ? "Bot" : "Opponent"}
            name={opponent?.display_name ?? "Waiting…"}
            clicks={opponentClicks}
            currentTitle={null}
            finished={opponentFinished}
            isBot={opponent?.is_bot}
          />
        </div>

        <div className="max-w-6xl mx-auto px-6 pb-4">
          <div className="paper-card flex items-stretch overflow-hidden">
            <RailEnd
              icon={<Flag className="w-3.5 h-3.5" />}
              label="From"
              title={startSummary?.title ?? match?.start_title ?? ""}
              subtitle={startSummary?.extract ?? ""}
            />
            <div className="flex items-center px-4 text-ink-faint">
              <ArrowRight className="w-4 h-4" />
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

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-8 pt-6 pb-3 border-b border-rule flex items-baseline justify-between gap-3">
            <h1 className="serif text-3xl font-extrabold truncate">{currentTitle}</h1>
            <span className="mono text-xs text-ink-faint">hop {path.length - 1}</span>
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
    </main>
  );
};

// ─────────────────────────── Sub-components ───────────────────────────

const Lobby = ({
  name,
  setName,
  onFind,
  onCreateRoom,
  onJoinRoom,
  error,
}: {
  name: string;
  setName: (n: string) => void;
  onFind: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  error: string | null;
}) => {
  const [code, setCode] = useState("");
  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-8"
        >
          <ArrowLeft className="w-3 h-3" /> Back to single player
        </Link>
        <div className="small-caps text-xs text-ink-soft mb-6">
          Vol. I · No. 2 · A live editorial duel
        </div>
        <h1 className="serif text-5xl md:text-6xl font-extrabold tracking-tight mb-3">
          Race a <span className="italic text-primary">stranger</span>.
        </h1>
        <p className="serif italic text-lg text-muted-foreground mb-8">
          Two readers. One target. First to arrive wins.
        </p>
        <div className="hairline my-6 mx-auto w-24" />

        <div className="paper-card p-6 text-left mb-6">
          <label className="small-caps text-[10px] text-ink-faint mb-2 block">
            Your byline
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
  finished,
  self,
  isBot,
}: {
  label: string;
  name: string;
  clicks: number;
  currentTitle: string | null;
  finished: boolean;
  self?: boolean;
  isBot?: boolean;
}) => (
  <div
    className={`paper-card p-3 flex items-center justify-between gap-3 ${
      self ? "ring-1 ring-primary/40" : ""
    }`}
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
      {currentTitle && (
        <div className="text-[11px] text-ink-soft truncate">on “{currentTitle}”</div>
      )}
      {!self && !finished && (
        <div className="text-[11px] text-ink-faint italic">path hidden until finish</div>
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
