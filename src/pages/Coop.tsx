import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Check, Copy, Crown, Flag, Loader2, Lock, Play, Timer,
  Trophy, Users, X, Zap, Share2, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WikiArticle } from "@/components/WikiArticle";
import {
  getArticleHtml, getRandomTitle, normaliseTitle, type WikiSummary, getSummary,
} from "@/lib/wiki";
import { getPlayerId, getPlayerName, setPlayerName } from "@/lib/player";
import {
  claimCoopWord, createCoopRoom, fetchCoopClaims, fetchCoopMatch, fetchCoopPlayers,
  joinCoopRoom, leaveCoopMatch, markCoopDone, optInRematch, rematchCoopMatch,
  setCoopChasing, startCoopMatch, subscribeCoop,
  type CoopClaimRow, type CoopMatchRow, type CoopPlayerRow,
} from "@/lib/coop";
import { toast } from "sonner";
import { setRaceActive } from "@/hooks/use-race-active";
import { useBlockFind } from "@/hooks/use-block-find";
import { Countdown } from "@/components/Countdown";
import { supabase } from "@/integrations/supabase/client";

type Phase = "lobby" | "creating" | "room" | "playing" | "finished";

const WORD_COUNT = 12;
const DEFAULT_DURATION_MS = 5 * 60 * 1000;
const SUDDEN_DEATH_MS = 2 * 60 * 1000;
const START_COUNTDOWN_MS = 5_000;

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

/** Build a fresh wiki word list (12 random titles + a start). */
const buildRound = async (): Promise<{ start: string; wordList: string[] }> => {
  const start = await getRandomTitle();
  const wordList: string[] = [];
  const seen = new Set<string>([normaliseTitle(start)]);
  while (wordList.length < WORD_COUNT) {
    const t = await getRandomTitle();
    const k = normaliseTitle(t);
    if (seen.has(k)) continue;
    seen.add(k);
    wordList.push(t);
  }
  return { start, wordList };
};

const Coop = () => {
  const playerId = useMemo(() => getPlayerId(), []);
  const [name, setName] = useState(() => getPlayerName());
  const [phase, setPhase] = useState<Phase>("lobby");
  const [error, setError] = useState<string | null>(null);

  const [matchId, setMatchId] = useState<string | null>(null);
  const [match, setMatch] = useState<CoopMatchRow | null>(null);
  const [players, setPlayers] = useState<CoopPlayerRow[]>([]);
  const [claims, setClaims] = useState<CoopClaimRow[]>([]);
  const [busy, setBusy] = useState<null | "start" | "rematch" | "done">(null);
  const [presence, setPresence] = useState<Set<string>>(new Set());

  const [startSummary, setStartSummary] = useState<WikiSummary | null>(null);
  const [articleHtml, setArticleHtml] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [chasing, setChasing] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());

  // Active (non-left) players, ordered by join.
  const activePlayers = useMemo(
    () =>
      [...players]
        .filter((p) => !p.left_at)
        .sort((a, b) => a.joined_at.localeCompare(b.joined_at)),
    [players]
  );
  const me = activePlayers.find((p) => p.player_id === playerId) ?? null;
  const isHost = !!match && match.host_player_id === playerId;

  // ─── Realtime subscription ───
  useEffect(() => {
    if (!matchId) return;
    void fetchCoopMatch(matchId).then((m) => m && setMatch(m));
    void fetchCoopPlayers(matchId).then(setPlayers);
    void fetchCoopClaims(matchId).then(setClaims);
    const sub = subscribeCoop(matchId, {
      onMatch: (m) => setMatch(m),
      onPlayer: (p) => setPlayers((prev) => {
        const idx = prev.findIndex((x) => x.id === p.id);
        if (idx === -1) return [...prev, p];
        const next = [...prev]; next[idx] = p; return next;
      }),
      onClaim: (c) => setClaims((prev) => prev.find((x) => x.id === c.id) ? prev : [...prev, c]),
    });
    return () => sub.unsubscribe();
  }, [matchId]);

  // ─── Presence ───
  useEffect(() => {
    if (!matchId) { setPresence(new Set()); return; }
    const channel = supabase.channel(`coop-presence:${matchId}`, {
      config: { presence: { key: playerId } },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, unknown[]>;
      setPresence(new Set(Object.keys(state)));
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ at: Date.now(), name });
      }
    });
    return () => { void supabase.removeChannel(channel); };
  }, [matchId, playerId, name]);

  // ─── Auto-follow rematch ───
  useEffect(() => {
    if (!match?.next_match_id) return;
    if (match.next_match_id === matchId) return;
    setClaims([]);
    setPlayers([]);
    setStartSummary(null);
    setArticleHtml("");
    setCurrentTitle("");
    setChasing(null);
    setMatchId(match.next_match_id);
    setPhase("room"); // land in lobby for next round
    setBusy(null);
  }, [match?.next_match_id, matchId]);

  // ─── Match status drives phase transitions ───
  useEffect(() => {
    if (!match) return;
    if (match.status === "playing" && phase === "room") setPhase("playing");
    if (match.status === "finished" && phase !== "finished") {
      setPhase("finished");
      setRaceActive(false);
    }
  }, [match, phase]);

  // ─── Load start article on entering playing ───
  useEffect(() => {
    if (phase !== "playing" || !match?.start_title) return;
    let cancelled = false;
    (async () => {
      try {
        const [sum, art] = await Promise.all([
          getSummary(match.start_title),
          getArticleHtml(match.start_title),
        ]);
        if (cancelled) return;
        setStartSummary(sum);
        setArticleHtml(art.html);
        setCurrentTitle(art.title);
      } catch (e) {
        toast.error("Couldn't load the start article.");
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [phase, match?.start_title]);

  // ─── Single ticker (1s — smooth enough, doesn't thrash header) ───
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // ─── Compute effective time-remaining (handles sudden death) ───
  const remainingMs = useMemo(() => {
    if (!match?.started_at) return DEFAULT_DURATION_MS;
    const startedAt = new Date(match.started_at).getTime();
    const baseEnd = startedAt + (match.duration_ms || DEFAULT_DURATION_MS);
    if (match.sudden_death_at) {
      const sdEnd = new Date(match.sudden_death_at).getTime() + (match.sudden_death_ms || SUDDEN_DEATH_MS);
      return Math.max(0, Math.min(baseEnd, sdEnd) - now);
    }
    return Math.max(0, baseEnd - now);
  }, [match, now]);

  // Auto-finish when timer hits zero (only the host calls finish to avoid races).
  useEffect(() => {
    if (phase !== "playing" || !matchId) return;
    if (remainingMs > 0) return;
    if (!isHost) return;
    void supabase.rpc("finish_coop_match", { p_match_id: matchId, p_player_id: playerId });
  }, [phase, remainingMs, matchId, isHost, playerId]);

  useBlockFind(phase === "playing");

  useEffect(() => {
    setRaceActive(phase === "playing");
    return () => setRaceActive(false);
  }, [phase]);

  // ─── Actions ───────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    setError(null);
    setPhase("creating");
    setPlayerName(name);
    try {
      const { start, wordList } = await buildRound();
      const { matchId: id } = await createCoopRoom({
        playerId, displayName: name || "Anonymous", start, wordList,
      });
      setMatchId(id);
      setPhase("room");
    } catch (e) {
      console.error(e);
      setError("Couldn't create a room. Try again.");
      setPhase("lobby");
    }
  }, [name, playerId]);

  const joinRoom = useCallback(async (code: string) => {
    setError(null);
    setPlayerName(name);
    try {
      const id = await joinCoopRoom({ playerId, displayName: name || "Anonymous", code });
      setMatchId(id);
      setPhase("room");
    } catch (e) {
      console.error(e);
      const msg = (e as { message?: string })?.message ?? "Couldn't join that room.";
      setError(msg);
    }
  }, [name, playerId]);

  const leave = useCallback(async () => {
    if (matchId) {
      try { await leaveCoopMatch(matchId, playerId); } catch (e) { console.error(e); }
    }
    setRaceActive(false);
    setMatchId(null);
    setMatch(null);
    setPlayers([]);
    setClaims([]);
    setStartSummary(null);
    setArticleHtml("");
    setCurrentTitle("");
    setChasing(null);
    setBusy(null);
    setPhase("lobby");
  }, [matchId, playerId]);

  // Host kicks off the round (after a 5s in-lobby countdown).
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (startCountdown === null) return;
    if (startCountdown <= 0) {
      setStartCountdown(null);
      if (matchId && isHost) {
        void startCoopMatch(matchId, playerId).catch((e) => {
          console.error(e);
          toast.error("Couldn't start the round.");
        });
      }
      return;
    }
    const id = window.setTimeout(() => setStartCountdown((c) => (c ?? 0) - 1), 1000);
    return () => window.clearTimeout(id);
  }, [startCountdown, isHost, matchId, playerId]);

  const beginStart = useCallback(() => {
    if (!isHost) return;
    if (activePlayers.length < 2) {
      toast.info("Wait for at least one more player.");
      return;
    }
    setStartCountdown(Math.ceil(START_COUNTDOWN_MS / 1000));
  }, [isHost, activePlayers.length]);

  // Player marks themselves "done" — triggers sudden death after 3.
  const markDone = useCallback(async () => {
    if (!matchId) return;
    setBusy("done");
    try { await markCoopDone(matchId, playerId); }
    catch (e) { console.error(e); }
    finally { setBusy(null); }
  }, [matchId, playerId]);

  // Per-player rejoin opt-in (set on results screen).
  const setOptIn = useCallback(async (yes: boolean) => {
    if (!matchId) return;
    try { await optInRematch(matchId, playerId, yes); } catch (e) { console.error(e); }
  }, [matchId, playerId]);

  // Host starts the next round (pulls in everyone who opted in).
  const playAgain = useCallback(async () => {
    if (!matchId || !isHost) return;
    setBusy("rematch");
    try {
      const { start, wordList } = await buildRound();
      await rematchCoopMatch({ matchId, playerId, start, wordList });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't start a new round.");
      setBusy(null);
    }
  }, [matchId, playerId, isHost]);

  // ─── In-game navigate ───
  const navigate = useCallback(async (title: string) => {
    if (!matchId || phase !== "playing") return;
    try {
      const art = await getArticleHtml(title);
      setArticleHtml(art.html);
      setCurrentTitle(art.title);

      const wordList = match?.word_list ?? [];
      const claimedKeys = new Set(claims.map((c) => normaliseTitle(c.word)));
      const hit = wordList.find(
        (w) => normaliseTitle(w) === normaliseTitle(art.title) && !claimedKeys.has(normaliseTitle(w))
      );

      if (hit) {
        const ok = await claimCoopWord({ matchId, playerId, word: hit });
        if (ok) {
          toast.success(`Found "${hit}"!`, { duration: 1800 });
          setChasing(null);
        }
      }

      void setCoopChasing({
        matchId, playerId, currentTitle: art.title, chasingWord: chasing,
      });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load that article.");
    }
  }, [matchId, phase, match?.word_list, claims, playerId, chasing]);

  const pickChasing = useCallback((word: string) => {
    setChasing(word);
    if (matchId) {
      void setCoopChasing({ matchId, playerId, currentTitle, chasingWord: word });
    }
  }, [matchId, playerId, currentTitle]);

  // ─── Render ───
  if (phase === "lobby" || phase === "creating") {
    return (
      <Lobby
        name={name} setName={setName}
        onCreate={createRoom} onJoin={joinRoom}
        loading={phase === "creating"} error={error}
      />
    );
  }

  if (phase === "room") {
    return (
      <RoomLobby
        match={match}
        players={activePlayers}
        meId={playerId}
        isHost={isHost}
        startCountdown={startCountdown}
        onStart={beginStart}
        onLeave={leave}
        presence={presence}
      />
    );
  }

  if (phase === "playing") {
    return (
      <PlayingScreen
        match={match}
        me={me}
        players={activePlayers}
        claims={claims}
        remainingMs={remainingMs}
        articleHtml={articleHtml}
        currentTitle={currentTitle}
        startSummary={startSummary}
        chasing={chasing}
        presence={presence}
        onNavigate={navigate}
        onPickChasing={pickChasing}
        onMarkDone={markDone}
        markingDone={busy === "done"}
        onLeave={leave}
      />
    );
  }

  return (
    <Results
      match={match}
      players={activePlayers}
      meId={playerId}
      claims={claims}
      isHost={isHost}
      busy={busy}
      onSetOptIn={setOptIn}
      onPlayAgain={playAgain}
      onLeave={leave}
      presence={presence}
    />
  );
};

// ────────────────────────────────────────────────────────────────────
// Lobby (entry: name + create/join)
// ────────────────────────────────────────────────────────────────────
const Lobby = ({
  name, setName, onCreate, onJoin, loading, error,
}: {
  name: string;
  setName: (n: string) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  loading: boolean;
  error: string | null;
}) => {
  const [code, setCode] = useState("");
  return (
    <main className="relative z-10 min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-6">
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>

        <div className="text-center mb-8">
          <Users className="w-8 h-8 mx-auto text-primary mb-3" />
          <div className="small-caps text-xs text-ink-soft mb-2">Vol. II · No. 1 · Co-op</div>
          <h1 className="serif text-4xl sm:text-5xl font-extrabold tracking-tight">
            Co-op <span className="italic text-primary">Time Attack</span>
          </h1>
          <p className="serif italic text-ink-soft mt-3 max-w-md mx-auto text-sm">
            Up to 10 readers in a room. Twelve targets. Find the most before the clock runs out.
          </p>
        </div>

        <div className="paper-card p-5 sm:p-6 mb-5">
          <label className="small-caps text-[10px] text-ink-faint">Your name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            className="mt-2"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="paper-card p-5 sm:p-6 text-center">
            <Lock className="w-6 h-6 mx-auto text-primary mb-3" />
            <div className="small-caps text-[10px] text-ink-faint mb-1">Host</div>
            <h3 className="serif text-lg font-bold mb-2">Open a lobby</h3>
            <p className="text-xs text-ink-soft mb-4">Get a code, share it, start when ready.</p>
            <Button onClick={onCreate} disabled={loading} className="w-full">
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</>
                : "Open lobby"}
            </Button>
          </div>

          <div className="paper-card p-5 sm:p-6 text-center">
            <Users className="w-6 h-6 mx-auto text-primary mb-3" />
            <div className="small-caps text-[10px] text-ink-faint mb-1">Join</div>
            <h3 className="serif text-lg font-bold mb-2">Enter a code</h3>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              className="mb-3 mono text-center tracking-[0.3em] uppercase"
              maxLength={6}
            />
            <Button
              variant="secondary"
              onClick={() => onJoin(code)}
              disabled={code.length !== 6}
              className="w-full"
            >
              Join lobby
            </Button>
          </div>
        </div>

        {error && (
          <div className="paper-card mt-5 p-3 text-center text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </main>
  );
};

// ────────────────────────────────────────────────────────────────────
// Room lobby — shows all current players, host can Start
// ────────────────────────────────────────────────────────────────────
const RoomLobby = ({
  match, players, meId, isHost, startCountdown, onStart, onLeave, presence,
}: {
  match: CoopMatchRow | null;
  players: CoopPlayerRow[];
  meId: string;
  isHost: boolean;
  startCountdown: number | null;
  onStart: () => void;
  onLeave: () => void;
  presence: Set<string>;
}) => {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const code = match?.room_code ?? "";
  const max = match?.max_players ?? 10;
  const totalWords = match?.word_list?.length ?? 0;
  const shareUrl = code
    ? `${window.location.origin}/coop?code=${encodeURIComponent(code)}`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch { /* noop */ }
  };

  const share = async () => {
    if (!shareUrl) return;
    const text = `Join my Co-op round on WikiRace — code ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "WikiRace Co-op", text, url: shareUrl });
        return;
      } catch { /* user cancelled */ }
    }
    void copyLink();
  };

  return (
    <main className="relative z-10 min-h-screen px-4 sm:px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-destructive mb-6"
        >
          <ArrowLeft className="w-3 h-3" /> Leave lobby
        </button>

        <div className="text-center mb-6">
          <div className="small-caps text-xs text-ink-soft mb-2">Co-op lobby</div>
          <h2 className="serif text-3xl font-extrabold mb-1">
            Round {match?.round_number ?? 1}
          </h2>
          <p className="text-sm text-ink-soft">
            {players.length} of {max} {players.length === 1 ? "reader" : "readers"} here
          </p>
        </div>

        <div className="paper-card p-4 mb-5 overflow-hidden">
          <div className="small-caps text-[10px] text-ink-faint mb-1">Room code · invite up to {max}</div>
          <button
            onClick={copy}
            className="group block w-full text-left hover:opacity-90 transition"
          >
            <div className="mono text-3xl sm:text-5xl font-extrabold tracking-[0.2em] sm:tracking-[0.4em] text-primary break-all">
              {code || "------"}
            </div>
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copy}
              disabled={!code}
              className="w-full"
            >
              {copied
                ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Copied</>
                : <><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy code</>}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={share}
              disabled={!shareUrl}
              className="w-full"
            >
              {linkCopied
                ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Link copied</>
                : <><Share2 className="w-3.5 h-3.5 mr-1.5" /> Share invite</>}
            </Button>
          </div>
          {shareUrl && (
            <button
              onClick={copyLink}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 small-caps text-[10px] text-ink-faint hover:text-primary truncate"
              title={shareUrl}
            >
              <Link2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{shareUrl.replace(/^https?:\/\//, "")}</span>
            </button>
          )}
        </div>

        <div className="paper-card p-5 mb-5">
          <div className="small-caps text-[10px] text-ink-faint mb-3">In the lobby</div>
          <PlayerList
            players={players}
            meId={meId}
            hostId={match?.host_player_id ?? null}
            presence={presence}
            totalWords={totalWords}
          />
        </div>

        {startCountdown !== null ? (
          <div className="paper-card p-6 text-center">
            <div className="small-caps text-[10px] text-ink-faint mb-2">Starting in</div>
            <div className="mono text-6xl font-extrabold ticker text-primary tabular-nums">
              {startCountdown}
            </div>
            <p className="text-[11px] text-ink-faint mt-2 serif italic">
              Late joiners can still drop in until zero.
            </p>
          </div>
        ) : isHost ? (
          <div className="space-y-3">
            <Button
              onClick={onStart}
              disabled={players.length < 2}
              className="w-full h-12 text-base"
            >
              <Play className="w-4 h-4 mr-2" />
              Start round
            </Button>
            <p className="text-[11px] text-ink-faint text-center serif italic">
              {players.length < 2
                ? "Waiting for one more player to join…"
                : "You can start whenever everyone's ready."}
            </p>
          </div>
        ) : (
          <div className="paper-card p-4 text-center text-sm text-ink-soft serif italic">
            <Loader2 className="w-4 h-4 inline mr-2 animate-spin text-primary" />
            Waiting for the host to start…
          </div>
        )}
      </div>
    </main>
  );
};

// ────────────────────────────────────────────────────────────────────
// Live player list (used in lobby + sidebar)
// ────────────────────────────────────────────────────────────────────
const PlayerList = ({
  players, meId, hostId, presence, ranked, totalWords,
}: {
  players: CoopPlayerRow[];
  meId: string;
  hostId: string | null;
  presence: Set<string>;
  ranked?: boolean;
  totalWords?: number;
}) => {
  const list = ranked
    ? [...players].sort((a, b) => b.score - a.score)
    : players;

  return (
    <ul className="space-y-1.5">
      {list.map((p, i) => {
        const isMe = p.player_id === meId;
        const isHost = p.player_id === hostId;
        const online = presence.has(p.player_id);
        const done = !!p.finished_at;
        const claims = p.claims ?? 0;
        const pct = totalWords && totalWords > 0
          ? Math.min(100, Math.round((claims / totalWords) * 100))
          : null;
        return (
          <li
            key={p.id}
            className={`px-2 py-1.5 rounded border ${
              done
                ? "border-success/40 bg-success/5"
                : isMe
                ? "border-primary/50 bg-primary/5"
                : "border-rule"
            }`}
          >
            <div className="flex items-center gap-2">
            {ranked && (
              <span className="mono text-[10px] w-4 text-ink-faint tabular-nums">
                {i + 1}
              </span>
            )}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                online ? "bg-primary" : "bg-ink-faint/40"
              }`}
              title={online ? "Online" : "Disconnected"}
            />
            {isHost && <Crown className="w-3 h-3 text-primary shrink-0" />}
            <span className="serif text-sm font-semibold truncate flex-1">
              {p.display_name}
              {isMe && <span className="ml-1 small-caps text-[9px] text-ink-faint">(you)</span>}
            </span>
            {totalWords ? (
              <span
                className={`mono text-[10px] tabular-nums shrink-0 ${
                  done ? "text-success" : "text-ink-soft"
                }`}
                title={`${claims} of ${totalWords} words found`}
              >
                {claims}/{totalWords}
              </span>
            ) : null}
            {done && (
              <span
                className="inline-flex items-center gap-1 small-caps text-[10px] font-bold text-success bg-success/15 border border-success/40 px-2 py-0.5 rounded-full shrink-0"
                title={totalWords ? `Finished with ${claims} of ${totalWords} words` : "Finished"}
              >
                <Flag className="w-3 h-3" />
                Done{totalWords ? ` · ${claims}/${totalWords}` : ""}
              </span>
            )}
            {ranked && (
              <span className="mono text-xs tabular-nums">
                {p.score.toLocaleString()}
              </span>
            )}
            </div>
            {pct !== null && !ranked && (
              <div className="mt-1 h-1 w-full bg-muted rounded overflow-hidden">
                <div
                  className={`h-full ${done ? "bg-success" : "bg-primary"} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ────────────────────────────────────────────────────────────────────
// Playing screen
// ────────────────────────────────────────────────────────────────────
const PlayingScreen = ({
  match, me, players, claims, remainingMs, articleHtml, currentTitle,
  startSummary, chasing, presence, onNavigate, onPickChasing, onMarkDone,
  markingDone, onLeave,
}: {
  match: CoopMatchRow | null;
  me: CoopPlayerRow | null;
  players: CoopPlayerRow[];
  claims: CoopClaimRow[];
  remainingMs: number;
  articleHtml: string;
  currentTitle: string;
  startSummary: WikiSummary | null;
  chasing: string | null;
  presence: Set<string>;
  onNavigate: (title: string) => void;
  onPickChasing: (word: string) => void;
  onMarkDone: () => void;
  markingDone: boolean;
  onLeave: () => void;
}) => {
  const wordList = match?.word_list ?? [];
  const claimedMap = new Map(claims.map((c) => [normaliseTitle(c.word), c]));
  const inSuddenDeath = !!match?.sudden_death_at;
  const lowTime = remainingMs <= 30_000;
  const playerNameById = useMemo(
    () => new Map(players.map((p) => [p.player_id, p.display_name])),
    [players]
  );
  const meDone = !!me?.finished_at;

  return (
    <main className="relative z-10 min-h-screen pb-12">
      {/* Sticky header: solid bg (no backdrop-blur) + fixed height to avoid scroll-jank */}
      <header className="sticky top-0 z-30 bg-background border-b border-rule">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-3 min-h-[44px]">
          <button
            onClick={onLeave}
            className="paper-card px-2 py-1 text-xs text-ink-soft hover:text-destructive inline-flex items-center gap-1 shrink-0"
          >
            <X className="w-3 h-3" /> Leave
          </button>

          <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
            <div
              className={`inline-flex items-center gap-1.5 mono text-base sm:text-xl font-bold ticker tabular-nums ${
                lowTime ? "text-destructive" : "text-primary"
              }`}
            >
              <Timer className="w-4 h-4" /> {fmtTime(remainingMs)}
              {inSuddenDeath && (
                <span className="ml-1 small-caps text-[9px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                  Sudden death
                </span>
              )}
            </div>
            <div className="hairline h-5 w-px hidden sm:block" />
            <div className="hidden sm:inline-flex items-center gap-1.5 mono text-base font-bold ticker tabular-nums">
              <Trophy className="w-4 h-4 text-primary" />
              {match?.team_score?.toLocaleString() ?? 0}
            </div>
            <div className="hairline h-5 w-px hidden sm:block" />
            <div className="small-caps text-[10px] text-ink-soft whitespace-nowrap">
              {claims.length}/{wordList.length}
            </div>
          </div>

          <Button
            size="sm"
            variant={meDone ? "secondary" : "outline"}
            disabled={meDone || markingDone}
            onClick={onMarkDone}
            className="shrink-0 h-8 px-2 sm:px-3"
            title="I'm done — let the others finish"
          >
            <Flag className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">{meDone ? "Done" : "Done"}</span>
          </Button>
        </div>

        {/* Word list strip */}
        <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {wordList.map((w) => {
              const claim = claimedMap.get(normaliseTitle(w));
              const claimed = !!claim;
              const byMe = claim?.claimed_by === me?.player_id;
              const claimerName = claim ? playerNameById.get(claim.claimed_by) : null;
              const isChasing = chasing && normaliseTitle(chasing) === normaliseTitle(w);
              const partnerHere = !claimed && players.some(
                (p) => p.player_id !== me?.player_id
                  && p.chasing_word
                  && normaliseTitle(p.chasing_word) === normaliseTitle(w)
              );
              return (
                <button
                  key={w}
                  onClick={() => !claimed && onPickChasing(w)}
                  disabled={claimed}
                  className={`relative text-xs px-2 py-1 rounded border transition ${
                    claimed
                      ? byMe
                        ? "bg-primary/20 border-primary/60 text-primary line-through"
                        : "bg-muted border-rule text-ink-soft line-through"
                      : isChasing
                      ? "bg-primary/10 border-primary text-primary font-semibold"
                      : "border-rule hover:border-primary text-ink"
                  }`}
                  title={
                    claimed
                      ? `Found by ${byMe ? "you" : claimerName ?? "someone"}`
                      : "Click to mark as your target"
                  }
                >
                  {claimed && <Check className="w-3 h-3 inline mr-1" />}
                  {w}
                  {partnerHere && (
                    <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-background" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-6 mt-4 grid lg:grid-cols-[1fr_280px] gap-4">
        <div className="paper-card p-4 sm:p-6">
          {articleHtml ? (
            <WikiArticle html={articleHtml} onNavigate={onNavigate} targetTitle={chasing ?? undefined} />
          ) : (
            <div className="flex items-center justify-center py-20 text-ink-soft">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="paper-card p-4">
            <div className="small-caps text-[10px] text-ink-faint mb-2 flex items-center justify-between">
              <span>Lobby ({players.length})</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {presence.size} online
              </span>
            </div>
            <PlayerList
              players={players}
              meId={me?.player_id ?? ""}
              hostId={match?.host_player_id ?? null}
              presence={presence}
              ranked
              totalWords={wordList.length}
            />
          </div>

          <div className="paper-card p-4">
            <div className="small-caps text-[10px] text-ink-faint mb-1">You're on</div>
            <div className="serif font-semibold text-sm truncate">{currentTitle || "—"}</div>
            {chasing && (
              <div className="mt-2 text-[11px] text-primary truncate">
                Chasing: <span className="font-semibold">{chasing}</span>
              </div>
            )}
          </div>

          {startSummary && (
            <div className="paper-card p-4">
              <div className="small-caps text-[10px] text-ink-faint mb-1">Started from</div>
              <div className="serif font-semibold text-sm">{startSummary.title}</div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
};

// ────────────────────────────────────────────────────────────────────
// Results: podium, ranked leaderboard, words breakdown, per-player rejoin
// ────────────────────────────────────────────────────────────────────
const Results = ({
  match, players, meId, claims, isHost, busy, onSetOptIn, onPlayAgain,
  onLeave, presence,
}: {
  match: CoopMatchRow | null;
  players: CoopPlayerRow[];
  meId: string;
  claims: CoopClaimRow[];
  isHost: boolean;
  busy: null | "start" | "rematch" | "done";
  onSetOptIn: (yes: boolean) => void;
  onPlayAgain: () => void;
  onLeave: () => void;
  presence: Set<string>;
}) => {
  const wordList = match?.word_list ?? [];
  const swept = claims.length === wordList.length && wordList.length > 0;
  const ranked = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players]
  );
  const podium = ranked.slice(0, 3);
  const me = players.find((p) => p.player_id === meId) ?? null;
  const optedInPlayers = ranked.filter((p) => p.rematch_opt_in || p.player_id === match?.host_player_id);
  const myOptIn = !!me?.rematch_opt_in || isHost;

  const claimsByPlayer = useMemo(() => {
    const m = new Map<string, CoopClaimRow[]>();
    for (const c of claims) {
      const arr = m.get(c.claimed_by) ?? [];
      arr.push(c); m.set(c.claimed_by, arr);
    }
    return m;
  }, [claims]);

  return (
    <main className="relative z-10 min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
          <div className="small-caps text-xs text-ink-soft mb-2">Round complete</div>
          <h1 className="serif text-4xl sm:text-5xl font-extrabold">
            {swept ? "Clean sweep!" : "Time's up"}
          </h1>
          {match?.round_number ? (
            <div className="small-caps text-[10px] text-ink-faint mt-2">
              Round {match.round_number}
            </div>
          ) : null}
          <p className="serif italic text-ink-soft mt-3">Team score</p>
          <div className="mono text-5xl font-extrabold ticker text-primary tabular-nums mt-1">
            {(match?.team_score ?? 0).toLocaleString()}
          </div>
          <p className="text-sm text-ink-soft mt-2">
            {claims.length} of {wordList.length} words found
          </p>
        </div>

        {/* Podium */}
        {podium.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[1, 0, 2].map((idx) => {
              const p = podium[idx];
              if (!p) return <div key={idx} />;
              const place = idx + 1;
              const heights = ["h-28", "h-36", "h-24"];
              const colors = ["text-amber-500", "text-zinc-400", "text-orange-700"];
              return (
                <div key={p.id} className="flex flex-col items-center justify-end">
                  <Trophy className={`w-6 h-6 mb-2 ${colors[idx]}`} />
                  <div className="serif font-bold text-sm truncate max-w-full">
                    {p.display_name}
                  </div>
                  <div className="mono text-base tabular-nums text-primary">
                    {p.score.toLocaleString()}
                  </div>
                  <div className={`paper-card w-full mt-2 flex items-center justify-center ${heights[idx]} bg-primary/5`}>
                    <div className="serif text-3xl font-extrabold text-primary">{place}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Full ranked list */}
        <div className="paper-card p-5 mb-5">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Leaderboard</div>
          <PlayerList
            players={ranked}
            meId={meId}
            hostId={match?.host_player_id ?? null}
            presence={presence}
            ranked
          />
        </div>

        {/* Per-player words breakdown */}
        <div className="paper-card p-5 mb-6">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Words found by player</div>
          <ul className="space-y-3">
            {ranked.map((p) => {
              const ws = claimsByPlayer.get(p.player_id) ?? [];
              return (
                <li key={p.id}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="serif font-semibold text-sm truncate">
                      {p.display_name}
                      {p.player_id === meId && (
                        <span className="ml-1 small-caps text-[9px] text-ink-faint">(you)</span>
                      )}
                    </span>
                    <span className="mono text-[11px] tabular-nums text-ink-faint">
                      {ws.length} {ws.length === 1 ? "word" : "words"}
                    </span>
                  </div>
                  {ws.length === 0 ? (
                    <div className="text-[11px] text-ink-faint serif italic">No words.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {ws.map((c) => (
                        <span
                          key={c.id}
                          className="text-[11px] px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary"
                        >
                          {c.word}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Per-player rejoin: opt in to next round + host start */}
        <div className="paper-card p-5 mb-6">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Next round</div>
          {!isHost && (
            <div className="flex items-center gap-3 mb-3">
              <Button
                size="sm"
                variant={myOptIn ? "default" : "outline"}
                onClick={() => onSetOptIn(!myOptIn)}
              >
                <Zap className="w-3 h-3 mr-1.5" />
                {myOptIn ? "Staying in" : "Stay for next round"}
              </Button>
              <span className="text-[11px] text-ink-soft">
                {optedInPlayers.length} {optedInPlayers.length === 1 ? "player" : "players"} ready
              </span>
            </div>
          )}

          {/* Always show who's staying so everyone can see the next lobby. */}
          <div className="text-[11px] text-ink-faint mb-2">Staying:</div>
          <PlayerList
            players={optedInPlayers}
            meId={meId}
            hostId={match?.host_player_id ?? null}
            presence={presence}
          />
        </div>

        <div className="flex gap-3 justify-center flex-wrap">
          {isHost ? (
            <Button
              onClick={onPlayAgain}
              disabled={busy === "rematch"}
              className="min-w-[180px]"
            >
              {busy === "rematch"
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting…</>
                : <>Play again ({optedInPlayers.length})</>}
            </Button>
          ) : (
            <div className="paper-card px-4 py-3 inline-flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Waiting for the host to start…
            </div>
          )}
          <Button onClick={onLeave} variant="outline" className="min-w-[140px]">
            Leave room
          </Button>
        </div>
      </div>
    </main>
  );
};

export default Coop;