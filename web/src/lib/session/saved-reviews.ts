/** Finished games saved for review later, kept in this browser or, when signed in, on the account. */
import { queueChange, readAccount } from "@/lib/account/store";
import type { GameState } from "@/lib/engine/game";

const KEY = "big2.reviews.v1";
const KEEP = 50;

export interface SavedReview {
  id: string;
  /** When it was saved (milliseconds since 1970). */
  at: number;
  /** Short description, such as "VS BOTS · HARD". */
  title: string;
  final: GameState;
  names: string[];
  seats: number[];
  youSeat: number;
  /** Seats whose moves count towards the review summary. */
  players: number[];
  /** Score every seat's moves (all hands are known), not only `players`. */
  scoreAll: boolean;
}

export function readSavedReviews(): SavedReview[] {
  return readAccount()?.history.reviews ?? readGuestReviews();
}

/** Reviews kept in this browser while signed out. */
export function readGuestReviews(): SavedReview[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SavedReview[]) : [];
  } catch {
    return [];
  }
}

function write(reviews: SavedReview[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(reviews.slice(0, KEEP)));
    return true;
  } catch {
    return false;
  }
}

/** Save a review at the top of the list; saving one already there keeps its place. Returns false if storage refused it. */
export function saveReview(review: SavedReview): boolean {
  const queued = queueChange({ reviews: [review] });
  if (queued !== null) return queued;
  const saved = readGuestReviews();
  if (saved.some((r) => r.id === review.id)) return write(saved.map((r) => (r.id === review.id ? review : r)));
  return write([review, ...saved]);
}

export function deleteSavedReview(id: string) {
  if (queueChange({ deletedReviews: [id] }) !== null) return;
  write(readGuestReviews().filter((r) => r.id !== id));
}

export function clearGuestReviews() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
