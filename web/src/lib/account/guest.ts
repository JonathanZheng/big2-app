/** Everything this browser holds from signed-out play, as one bundle for the account. */
import { clearGuestResults, readGuestResults } from "@/lib/puzzle/puzzle";
import { clearProfile, readGuestGameRecords } from "@/lib/session/profile";
import { clearGuestReviews, readGuestReviews } from "@/lib/session/saved-reviews";
import { readGuestStats } from "@/lib/session/stats";
import type { HistoryBundle } from "./merge";

/** The guest data, or null when there is none. Card colour is a display setting and stays. */
export function readGuestBundle(): HistoryBundle | null {
  const games = readGuestGameRecords();
  const reviews = readGuestReviews();
  const puzzles = readGuestResults();
  const { matches, matchWins } = readGuestStats();
  if (!games.length && !reviews.length && !Object.keys(puzzles).length && !matches) return null;
  return {
    games,
    reviews,
    deletedReviews: [],
    puzzles,
    matches: matches ? [{ id: crypto.randomUUID(), matches, matchWins }] : [],
  };
}

export function clearGuest() {
  clearProfile();
  clearGuestReviews();
  clearGuestResults();
}
