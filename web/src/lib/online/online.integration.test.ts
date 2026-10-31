/**
 * End-to-end checks of online play against a running app and Supabase.
 * Skipped unless ONLINE_TEST_APP is set, for example:
 *
 *   ONLINE_TEST_APP=http://localhost:3123 npx vitest run src/lib/online/online.integration.test.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY in the environment (a local Supabase is fine).
 */
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Card } from "@/lib/engine/cards";
import { legalMoves } from "@/lib/engine/legal";
import type { GameState } from "@/lib/engine/game";

const APP = process.env.ONLINE_TEST_APP;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

interface Player { id: string; token: string; db: SupabaseClient }

async function player(name: string): Promise<Player> {
  const adminDb = createClient(URL, SECRET, { auth: { persistSession: false } });
  const email = `${name}-${Date.now()}@example.test`;
  const password = `pw-${Math.random()}`;
  const created = await adminDb.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id: created.data.user.id, token: signed.data.session.access_token, db };
}

async function call(p: Player, action: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${APP}/api/online`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.token}` },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function stateFor(p: Player, roomId: string): Promise<{ state: GameState; seat: number }> {
  const seats = (await p.db.from("room_seats").select("seat, user_id").eq("room_id", roomId)).data!;
  const seat = seats.find((s) => s.user_id === p.id)!.seat as number;
  const g = (await p.db.from("room_games").select("*").eq("room_id", roomId).single()).data!;
  const hand = (await p.db.from("room_hands").select("cards").eq("room_id", roomId).eq("seat", seat).single()).data!.cards as Card[];
  return {
    seat,
    state: {
      hands: (g.counts as number[]).map((n, s) => (s === seat ? hand : Array(n).fill(-1))),
      current: g.current, firstMove: g.first_move, lastPlay: g.last_play, passes: g.passes, history: g.history, winner: g.winner,
    },
  };
}

describe.skipIf(!APP)("online play", () => {
  let a: Player;
  let b: Player;
  let outsider: Player;
  let roomId = "";
  const adminDb = () => createClient(URL, SECRET, { auth: { persistSession: false } });

  beforeAll(async () => {
    [a, b, outsider] = await Promise.all([player("alice"), player("bob"), player("carol")]);
    expect((await call(a, "name", { name: "Alice" })).status).toBe(200);
    expect((await call(b, "name", { name: "Bob" })).status).toBe(200);
  });

  it("creates a room, lets a friend join by code, and starts with bots in empty seats", async () => {
    const created = await call(a, "create", { difficulty: "easy", games: 1, hints: false, turnSeconds: 30 });
    expect(created.status).toBe(200);
    roomId = created.body.id as string;
    expect((await call(b, "join", { code: created.body.code })).status).toBe(200);
    expect((await call(b, "start", { roomId })).status).toBe(403); // only the host
    expect((await call(a, "start", { roomId })).status).toBe(200);
    const seats = (await a.db.from("room_seats").select("seat, bot").eq("room_id", roomId).order("seat")).data!;
    expect(seats.map((s) => s.bot)).toEqual([false, false, true, true]);
  });

  it("never shows a player anyone else's hand, and shows outsiders nothing", async () => {
    const mine = (await b.db.from("room_hands").select("seat").eq("room_id", roomId)).data!;
    expect(mine.map((h) => h.seat)).toEqual([1]);
    expect((await b.db.from("room_games").select("room_id").eq("room_id", roomId)).data).toHaveLength(1);
    for (const table of ["rooms", "room_seats", "room_games", "room_hands"]) {
      const column = table === "rooms" ? "id" : "room_id";
      expect((await outsider.db.from(table).select("*").eq(column, roomId)).data).toEqual([]);
    }
  });

  it("does not let players write to the game directly", async () => {
    await b.db.from("room_games").update({ winner: 1 }).eq("room_id", roomId);
    await b.db.from("room_hands").update({ cards: [] }).eq("room_id", roomId);
    const g = (await adminDb().from("room_games").select("winner").eq("room_id", roomId).single()).data!;
    expect(g.winner).toBeNull();
    const hands = (await adminDb().from("room_hands").select("cards").eq("room_id", roomId)).data!;
    expect(hands.every((h) => (h.cards as number[]).length > 0)).toBe(true);
  });

  it("rejects moves out of turn and illegal moves", async () => {
    const { state } = await stateFor(a, roomId);
    const mover = state.current === 0 ? a : b;
    const waiter = mover === a ? b : a;
    const { state: moverState, seat } = await stateFor(mover, roomId);
    expect((await call(waiter, "move", { roomId, cards: legalMoves(moverState, seat)[0] })).status).toBe(409);
    expect((await call(mover, "move", { roomId, cards: [51, 50, 49, 48] })).status).toBe(400);
  });

  it("makes the move for a player whose time ran out, and not before", async () => {
    expect((await call(a, "timeout", { roomId })).status).toBe(409);
    const before = (await adminDb().from("room_games").select("version, current").eq("room_id", roomId).single()).data!;
    await adminDb().from("room_games").update({ turn_deadline: new Date(Date.now() - 1000).toISOString() }).eq("room_id", roomId);
    expect((await call(b, "timeout", { roomId })).status).toBe(200);
    const after = (await adminDb().from("room_games").select("version, history").eq("room_id", roomId).single()).data!;
    expect(after.version).toBe(before.version + 1);
    expect((after.history as { player: number }[]).some((p) => p.player === before.current)).toBe(true);
  });

  it("lets the host hand a quiet seat to a bot, and gives it back when the player returns", async () => {
    expect((await call(a, "takeover", { roomId, seat: 1 })).status).toBe(409); // Bob checked in recently
    await adminDb().from("room_seats").update({ last_seen: new Date(Date.now() - 120_000).toISOString() }).eq("room_id", roomId).eq("seat", 1);
    expect((await call(b, "takeover", { roomId, seat: 0 })).status).toBe(403); // only the host
    expect((await call(a, "takeover", { roomId, seat: 1 })).status).toBe(200);
    let seat = (await a.db.from("room_seats").select("bot").eq("room_id", roomId).eq("seat", 1).single()).data!;
    expect(seat.bot).toBe(true);
    expect((await call(b, "heartbeat", { roomId })).status).toBe(200);
    seat = (await a.db.from("room_seats").select("bot").eq("room_id", roomId).eq("seat", 1).single()).data!;
    expect(seat.bot).toBe(false);
  });

  it("plays to the end and counts the game in both players' stats", async () => {
    for (let turn = 0; turn < 300; turn++) {
      const { state, seat } = await stateFor(a, roomId);
      if (state.winner !== null) break;
      const mover = state.current === seat ? a : b;
      const view = mover === a ? { state, seat } : await stateFor(b, roomId);
      const moves = legalMoves(view.state, view.seat);
      const res = await call(mover, "move", { roomId, cards: moves.find((m) => m.length > 0) ?? [] });
      expect(res.status).toBe(200);
    }
    const g = (await a.db.from("room_games").select("winner").eq("room_id", roomId).single()).data!;
    expect(g.winner).not.toBeNull();
    for (const p of [a, b]) {
      const stats = (await p.db.from("player_stats").select("games").eq("user_id", p.id).single()).data!;
      expect(stats.games).toBe(1);
    }
    const room = (await a.db.from("rooms").select("status").eq("id", roomId).single()).data!;
    expect(room.status).toBe("finished");
  }, 120_000);
});
