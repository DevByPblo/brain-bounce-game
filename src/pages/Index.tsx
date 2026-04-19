import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WikiArticle } from "@/components/WikiArticle";
import {
  getArticleHtml,
  getDailyPair,
  getRandomTitle,
  getSummary,
  getTitleForDifficulty,
  normaliseTitle,
  resolveTitleFromQuery,
  type WikiSummary,
} from "@/lib/wiki";
import { CATEGORIES, OTHER_CATEGORIES, POPULAR_CATEGORIES, getTitleForCategory } from "@/lib/categories";
import { recordCategoryUse } from "@/lib/categoryStats";
import { useFavoriteCategories } from "@/hooks/use-favorite-categories";
import {
  addEntry,
  getLeaderboardView,
  type Difficulty,
  type GameMode,
  type LeaderboardEntry,
} from "@/lib/leaderboard";
import { ensureSession } from "@/lib/guestAuth";
import { submitScore } from "@/lib/onlineScores";
import { toast } from "sonner";
import {
  ArrowRight,
  RotateCcw,
  Trophy,
  Loader2,
  Target,
  Flag,
  Undo2,
  Calendar,
  Shuffle,
  Medal,
  Clock,
  MousePointerClick,
  Swords,
  Pencil,
  Share2,
  Check,
  Lightbulb,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
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
import { HintCard, HINT_COSTS } from "@/components/HintCard";
import { recordRun } from "@/lib/achievements";
import { celebrateBadges } from "@/lib/achievementToast";
import { useScrolled } from "@/hooks/use-scrolled";
import { useBlockFind } from "@/hooks/use-block-find";
import { Countdown } from "@/components/Countdown";

type Phase = "idle" | "loading" | "countdown" | "playing" | "won";

const UNDO_PENALTY = 200; // score points per undo step

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const computeScore = (
  clicks: number,
  ms: number,
  undos: number,
  difficulty: Difficulty,
  hintCost = 0
) => {
  const base = 10000;
  const clickPenalty = clicks * 350;
  const timePenalty = Math.floor(ms / 1000) * 8;
  const undoPenalty = undos * UNDO_PENALTY;
  const diffMultiplier =
    difficulty === "hard" ? 1.5 : difficulty === "easy" ? 0.85 : 1;
  return Math.max(
    50,
    Math.round((base - clickPenalty - timePenalty - undoPenalty) * diffMultiplier) - hintCost
  );
};

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<GameMode>("random");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [category, setCategory] = useState<string>("");
  const [customTarget, setCustomTarget] = useState<string>("");
  const [start, setStart] = useState<WikiSummary | null>(null);
  const [target, setTarget] = useState<WikiSummary | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>("");
  const [articleHtml, setArticleHtml] = useState<string>("");
  // Path entries hold the title AND the html so we can jump back without refetching.
  const [path, setPath] = useState<{ title: string; html: string }[]>([]);
  const [clicks, setClicks] = useState(0);
  const [undos, setUndos] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<number>(0);
  const autoStartedRef = useRef(false);
  const compact = useScrolled(40);
  useBlockFind(phase === "playing");

  const hintCost = useMemo(
    () => HINT_COSTS.slice(0, hintsUsed).reduce((a, b) => a + b, 0),
    [hintsUsed]
  );

  // Timer
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Track race-active state globally so chrome (e.g. AuthMenu) can hide.
  useEffect(() => {
    setRaceActive(phase === "playing" || phase === "countdown");
    return () => setRaceActive(false);
  }, [phase]);

  const score = useMemo(
    () => computeScore(clicks, elapsed, undos, difficulty, hintCost),
    [clicks, elapsed, undos, difficulty, hintCost]
  );

  const newGame = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setPath([]);
    setClicks(0);
    setUndos(0);
    setElapsed(0);
    setHintsUsed(0);
    setArticleHtml("");
    try {
      let s: string;
      let t: string;
      if (mode === "daily") {
        const pair = await getDailyPair();
        s = pair.start;
        t = pair.target;
      } else if (mode === "custom") {
        // Resolve user-entered word to a real article, then pick a random start.
        t = await resolveTitleFromQuery(customTarget);
        s = await getRandomTitle();
        let guard = 0;
        while (normaliseTitle(s) === normaliseTitle(t) && guard++ < 4) {
          s = await getRandomTitle();
        }
      } else {
        s = await getRandomTitle();
        const pickTarget = () =>
          category ? getTitleForCategory(category, difficulty) : getTitleForDifficulty(difficulty);
        t = await pickTarget();
        let guard = 0;
        while (normaliseTitle(s) === normaliseTitle(t) && guard++ < 4) {
          t = await pickTarget();
        }
        if (category) recordCategoryUse(category);
      }
      const [sSum, tSum, art] = await Promise.all([
        getSummary(s),
        getSummary(t),
        getArticleHtml(s),
      ]);
      setStart(sSum);
      setTarget(tSum);
      setCurrentTitle(art.title);
      setArticleHtml(art.html);
      setPath([{ title: art.title, html: art.html }]);
      // Show countdown overlay; the timer starts when it completes.
      setPhase("countdown");
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Couldn't reach Wikipedia. Try again.";
      setError(msg);
      setPhase("idle");
    }
  }, [mode, difficulty, category, customTarget]);

  // ─── Auto-start from a shared URL: /?target=Octopus ───
  useEffect(() => {
    if (autoStartedRef.current) return;
    const t = searchParams.get("target");
    if (!t) return;
    autoStartedRef.current = true;
    setMode("custom");
    setCustomTarget(t);
    // Clear the param so refresh doesn't re-trigger.
    setSearchParams({}, { replace: true });
    // Defer to next tick so state settles before newGame reads it.
    setTimeout(() => {
      void newGame();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const finishGame = useCallback(
    (
      finalClicks: number,
      finalElapsed: number,
      finalUndos: number,
      finalPath: { title: string; html: string }[]
    ) => {
      const finalScore = computeScore(
        finalClicks,
        finalElapsed,
        finalUndos,
        difficulty,
        hintCost
      );
      if (start && target) {
        addEntry({
          start: start.title,
          target: target.title,
          clicks: finalClicks,
          timeMs: finalElapsed,
          score: finalScore,
          mode,
          difficulty,
        });

        // Auto-submit to the global online leaderboard for daily + custom races.
        // Anonymous users get an auto-created session so they still appear on the board.
        if (mode === "daily" || mode === "custom") {
          (async () => {
            const uid = await ensureSession();
            if (!uid) return;
            const res = await submitScore({
              mode: "race",
              score: finalScore,
              clicks: finalClicks,
              timeMs: finalElapsed,
              details: {
                start: start.title,
                target: target.title,
                gameMode: mode,
                difficulty,
              },
            });
            if (res.ok) {
              toast.success("Score submitted to the global leaderboard!");
            }
          })();
        }
      }

      // Local achievements: record run + toast any newly unlocked badges.
      const earned = recordRun({
        mode:
          mode === "daily" ? "race-daily" :
          mode === "custom" ? "race-custom" : "race-random",
        won: true,
        clicks: finalClicks,
        timeMs: finalElapsed,
        hintsUsed,
        undos: finalUndos,
        category: mode === "random" && category ? category : undefined,
      });
      if (earned.length) celebrateBadges(earned);

      setElapsed(finalElapsed);
      setPath(finalPath);
      setPhase("won");
    },
    [difficulty, mode, start, target, hintCost, hintsUsed, category]
  );

  const navigate = useCallback(
    async (title: string) => {
      if (!target) return;
      setClicks((c) => c + 1);
      try {
        const art = await getArticleHtml(title);
        const newPath = [...path, { title: art.title, html: art.html }];
        setCurrentTitle(art.title);
        setArticleHtml(art.html);
        setPath(newPath);
        if (normaliseTitle(art.title) === normaliseTitle(target.title)) {
          finishGame(clicks + 1, Date.now() - startRef.current, undos, newPath);
        }
      } catch (e) {
        console.error(e);
      }
    },
    [target, path, clicks, undos, finishGame]
  );

  /** Jump back to the article at index `i` in the path. Costs an undo penalty per step removed. */
  const undoTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= path.length - 1) return;
      const stepsRemoved = path.length - 1 - i;
      const trimmed = path.slice(0, i + 1);
      const last = trimmed[trimmed.length - 1];
      setPath(trimmed);
      setCurrentTitle(last.title);
      setArticleHtml(last.html);
      setUndos((u) => u + stepsRemoved);
    },
    [path]
  );

  // ───────────────────────────── UI ─────────────────────────────

  if (phase === "idle" || phase === "loading") {
    return <IdleScreen
      mode={mode}
      setMode={setMode}
      difficulty={difficulty}
      setDifficulty={setDifficulty}
      category={category}
      setCategory={setCategory}
      customTarget={customTarget}
      setCustomTarget={setCustomTarget}
      onStart={newGame}
      loading={phase === "loading"}
      error={error}
    />;
  }

  if (phase === "won") {
    return (
      <WonScreen
        clicks={clicks}
        elapsed={elapsed}
        undos={undos}
        score={score}
        path={path}
        target={target}
        mode={mode}
        onPlayAgain={newGame}
        onChangeSettings={() => setPhase("idle")}
      />
    );
  }

  // Playing
  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      {/* Sticky masthead — always visible while racing */}
      <header className="sticky top-0 z-30 border-b border-rule bg-card/95 backdrop-blur-md shadow-sm transition-all duration-200">
        <div className={`max-w-6xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-6 transition-all duration-200 ${compact ? "py-1.5" : "py-2 sm:py-3"}`}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className={`serif font-extrabold whitespace-nowrap transition-all ${compact ? "text-sm sm:text-base" : "text-base sm:text-xl"}`}>
              Wiki<span className="italic text-primary">Race</span>
            </div>
            {/* Target word — always visible */}
            <div className="hidden sm:flex items-center gap-1.5 pl-3 ml-1 border-l border-rule min-w-0">
              <Target className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="small-caps text-[10px] text-ink-faint">Find</span>
              <span className="serif text-sm font-bold text-primary truncate max-w-[200px]">
                {target?.title ?? "…"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-5 ticker">
            <Metric label="Clicks" value={String(clicks)} />
            <Metric label="Time" value={formatTime(elapsed)} />
            {undos > 0 && <Metric label="Undos" value={String(undos)} />}
            <Metric label="Score" value={score.toLocaleString()} accent />
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 sm:px-3"
              onClick={() => setHintOpen(true)}
              title={
                hintsUsed >= 3
                  ? "All hints used"
                  : `Reveal a hint (−${HINT_COSTS[hintsUsed]?.toLocaleString() ?? ""} pts)`
              }
            >
              <Lightbulb className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">
                Hint{hintsUsed > 0 ? ` ${hintsUsed}/3` : ""}
              </span>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3">
                  <RotateCcw className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">New</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Abandon this race?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current path, clicks, and time will be discarded. This run won't be scored.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep racing</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setPhase("idle")}>
                    Yes, exit
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Mobile: show target on its own line so it never gets cut */}
        <div className="sm:hidden max-w-6xl mx-auto px-3 pb-2 flex items-center gap-1.5">
          <Target className="w-3 h-3 text-primary shrink-0" />
          <span className="small-caps text-[9px] text-ink-faint">Find</span>
          <span className="serif text-xs font-bold text-primary truncate">
            {target?.title ?? "…"}
          </span>
        </div>

        {/* Start → Target rail */}
        <div className={`max-w-6xl mx-auto px-3 sm:px-6 pb-3 sm:pb-4 hidden sm:block transition-all overflow-hidden ${compact ? "max-h-0 !pb-0 opacity-0 pointer-events-none" : "max-h-[200px]"}`}>
          <div className="paper-card flex flex-col sm:flex-row sm:items-stretch overflow-hidden">
            <RailEnd
              icon={<Flag className="w-3.5 h-3.5" />}
              label="From"
              title={start?.title ?? ""}
              subtitle={start?.extract ?? ""}
            />
            <div className="hidden sm:flex items-center px-4 text-ink-faint">
              <ArrowRight className="w-4 h-4" />
            </div>
            <RailEnd
              icon={<Target className="w-3.5 h-3.5" />}
              label="To"
              title={target?.title ?? ""}
              subtitle={target?.extract ?? ""}
              accent
            />
          </div>
        </div>
      </header>

      {/* Article + path */}
      <div className="flex-1 max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 sm:gap-6 px-3 sm:px-6 py-4 sm:py-6 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-4 sm:px-8 pt-4 sm:pt-6 pb-3 border-b border-rule flex items-baseline justify-between gap-3">
            <h1 className="serif text-xl sm:text-3xl font-extrabold truncate">{currentTitle}</h1>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {path.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => undoTo(path.length - 2)}
                  title={`Go back one article (-${UNDO_PENALTY} pts)`}
                  className="h-8 px-2 sm:px-3"
                >
                  <Undo2 className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Undo</span>
                </Button>
              )}
              <span className="mono text-xs text-ink-faint whitespace-nowrap">
                hop {path.length - 1}
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <WikiArticle
              key={currentTitle}
              html={articleHtml}
              targetTitle={target?.title ?? ""}
              onNavigate={navigate}
            />
          </div>
        </article>

        <aside className="paper-card p-4 h-fit lg:sticky lg:top-6">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Path</div>
          <ol className="serif text-sm space-y-1.5 max-h-[40vh] lg:max-h-[55vh] overflow-y-auto">
            {path.map((p, i) => {
              const isCurrent = i === path.length - 1;
              const canJump = !isCurrent;
              return (
                <li key={i} className="flex gap-2 items-start">
                  <span className="mono text-[10px] text-ink-faint w-5 pt-1">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {canJump ? (
                    <button
                      onClick={() => undoTo(i)}
                      className="text-left text-ink-soft hover:text-primary hover:underline transition-colors break-words"
                      title={`Jump back here (-${
                        (path.length - 1 - i) * UNDO_PENALTY
                      } pts)`}
                    >
                      {p.title}
                    </button>
                  ) : (
                    <span className="text-primary font-semibold break-words">{p.title}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="hairline my-4" />
          <p className="text-[11px] text-ink-faint leading-relaxed">
            Highlighted links lead directly to your target. Click any past
            article to jump back ( −{UNDO_PENALTY} pts per step ).
          </p>
        </aside>
      </div>

      <HintCard
        open={hintOpen}
        onOpenChange={setHintOpen}
        target={target}
        hintsUsed={hintsUsed}
        onPurchase={() => {
          const cost = HINT_COSTS[hintsUsed];
          setHintsUsed((n) => n + 1);
          toast.info(`Hint revealed (−${cost.toLocaleString()} pts)`);
        }}
      />
    </main>
  );
};

// ───────────────────────────── Sub-components ─────────────────────────────

const IdleScreen = ({
  mode,
  setMode,
  difficulty,
  setDifficulty,
  category,
  setCategory,
  customTarget,
  setCustomTarget,
  onStart,
  loading,
  error,
}: {
  mode: GameMode;
  setMode: (m: GameMode) => void;
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  category: string;
  setCategory: (c: string) => void;
  customTarget: string;
  setCustomTarget: (s: string) => void;
  onStart: () => void;
  loading: boolean;
  error: string | null;
}) => {
  const favorites = useFavoriteCategories(3);
  const favoriteDefs = favorites
    .map((label) => CATEGORIES.find((c) => c.label === label))
    .filter((c): c is (typeof CATEGORIES)[number] => Boolean(c));
  return (
  <main className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
    <div className="max-w-3xl w-full text-center">
      <div className="small-caps text-xs text-ink-soft mb-4 sm:mb-6">
        Vol. I · No. 1 · An editorial diversion
      </div>
      <h1 className="serif text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-3 sm:mb-4">
        Wiki<span className="italic text-primary">Race</span>
      </h1>
      <p className="serif italic text-base sm:text-xl text-muted-foreground mb-2">
        From one article to another, by hyperlink alone.
      </p>
      <div className="hairline my-6 sm:my-8 mx-auto w-24" />

      {/* Mode */}
      <div className="grid sm:grid-cols-3 gap-3 mb-4 text-left">
        <ModeCard
          active={mode === "random"}
          onClick={() => setMode("random")}
          icon={<Shuffle className="w-4 h-4" />}
          title="Random race"
          desc="Two surprise articles, fresh every game."
        />
        <ModeCard
          active={mode === "daily"}
          onClick={() => setMode("daily")}
          icon={<Calendar className="w-4 h-4" />}
          title="Daily challenge"
          desc="Same start & target for everyone today."
        />
        <ModeCard
          active={mode === "custom"}
          onClick={() => setMode("custom")}
          icon={<Pencil className="w-4 h-4" />}
          title="Custom target"
          desc="Pick your own destination word."
        />
      </div>

      {/* Custom target input */}
      {mode === "custom" && (
        <div className="paper-card p-4 mb-4 text-left">
          <label className="small-caps text-[10px] text-ink-faint block mb-2">
            Target article
          </label>
          <Input
            value={customTarget}
            onChange={(e) => setCustomTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customTarget.trim()) onStart();
            }}
            placeholder="e.g. Octopus, Roman Empire, Quantum mechanics…"
            className="serif"
          />
          <p className="text-[11px] text-ink-faint mt-2">
            We'll find the matching Wikipedia article and drop you on a random page.
          </p>
        </div>
      )}

      {/* Difficulty (only meaningful for random) */}
      <div
        className={`grid grid-cols-3 gap-3 mb-4 text-left transition-opacity ${
          mode !== "random" ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
          <DiffCard
            key={d}
            active={difficulty === d}
            onClick={() => setDifficulty(d)}
            label={d}
            desc={
              d === "easy"
                ? "Popular target. Bonus ×0.85."
                : d === "normal"
                ? "Random target. Bonus ×1."
                : "Obscure target. Bonus ×1.5."
            }
          />
        ))}
      </div>

      {/* Category narrowing (random mode only) */}
      <div
        className={`paper-card p-4 mb-8 text-left transition-opacity ${
          mode !== "random" ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <label
          htmlFor="category-select"
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
          id="category-select"
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
                {c.label}</option>
            ))}
          </optgroup>
        </select>
        <p className="text-[11px] text-ink-faint mt-2">
          When set, your target will be drawn from this category.
        </p>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <Button
        size="lg"
        onClick={onStart}
        disabled={loading || (mode === "custom" && !customTarget.trim())}
        className="px-10 py-6 text-base"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Setting the press…
          </>
        ) : (
          <>Begin the race <ArrowRight className="w-4 h-4 ml-2" /></>
        )}
      </Button>

      <div className="hairline my-10 mx-auto w-24" />

      <Link to="/multiplayer" className="block">
        <div className="paper-card p-5 text-left flex items-center gap-4 hover:translate-y-[-1px] transition-transform">
          <div className="shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Swords className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="serif font-bold">Race a stranger live</div>
            <div className="text-xs text-ink-soft">
              Quick-match against another reader. First to the target wins.
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-ink-soft shrink-0" />
        </div>
      </Link>

      <div className="mt-10">
        <Leaderboard />
      </div>
    </div>
  </main>
  );
};

const ModeCard = ({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <button
    onClick={onClick}
    className={`paper-card p-4 text-left transition-all hover:translate-y-[-1px] ${
      active ? "ring-2 ring-primary" : ""
    }`}
  >
    <div className="flex items-center gap-2 mb-2">
      <span className={active ? "text-primary" : "text-ink-soft"}>{icon}</span>
      <span className="serif font-semibold">{title}</span>
    </div>
    <div className="text-xs text-ink-soft leading-relaxed">{desc}</div>
  </button>
);

const DiffCard = ({
  active,
  onClick,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
}) => (
  <button
    onClick={onClick}
    className={`paper-card p-3 text-left transition-all hover:translate-y-[-1px] ${
      active ? "ring-2 ring-primary" : ""
    }`}
  >
    <div className="small-caps text-[10px] text-ink-faint mb-1">Difficulty</div>
    <div
      className={`serif font-semibold capitalize mb-1 ${
        active ? "text-primary" : ""
      }`}
    >
      {label}
    </div>
    <div className="text-[11px] text-ink-soft leading-relaxed">{desc}</div>
  </button>
);

const Leaderboard = () => {
  const view = useMemo(() => getLeaderboardView(5), []);
  const empty =
    view.topScores.length === 0 &&
    view.fewestClicks.length === 0 &&
    view.fastestTimes.length === 0;

  if (empty) {
    return (
      <div className="paper-card p-6 text-center">
        <div className="small-caps text-[10px] text-ink-faint mb-1">
          Local leaderboard
        </div>
        <p className="text-sm text-ink-soft">
          No races run yet. Finish one to set a record.
        </p>
      </div>
    );
  }

  return (
    <div className="paper-card p-5 text-left">
      <div className="flex items-center gap-2 mb-4">
        <Medal className="w-4 h-4 text-primary" />
        <div className="small-caps text-xs text-ink-soft">Local leaderboard</div>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        <BoardColumn
          title="Top scores"
          icon={<Trophy className="w-3.5 h-3.5" />}
          entries={view.topScores}
          render={(e) => e.score.toLocaleString()}
        />
        <BoardColumn
          title="Fewest clicks"
          icon={<MousePointerClick className="w-3.5 h-3.5" />}
          entries={view.fewestClicks}
          render={(e) => `${e.clicks} clicks`}
        />
        <BoardColumn
          title="Fastest times"
          icon={<Clock className="w-3.5 h-3.5" />}
          entries={view.fastestTimes}
          render={(e) => formatTime(e.timeMs)}
        />
      </div>
    </div>
  );
};

const BoardColumn = ({
  title,
  icon,
  entries,
  render,
}: {
  title: string;
  icon: React.ReactNode;
  entries: LeaderboardEntry[];
  render: (e: LeaderboardEntry) => string;
}) => (
  <div>
    <div className="flex items-center gap-1.5 mb-2 text-ink-soft">
      {icon}
      <span className="small-caps text-[10px]">{title}</span>
    </div>
    {entries.length === 0 ? (
      <div className="text-xs text-ink-faint">—</div>
    ) : (
      <ol className="space-y-1.5">
        {entries.map((e, i) => (
          <li key={e.id} className="text-xs flex items-baseline gap-2">
            <span className="mono text-[10px] text-ink-faint w-4">
              {i + 1}.
            </span>
            <div className="flex-1 min-w-0">
              <div className="serif truncate">
                {e.start} → <span className="text-primary">{e.target}</span>
              </div>
              <div className="text-[10px] text-ink-faint capitalize">
                {e.mode === "daily" ? "daily" : e.difficulty}
              </div>
            </div>
            <span className="mono ticker font-semibold">{render(e)}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
);

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
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

const Metric = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
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
    <div
      className={`serif text-lg font-bold truncate ${
        accent ? "text-primary" : ""
      }`}
    >
      {title}
    </div>
    <div className="text-xs text-ink-soft line-clamp-1 mt-0.5">{subtitle}</div>
  </div>
);

const WonScreen = ({
  clicks,
  elapsed,
  undos,
  score,
  path,
  target,
  mode,
  onPlayAgain,
  onChangeSettings,
}: {
  clicks: number;
  elapsed: number;
  undos: number;
  score: number;
  path: { title: string; html: string }[];
  target: WikiSummary | null;
  mode: GameMode;
  onPlayAgain: () => void;
  onChangeSettings: () => void;
}) => {
  const [copied, setCopied] = useState(false);

  // Build a /?target=... share link if this run had a meaningful target.
  const shareUrl = (() => {
    if (!target?.title) return null;
    const url = new URL(window.location.origin);
    url.searchParams.set("target", target.title);
    return url.toString();
  })();

  const shareLabel =
    mode === "custom"
      ? "Challenge a friend to this target"
      : "Share this target with a friend";

  const onShare = async () => {
    if (!shareUrl) return;
    const shareData = {
      title: "WikiRace",
      text: `Race me to “${target?.title}” on WikiRace!`,
      url: shareUrl,
    };
    try {
      // Use native share sheet on mobile if available.
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        // Avoid sharing only-text on desktop where it's flaky.
        /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)
      ) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied — share it with a friend!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-3xl w-full grid gap-4 sm:gap-6">
        <div className="paper-card p-6 sm:p-10 text-center">
          <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
          <div className="small-caps text-xs text-ink-soft mb-2">Final dispatch</div>
          <h2 className="serif text-3xl sm:text-4xl font-extrabold mb-6">You arrived.</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-6 sm:mb-8">
            <Stat label="Clicks" value={String(clicks)} />
            <Stat label="Time" value={formatTime(elapsed)} />
            <Stat label="Undos" value={String(undos)} />
            <Stat label="Score" value={score.toLocaleString()} accent />
          </div>

          <div className="hairline mb-6" />
          <div className="text-left">
            <div className="small-caps text-xs text-ink-soft mb-2">Your path</div>
            <ol className="serif text-sm space-y-1 max-h-[40vh] overflow-y-auto">
              {path.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mono text-xs text-ink-faint w-6 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`break-words ${
                      i === path.length - 1 ? "text-primary font-semibold" : ""
                    }`}
                  >
                    {p.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {shareUrl && (
            <div className="paper-card p-3 sm:p-4 mt-6 sm:mt-8 text-left flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="small-caps text-[10px] text-ink-faint mb-0.5">
                  {shareLabel}
                </div>
                <div className="mono text-xs text-ink-soft truncate">
                  {shareUrl.replace(/^https?:\/\//, "")}
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={onShare}
                className="w-full sm:w-auto shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" /> Copied
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 mr-2" /> Share link
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-6 sm:mt-8 justify-center">
            <Button onClick={onPlayAgain} size="lg">
              <RotateCcw className="w-4 h-4 mr-2" /> Race again
            </Button>
            <Button variant="outline" size="lg" onClick={onChangeSettings}>
              Change settings
            </Button>
          </div>
        </div>

        <Leaderboard />
      </div>
    </main>
  );
};

export default Index;
