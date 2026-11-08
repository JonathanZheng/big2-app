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
  const [games, reviews, puzzles, matches] = await Promise.all([
    check(db.from("history_games").select("record").eq("user_id", userId).order("at")),
    check(db.from("history_reviews").select("review").eq("user_id", userId).order("at", { ascending: false })),
    check(db.from("history_puzzles").select("day, result").eq("user_id", userId)),
    check(db.from("history_matches").select("matches, match_wins").eq("user_id", userId)),
  ]);
  return {
    games: (games as { record: GameRecord }[]).map((g) => g.record),
    reviews: (reviews as { review: SavedReview }[]).map((r) => r.review),
    puzzles: Object.fromEntries((puzzles as { day: string; result: PuzzleResult }[]).map((p) => [p.day, p.result])),
    matches: (matches as { matches: number }[]).reduce((n, m) => n + m.matches, 0),
    matchWins: (matches as { match_wins: number }[]).reduce((n, m) => n + m.match_wins, 0),
  };
}

export async function mergeIntoAccount(userId: string, bundle: HistoryBundle): Promise<AccountHistory> {
  const db = admin();
  const before = await loadHistory(userId);
  const changes = historyChanges(before, mergeHistory(before, { ...bundle, matches: [] }));
  const writes: PromiseLike<unknown>[] = [];
  if (changes.upsertGames.length) {
    writes.push(check(db.from("history_games").upsert(changes.upsertGames.map((g) => ({ user_id: userId, at: g.at, record: g })))));
  }
  if (changes.deleteGames.length) {
    writes.push(check(db.from("history_games").delete().eq("user_id", userId).in("at", changes.deleteGames)));
  }
  if (changes.upsertReviews.length) {
    writes.push(check(db.from("history_reviews").upsert(changes.upsertReviews.map((r) => ({ user_id: userId, id: r.id, at: r.at, review: r })))));
  }
  if (changes.deleteReviews.length) {
    writes.push(check(db.from("history_reviews").delete().eq("user_id", userId).in("id", changes.deleteReviews)));
  }
  const days = Object.entries(changes.upsertPuzzles);
  if (days.length) {
    writes.push(check(db.from("history_puzzles").upsert(days.map(([day, result]) => ({ user_id: userId, day, result })))));
  }
  if (bundle.matches.length) {
    writes.push(check(db.from("history_matches").upsert(
      bundle.matches.map((m) => ({ user_id: userId, upload_id: m.id, matches: m.matches, match_wins: m.matchWins })),
      { onConflict: "user_id,upload_id", ignoreDuplicates: true },
    )));
  }
  await Promise.all(writes);
  return loadHistory(userId);
}

/** RESET STATS: games and match counts go; saved reviews and puzzle answers stay. */
export async function resetHistory(userId: string): Promise<AccountHistory> {
  const db = admin();
  await Promise.all([
    check(db.from("history_games").delete().eq("user_id", userId)),
    check(db.from("history_matches").delete().eq("user_id", userId)),
  ]);
  return loadHistory(userId);
}
