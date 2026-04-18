import { toast } from "sonner";
import type { Badge } from "@/lib/achievements";
import { BadgeIcon } from "@/components/BadgeIcon";

/** Pop a celebratory toast for each newly-unlocked badge, staggered slightly. */
export function celebrateBadges(badges: Badge[]) {
  badges.forEach((b, i) => {
    setTimeout(() => {
      toast.success(`Achievement unlocked: ${b.label}`, {
        description: b.description,
        icon: <BadgeIcon icon={b.icon} className="w-4 h-4 text-primary" />,
        duration: 5000,
      });
    }, i * 600);
  });
}
