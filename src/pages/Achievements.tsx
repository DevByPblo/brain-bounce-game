import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lock, Sparkles } from "lucide-react";
import { BADGES, getStats, getUnlockedIds, type Badge } from "@/lib/achievements";
import { BadgeIcon } from "@/components/BadgeIcon";

const Achievements = () => {
  const unlocked = useMemo(() => new Set(getUnlockedIds()), []);
  const stats = useMemo(() => getStats(), []);

  const groups: { key: Badge["category"]; title: string; desc: string }[] = [
    { key: "milestone", title: "Milestones", desc: "Tally up the wins." },
    { key: "skill", title: "Skill", desc: "Earned for sharp play." },
    { key: "mode", title: "Modes", desc: "One badge per game type." },
  ];

  const earnedCount = unlocked.size;
  const totalCount = BADGES.length;

  return (
    <main className="relative z-10 min-h-screen px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-8"
        >
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>

        <div className="text-center mb-10">
          <div className="small-caps text-xs text-ink-soft mb-3">
            Vol. I · No. 7 · The trophy room
          </div>
          <h1 className="serif text-5xl sm:text-6xl font-extrabold tracking-tight mb-3">
            Achie<span className="italic text-primary">vements</span>
          </h1>
          <p className="serif italic text-base text-muted-foreground">
            {earnedCount} of {totalCount} unlocked.
          </p>
          <div className="hairline my-6 mx-auto w-24" />
          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
            <Stat label="Wins" value={String(stats.totalWins)} />
            <Stat label="Best clicks" value={stats.bestClicksRace?.toString() ?? "—"} />
            <Stat
              label="Best time"
              value={
                stats.bestTimeRaceMs
                  ? `${Math.floor(stats.bestTimeRaceMs / 1000)}s`
                  : "—"
              }
            />
          </div>
        </div>

        {groups.map((g) => {
          const items = BADGES.filter((b) => b.category === g.key);
          return (
            <section key={g.key} className="mb-10">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="serif text-2xl font-extrabold">{g.title}</h2>
                <span className="small-caps text-[10px] text-ink-faint">
                  {items.filter((b) => unlocked.has(b.id)).length} / {items.length}
                </span>
              </div>
              <p className="text-sm text-ink-soft mb-4">{g.desc}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((b) => {
                  const got = unlocked.has(b.id);
                  return (
                    <div
                      key={b.id}
                      className={`paper-card p-4 flex items-start gap-3 transition-all ${
                        got ? "ring-1 ring-primary/40" : "opacity-60"
                      }`}
                    >
                      <div
                        className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                          got ? "bg-primary/15 text-primary" : "bg-muted text-ink-faint"
                        }`}
                      >
                        {got ? (
                          <BadgeIcon icon={b.icon} className="w-5 h-5" />
                        ) : (
                          <Lock className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="serif font-bold flex items-center gap-1.5">
                          {b.label}
                          {got && <Sparkles className="w-3 h-3 text-primary" />}
                        </div>
                        <div className="text-xs text-ink-soft leading-relaxed">
                          {b.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="paper-card p-3">
    <div className="small-caps text-[10px] text-ink-faint mb-1">{label}</div>
    <div className="serif text-xl font-extrabold">{value}</div>
  </div>
);

export default Achievements;
