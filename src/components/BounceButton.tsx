import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Shuffle, Loader2 } from "lucide-react";
import { getRandomTitle } from "@/lib/wiki";
import { toast } from "sonner";

export const BOUNCE_THRESHOLD = 15;

/**
 * Detect a strict A↔B↔A↔B ping-pong pattern in the last 4 visits.
 * `titles` is the ordered list of visited article titles for the current run.
 * Returns true when the most recent step is part of a 2-page loop and should
 * NOT count toward unlocking Bounce.
 */
export function isPingPongStep(titles: string[]): boolean {
  if (titles.length < 4) return false;
  const [a, b, c, d] = titles.slice(-4);
  return a === c && b === d && a !== b;
}

/**
 * Count visits that should progress the Bounce meter, ignoring ping-pong
 * steps. We re-walk the history so the rule stays consistent regardless of
 * how each game tracks state.
 */
export function countBounceProgress(titles: string[]): number {
  let n = 0;
  for (let i = 1; i <= titles.length; i++) {
    const slice = titles.slice(0, i);
    if (!isPingPongStep(slice)) n++;
  }
  return n;
}

type Props = {
  /** Total qualifying visits in the current run. */
  progress: number;
  /** Called with a freshly-picked random article title. */
  onBounce: (title: string) => void | Promise<void>;
  /** Hide entirely until the player has at least 1 visit. */
  hidden?: boolean;
  className?: string;
};

export const BounceButton = ({ progress, onBounce, hidden, className }: Props) => {
  const [loading, setLoading] = useState(false);
  const enabled = progress >= BOUNCE_THRESHOLD;
  const remaining = Math.max(0, BOUNCE_THRESHOLD - progress);

  const handle = useCallback(async () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      const title = await getRandomTitle();
      await onBounce(title);
      toast.success(`Bounced to “${title}”`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't bounce. Try again.");
    } finally {
      setLoading(false);
    }
  }, [enabled, loading, onBounce]);

  if (hidden) return null;

  return (
    <Button
      type="button"
      variant={enabled ? "default" : "outline"}
      size="sm"
      className={`h-8 px-2 sm:px-3 ${className ?? ""}`}
      onClick={handle}
      disabled={!enabled || loading}
      title={
        enabled
          ? "Jump to a random article (rescue)"
          : `Stuck? Bounce unlocks in ${remaining} more visit${remaining === 1 ? "" : "s"}. Ping-ponging between two pages doesn't count.`
      }
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin sm:mr-1.5" />
      ) : (
        <Shuffle className="w-3.5 h-3.5 sm:mr-1.5" />
      )}
      <span className="hidden sm:inline ticker">
        Bounce{enabled ? "" : ` ${progress}/${BOUNCE_THRESHOLD}`}
      </span>
    </Button>
  );
};
