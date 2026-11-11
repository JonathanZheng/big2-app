/** Everything a player can do in an online room. Each call checks it is allowed, then saves. */
import "server-only";
import { randomInt } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { Difficulty } from "@/lib/bots/bots";
import type { Card } from "@/lib/engine/cards";
import { type GameState, applyMove, deal } from "@/lib/engine/game";
import {
  type Seat, autoMove, canTakeOver, nextDeadline, roomCode, runBots, statsDelta,
} from "./room-logic";
import { HttpError, type LoadedRoom, admin, loadRoom, saveGame, serverBot } from "./server";

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new HttpError(500, result.error.message);
  return result.data;
}

async function displayName(user: User): Promise<string> {
  const row = check(await admin().from("profiles").select("display_name").eq("id", user.id).maybeSingle()) as
    { display_name: string } | null;
  if (!row) throw new HttpError(400, "Choose a display name first.");
  return row.display_name;
}

function seatOf(loaded: LoadedRoom, user: User): Seat {
  const seat = loaded.seats.find((s) => s.userId === user.id);
  if (!seat) throw new HttpError(403, "You are not in this room.");
  return seat;
}

function requireHost(loaded: LoadedRoom, user: User) {
  if (loaded.room.host !== user.id) throw new HttpError(403, "Only the host can do that.");
}

export async function setDisplayName(user: User, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 20) throw new HttpError(400, "Names are 1 to 20 characters.");
  check(await admin().from("profiles").upsert({ id: user.id, display_name: trimmed }));
  // Keep the name in rooms they sit in up to date.
  check(await admin().from("room_seats").update({ display_name: trimmed }).eq("user_id", user.id));
}

export async function createRoom(user: User, settings: {
  difficulty: Difficulty; games: 1 | 3 | 5 | 10; hints: boolean; turnSeconds: number | null;
}) {
  const name = await displayName(user);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin().from("rooms").insert({
      code: roomCode(rng), host: user.id, difficulty: settings.difficulty, games: settings.games,
      hints: settings.hints, turn_seconds: settings.turnSeconds,
    }).select("id, code").single();
    if (error?.code === "23505") continue; // code already used: try another
    if (error || !data) throw new HttpError(500, error?.message ?? "Could not create the room.");
    check(await admin().from("room_seats").insert([0, 1, 2, 3].map((seat) => ({
      room_id: data.id, seat,
      user_id: seat === 0 ? user.id : null,
      display_name: seat === 0 ? name : null,
      last_seen: seat === 0 ? new Date().toISOString() : null,
    }))));
    return data as { id: string; code: string };
  }
  throw new HttpError(500, "Could not find a free room code. Try again.");
}

export async function joinRoom(user: User, code: string) {
  const room = check(await admin().from("rooms").select("id, status").eq("code", code.trim().toUpperCase()).maybeSingle()) as
    { id: string; status: string } | null;
  if (!room) throw new HttpError(404, "No room has that code.");
  const loaded = await loadRoom(room.id);
  if (loaded.seats.some((s) => s.userId === user.id)) return { id: room.id };
  if (room.status !== "lobby") throw new HttpError(409, "That game has already started.");
  const name = await displayName(user);
  // Friends joining together race for seats: on losing one, try the next.
  // A seat a bot was given at the start is not free.
  for (const free of loaded.seats.filter((s) => s.userId === null)) {
    const { data, error } = await admin().from("room_seats")
      .update({ user_id: user.id, display_name: name, last_seen: new Date().toISOString() })
      .eq("room_id", room.id).eq("seat", free.seat).is("user_id", null).eq("bot", false).select("seat");
    if (error?.code === "23505") return { id: room.id }; // their other tab sat down first
    if (error) throw new HttpError(500, error.message);
    if (data.length > 0) return { id: room.id };
  }
  const seated = check(await admin().from("room_seats").select("seat")
    .eq("room_id", room.id).eq("user_id", user.id)) as unknown[];
  if (seated.length > 0) return { id: room.id };
  throw new HttpError(409, "That room is full.");
}

/** Bots move, the timer is set, and a finished game is scored, then everything is saved. */
async function advance(loaded: LoadedRoom, state: GameState, expectedVersion: number | null) {
  const after = await runBots(state, loaded.seats, serverBot(loaded.room.difficulty));
  const now = Date.now();
  await saveGame(loaded, after, nextDeadline(after, loaded.seats, loaded.room.turn_seconds, now), expectedVersion);
  if (after.winner !== null) await finishGame(loaded, after.winner);
}

async function finishGame(loaded: LoadedRoom, winner: number) {
  const { room, seats } = loaded;
  const wins = room.wins.map((w, s) => (s === winner ? w + 1 : w));
  const over = room.game_index + 1 >= room.games;
  const most = Math.max(...wins);
  const matchWinners = over && room.games > 1 ? wins.flatMap((w, s) => (w === most ? [s] : [])) : null;
  check(await admin().from("rooms").update({ wins, status: over ? "finished" : "playing" }).eq("id", room.id));
  for (const d of statsDelta(seats, winner, matchWinners)) {
    const current = check(await admin().from("player_stats").select("*").eq("user_id", d.userId).maybeSingle()) as
      { games: number; wins: number; matches: number; match_wins: number } | null;
    check(await admin().from("player_stats").upsert({
      user_id: d.userId,
      games: (current?.games ?? 0) + d.games,
      wins: (current?.wins ?? 0) + d.wins,
      matches: (current?.matches ?? 0) + d.matches,
      match_wins: (current?.match_wins ?? 0) + d.matchWins,
    }));
  }
}

export async function startRoom(user: User, roomId: string) {
  requireHost(await loadRoom(roomId), user);
  // Claim the lobby first, so only one press of START deals.
  const claimed = check(await admin().from("rooms").update({ status: "playing" })
    .eq("id", roomId).eq("status", "lobby").select("id")) as unknown[];
  if (claimed.length === 0) throw new HttpError(409, "The game has already started.");
  // Empty seats become bots. Someone may still sit down in one first.
  const seats = (await loadRoom(roomId)).seats;
  let botNumber = 0;
  for (const s of seats) {
    if (s.userId !== null) continue;
    botNumber += 1;
    check(await admin().from("room_seats").update({ bot: true, display_name: `Bot ${botNumber}` })
      .eq("room_id", roomId).eq("seat", s.seat).is("user_id", null));
  }
  await advance(await loadRoom(roomId), deal(rng), null);
}

export async function nextRoomGame(user: User, roomId: string) {
  const loaded = await loadRoom(roomId);
  requireHost(loaded, user);
  if (loaded.room.status !== "playing" || !loaded.game || loaded.game.state.winner === null) {
    throw new HttpError(409, "The current game is not over yet.");
  }
  check(await admin().from("rooms").update({ game_index: loaded.room.game_index + 1 }).eq("id", roomId));
  loaded.room.game_index += 1;
  await advance(loaded, deal(rng), loaded.game.version);
}

export async function makeMove(user: User, roomId: string, cards: Card[]) {
  const loaded = await loadRoom(roomId);
  const seat = seatOf(loaded, user);
  const game = loaded.game;
  if (!game || game.state.winner !== null) throw new HttpError(409, "There is no game in progress.");
  if (game.state.current !== seat.seat || seat.bot) throw new HttpError(409, "It is not your turn.");
  let next: GameState;
  try {
    next = applyMove(game.state, cards);
  } catch {
    throw new HttpError(400, "That move is not allowed.");
  }
  await advance(loaded, next, game.version);
}

/** Players check in regularly. A player whose seat a bot took over gets it back. */
export async function heartbeat(user: User, roomId: string) {
  const loaded = await loadRoom(roomId);
  const seat = seatOf(loaded, user);
  check(await admin().from("room_seats").update({ last_seen: new Date().toISOString(), bot: false })
    .eq("room_id", roomId).eq("seat", seat.seat));
  if (seat.bot && loaded.game && loaded.game.state.winner === null && loaded.game.state.current === seat.seat) {
    // Back on their own turn: start their timer again.
    seat.bot = false;
    const deadline = nextDeadline(loaded.game.state, loaded.seats, loaded.room.turn_seconds, Date.now());
    await saveGame(loaded, loaded.game.state, deadline, loaded.game.version);
  }
}

export async function takeOverSeat(user: User, roomId: string, seatNumber: number) {
  const loaded = await loadRoom(roomId);
  requireHost(loaded, user);
  const seat = loaded.seats[seatNumber];
  if (!seat || !canTakeOver(seat, Date.now())) {
    throw new HttpError(409, "A seat can be handed to a bot after its player has been away for a minute.");
  }
  check(await admin().from("room_seats").update({ bot: true }).eq("room_id", roomId).eq("seat", seatNumber));
  seat.bot = true;
  const game = loaded.game;
  if (game && game.state.winner === null) await advance(loaded, game.state, game.version);
}

/** Anyone in the room can report that the current turn has run out. */
export async function turnTimedOut(user: User, roomId: string) {
  const loaded = await loadRoom(roomId);
  seatOf(loaded, user);
  const game = loaded.game;
  if (!game || game.state.winner !== null || game.deadline === null || Date.now() < game.deadline) {
    throw new HttpError(409, "The turn has not run out.");
  }
  await advance(loaded, applyMove(game.state, autoMove(game.state)), game.version);
}
