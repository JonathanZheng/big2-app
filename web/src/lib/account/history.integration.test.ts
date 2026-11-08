/**
 * End-to-end checks of /api/history against a running app and Supabase.
 * Skipped unless ONLINE_TEST_APP is set, for example:
 *
 *   ONLINE_TEST_APP=http://localhost:3123 npx vitest run src/lib/account/history.integration.test.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY in the environment (a local Supabase is fine).
 */
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { AccountHistory } from "./merge";

const APP = process.env.ONLINE_TEST_APP;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

interface Player { token: string; db: SupabaseClient }

async function player(name: string): Promise<Player> {
  const adminDb = createClient(URL, SECRET, { auth: { persistSession: false } });
  const email = `${name}-${Date.now()}@example.test`;
  const password = `pw-${Math.random()}`;
  const created = await adminDb.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { token: signed.data.session.access_token, db };
}

async function call(token: string | null, body: Record<string, unknown>) {
  const response = await fetch(`${APP}/api/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { history: AccountHistory; error?: string } };
}

const game = (at: number, analysed = false) => ({
  at, difficulty: "easy", won: true, cardsLeft: 0, plays: [0, 1], suits: [1, 0, 0, 0], hints: 0,
  ...(analysed ? { analysis: { moves: 1, best: 1 } } : {}),
});

const review = { id: "r1", at: 5, title: "VS BOTS · EASY", final: {}, names: [], seats: [], youSeat: 0, players: [0], scoreAll: true };

describe.skipIf(!APP)("account history", () => {
  it("requires sign-in", async () => {
    expect((await call(null, { action: "load" })).status).toBe(401);
  });

  it("merging twice counts once", async () => {
    const p = await player("merge");
    const bundle = {
      games: [game(1), game(2)], reviews: [review], puzzles: { "2026-11-01": { cards: [1], label: "Good" } },
      matches: [{ id: "m1", matches: 1, matchWins: 1 }],
    };
    await call(p.token, { action: "merge", bundle });
    const { status, body } = await call(p.token, { action: "merge", bundle });
    expect(status).toBe(200);
    expect(body.history.games).toHaveLength(2);
    expect(body.history.reviews).toHaveLength(1);
    expect([body.history.matches, body.history.matchWins]).toEqual([1, 1]);
  });

  it("keeps the better puzzle and fills in analysis", async () => {
    const p = await player("better");
    await call(p.token, { action: "merge", bundle: { games: [game(1)], puzzles: { "2026-11-01": { cards: [1], label: "Best" } } } });
    const { body } = await call(p.token, {
      action: "merge", bundle: { games: [game(1, true)], puzzles: { "2026-11-01": { cards: [2], label: "Mistake" } } },
    });
    expect(body.history.puzzles["2026-11-01"].label).toBe("Best");
    expect(body.history.games[0].analysis).toBeTruthy();
  });

  it("reset clears games and matches but keeps reviews and puzzles", async () => {
    const p = await player("reset");
    await call(p.token, {
      action: "merge",
      bundle: { games: [game(1)], reviews: [review], puzzles: { "2026-11-01": { cards: [1], label: "Good" } }, matches: [{ id: "m", matches: 2, matchWins: 1 }] },
    });
    const { body } = await call(p.token, { action: "reset" });
    expect(body.history.games).toEqual([]);
    expect(body.history.matches).toBe(0);
    expect(body.history.reviews).toHaveLength(1);
    expect(Object.keys(body.history.puzzles)).toEqual(["2026-11-01"]);
  });

  it("players cannot read the tables directly", async () => {
    const p = await player("direct");
    await call(p.token, { action: "merge", bundle: { games: [game(1)] } });
    const { data, error } = await p.db.from("history_games").select();
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("rejects a malformed bundle", async () => {
    const p = await player("bad");
    const { status } = await call(p.token, { action: "merge", bundle: { games: "lots" } });
    expect(status).toBe(400);
  });
});
