// Local leaderboard persisted to localStorage.

const KEY = "wikirace.leaderboard.v1";
const MAX_ENTRIES = 50;

export type GameMode = "random" | "daily" | "custom";
export type Difficulty = "easy" | "normal" | "hard";

export type LeaderboardEntry = {
  id: string;
  date: string;          // ISO timestamp
  start: string;
  target: string;
  clicks: number;
  timeMs: number;
  score: number;
  mode: GameMode;
  difficulty: Difficulty;
};

function read(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: LeaderboardEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota errors */
  }
}

export function getLeaderboard(): LeaderboardEntry[] {
  return read();
}

export function addEntry(
  entry: Omit<LeaderboardEntry, "id" | "date">
): LeaderboardEntry {
  const e: LeaderboardEntry = {
    ...entry,
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
  };
  const all = [...read(), e].sort((a, b) => b.score - a.score);
  write(all);
  return e;
}

export function clearLeaderboard(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export type LeaderboardView = {
  topScores: LeaderboardEntry[];
  fewestClicks: LeaderboardEntry[];
  fastestTimes: LeaderboardEntry[];
};

export function getLeaderboardView(limit = 5): LeaderboardView {
  const all = read();
  return {
    topScores: [...all].sort((a, b) => b.score - a.score).slice(0, limit),
    fewestClicks: [...all].sort((a, b) => a.clicks - b.clicks).slice(0, limit),
    fastestTimes: [...all].sort((a, b) => a.timeMs - b.timeMs).slice(0, limit),
  };
}
