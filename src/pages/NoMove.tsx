import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WikiArticle } from "@/components/WikiArticle";
import { scorePop } from "@/components/ScorePop";
import {
  ArrowLeft,
  ArrowRight,
  EyeOff,
  Flag,
  Loader2,
  RotateCcw,
  Target,
  Trophy,
} from "lucide-react";
import {
  getArticleHtml,
  getRandomTitle,
  getSummary,
  normaliseTitle,
  type WikiSummary,
} from "@/lib/wiki";
import { submitScore } from "@/lib/onlineScores";
import { useAuth } from "@/lib/auth";
import { recordRun } from "@/lib/achievements";
import { celebrateBadges } from "@/lib/achievementToast";
import { toast } from "sonner";
import { useScrolled } from "@/hooks/use-scrolled";
import { useBlockFind } from "@/hooks/use-block-find";
import { Countdown } from "@/components/Countdown";
import { BounceButton, countBounceProgress } from "@/components/BounceButton";

type Phase = "idle" | "loading" | "countdown" | "playing" | "won";

const HOP_PENALTY = 80;
const BASE = 5000;

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const NoMove = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState<WikiSummary | null>(null);
  const [target, setTarget] = useState<WikiSummary | null>(null);
  const [currentTitle, setCurrentTitle] = useState("");
  const [articleHtml, setArticleHtml] = useState("");
  const [clicks, setClicks] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [visits, setVisits] = useState<string[]>([]);
  const startedAt = useRef(0);
  const submittedRef = useRef(false);
  const { user } = useAuth();
  const compact = useScrolled(40);
  useBlockFind(phase === "playing" || phase === "countdown");

  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  const score = Math.max(50, BASE - clicks * HOP_PENALTY - Math.floor(elapsed / 1000) * 4);

  const beginGame = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setClicks(0);
    setElapsed(0);
    submittedRef.current = false;
    try {
      const s = await getRandomTitle();
      let t = await getRandomTitle();
      let g = 0;
      while (normaliseTitle(s) === normaliseTitle(t) && g++ < 4) {
        t = await getRandomTitle();
      }
      const [sSum, tSum, art] = await Promise.all([
        getSummary(s), getSummary(t), getArticleHtml(s),
      ]);
      setStart(sSum);
      setTarget(tSum);
      setCurrentTitle(art.title);
      setArticleHtml(art.html);
      setVisits([art.title]);
      setPhase("countdown");
    } catch (e) {
      console.error(e);
      setError("Couldn't reach Wikipedia. Try again.");
      setPhase("idle");
    }
  }, []);

  const finishGame = useCallback(async (finalClicks: number, finalElapsed: number) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const finalScore = Math.max(50, BASE - finalClicks * HOP_PENALTY - Math.floor(finalElapsed / 1000) * 4);
    setElapsed(finalElapsed);
    setPhase("won");

    const earned = recordRun({
      mode: "nomove",
      won: true,
      clicks: finalClicks,
      timeMs: finalElapsed,
      hintsUsed: 0,
      undos: 0,
    });
    if (earned.length) celebrateBadges(earned);

    if (user) {
      const res = await submitScore({
        mode: "nomove",
        score: finalScore,
        clicks: finalClicks,
        timeMs: finalElapsed,
        details: { start: start?.title, target: target?.title },
      });
      if (res.ok) toast.success("Score submitted to the global board.");
    }
  }, [user, start, target]);

  const navigate = useCallback(async (title: string) => {
    if (!target) return;
    const newClicks = clicks + 1;
    setClicks(newClicks);
    try {
      const art = await getArticleHtml(title);
      setCurrentTitle(art.title);
      setArticleHtml(art.html);
      setVisits((v) => [...v, art.title]);
      if (normaliseTitle(art.title) === normaliseTitle(target.title)) {
        scorePop("Target!");
        finishGame(newClicks, Date.now() - startedAt.current);
      }
    } catch (e) {
      console.error(e);
    }
  }, [target, clicks, finishGame]);

  const bounceTo = useCallback(async (title: string) => {
    try {
      const art = await getArticleHtml(title);
      setCurrentTitle(art.title);
      setArticleHtml(art.html);
      setVisits((v) => [...v, art.title]);
      setClicks((c) => c + 1);
      if (target && normaliseTitle(art.title) === normaliseTitle(target.title)) {
        scorePop("Target!");
        finishGame(clicks + 1, Date.now() - startedAt.current);
      }
    } catch (e) {
      console.error(e);
    }
  }, [target, clicks, finishGame]);

  const bounceProgress = countBounceProgress(visits);

  if (phase === "idle" || phase === "loading") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center">
          <Link to="/" className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-8">
            <ArrowLeft className="w-3 h-3" /> Back
          </Link>
          <div className="small-caps text-xs text-ink-soft mb-4">
            Vol. I · No. 5 · The blind dispatch
          </div>
          <h1 className="serif text-6xl font-extrabold tracking-tight mb-4">
            No-<span className="italic text-primary">Move</span>
          </h1>
          <p className="serif italic text-lg text-muted-foreground mb-2">
            Only images and infoboxes. No text, no headings. Find your way.
          </p>
          <div className="hairline my-8 mx-auto w-24" />

          <div className="paper-card p-5 mb-6 text-left">
            <div className="flex items-start gap-3">
              <EyeOff className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm text-ink-soft">
                You'll see only the article's <strong>images, captions, and infobox</strong>.
                Click links inside the infobox or under photos to navigate towards the target.
              </div>
            </div>
          </div>

          {error && <p className="text-destructive text-sm mb-4">{error}</p>}
          {!user && (
            <p className="text-[11px] text-ink-faint mb-3">
              <Link to="/auth" className="underline">Sign in</Link> to save your score.
            </p>
          )}

          <Button size="lg" onClick={beginGame} disabled={phase === "loading"} className="px-10 py-6 text-base">
            {phase === "loading" ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting the press…</>
            ) : (
              <>Begin <ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "won") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full">
          <div className="paper-card p-10 text-center">
            <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
            <h2 className="serif text-4xl font-extrabold mb-2">You arrived blindly.</h2>
            <p className="serif italic text-muted-foreground mb-6">
              {start?.title} → <span className="text-primary">{target?.title}</span>
            </p>
            <div className="grid grid-cols-3 gap-3 mb-8">
              <Stat label="Score" value={score.toLocaleString()} accent />
              <Stat label="Clicks" value={String(clicks)} />
              <Stat label="Time" value={formatTime(elapsed)} />
            </div>
            <div className="flex justify-center gap-3">
              <Button onClick={beginGame}><RotateCcw className="w-4 h-4 mr-2" /> Play again</Button>
              <Link to="/leaderboard"><Button variant="outline">Leaderboard</Button></Link>
              <Link to="/"><Button variant="ghost">Home</Button></Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      {phase === "countdown" && (
        <Countdown
          targetTitle={target?.title}
          onComplete={() => {
            startedAt.current = Date.now();
            setElapsed(0);
            setPhase("playing");
          }}
        />
      )}
      <header className="sticky top-0 z-30 border-b border-rule bg-card/95 backdrop-blur-md shadow-sm">
        <div className={`max-w-6xl mx-auto px-6 flex items-center justify-between gap-6 ${compact ? "py-1.5" : "py-2"}`}>
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className={`serif font-extrabold whitespace-nowrap ${compact ? "text-base" : "text-xl"}`}>
              Wiki<span className="italic text-primary">Race</span>
            </Link>
            <div className="hidden sm:flex items-center gap-1.5 pl-3 ml-1 border-l border-rule min-w-0">
              <Target className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="small-caps text-[10px] text-ink-faint">Find</span>
              <span className="serif text-sm font-bold text-primary truncate max-w-[200px]">
                {target?.title ?? "…"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-5 ticker">
            <Metric label="Clicks" value={String(clicks)} />
            <Metric label="Time" value={formatTime(elapsed)} />
            <Metric label="Score" value={score.toLocaleString()} accent />
            <BounceButton progress={bounceProgress} onBounce={bounceTo} />
            <Button variant="outline" size="sm" onClick={() => setPhase("idle")}>End</Button>
          </div>
        </div>
        {!compact && (
          <div className="max-w-6xl mx-auto px-6 pb-3">
            <div className="paper-card flex items-stretch overflow-hidden">
              <RailEnd icon={<Flag className="w-3.5 h-3.5" />} label="From" title={start?.title ?? ""} />
              <div className="flex items-center px-4 text-ink-faint"><ArrowRight className="w-4 h-4" /></div>
              <RailEnd icon={<Target className="w-3.5 h-3.5" />} label="To" title={target?.title ?? ""} accent />
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-4 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-8 pt-5 pb-3 border-b border-rule flex items-baseline justify-between gap-3">
            <h1 className="serif text-2xl font-extrabold text-ink-faint italic">[ title hidden ]</h1>
            <span className="mono text-xs text-ink-faint">images-only</span>
          </div>
          <div className="flex-1 min-h-0">
            <WikiArticle
              key={currentTitle}
              html={articleHtml}
              targetTitle={target?.title ?? ""}
              onNavigate={navigate}
              imagesOnly
            />
          </div>
        </article>
      </div>
    </main>
  );
};

const Metric = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="text-right">
    <div className="small-caps text-[9px] text-ink-faint leading-none">{label}</div>
    <div className={`mono text-sm font-semibold leading-tight ${accent ? "text-primary" : "text-ink"}`}>{value}</div>
  </div>
);

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div className="paper-card p-4">
    <div className="small-caps text-[10px] text-ink-faint mb-1">{label}</div>
    <div className={`serif text-2xl font-extrabold ticker ${accent ? "text-primary" : ""}`}>{value}</div>
  </div>
);

const RailEnd = ({ icon, label, title, accent }: { icon: React.ReactNode; label: string; title: string; accent?: boolean }) => (
  <div className="flex-1 p-4 min-w-0">
    <div className="flex items-center gap-2 mb-1">
      <span className={accent ? "text-primary" : "text-ink-soft"}>{icon}</span>
      <span className="small-caps text-[10px] text-ink-faint">{label}</span>
    </div>
    <div className={`serif text-lg font-bold truncate ${accent ? "text-primary" : ""}`}>{title}</div>
  </div>
);

export default NoMove;
