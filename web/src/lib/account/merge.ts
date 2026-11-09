/**
 * The shapes of account history and every rule for merging it. Shared by the
 * browser (its own copy and upload queue) and the server (what it stores).
 */
import type { Label } from "@/lib/model/advice";
import type { PuzzleResult } from "@/lib/puzzle/puzzle";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";

export const GAME_CAP = 500;
export const REVIEW_CAP = 50;
/** The most of each of these one request to /api/history may carry. */
export const PUZZLE_LIMIT = 400;
export const DELETE_LIMIT = 200;
export const MATCH_LIMIT = 500;

/** Everything an account holds. */
export interface AccountHistory {
  games: GameRecord[];
  reviews: SavedReview[];
  puzzles: Record<string, PuzzleResult>;
  matches: number;
  matchWins: number;
}

/** Match counts sent once; the id stops a retry counting them twice. */
export interface MatchUpload {
  id: string;
  matches: number;
  matchWins: number;
}

/** Changes on their way to the account. */
export interface HistoryBundle {
  games: GameRecord[];
  reviews: SavedReview[];
  deletedReviews: string[];
  puzzles: Record<string, PuzzleResult>;
  matches: MatchUpload[];
}

export interface HistoryChanges {
  upsertGames: GameRecord[];
  deleteGames: number[];
  upsertReviews: SavedReview[];
  deleteReviews: string[];
  upsertPuzzles: Record<string, PuzzleResult>;
}

const LABEL_ORDER: Label[] = ["Best", "Good", "Inaccuracy", "Mistake", "Blunder"];

export function emptyHistory(): AccountHistory {
  return { games: [], reviews: [], puzzles: {}, matches: 0, matchWins: 0 };
}

export function emptyBundle(): HistoryBundle {
  return { games: [], reviews: [], deletedReviews: [], puzzles: {}, matches: [] };
}

export function isEmptyBundle(b: HistoryBundle): boolean {
  return !b.games.length && !b.reviews.length && !b.deletedReviews.length && !Object.keys(b.puzzles).length && !b.matches.length;
}

/** The better of two answers to the same day's puzzle; a tie keeps the existing one. */
export function betterPuzzle(existing: PuzzleResult | undefined, incoming: PuzzleResult): PuzzleResult {
  if (!existing) return incoming;
  return LABEL_ORDER.indexOf(incoming.label) < LABEL_ORDER.indexOf(existing.label) ? incoming : existing;
}

/** Union by `at`; an existing record wins unless it lacks an analysis the incoming one has. */
function mergeGames(existing: GameRecord[], incoming: GameRecord[]): GameRecord[] {
  const byAt = new Map(existing.map((g) => [g.at, g]));
  for (const g of incoming) {
    const old = byAt.get(g.at);
    if (!old || (!old.analysis && g.analysis)) byAt.set(g.at, g);
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

function mergePuzzles(existing: Record<string, PuzzleResult>, incoming: Record<string, PuzzleResult>) {
  const merged = { ...existing };
  for (const [day, result] of Object.entries(incoming)) merged[day] = betterPuzzle(merged[day], result);
  return merged;
}

/** Union by id, incoming replacing existing. */
function mergeReviews(existing: SavedReview[], incoming: SavedReview[]): SavedReview[] {
  const ids = new Set(incoming.map((r) => r.id));
  return [...incoming, ...existing.filter((r) => !ids.has(r.id))];
}

/** Apply a change to an account's history, trimming to the caps. */
export function mergeHistory(history: AccountHistory, change: Partial<HistoryBundle>): AccountHistory {
  const deleted = new Set(change.deletedReviews ?? []);
  const matches = change.matches ?? [];
  return {
    games: mergeGames(history.games, change.games ?? []).slice(-GAME_CAP),
    reviews: mergeReviews(history.reviews, change.reviews ?? [])
      .filter((r) => !deleted.has(r.id))
      .sort((a, b) => b.at - a.at)
      .slice(0, REVIEW_CAP),
    puzzles: mergePuzzles(history.puzzles, change.puzzles ?? {}),
    matches: history.matches + matches.reduce((n, m) => n + m.matches, 0),
    matchWins: history.matchWins + matches.reduce((n, m) => n + m.matchWins, 0),
  };
}

/** Add a later change to queued changes, so that whichever came last wins for each review. */
export function combineBundles(earlier: HistoryBundle, later: Partial<HistoryBundle>): HistoryBundle {
  const saved = new Set((later.reviews ?? []).map((r) => r.id));
  const deleted = new Set(later.deletedReviews ?? []);
  return {
    games: mergeGames(earlier.games, later.games ?? []).slice(-GAME_CAP),
    reviews: mergeReviews(earlier.reviews, later.reviews ?? [])
      .filter((r) => !deleted.has(r.id))
      .sort((a, b) => b.at - a.at)
      .slice(0, REVIEW_CAP),
    deletedReviews: [...new Set([...earlier.deletedReviews.filter((id) => !saved.has(id)), ...deleted])],
    puzzles: mergePuzzles(earlier.puzzles, later.puzzles ?? {}),
    matches: [...earlier.matches, ...(later.matches ?? [])],
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The parts of `bundle` that are (or with `inOther` false, are not) exactly the same in `other`. */
export function bundleOverlap(bundle: HistoryBundle, other: HistoryBundle, inOther: boolean): HistoryBundle {
  const games = new Map(other.games.map((g) => [g.at, g]));
  const reviews = new Map(other.reviews.map((r) => [r.id, r]));
  const deleted = new Set(other.deletedReviews);
  const matches = new Map(other.matches.map((m) => [m.id, m]));
  return {
    games: bundle.games.filter((g) => same(games.get(g.at), g) === inOther),
    reviews: bundle.reviews.filter((r) => same(reviews.get(r.id), r) === inOther),
    deletedReviews: bundle.deletedReviews.filter((id) => deleted.has(id) === inOther),
    puzzles: Object.fromEntries(Object.entries(bundle.puzzles).filter(([day, p]) => same(other.puzzles[day], p) === inOther)),
    matches: bundle.matches.filter((m) => same(matches.get(m.id), m) === inOther),
  };
}

/** Split a queued bundle into parts that each fit in one request. Games and reviews already fit the caps. */
export function splitBundle(bundle: HistoryBundle): HistoryBundle[] {
  const puzzles = Object.entries(bundle.puzzles);
  const parts = Math.max(
    1,
    Math.ceil(puzzles.length / PUZZLE_LIMIT),
    Math.ceil(bundle.deletedReviews.length / DELETE_LIMIT),
    Math.ceil(bundle.matches.length / MATCH_LIMIT),
  );
  if (parts === 1) return [bundle];
  return Array.from({ length: parts }, (_, i) => ({
    games: i === 0 ? bundle.games : [],
    reviews: i === 0 ? bundle.reviews : [],
    deletedReviews: bundle.deletedReviews.slice(i * DELETE_LIMIT, (i + 1) * DELETE_LIMIT),
    puzzles: Object.fromEntries(puzzles.slice(i * PUZZLE_LIMIT, (i + 1) * PUZZLE_LIMIT)),
    matches: bundle.matches.slice(i * MATCH_LIMIT, (i + 1) * MATCH_LIMIT),
  }));
}

/** The rows that must be written to turn `before` into `after`. */
export function historyChanges(before: AccountHistory, after: AccountHistory): HistoryChanges {
  const oldGames = new Map(before.games.map((g) => [g.at, g]));
  const newGames = new Set(after.games.map((g) => g.at));
  const oldReviews = new Map(before.reviews.map((r) => [r.id, r]));
  const newReviews = new Set(after.reviews.map((r) => r.id));
  return {
    upsertGames: after.games.filter((g) => !same(oldGames.get(g.at), g)),
    deleteGames: before.games.filter((g) => !newGames.has(g.at)).map((g) => g.at),
    upsertReviews: after.reviews.filter((r) => !same(oldReviews.get(r.id), r)),
    deleteReviews: before.reviews.filter((r) => !newReviews.has(r.id)).map((r) => r.id),
    upsertPuzzles: Object.fromEntries(Object.entries(after.puzzles).filter(([day, p]) => !same(before.puzzles[day], p))),
  };
}
