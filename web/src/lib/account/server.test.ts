import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { type FakeSupabase, type Query, type Reply, args, fakeSupabase, is } from "@/lib/online/test-helpers";
import { emptyBundle } from "./merge";
import { loadHistory, mergeIntoAccount, resetHistory } from "./server";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/online/server", () => ({ admin: () => fake.db }));

const game = (at: number): GameRecord => ({ at, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });
const review = { id: "rv1" } as SavedReview;

let db: FakeSupabase;
let respond: (q: Query) => Reply;

/** An account with one game, one review, one puzzle and match totals sent back as strings. */
const stored = (q: Query): Reply => {
  if (q.table === "history_games") return { data: [{ record: game(1) }] };
  if (q.table === "history_reviews") return { data: [{ review }] };
  if (q.table === "history_puzzles") return { data: [{ day: "2026-01-01", result: { solved: true } }] };
  if (q.table === "rpc:history_match_totals") return { data: { matches: "3", match_wins: 2 } };
  return {};
};

beforeEach(() => {
  respond = stored;
  db = fakeSupabase((q) => respond(q));
  fake.db = db;
});

describe("loadHistory", () => {
  it("reads every table for the user and turns bigint sums into numbers", async () => {
    await expect(loadHistory("u1")).resolves.toEqual({
      games: [game(1)],
      reviews: [review],
      puzzles: { "2026-01-01": { solved: true } },
      matches: 3,
      matchWins: 2,
    });
    expect(args(db.queries.find((q) => q.table === "history_games")!, "eq")).toEqual(["user_id", "u1"]);
    expect(args(db.queries.find((q) => q.table === "history_reviews")!, "order")).toEqual(["at", { ascending: false }]);
    expect(args(db.queries.find((q) => q.table === "rpc:history_match_totals")!, "rpc")).toEqual([{ p_user: "u1" }]);
  });

  it("throws the database's message on an error", async () => {
    respond = (q) => (q.table === "history_puzzles" ? { error: { message: "denied" } } : stored(q));
    await expect(loadHistory("u1")).rejects.toThrow("denied");
  });
});

describe("mergeIntoAccount", () => {
  it("sends only what changed, plus deletions and match uploads, then reloads", async () => {
    const bundle = {
      ...emptyBundle(),
      games: [game(1), game(2)],
      deletedReviews: ["old"],
      matches: [{ id: "m1", matches: 1, matchWins: 1 }],
    };
    const result = await mergeIntoAccount("u1", bundle);
    const merge = db.queries.find((q) => q.table === "rpc:merge_history")!;
    expect(args(merge, "rpc")).toEqual([{
      p_user: "u1",
      p_games: [game(2)],
      p_reviews: [],
      p_deleted_reviews: ["old"],
      p_puzzles: {},
      p_matches: [{ id: "m1", matches: 1, matchWins: 1 }],
    }]);
    expect(result.games).toEqual([game(1)]);
    // Loaded before and after the merge.
    expect(db.queries.filter((q) => q.table === "history_games")).toHaveLength(2);
  });

  it("throws when the merge fails", async () => {
    respond = (q) => (q.table === "rpc:merge_history" ? { error: { message: "locked" } } : stored(q));
    await expect(mergeIntoAccount("u1", emptyBundle())).rejects.toThrow("locked");
  });
});

describe("resetHistory", () => {
  it("deletes the games, zeroes the match rows and reloads", async () => {
    await resetHistory("u1");
    expect(db.queries.some((q) => is(q, "history_games", "delete"))).toBe(true);
    const zero = db.queries.find((q) => is(q, "history_matches", "update"))!;
    expect(args(zero, "update")).toEqual([{ matches: 0, match_wins: 0 }]);
    expect(args(zero, "eq")).toEqual(["user_id", "u1"]);
    expect(db.queries.some((q) => q.table === "history_reviews")).toBe(true);
  });
});
