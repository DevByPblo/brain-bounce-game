import { useEffect, useState } from "react";

type Props = {
  /** Called once after "Go!" finishes. Begin the actual race here. */
  onComplete: () => void;
};

/**
 * Full-screen focused 3-2-1-Go countdown shown immediately before a race.
 * Uses paper-card aesthetic + scale-in animation per tick.
 */
export const Countdown = ({ onComplete }: Props) => {
  // 3 → 2 → 1 → 0 (rendered as "Go!"). After ~600ms on Go we call onComplete.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/85 backdrop-blur-md animate-fade-in">
      <div className="text-center">
        <div className="small-caps text-xs text-ink-soft mb-4 tracking-widest">
          {accent ? "" : "Get ready"}
        </div>
        <div
          key={n}
          className={`serif font-extrabold leading-none animate-scale-in ${
            accent ? "text-primary" : "text-ink"
          }`}
          style={{ fontSize: accent ? "10rem" : "12rem" }}
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
