import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  Loader2,
  Medal,
  MousePointerClick,
  Trophy,
} from "lucide-react";
import {
  fetchTopScores,
  type OnlineMode,
  type OnlineScore,
} from "@/lib/onlineScores";

const MODES: { id: OnlineMode; label: string; desc: string }[] = [
  { id: "race", label: "A → B Race", desc: "From start to target, fewest hops & fastest time." },
  { id: "collector", label: "Link Collector", desc: "2-min time attack: visit as many targets as possible." },
  { id: "nomove", label: "No-Move Challenge", desc: "Navigate by images & infobox alone." },
];

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const Leaderboard = () => {
  const [mode, setMode] = useState<OnlineMode>("race");
  const [scores, setScores] = useState<OnlineScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchTopScores(mode, 25)
      .then(setScores)
      .finally(() => setLoading(false));
  }, [mode]);

  return (
    <main className="relative z-10 min-h-screen px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-6"
        >
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>

        <div className="text-center mb-10">
          <Medal className="w-8 h-8 mx-auto text-primary mb-3" />
          <div className="small-caps text-xs text-ink-soft mb-2">
            Vol. I · No. 3 · The standings
          </div>
          <h1 className="serif text-5xl font-extrabold tracking-tight">
            Global <span className="italic text-primary">leaderboard</span>
          </h1>
        </div>

        <div className="flex flex-wrap gap-2 justify-center mb-8">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`paper-card px-4 py-2 text-sm transition-all ${
                mode === m.id ? "ring-2 ring-primary text-primary font-semibold" : ""
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p className="text-center text-sm text-ink-soft serif italic mb-6">
          {MODES.find((m) => m.id === mode)?.desc}
        </p>

        <div className="paper-card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-ink-soft">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : scores.length === 0 ? (
            <div className="text-center py-16 text-ink-soft serif italic">
              No scores yet. Be the first to submit one.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="small-caps text-[10px] text-ink-faint px-4 py-3 w-10">#</th>
                  <th className="small-caps text-[10px] text-ink-faint px-4 py-3">Player</th>
                  <th className="small-caps text-[10px] text-ink-faint px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="w-3 h-3" /> Score
                    </span>
                  </th>
                  <th className="small-caps text-[10px] text-ink-faint px-4 py-3 text-right hidden md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="w-3 h-3" /> Clicks
                    </span>
                  </th>
                  <th className="small-caps text-[10px] text-ink-faint px-4 py-3 text-right hidden md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Time
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s, i) => (
                  <tr
                    key={s.id}
                    className={`border-b border-rule/60 last:border-0 ${
                      i < 3 ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 mono text-sm text-ink-faint">{i + 1}</td>
                    <td className="px-4 py-3 serif font-semibold">{s.display_name}</td>
                    <td className="px-4 py-3 mono text-right ticker font-bold">
                      {s.score.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 mono text-right text-ink-soft text-sm hidden md:table-cell">
                      {s.clicks}
                    </td>
                    <td className="px-4 py-3 mono text-right text-ink-soft text-sm hidden md:table-cell">
                      {s.time_ms ? formatTime(s.time_ms) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
};

export default Leaderboard;
