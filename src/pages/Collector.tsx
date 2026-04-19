import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WikiArticle } from "@/components/WikiArticle";
import { scorePop } from "@/components/ScorePop";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  Loader2,
  RotateCcw,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import {
  getArticleHtml,
  getRandomTitle,
  normaliseTitle,
} from "@/lib/wiki";
import { submitScore } from "@/lib/onlineScores";
import { useAuth } from "@/lib/auth";
import { recordRun } from "@/lib/achievements";
import { celebrateBadges } from "@/lib/achievementToast";
import { toast } from "sonner";
import { useScrolled } from "@/hooks/use-scrolled";
import { useBlockFind } from "@/hooks/use-block-find";

type Phase = "idle" | "loading" | "playing" | "done";

const ROUND_MS = 120_000; // 2 minutes
const ACTIVE_TARGETS = 5;
const BASE_POINTS = 100;
const HOP_BONUS = (hops: number) => Math.max(0, 50 - hops * 8);

const formatTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const Collector = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startTitle, setStartTitle] = useState<string>("");
  const [articleHtml, setArticleHtml] = useState<string>("");
  const [currentTitle, setCurrentTitle] = useState<string>("");
  const [targets, setTargets] = useState<string[]>([]);
  const [reached, setReached] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [hopsThisLeg, setHopsThisLeg] = useState(0);
  const [remaining, setRemaining] = useState(ROUND_MS);
  const startedAt = useRef<number>(0);
  const submittedRef = useRef(false);

  const { user } = useAuth();
  const compact = useScrolled(40);
  useBlockFind(phase === "playing");

  // Tick + auto-end
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      const left = ROUND_MS - (Date.now() - startedAt.current);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        finish();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setPhase("done");

    // Achievements: a finished round counts as a "win".
    const earned = recordRun({
      mode: "collector",
      won: reached.length > 0,
      clicks,
      timeMs: ROUND_MS,
      hintsUsed: 0,
      undos: 0,
    });
    if (earned.length) celebrateBadges(earned);

    if (user) {
      const res = await submitScore({
        mode: "collector",
        score,
        clicks,
        timeMs: ROUND_MS,
        details: { reached: reached.length },
      });
      if (res.ok) toast.success("Score submitted to the global board.");
    }
  }, [user, score, clicks, reached.length]);

  const start = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setReached([]);
    setScore(0);
    setClicks(0);
    setHopsThisLeg(0);
    setRemaining(ROUND_MS);
    submittedRef.current = false;
    try {
      // Pick a starting page + 5 random targets, all distinct.
      const all = await Promise.all(
        Array.from({ length: ACTIVE_TARGETS + 1 }, () => getRandomTitle())
      );
      const distinct: string[] = [];
      for (const t of all) {
        if (!distinct.some((d) => normaliseTitle(d) === normaliseTitle(t))) {
          distinct.push(t);
        }
      }
      while (distinct.length < ACTIVE_TARGETS + 1) {
        distinct.push(await getRandomTitle());
      }
      const [s, ...ts] = distinct;
      const art = await getArticleHtml(s);
      setStartTitle(art.title);
      setCurrentTitle(art.title);
      setArticleHtml(art.html);
      setTargets(ts.slice(0, ACTIVE_TARGETS));
      startedAt.current = Date.now();
      setPhase("playing");
    } catch (e) {
      console.error(e);
      setError("Couldn't reach Wikipedia. Try again.");
      setPhase("idle");
    }
  }, []);

  const navigate = useCallback(
    async (title: string, evt?: { x: number; y: number }) => {
      if (phase !== "playing") return;
      setClicks((c) => c + 1);
      setHopsThisLeg((h) => h + 1);
      try {
        const art = await getArticleHtml(title);
        setCurrentTitle(art.title);
        setArticleHtml(art.html);

        const idx = targets.findIndex(
          (t) => normaliseTitle(t) === normaliseTitle(art.title)
        );
        if (idx !== -1) {
          // Hit a target!
          const bonus = HOP_BONUS(hopsThisLeg + 1);
          const gained = BASE_POINTS + bonus;
          setScore((s) => s + gained);
          setReached((r) => [...r, targets[idx]]);
          setHopsThisLeg(0);
          // Replace with a fresh target.
          const fresh = await getRandomTitle();
          setTargets((curr) => {
            const next = [...curr];
            next[idx] = fresh;
            return next;
          });
          scorePop(`+${gained}`, evt?.x, evt?.y);
        }
      } catch (e) {
        console.error(e);
      }
    },
    [phase, targets, hopsThisLeg]
  );

  // Handle wiki link clicks: capture click coords for the popup.
  const onArticleNavigate = useCallback(
    (title: string) => {
      // We don't get the event here — popup will use last known mouse position.
      navigate(title, lastMouse.current);
    },
    [navigate]
  );

  const lastMouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);

  const targetIsHit = useMemo(
    () => (t: string) => normaliseTitle(t) === normaliseTitle(currentTitle),
    [currentTitle]
  );
  const targetTitlesForHighlight = useMemo(
    () => targets.join("|"),
    [targets]
  );

  // ─────────────────────────── UI ───────────────────────────

  if (phase === "idle" || phase === "loading") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-8"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </Link>
          <div className="small-caps text-xs text-ink-soft mb-4">
            Vol. I · No. 4 · A two-minute affair
          </div>
          <h1 className="serif text-6xl font-extrabold tracking-tight mb-4">
            Link <span className="italic text-primary">Collector</span>
          </h1>
          <p className="serif italic text-lg text-muted-foreground mb-2">
            Two minutes. Five targets at a time. Reach as many as you can.
          </p>
          <div className="hairline my-8 mx-auto w-24" />

          <div className="grid grid-cols-3 gap-4 text-left mb-8">
            <RuleCard
              icon={<Clock className="w-4 h-4" />}
              title="120 sec"
              desc="The clock ticks the moment you start."
            />
            <RuleCard
              icon={<Target className="w-4 h-4" />}
              title="5 active"
              desc="A new random target appears every time you hit one."
            />
            <RuleCard
              icon={<Zap className="w-4 h-4" />}
              title="+100/hit"
              desc="Plus a bonus for fewer hops."
            />
          </div>

          {error && <p className="text-destructive text-sm mb-4">{error}</p>}

          {!user && (
            <p className="text-[11px] text-ink-faint mb-3">
              <Link to="/auth" className="underline">Sign in</Link> to save your score
              to the global board.
            </p>
          )}

          <Button
            size="lg"
            onClick={start}
            disabled={phase === "loading"}
            className="px-10 py-6 text-base"
          >
            {phase === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting the press…
              </>
            ) : (
              <>
                Begin <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "done") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full">
          <div className="paper-card p-10 text-center">
            <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
            <div className="small-caps text-xs text-ink-soft mb-2">Time's up</div>
            <h2 className="serif text-4xl font-extrabold mb-6">
              {reached.length} {reached.length === 1 ? "target" : "targets"} collected.
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-8">
              <Stat label="Score" value={score.toLocaleString()} accent />
              <Stat label="Targets" value={String(reached.length)} />
              <Stat label="Clicks" value={String(clicks)} />
            </div>

            {!user && (
              <p className="text-sm text-ink-soft mb-6">
                <Link to="/auth" className="underline text-primary">Sign in</Link>{" "}
                to save scores to the global board.
              </p>
            )}

            <div className="flex justify-center gap-3">
              <Button onClick={start}>
                <RotateCcw className="w-4 h-4 mr-2" /> Play again
              </Button>
              <Link to="/leaderboard">
                <Button variant="outline">View leaderboard</Button>
              </Link>
              <Link to="/">
                <Button variant="ghost">Home</Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // playing
  const lowTime = remaining < 20_000;
  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-rule bg-card/95 backdrop-blur-md shadow-sm transition-all duration-200">
        <div className={`max-w-6xl mx-auto px-6 flex items-center justify-between gap-6 transition-all duration-200 ${compact ? "py-1.5" : "py-3"}`}>
          <Link to="/" className={`serif font-extrabold transition-all ${compact ? "text-base" : "text-2xl"}`}>
            Wiki<span className="italic text-primary">Race</span>
          </Link>
          <div className="flex items-center gap-5 ticker">
            <Metric label="Score" value={score.toLocaleString()} accent />
            <Metric
              label="Time"
              value={formatTime(remaining)}
              accent={lowTime}
            />
            <Metric label="Hits" value={String(reached.length)} />
            <Button variant="outline" size="sm" onClick={finish}>
              End
            </Button>
          </div>
        </div>

        {/* Targets list — collapses to a single line when scrolled */}
        <div className="max-w-6xl mx-auto px-6 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-primary" />
            <span className="small-caps text-[10px] text-ink-faint">
              {compact ? `Targets · ${reached.length}/${targets.length}` : `Active targets (${reached.length} collected)`}
            </span>
          </div>
          {!compact && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {targets.map((t, i) => {
                const hit = targetIsHit(t);
                return (
                  <div
                    key={`${t}-${i}`}
                    className={`paper-card px-3 py-2 text-sm truncate transition-all ${
                      hit ? "ring-2 ring-primary text-primary font-semibold" : ""
                    }`}
                    title={t}
                  >
                    {hit && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                    {t}
                  </div>
                );
              })}
            </div>
          )}
          {compact && (
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t, i) => {
                const hit = targetIsHit(t);
                return (
                  <span
                    key={`${t}-${i}`}
                    className={`text-[11px] px-1.5 py-0.5 rounded border truncate max-w-[140px] ${
                      hit ? "bg-primary/15 text-primary border-primary/30 font-semibold" : "border-rule text-ink-soft"
                    }`}
                    title={t}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {!compact && (
          <div className="max-w-6xl mx-auto px-6 pb-3 small-caps text-[10px] text-ink-faint">
            Started from <span className="text-ink-soft">{startTitle}</span> ·
            on <span className="text-ink-soft">{currentTitle}</span> ·
            hops since last hit: {hopsThisLeg}
          </div>
        )}
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-4 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-8 pt-5 pb-3 border-b border-rule flex items-baseline justify-between gap-3">
            <h1 className="serif text-3xl font-extrabold truncate">{currentTitle}</h1>
            <span className="mono text-xs text-ink-faint">click {clicks}</span>
          </div>
          <div className="flex-1 min-h-0">
            <WikiArticle
              key={currentTitle}
              html={articleHtml}
              targetTitle={targetTitlesForHighlight /* not used as single but ok */}
              onNavigate={onArticleNavigate}
            />
          </div>
        </article>
      </div>
    </main>
  );
};

const Metric = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div className="text-right">
    <div className="small-caps text-[9px] text-ink-faint leading-none">{label}</div>
    <div
      className={`mono text-sm font-semibold leading-tight ${
        accent ? "text-primary" : "text-ink"
      }`}
    >
      {value}
    </div>
  </div>
);

const Stat = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div className="paper-card p-4">
    <div className="small-caps text-[10px] text-ink-faint mb-1">{label}</div>
    <div
      className={`serif text-2xl font-extrabold ticker ${
        accent ? "text-primary" : ""
      }`}
    >
      {value}
    </div>
  </div>
);

const RuleCard = ({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <div className="paper-card p-4">
    <div className="flex items-center gap-2 mb-2 text-primary">{icon}</div>
    <div className="serif font-bold mb-1">{title}</div>
    <div className="text-xs text-ink-soft leading-relaxed">{desc}</div>
  </div>
);

export default Collector;
