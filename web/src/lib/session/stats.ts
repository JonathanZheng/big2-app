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

function update(change: (stats: Stats) => void) {
  const stats = readStats();
  change(stats);
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked: stats simply are not kept.
  }
}

/** Record a finished game, won or lost. */
export function recordGame(won: boolean) {
  update((stats) => {
    stats.games += 1;
    if (won) stats.wins += 1;
  });
}

/** Record a multi-game match, including one finished early. */
export function recordMatch(won: boolean) {
  update((stats) => {
    stats.matches += 1;
    if (won) stats.matchWins += 1;
  });
}
