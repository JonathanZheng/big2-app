/** Win counts kept in this browser. Storage can be blocked, so every access is guarded. */
const KEY = "big2.stats.v1";

export interface Stats {
  games: number;
  wins: number;
  matches: number;
  matchWins: number;
}

const EMPTY: Stats = { games: 0, wins: 0, matches: 0, matchWins: 0 };

export function readStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Stats>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Record a finished game; `matchWon` is null unless this game ended a match of several games. */
export function recordResult(won: boolean, matchWon: boolean | null) {
  const stats = readStats();
  stats.games += 1;
  if (won) stats.wins += 1;
  if (matchWon !== null) {
    stats.matches += 1;
    if (matchWon) stats.matchWins += 1;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked: stats simply are not kept.
  }
}
