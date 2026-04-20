import { useEffect, useState } from "react";
import { Target } from "lucide-react";

type Props = {
  /** Called once after "Go!" finishes. Begin the actual race here. */
  onComplete: () => void;
  /** Optional target word to keep visible during the focus moment. */
  targetTitle?: string | null;
};

/**
 * Full-screen focused 3-2-1-Go countdown shown immediately before a race.
 * Fully opaque so the article behind doesn't distract on laptops.
 */
export const Countdown = ({ onComplete, targetTitle }: Props) => {
  const [n, setN] = useState(3);

  useEffect(() => {
    if (n > 0) {
      const id = setTimeout(() => setN((x) => x - 1), 800);
      return () => clearTimeout(id);
    }
    const id = setTimeout(onComplete, 600);
    return () => clearTimeout(id);
  }, [n, onComplete]);

  const label = n === 0 ? "Go!" : String(n);
  const accent = n === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background animate-fade-in">
      <div className="text-center px-6 max-w-lg">
        {targetTitle ? (
          <div className="paper-card inline-flex items-center gap-2 px-4 py-2 mb-8">
            <Target className="w-4 h-4 text-primary" />
            <span className="small-caps text-[10px] text-ink-faint">Find</span>
            <span className="serif text-base font-bold text-primary truncate max-w-[260px]">
              {targetTitle}
            </span>
          </div>
        ) : (
          <div className="small-caps text-xs text-ink-soft mb-4 tracking-widest">
            {accent ? "" : "Get ready"}
          </div>
        )}
        <div
          key={n}
          className={`serif font-extrabold leading-none animate-scale-in ${
            accent ? "text-primary" : "text-ink"
          }`}
          style={{ fontSize: accent ? "9rem" : "11rem" }}
        >
          {label}
        </div>
        <div className="hairline my-6 mx-auto w-32" />
        <div className="serif italic text-ink-soft">
          {accent ? "Race begins now." : "Eyes on the target."}
        </div>
      </div>
    </div>
  );
};
