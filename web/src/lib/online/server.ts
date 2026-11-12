/**
 * Server side of online play: the only code that writes rooms, games and
 * hands. It runs in API routes with the secret key, after checking the
 * player's sign-in token.
 */
import "server-only";
import { type SupabaseClient, type User, createClient } from "@supabase/supabase-js";
import { type Difficulty, botMove } from "@/lib/bots/bots";
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { serverModel } from "./server-model";
import { type PublicGame, type Seat, joinState, splitState } from "./room-logic";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let client: SupabaseClient | null = null;

/** A client with the secret key. Never sent to the browser. */
export function admin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new HttpError(503, "Online play is not set up on this server.");
  client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** The signed-in player making this request. */
export async function requireUser(request: Request): Promise<User> {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Sign in first.");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your sign-in has expired. Sign in again.");
  return data.user;
}

export interface RoomRow {
  id: string;
  code: string;
  host: string;
  status: "lobby" | "playing" | "finished";
  difficulty: Difficulty;
  games: 1 | 3 | 5 | 10;
  hints: boolean;
  turn_seconds: number | null;
  game_index: number;
  wins: number[];
}

export interface LoadedRoom {
  room: RoomRow;
  seats: Seat[];
  /** Null before the first deal. */
  game: { version: number; state: GameState; deadline: number | null } | null;
}

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new HttpError(500, result.error.message);
  return result.data;
}

/**
 * The room, its seats, its game and its hands, read in one query so they
 * all come from the same moment. Separate reads could pair a game with
 * hands from the move before or after it.
 */
export async function loadRoom(roomId: string): Promise<LoadedRoom> {
  const loaded = check(await admin().from("rooms")
    .select("*, room_seats(*), room_games(*), room_hands(seat, cards)").eq("id", roomId).maybeSingle()) as
    (RoomRow & {
      room_seats: { seat: number; user_id: string | null; display_name: string | null; bot: boolean; last_seen: string | null }[];
      room_games: {
        version: number; current: number; first_move: boolean; last_play: PublicGame["lastPlay"]; passes: number;
        history: PublicGame["history"]; counts: number[]; winner: number | null; turn_deadline: string | null;
      } | null;
      room_hands: { seat: number; cards: Card[] }[];
    }) | null;
  if (!loaded) throw new HttpError(404, "That room does not exist.");
  const { room_seats: seatRows, room_games: gameRow, room_hands: handRows, ...room } = loaded;
  const seats: Seat[] = seatRows.sort((a, b) => a.seat - b.seat).map((s) => ({
    seat: s.seat, userId: s.user_id, displayName: s.display_name, bot: s.bot,
    lastSeen: s.last_seen ? Date.parse(s.last_seen) : null,
  }));
  if (!gameRow) return { room, seats, game: null };
  const hands = [0, 1, 2, 3].map((s) => handRows.find((h) => h.seat === s)?.cards ?? []);
  const deadline = gameRow.turn_deadline ? Date.parse(gameRow.turn_deadline) : null;
  const state = joinState({
    current: gameRow.current, firstMove: gameRow.first_move, lastPlay: gameRow.last_play, passes: gameRow.passes,
    history: gameRow.history, counts: gameRow.counts, winner: gameRow.winner, turnDeadline: deadline,
  }, hands);
  return { room, seats, game: { version: gameRow.version, state, deadline } };
}

/**
 * Save the game if nobody else saved since `expectedVersion` was loaded.
 * Two moves arriving together cannot both win: the second gets a 409.
 * The game and the hands are saved together in one transaction.
 */
export async function saveGame(
  room: LoadedRoom, state: GameState, deadline: number | null, expectedVersion: number | null,
): Promise<void> {
  const { publicGame, hands } = splitState(state, deadline);
  const saved = check(await admin().rpc("save_room_game", {
    p_room: room.room.id,
    p_expected: expectedVersion,
    p_game: {
      current: publicGame.current,
      first_move: publicGame.firstMove,
      last_play: publicGame.lastPlay,
      passes: publicGame.passes,
      history: publicGame.history,
      counts: publicGame.counts,
      winner: publicGame.winner,
      turn_deadline: deadline === null ? null : new Date(deadline).toISOString(),
    },
    p_hands: hands.map((cards, seat) => ({ seat, user_id: room.seats[seat].userId, cards })),
  })) as boolean;
  if (!saved) throw new HttpError(409, "Someone else moved first. Try again.");
}

/** The bots' moves on the server. Hard uses the trained model, loaded once per server. */
export function serverBot(difficulty: Difficulty) {
  return async (state: GameState, player: number): Promise<Card[]> => {
    if (difficulty !== "hard") return botMove(difficulty, state, player, null);
    const model = await serverModel();
    return model.best(state, player);
  };
}
