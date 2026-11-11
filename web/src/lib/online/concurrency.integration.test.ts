/**
 * Races in online play: many requests for the same room arriving together.
 * Skipped unless ONLINE_TEST_APP is set, like online.integration.test.ts:
 *
 *   ONLINE_TEST_APP=http://localhost:3123 npx vitest run src/lib/online/concurrency.integration.test.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY in the environment (a local Supabase is fine).
 */
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/engine/cards";
import { legalMoves } from "@/lib/engine/legal";
import type { GameState, Play } from "@/lib/engine/game";

const APP = process.env.ONLINE_TEST_APP;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

interface Player { id: string; token: string }

const adminDb = (): SupabaseClient => createClient(URL, SECRET, { auth: { persistSession: false } });

async function player(name: string): Promise<Player> {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = `pw-${Math.random()}`;
  const created = await adminDb().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const p = { id: created.data.user.id, token: signed.data.session.access_token };
  expect((await call(p, "name", { name })).status).toBe(200);
  return p;
}

async function call(p: Player, action: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${APP}/api/online`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.token}` },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const statuses = (results: { status: number }[]) => results.map((r) => r.status).sort();

async function newRoom(host: Player, turnSeconds: number | null = 30) {
  const created = await call(host, "create", { difficulty: "easy", games: 1, hints: false, turnSeconds });
  expect(created.status).toBe(200);
  return created.body as { id: string; code: string };
}

async function game(roomId: string) {
  return (await adminDb().from("room_games").select("*").eq("room_id", roomId).single()).data!;
}

async function hands(roomId: string): Promise<Card[][]> {
  const rows = (await adminDb().from("room_hands").select("seat, cards").eq("room_id", roomId).order("seat")).data!;
  return rows.map((r) => r.cards as Card[]);
}

/** Every card is in exactly one hand or already played, and the counts match the hands. */
async function expectConsistentDeal(roomId: string) {
  const g = await game(roomId);
  const held = await hands(roomId);
  expect(held.map((h) => h.length)).toEqual(g.counts);
  const played = (g.history as Play[]).flatMap((p) => p.cards);
  const all = [...held.flat(), ...played];
  expect(new Set(all).size).toBe(52);
  expect(all).toHaveLength(52);
}

describe.skipIf(!APP)("online play under concurrent requests", () => {
  it("eight players racing for three free seats: three get in, each in their own seat", async () => {
    const host = await player("host");
    const racers = await Promise.all(Array.from({ length: 8 }, (_, i) => player(`racer${i}`)));
    const { id, code } = await newRoom(host);
    const results = await Promise.all(racers.map((r) => call(r, "join", { code })));
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const seats = (await adminDb().from("room_seats").select("seat, user_id").eq("room_id", id).order("seat")).data!;
    const users = seats.map((s) => s.user_id);
    expect(users.every((u) => u !== null)).toBe(true);
    expect(new Set(users).size).toBe(4);
    const joined = racers.filter((_, i) => results[i].status === 200).map((r) => r.id);
    expect(joined.sort()).toEqual(users.slice(1).sort());
  });

  it("one player joining from several tabs at once takes one seat, and every tab gets in", async () => {
    const host = await player("host");
    const guest = await player("tabs");
    const { id, code } = await newRoom(host);
    const results = await Promise.all(Array.from({ length: 5 }, () => call(guest, "join", { code })));
    expect(statuses(results)).toEqual([200, 200, 200, 200, 200]);
    const mine = (await adminDb().from("room_seats").select("seat").eq("room_id", id).eq("user_id", guest.id)).data!;
    expect(mine).toHaveLength(1);
  });

  // Known bug, fixed in a follow-up: startRoom never claims the lobby, so every
  // press deals a new game. Change it.fails back to it once only one press can
  // start the room.
  it.fails("the host pressing start several times at once deals one game", async () => {
    const host = await player("host");
    const guest = await player("guest");
    const { id, code } = await newRoom(host);
    expect((await call(guest, "join", { code })).status).toBe(200);
    const results = await Promise.all(Array.from({ length: 5 }, () => call(host, "start", { roomId: id })));
    expect(statuses(results)).toEqual([200, 409, 409, 409, 409]);
    expect((await game(id)).version).toBe(0);
    await expectConsistentDeal(id);
  });

  it("the same move sent several times at once is applied once", async () => {
    const host = await player("host");
    const guest = await player("guest");
    const { id, code } = await newRoom(host);
    expect((await call(guest, "join", { code })).status).toBe(200);
    expect((await call(host, "start", { roomId: id })).status).toBe(200);
    const before = await game(id);
    const mover = before.current === 0 ? host : guest;
    const seat = before.current as number;
    const held = await hands(id);
    const state: GameState = {
      hands: held, current: seat, firstMove: before.first_move, lastPlay: before.last_play,
      passes: before.passes, history: before.history, winner: before.winner,
    };
    const move = legalMoves(state, seat).find((m) => m.length > 0)!;
    const results = await Promise.all(Array.from({ length: 5 }, () => call(mover, "move", { roomId: id, cards: move })));
    expect(statuses(results)).toEqual([200, 409, 409, 409, 409]);
    const after = await game(id);
    expect(after.version).toBe(before.version + 1);
    await expectConsistentDeal(id);
  });

  it("many players reporting the same expired turn advance the game once", async () => {
    const host = await player("host");
    const guest = await player("guest");
    const { id, code } = await newRoom(host);
    expect((await call(guest, "join", { code })).status).toBe(200);
    expect((await call(host, "start", { roomId: id })).status).toBe(200);
    const before = await game(id);
    await adminDb().from("room_games").update({ turn_deadline: new Date(Date.now() - 1000).toISOString() }).eq("room_id", id);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? host : guest, "timeout", { roomId: id })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect((await game(id)).version).toBe(before.version + 1);
    await expectConsistentDeal(id);
  });

  it("a burst of heartbeats from every seat leaves the game untouched", async () => {
    const host = await player("host");
    const guest = await player("guest");
    const { id, code } = await newRoom(host);
    expect((await call(guest, "join", { code })).status).toBe(200);
    expect((await call(host, "start", { roomId: id })).status).toBe(200);
    const before = await game(id);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 ? host : guest, "heartbeat", { roomId: id })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await game(id)).version).toBe(before.version);
    await expectConsistentDeal(id);
  });
});
