import {
  Trophy, Medal, Crown, Zap, Timer, LightbulbOff, Undo2, Swords,
  Target, EyeOff, Calendar, Shuffle, Pencil, Users, type LucideIcon,
} from "lucide-react";
import type { Badge } from "@/lib/achievements";

const MAP: Record<Badge["icon"], LucideIcon> = {
  trophy: Trophy,
  medal: Medal,
  crown: Crown,
  zap: Zap,
  timer: Timer,
  "lightbulb-off": LightbulbOff,
  "undo2-off": Undo2,
  swords: Swords,
  target: Target,
  "eye-off": EyeOff,
  calendar: Calendar,
  shuffle: Shuffle,
  pencil: Pencil,
  users: Users,
};

export const BadgeIcon = ({
  icon,
  className,
}: {
  icon: Badge["icon"];
  className?: string;
}) => {
  const Cmp = MAP[icon] ?? Trophy;
  return <Cmp className={className} />;
};
