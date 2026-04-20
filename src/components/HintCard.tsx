// Progressive hint dialog for the race target.
// Reveals: 1) Wikipedia summary, 2) categories, 3) sample articles linking TO the target.
// Each reveal costs points (1000 / 1500 / 2000) — caller decides whether/how to apply.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lightbulb, Loader2, Sparkles, Tag, Link2 } from "lucide-react";
import { getCategories, getBacklinks, type WikiSummary } from "@/lib/wiki";

export const HINT_COSTS = [1000, 1500, 2000] as const;
export const MAX_HINTS = 3;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: WikiSummary | null;
  /** Number of hints already paid for (0–3). */
  hintsUsed: number;
  /** Called when the user confirms paying for the next hint. */
  onPurchase: () => void;
  /** Optional label tweak (e.g. hide "score" for multiplayer). */
  costLabel?: (cost: number) => string;
};

export const HintCard = ({
  open,
  onOpenChange,
  target,
  hintsUsed,
  onPurchase,
  costLabel,
}: Props) => {
  const [categories, setCategories] = useState<string[] | null>(null);
  const [backlinks, setBacklinks] = useState<string[] | null>(null);
  const [loadingCats, setLoadingCats] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Reset content when target changes (new race).
  useEffect(() => {
    setCategories(null);
    setBacklinks(null);
  }, [target?.title]);

  // Lazy-fetch categories once hint 2 is unlocked.
  useEffect(() => {
    if (!target || hintsUsed < 2 || categories !== null) return;
    setLoadingCats(true);
    void getCategories(target.title).then((c) => {
      setCategories(c);
      setLoadingCats(false);
    });
  }, [target, hintsUsed, categories]);

  // Lazy-fetch backlinks once hint 3 is unlocked.
  useEffect(() => {
    if (!target || hintsUsed < 3 || backlinks !== null) return;
    setLoadingLinks(true);
    void getBacklinks(target.title).then((b) => {
      setBacklinks(b);
      setLoadingLinks(false);
    });
  }, [target, hintsUsed, backlinks]);

  if (!target) return null;

  const nextCost = hintsUsed < MAX_HINTS ? HINT_COSTS[hintsUsed] : null;
  const formatCost = costLabel ?? ((c: number) => `−${c.toLocaleString()} pts`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="serif text-2xl flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            Intel on your target
          </DialogTitle>
          <DialogDescription>
            Each clue costs score points. You can buy up to {MAX_HINTS}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hint 1: Summary */}
          <HintBlock
            unlocked={hintsUsed >= 1}
            icon={<Sparkles className="w-4 h-4" />}
            label="Summary"
          >
            {target.thumbnail && (
              <img
                src={target.thumbnail}
                alt={target.title}
                className="float-right ml-3 mb-2 w-24 h-24 object-cover rounded border border-rule"
              />
            )}
            <p className="serif text-sm text-ink-soft leading-relaxed">
              <span className="font-semibold">{target.title}</span> —{" "}
              {target.extract || "No summary available."}
            </p>
          </HintBlock>

          {/* Hint 2: Categories */}
          <HintBlock
            unlocked={hintsUsed >= 2}
            icon={<Tag className="w-4 h-4" />}
            label="Wikipedia categories"
          >
            {loadingCats ? (
              <div className="flex items-center gap-2 text-ink-faint text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : categories && categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <span
                    key={c}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-accent/40 border border-rule serif"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-faint italic">No categories found.</p>
            )}
          </HintBlock>

          {/* Hint 3: Backlinks */}
          <HintBlock
            unlocked={hintsUsed >= 3}
            icon={<Link2 className="w-4 h-4" />}
            label="Articles that link here (good stepping stones)"
          >
            {loadingLinks ? (
              <div className="flex items-center gap-2 text-ink-faint text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : backlinks && backlinks.length > 0 ? (
              <ul className="serif text-sm space-y-1 list-disc list-inside text-ink-soft">
                {backlinks.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint italic">No backlinks found.</p>
            )}
          </HintBlock>
        </div>

        <div className="border-t border-rule pt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-ink-faint">
            Hints used:{" "}
            <span className="mono">
              {hintsUsed} / {MAX_HINTS}
            </span>
          </div>
          {nextCost !== null ? (
            <Button onClick={onPurchase} size="sm">
              <Lightbulb className="w-3.5 h-3.5 mr-1.5" />
              {hintsUsed === 0 ? "Reveal first hint" : "Reveal next hint"} (
              {formatCost(nextCost)})
            </Button>
          ) : (
            <span className="text-xs text-ink-faint italic">All hints used.</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const HintBlock = ({
  unlocked,
  icon,
  label,
  children,
}: {
  unlocked: boolean;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => (
  <div
    className={`paper-card p-3 transition-opacity ${
      unlocked ? "opacity-100" : "opacity-40"
    }`}
  >
    <div className="small-caps text-[10px] text-ink-faint mb-1.5 flex items-center gap-1.5">
      {icon}
      {label}
    </div>
    {unlocked ? (
      <div>{children}</div>
    ) : (
      <p className="text-sm text-ink-faint italic">Locked — purchase to reveal.</p>
    )}
  </div>
);
