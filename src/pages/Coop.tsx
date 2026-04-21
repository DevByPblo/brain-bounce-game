import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Bot, Check, Copy, Loader2, Lock, Target, Timer, Trophy, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WikiArticle } from "@/components/WikiArticle";
import {
  getArticleHtml, getRandomTitle, normaliseTitle, type WikiSummary, getSummary,
} from "@/lib/wiki";
import { getPlayerId, getPlayerName, setPlayerName } from "@/lib/player";
import {
  cancelCoopMatch, claimCoopWord, createCoopRoom, fetchCoopClaims, fetchCoopMatch,
  fetchCoopPlayers, finishCoopMatch, joinCoopRoom, setCoopChasing, subscribeCoop,
  type CoopClaimRow, type CoopMatchRow, type CoopPlayerRow,
} from "@/lib/coop";
import { toast } from "sonner";
import { setRaceActive } from "@/hooks/use-race-active";
import { useBlockFind } from "@/hooks/use-block-find";
import { Countdown } from "@/components/Countdown";
import { useScrolled } from "@/hooks/use-scrolled";

type Phase = "lobby" | "creating" | "room" | "countdown" | "playing" | "finished";

const WORD_COUNT = 12;
const DURATION_MS = 5 * 60 * 1000;

const formatTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
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

  const [startSummary, setStartSummary] = useState<WikiSummary | null>(null);
  const [articleHtml, setArticleHtml] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [chasing, setChasing] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number>(0);

  const me = players.find((p) => p.player_id === playerId) ?? null;
  const partner = players.find((p) => p.player_id !== playerId) ?? null;

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

  // ─── Move from room → countdown when both players join (or solo after timer) ───
  useEffect(() => {
    if (phase !== "room") return;
    if (match?.status === "playing" && players.length >= 2) {
      setPhase("countdown");
    }
  }, [phase, match?.status, players.length]);

  // ─── Load start article when entering countdown ───
  useEffect(() => {
    if (phase !== "countdown" || !match?.start_title) return;
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

  // ─── Countdown → playing ───
  const handleCountdownDone = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("playing");
    setRaceActive(true);
  }, []);

  // ─── Timer ───
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const e = Date.now() - startedAtRef.current;
      setElapsed(e);
      if (e >= DURATION_MS) {
        window.clearInterval(id);
        setPhase("finished");
        setRaceActive(false);
        if (matchId) void finishCoopMatch(matchId, playerId);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, matchId, playerId]);

  // ─── Finished detection from match status ───
  useEffect(() => {
    if (match?.status === "finished" && phase === "playing") {
      setPhase("finished");
      setRaceActive(false);
    }
  }, [match?.status, phase]);

  useBlockFind(phase === "playing");

  // ─── Start coop room ───
  const startRoom = useCallback(async () => {
    setError(null);
    setPhase("creating");
    setPlayerName(name);
    try {
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

  // ─── Join coop room by code ───
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

  // ─── Leave / cancel ───
  const leave = useCallback(() => {
    if (matchId) void cancelCoopMatch(matchId, playerId);
    setRaceActive(false);
    setMatchId(null);
    setMatch(null);
    setPlayers([]);
    setClaims([]);
    setStartSummary(null);
    setArticleHtml("");
    setCurrentTitle("");
    setChasing(null);
    setPhase("lobby");
  }, [matchId, playerId]);

  // ─── Navigate links inside article ───
  const navigate = useCallback(async (title: string) => {
    if (!matchId || phase !== "playing") return;
    try {
      const art = await getArticleHtml(title);
      setArticleHtml(art.html);
      setCurrentTitle(art.title);

      // Did this match a target word? Check all unclaimed words.
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
        name={name}
        setName={setName}
        onCreate={startRoom}
        onJoin={joinRoom}
        loading={phase === "creating"}
        error={error}
      />
    );
  }

  if (phase === "room") {
    return (
      <RoomWaiting
        code={match?.room_code ?? ""}
        onCancel={leave}
      />
    );
  }

  if (phase === "countdown") {
    return <Countdown onComplete={handleCountdownDone} targetTitle="Find any word from the list" />;
  }

  if (phase === "playing") {
    return (
      <PlayingScreen
        match={match}
        me={me}
        partner={partner}
        claims={claims}
        elapsed={elapsed}
        articleHtml={articleHtml}
        currentTitle={currentTitle}
        startSummary={startSummary}
        chasing={chasing}
        onNavigate={navigate}
        onPickChasing={pickChasing}
        onLeave={leave}
      />
    );
  }

  return (
    <Results
      match={match}
      me={me}
      partner={partner}
      claims={claims}
      onLeave={leave}
    />
  );
};

// ────────────────────────────────────────────────────────────────────
// Lobby
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
            Two players, five minutes, twelve targets. Either of you can claim any word —
            split up or double down.
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
            <h3 className="serif text-lg font-bold mb-2">Create a room</h3>
            <p className="text-xs text-ink-soft mb-4">Get a code to share with your partner.</p>
            <Button onClick={onCreate} disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</> : "Create room"}
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
              Join room
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
// Room waiting
// ────────────────────────────────────────────────────────────────────
const RoomWaiting = ({ code, onCancel }: { code: string; onCancel: () => void }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 py-16">
      <div className="max-w-md w-full text-center paper-card p-6 sm:p-10">
        <Lock className="w-7 h-7 mx-auto text-primary mb-4" />
        <div className="small-caps text-xs text-ink-soft mb-2">Co-op room</div>
        <h2 className="serif text-3xl font-extrabold mb-2">Share your code</h2>
        <p className="text-sm text-ink-soft mb-6">
          Send this to your partner. They join from the Co-op page.
        </p>
        <button
          onClick={copy}
          className="group block w-full paper-card p-4 sm:p-6 mb-5 hover:border-primary transition overflow-hidden"
        >
          <div className="mono text-3xl sm:text-5xl font-extrabold tracking-[0.2em] sm:tracking-[0.4em] text-primary break-all">
            {code || "------"}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 small-caps text-[10px] text-ink-faint group-hover:text-primary">
            {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Click to copy</>}
          </div>
        </button>
        <Button variant="outline" onClick={onCancel}>Close room</Button>
        <p className="text-[11px] text-ink-faint mt-6">Waiting for your partner…</p>
      </div>
    </main>
  );
};

// ────────────────────────────────────────────────────────────────────
// Playing screen
// ────────────────────────────────────────────────────────────────────
const PlayingScreen = ({
  match, me, partner, claims, elapsed, articleHtml, currentTitle, startSummary,
  chasing, onNavigate, onPickChasing, onLeave,
}: {
  match: CoopMatchRow | null;
  me: CoopPlayerRow | null;
  partner: CoopPlayerRow | null;
  claims: CoopClaimRow[];
  elapsed: number;
  articleHtml: string;
  currentTitle: string;
  startSummary: WikiSummary | null;
  chasing: string | null;
  onNavigate: (title: string) => void;
  onPickChasing: (word: string) => void;
  onLeave: () => void;
}) => {
  const compact = useScrolled();
  const wordList = match?.word_list ?? [];
  const remaining = Math.max(0, DURATION_MS - elapsed);
  const claimedMap = new Map(claims.map((c) => [normaliseTitle(c.word), c]));
  const partnerChasing = partner?.chasing_word ?? null;

  return (
    <main className="relative z-10 min-h-screen pb-12">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-rule">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 sm:py-3 flex items-center gap-3">
          <button
            onClick={onLeave}
            className="paper-card px-2 py-1 text-xs text-ink-soft hover:text-destructive inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Leave
          </button>

          <div className={`flex-1 flex items-center gap-3 ${compact ? "justify-center" : "justify-center"}`}>
            <div className="inline-flex items-center gap-1.5 mono text-base sm:text-xl font-bold ticker text-primary tabular-nums">
              <Timer className="w-4 h-4" /> {formatTime(remaining)}
            </div>
            <div className="hairline h-5 w-px" />
            <div className="inline-flex items-center gap-1.5 mono text-base sm:text-xl font-bold ticker tabular-nums">
              <Trophy className="w-4 h-4 text-primary" /> {match?.team_score?.toLocaleString() ?? 0}
            </div>
            <div className="hairline h-5 w-px" />
            <div className="small-caps text-[10px] text-ink-soft">
              {claims.length}/{wordList.length} found
            </div>
          </div>
        </div>

        {/* Word list strip */}
        <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-2 sm:pb-3">
          <div className="flex flex-wrap gap-1.5">
            {wordList.map((w) => {
              const claim = claimedMap.get(normaliseTitle(w));
              const claimed = !!claim;
              const byMe = claim?.claimed_by === me?.player_id;
              const isChasing = chasing && normaliseTitle(chasing) === normaliseTitle(w);
              const partnerHere = partnerChasing && normaliseTitle(partnerChasing) === normaliseTitle(w) && !claimed;
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
                  title={claimed ? `Found by ${byMe ? "you" : partner?.display_name ?? "partner"}` : "Click to mark as your target"}
                >
                  {claimed && <Check className="w-3 h-3 inline mr-1" />}
                  {w}
                  {partnerHere && (
                    <span
                      className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-background"
                      title={`${partner?.display_name ?? "Partner"} is chasing this`}
                    />
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
            <div className="small-caps text-[10px] text-ink-faint mb-2">You</div>
            <div className="serif font-bold truncate">{me?.display_name ?? "You"}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Found" value={String(me?.claims ?? 0)} />
              <Stat label="Score" value={(me?.score ?? 0).toLocaleString()} />
            </div>
            <div className="mt-2 text-[11px] text-ink-soft truncate">
              On: <span className="text-ink">{currentTitle || "—"}</span>
            </div>
            {chasing && (
              <div className="mt-1 text-[11px] text-primary truncate">
                Chasing: <span className="font-semibold">{chasing}</span>
              </div>
            )}
          </div>

          <div className="paper-card p-4">
            <div className="small-caps text-[10px] text-ink-faint mb-2">Partner</div>
            {partner ? (
              <>
                <div className="serif font-bold truncate">{partner.display_name}</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat label="Found" value={String(partner.claims)} />
                  <Stat label="Score" value={partner.score.toLocaleString()} />
                </div>
                <div className="mt-2 text-[11px] text-ink-soft truncate">
                  On: <span className="text-ink">{partner.current_title || "—"}</span>
                </div>
                {partner.chasing_word && (
                  <div className="mt-1 text-[11px] text-accent truncate">
                    Chasing: <span className="font-semibold">{partner.chasing_word}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-ink-soft serif italic">Waiting…</div>
            )}
          </div>

          {startSummary && (
            <div className="paper-card p-4">
              <div className="small-caps text-[10px] text-ink-faint mb-1">Start</div>
              <div className="serif font-semibold text-sm">{startSummary.title}</div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="small-caps text-[9px] text-ink-faint">{label}</div>
    <div className="mono font-bold ticker tabular-nums text-base">{value}</div>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Results
// ────────────────────────────────────────────────────────────────────
const Results = ({
  match, me, partner, claims, onLeave,
}: {
  match: CoopMatchRow | null;
  me: CoopPlayerRow | null;
  partner: CoopPlayerRow | null;
  claims: CoopClaimRow[];
  onLeave: () => void;
}) => {
  const navigate = useNavigate();
  const wordList = match?.word_list ?? [];
  const swept = claims.length === wordList.length && wordList.length > 0;

  return (
    <main className="relative z-10 min-h-screen px-4 sm:px-6 py-10 sm:py-14">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
          <div className="small-caps text-xs text-ink-soft mb-2">Time's up</div>
          <h1 className="serif text-4xl sm:text-5xl font-extrabold">
            {swept ? "Clean sweep!" : "Round complete"}
          </h1>
          <p className="serif italic text-ink-soft mt-3">
            Team score
          </p>
          <div className="mono text-5xl font-extrabold ticker text-primary tabular-nums mt-1">
            {(match?.team_score ?? 0).toLocaleString()}
          </div>
          <p className="text-sm text-ink-soft mt-2">
            {claims.length} of {wordList.length} words found
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div className="paper-card p-5">
            <div className="small-caps text-[10px] text-ink-faint mb-1">You</div>
            <div className="serif font-bold text-lg truncate">{me?.display_name ?? "You"}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Found" value={String(me?.claims ?? 0)} />
              <Stat label="Score" value={(me?.score ?? 0).toLocaleString()} />
            </div>
          </div>
          <div className="paper-card p-5">
            <div className="small-caps text-[10px] text-ink-faint mb-1">Partner</div>
            <div className="serif font-bold text-lg truncate">{partner?.display_name ?? "—"}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Found" value={String(partner?.claims ?? 0)} />
              <Stat label="Score" value={(partner?.score ?? 0).toLocaleString()} />
            </div>
          </div>
        </div>

        <div className="paper-card p-5 mb-6">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Word list</div>
          <div className="flex flex-wrap gap-1.5">
            {wordList.map((w) => {
              const claim = claims.find((c) => normaliseTitle(c.word) === normaliseTitle(w));
              const byMe = claim?.claimed_by === me?.player_id;
              return (
                <span
                  key={w}
                  className={`text-xs px-2 py-1 rounded border ${
                    claim
                      ? byMe
                        ? "bg-primary/20 border-primary/60 text-primary"
                        : "bg-accent/20 border-accent/60 text-accent"
                      : "border-rule text-ink-faint line-through opacity-60"
                  }`}
                >
                  {claim && <Check className="w-3 h-3 inline mr-1" />}{w}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 justify-center flex-wrap">
          <Button onClick={() => navigate("/coop")} className="min-w-[140px]" variant="secondary">
            New room
          </Button>
          <Button onClick={onLeave} variant="outline" className="min-w-[140px]">
            Back to lobby
          </Button>
        </div>
      </div>
    </main>
  );
};

export default Coop;