/**
 * Win counts kept in this browser or, for matches, on the signed-in account.
 * Storage can be blocked, so every access is guarded.
 */
import { newUploadId } from "@/lib/account/merge";
import { queueChange, readAccount } from "@/lib/account/store";

const KEY = "big2.stats.v1";

export interface Stats {
  games: number;
  wins: number;
  matches: number;
  matchWins: number;
}

const EMPTY: Stats = { games: 0, wins: 0, matches: 0, matchWins: 0 };

export function readStats(): Stats {
  const history = readAccount()?.history;
  if (!history) return readGuestStats();
  const wins = history.games.filter((g) => g.won).length;
  return { games: history.games.length, wins, matches: history.matches, matchWins: history.matchWins };
}

/** Counts kept in this browser while signed out. */
export function readGuestStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Stats>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function update(change: (stats: Stats) => void) {
  const stats = readGuestStats();
  change(stats);
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked: stats simply are not kept.
  }
}

/** Record a finished game, won or lost. */
export function recordGame(won: boolean) {
  if (readAccount()) return; // signed in, games are counted from the account's game records
  update((stats) => {
    stats.games += 1;
    if (won) stats.wins += 1;
  });
}

/** Record a multi-game match, including one finished early. */
export function recordMatch(won: boolean) {
  if (readAccount()) {
    queueChange({ matches: [{ id: newUploadId(), matches: 1, matchWins: won ? 1 : 0 }] });
    return;
  }
  update((stats) => {
    stats.matches += 1;
    if (won) stats.matchWins += 1;
  });
}
