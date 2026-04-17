import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WikiArticle } from "@/components/WikiArticle";
import {
  getArticleHtml,
  getRandomTitle,
  getSummary,
  normaliseTitle,
  type WikiSummary,
} from "@/lib/wiki";
import { ArrowRight, RotateCcw, Trophy, Loader2, Target, Flag } from "lucide-react";

type Phase = "idle" | "loading" | "playing" | "won";

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const computeScore = (clicks: number, ms: number) => {
  // Lower clicks + faster = higher score. Base 10000.
  const base = 10000;
  const clickPenalty = clicks * 350;
  const timePenalty = Math.floor(ms / 1000) * 8;
  return Math.max(50, base - clickPenalty - timePenalty);
};

const Index = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [start, setStart] = useState<WikiSummary | null>(null);
  const [target, setTarget] = useState<WikiSummary | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>("");
  const [articleHtml, setArticleHtml] = useState<string>("");
  const [path, setPath] = useState<string[]>([]);
  const [clicks, setClicks] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<number>(0);

  // Timer
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  const score = useMemo(
    () => computeScore(clicks, elapsed),
    [clicks, elapsed]
  );

  const newGame = useCallback(async () => {
    setPhase("loading");
    setError(null);
    setPath([]);
    setClicks(0);
    setElapsed(0);
    setArticleHtml("");
    try {
      // Pick two distinct random titles
      let s = await getRandomTitle();
      let t = await getRandomTitle();
      let guard = 0;
      while (normaliseTitle(s) === normaliseTitle(t) && guard++ < 4) {
        t = await getRandomTitle();
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
      setPath([art.title]);
      startRef.current = Date.now();
      setPhase("playing");
    } catch (e) {
      console.error(e);
      setError("Couldn't reach Wikipedia. Try again.");
      setPhase("idle");
    }
  }, []);

  const navigate = useCallback(
    async (title: string) => {
      if (!target) return;
      setClicks((c) => c + 1);
      try {
        const art = await getArticleHtml(title);
        setCurrentTitle(art.title);
        setArticleHtml(art.html);
        setPath((p) => [...p, art.title]);
        if (normaliseTitle(art.title) === normaliseTitle(target.title)) {
          setElapsed(Date.now() - startRef.current);
          setPhase("won");
        }
      } catch (e) {
        console.error(e);
      }
    },
    [target]
  );

  // ───────────────────────────── UI ─────────────────────────────

  if (phase === "idle" || phase === "loading") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center">
          <div className="small-caps text-xs text-ink-soft mb-6">
            Vol. I · No. 1 · An editorial diversion
          </div>
          <h1 className="serif text-6xl md:text-7xl font-extrabold tracking-tight mb-4">
            Wiki<span className="italic text-primary">Race</span>
          </h1>
          <p className="serif italic text-xl text-muted-foreground mb-2">
            From one article to another, by hyperlink alone.
          </p>
          <div className="hairline my-8 mx-auto w-24" />
          <p className="text-sm text-ink-soft leading-relaxed max-w-md mx-auto mb-10">
            You'll be dropped into a random Wikipedia article and given a target.
            Click links inside the article to travel between pages. Fewer clicks
            and faster times mean a higher score.
          </p>

          {error && (
            <p className="text-destructive text-sm mb-4">{error}</p>
          )}

          <Button
            size="lg"
            onClick={newGame}
            disabled={phase === "loading"}
            className="px-10 py-6 text-base"
          >
            {phase === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting the press…
              </>
            ) : (
              <>Begin the race <ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>

          <div className="mt-16 grid grid-cols-3 gap-6 text-left">
            {[
              ["01", "Random start", "A surprise article from the archive."],
              ["02", "Random target", "A second article — your destination."],
              ["03", "Hyperlinks only", "Fewer hops, faster time, higher score."],
            ].map(([n, t, d]) => (
              <div key={n} className="paper-card p-4">
                <div className="mono text-xs text-primary mb-2">№ {n}</div>
                <div className="serif font-semibold mb-1">{t}</div>
                <div className="text-xs text-ink-soft leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (phase === "won") {
    return (
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
        <div className="paper-card max-w-xl w-full p-10 text-center">
          <Trophy className="w-10 h-10 mx-auto text-primary mb-4" />
          <div className="small-caps text-xs text-ink-soft mb-2">Final dispatch</div>
          <h2 className="serif text-4xl font-extrabold mb-6">You arrived.</h2>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <Stat label="Clicks" value={String(clicks)} />
            <Stat label="Time" value={formatTime(elapsed)} />
            <Stat label="Score" value={score.toLocaleString()} accent />
          </div>

          <div className="hairline mb-6" />
          <div className="text-left">
            <div className="small-caps text-xs text-ink-soft mb-2">Your path</div>
            <ol className="serif text-sm space-y-1">
              {path.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mono text-xs text-ink-faint w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={i === path.length - 1 ? "text-primary font-semibold" : ""}>
                    {p}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <Button onClick={newGame} size="lg" className="mt-8">
            <RotateCcw className="w-4 h-4 mr-2" /> Race again
          </Button>
        </div>
      </main>
    );
  }

  // Playing
  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      {/* Masthead */}
      <header className="border-b border-rule bg-card/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="serif text-2xl font-extrabold">
              Wiki<span className="italic text-primary">Race</span>
            </div>
            <div className="hidden md:block small-caps text-[10px] text-ink-faint">
              In progress
            </div>
          </div>
          <div className="flex items-center gap-6 ticker">
            <Metric label="Clicks" value={String(clicks)} />
            <Metric label="Time" value={formatTime(elapsed)} />
            <Metric label="Score" value={score.toLocaleString()} accent />
            <Button variant="outline" size="sm" onClick={newGame}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> New
            </Button>
          </div>
        </div>

        {/* Start → Target rail */}
        <div className="max-w-6xl mx-auto px-6 pb-4">
          <div className="paper-card flex items-stretch overflow-hidden">
            <RailEnd
              icon={<Flag className="w-3.5 h-3.5" />}
              label="From"
              title={start?.title ?? ""}
              subtitle={start?.extract ?? ""}
            />
            <div className="flex items-center px-4 text-ink-faint">
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
      <div className="flex-1 max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6 px-6 py-6 min-h-0">
        <article className="paper-card overflow-hidden min-h-[60vh] flex flex-col">
          <div className="px-8 pt-6 pb-3 border-b border-rule flex items-baseline justify-between">
            <h1 className="serif text-3xl font-extrabold">{currentTitle}</h1>
            <span className="mono text-xs text-ink-faint">
              hop {path.length - 1}
            </span>
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

        <aside className="paper-card p-4 h-fit md:sticky md:top-6">
          <div className="small-caps text-[10px] text-ink-faint mb-3">Path</div>
          <ol className="serif text-sm space-y-1.5 max-h-[60vh] overflow-y-auto">
            {path.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mono text-[10px] text-ink-faint w-5 pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    i === path.length - 1
                      ? "text-primary font-semibold"
                      : "text-ink-soft"
                  }
                >
                  {p}
                </span>
              </li>
            ))}
          </ol>
          <div className="hairline my-4" />
          <p className="text-[11px] text-ink-faint leading-relaxed">
            Highlighted links lead directly to your target.
          </p>
        </aside>
      </div>
    </main>
  );
};

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

export default Index;
