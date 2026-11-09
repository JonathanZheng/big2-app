/** Shape and size checks for history sent to /api/history. */
import type { Label } from "@/lib/model/advice";
import type { PuzzleResult } from "@/lib/puzzle/puzzle";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { DELETE_LIMIT, GAME_CAP, type HistoryBundle, MATCH_LIMIT, type MatchUpload, PUZZLE_LIMIT, REVIEW_CAP } from "./merge";

/** The most one game record or saved review may take as JSON. Real ones are well under a tenth of this. */
export const MAX_GAME_BYTES = 1000;
export const MAX_REVIEW_BYTES = 16000;
/** The most one request may carry: a bundle at every limit with every item at its largest still fits. */
export const MAX_REQUEST_BYTES = 1_500_000;

const LABELS: Label[] = ["Best", "Good", "Inaccuracy", "Mistake", "Blunder"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const ANALYSIS_FIELDS = [
  "moves", "best", "good", "inaccuracies", "mistakes", "blunders", "passedInstead", "playedInstead", "otherPlay",
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;
const isTally = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000;
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isSeat = (v: unknown, from = 0): v is number => Number.isInteger(v) && (v as number) >= from && (v as number) <= 3;
const isCard = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 51;
const isCards = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 52 && v.every(isCard);
const shortString = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const arrayOf = (v: unknown, max: number, item: (x: unknown) => boolean) => Array.isArray(v) && v.length <= max && v.every(item);
const fits = (v: unknown, max: number) => new TextEncoder().encode(JSON.stringify(v)).length <= max;

function list(value: unknown, max: number): unknown[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= max ? value : null;
}

/** Every field the profile reads, so a stored record can never break it. */
function isGame(g: unknown): g is GameRecord {
  return isObject(g) && isTime(g.at) && DIFFICULTIES.includes(g.difficulty as string) && typeof g.won === "boolean"
    && Number.isInteger(g.cardsLeft) && (g.cardsLeft as number) >= 0 && (g.cardsLeft as number) <= 13
    && arrayOf(g.plays, 9, isTally) && arrayOf(g.suits, 4, isTally) && isTally(g.hints)
    && (g.analysis === undefined || (isObject(g.analysis) && ANALYSIS_FIELDS.every((f) => isTally((g.analysis as Record<string, unknown>)[f]))))
    && fits(g, MAX_GAME_BYTES);
}

const isPlay = (p: unknown) => isObject(p) && isSeat(p.player) && isCards(p.cards);

/** Every field the saved reviews list and the review screen read. */
function isReview(r: unknown): r is SavedReview {
  return isObject(r) && shortString(r.id, 100) && isTime(r.at) && shortString(r.title, 200)
    && isObject(r.final) && arrayOf(r.final.hands, 4, isCards) && arrayOf(r.final.history, 1000, isPlay)
    && arrayOf(r.names, 4, (n) => typeof n === "string" && n.length <= 100)
    && arrayOf(r.seats, 4, (s) => isSeat(s)) && isSeat(r.youSeat, -1) && arrayOf(r.players, 4, (s) => isSeat(s))
    && typeof r.scoreAll === "boolean"
    && fits(r, MAX_REVIEW_BYTES);
}

const isPuzzle = (p: unknown): p is PuzzleResult => isObject(p) && isCards(p.cards) && p.cards.length <= 13 && LABELS.includes(p.label as Label);

/** The bundle, or null when it is not valid. */
export function parseBundle(value: unknown): HistoryBundle | null {
  if (!isObject(value)) return null;
  const games = list(value.games, GAME_CAP);
  const reviews = list(value.reviews, REVIEW_CAP);
  const deletedReviews = list(value.deletedReviews, DELETE_LIMIT);
  const matches = list(value.matches, MATCH_LIMIT);
  const puzzles = value.puzzles === undefined ? {} : value.puzzles;
  if (!games || !reviews || !deletedReviews || !matches || !isObject(puzzles)) return null;

  if (!games.every(isGame)) return null;
  if (!reviews.every(isReview)) return null;
  if (!deletedReviews.every((id) => shortString(id, 100))) return null;
  if (!matches.every((m) => isObject(m) && shortString(m.id, 64) && isCount(m.matches) && isCount(m.matchWins) && m.matchWins <= m.matches)) {
    return null;
  }
  const days = Object.entries(puzzles);
  if (days.length > PUZZLE_LIMIT) return null;
  if (!days.every(([day, p]) => DAY.test(day) && isPuzzle(p))) return null;

  return {
    games: games as GameRecord[],
    reviews: reviews as SavedReview[],
    deletedReviews: deletedReviews as string[],
    puzzles: puzzles as Record<string, PuzzleResult>,
    matches: matches as MatchUpload[],
  };
}

/** The bundle without the games, reviews and puzzle answers the server would refuse, so one bad item cannot sink the rest. */
export function sendable(bundle: HistoryBundle): HistoryBundle {
  return {
    ...bundle,
    games: bundle.games.filter(isGame),
    reviews: bundle.reviews.filter(isReview),
    puzzles: Object.fromEntries(Object.entries(bundle.puzzles).filter(([day, p]) => DAY.test(day) && isPuzzle(p))),
  };
}
