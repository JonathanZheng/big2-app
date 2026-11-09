/**
 * Server side of account history: the only code that reads or writes the
 * history tables. Runs in /api/history with the secret key.
 */
import "server-only";
import type { PuzzleResult } from "@/lib/puzzle/puzzle";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { admin } from "@/lib/online/server";
import { type AccountHistory, type HistoryBundle, historyChanges, mergeHistory } from "./merge";

async function check<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function loadHistory(userId: string): Promise<AccountHistory> {
  const db = admin();
  const [games, reviews, puzzles, totals] = await Promise.all([
    check(db.from("history_games").select("record").eq("user_id", userId).order("at")),
    check(db.from("history_reviews").select("review").eq("user_id", userId).order("at", { ascending: false })),
    check(db.from("history_puzzles").select("day, result").eq("user_id", userId)),
    check(db.rpc("history_match_totals", { p_user: userId }).single()),
  ]);
  return {
    games: (games as { record: GameRecord }[]).map((g) => g.record),
    reviews: (reviews as { review: SavedReview }[]).map((r) => r.review),
    puzzles: Object.fromEntries((puzzles as { day: string; result: PuzzleResult }[]).map((p) => [p.day, p.result])),
    // Sums come back as bigint, which arrives as a number or a string.
    matches: Number((totals as { matches: number | string }).matches),
    matchWins: Number((totals as { match_wins: number | string }).match_wins),
  };
}

export async function mergeIntoAccount(userId: string, bundle: HistoryBundle): Promise<AccountHistory> {
  const before = await loadHistory(userId);
  const changes = historyChanges(before, mergeHistory(before, { ...bundle, matches: [] }));
  // One transaction, one merge per account at a time; it also trims to the caps
  // and keeps the merge rules against a merge that committed after `before` was read.
  await check(admin().rpc("merge_history", {
    p_user: userId,
    p_games: changes.upsertGames,
    p_reviews: changes.upsertReviews,
    p_deleted_reviews: bundle.deletedReviews,
    p_puzzles: changes.upsertPuzzles,
    p_matches: bundle.matches,
  }));
  return loadHistory(userId);
}

/**
 * RESET STATS: games and match counts go; saved reviews and puzzle answers stay.
 * Match rows are zeroed, not deleted, so an upload retried after the reset is
 * still recognised by its id and not counted again.
 */
export async function resetHistory(userId: string): Promise<AccountHistory> {
  const db = admin();
  await Promise.all([
    check(db.from("history_games").delete().eq("user_id", userId)),
    check(db.from("history_matches").update({ matches: 0, match_wins: 0 }).eq("user_id", userId)),
  ]);
  return loadHistory(userId);
}
