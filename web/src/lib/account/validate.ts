/** Shape and size checks for history sent to /api/history. */
import type { Label } from "@/lib/model/advice";
import type { PuzzleResult } from "@/lib/puzzle/puzzle";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { DELETE_LIMIT, GAME_CAP, type HistoryBundle, MATCH_LIMIT, type MatchUpload, PUZZLE_LIMIT, REVIEW_CAP } from "./merge";

const LABELS: Label[] = ["Best", "Good", "Inaccuracy", "Mistake", "Blunder"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
const shortString = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

function list(value: unknown, max: number): unknown[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= max ? value : null;
}

/** The bundle, or null when it is not valid. */
export function parseBundle(value: unknown): HistoryBundle | null {
  if (!isObject(value)) return null;
  const games = list(value.games, GAME_CAP);
  const reviews = list(value.reviews, REVIEW_CAP);
  const deletedReviews = list(value.deletedReviews, DELETE_LIMIT);
  const matches = list(value.matches, MATCH_LIMIT);
  const puzzles = value.puzzles === undefined ? {} : value.puzzles;
  if (!games || !reviews || !deletedReviews || !matches || !isObject(puzzles)) return null;

  if (!games.every((g) => isObject(g) && Number.isFinite(g.at))) return null;
  if (!reviews.every((r) => isObject(r) && shortString(r.id, 100) && Number.isFinite(r.at))) return null;
  if (!deletedReviews.every((id) => shortString(id, 100))) return null;
  if (!matches.every((m) => isObject(m) && shortString(m.id, 64) && isCount(m.matches) && isCount(m.matchWins) && m.matchWins <= m.matches)) {
    return null;
  }
  const days = Object.entries(puzzles);
  if (days.length > PUZZLE_LIMIT) return null;
  if (!days.every(([day, p]) => DAY.test(day) && isObject(p) && Array.isArray(p.cards) && LABELS.includes(p.label as Label))) return null;

  return {
    games: games as GameRecord[],
    reviews: reviews as SavedReview[],
    deletedReviews: deletedReviews as string[],
    puzzles: puzzles as Record<string, PuzzleResult>,
    matches: matches as MatchUpload[],
  };
}
