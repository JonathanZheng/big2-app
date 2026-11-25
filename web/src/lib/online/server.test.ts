import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GameState, applyMove, deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { type FakeSupabase, type Reply, args, fakeSupabase } from "./test-helpers";

const fake = vi.hoisted(() => ({ db: null as unknown, best: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => fake.db) }));
vi.mock("./server-model", () => ({ serverModel: async () => ({ best: fake.best }) }));

let db: FakeSupabase;
let reply: Reply = {};

async function server() {
  return import("./server");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://db.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
  reply = {};
  db = fakeSupabase(() => reply);
  fake.db = db;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (headers: Record<string, string> = {}) => new Request("http://app.test/api", { headers });

describe("admin", () => {
  it("refuses with 503 when the server has no Supabase settings", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { admin, HttpError } = await server();
    expect(() => admin()).toThrow(HttpError);
    expect(() => admin()).toThrow("Online play is not set up on this server.");
  });

  it("creates the client once and reuses it", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { admin } = await server();
    expect(admin()).toBe(db);
    expect(admin()).toBe(db);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("http://db.test", "secret", expect.anything());
  });
});

describe("requireUser", () => {
  it("asks for a sign-in when there is no token", async () => {
    const { requireUser } = await server();
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, message: "Sign in first." });
  });

  it("reports an expired sign-in when the token is not accepted", async () => {
    db.auth.getUser = async () => ({ data: { user: null }, error: { message: "bad jwt" } });
    const { requireUser } = await server();
    await expect(requireUser(request({ authorization: "Bearer old" }))).rejects.toMatchObject({ status: 401 });
  });

  it("returns the user for a valid token, without the Bearer prefix", async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
    db.auth.getUser = getUser;
    const { requireUser } = await server();
    await expect(requireUser(request({ authorization: "Bearer tok" }))).resolves.toEqual({ id: "u1" });
    expect(getUser).toHaveBeenCalledWith("tok");
  });
});

const roomRow = {
  id: "r1", code: "ABCDEF", host: "u0", status: "playing", difficulty: "easy", games: 1, hints: false,
  turn_seconds: null, game_index: 0, wins: [0, 0, 0, 0],
};
const seatRows = [
  { seat: 2, user_id: null, display_name: "Bot 1", bot: true, last_seen: null },
  { seat: 0, user_id: "u0", display_name: "Ann", bot: false, last_seen: "2026-01-01T00:00:00.000Z" },
  { seat: 3, user_id: null, display_name: null, bot: false, last_seen: null },
  { seat: 1, user_id: "u1", display_name: "Bo", bot: false, last_seen: null },
];

describe("loadRoom", () => {
  it("returns 404 for a room that does not exist", async () => {
    const { loadRoom } = await server();
    await expect(loadRoom("r1")).rejects.toMatchObject({ status: 404 });
  });

  it("turns a database error into a 500", async () => {
    reply = { error: { message: "boom" } };
    const { loadRoom } = await server();
    await expect(loadRoom("r1")).rejects.toMatchObject({ status: 500, message: "boom" });
  });

  it("sorts the seats and has no game before the first deal", async () => {
    reply = { data: { ...roomRow, room_seats: seatRows, room_games: null, room_hands: [] } };
    const { loadRoom } = await server();
    const loaded = await loadRoom("r1");
    expect(loaded.room).toEqual(roomRow);
    expect(loaded.game).toBeNull();
    expect(loaded.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    expect(loaded.seats[0]).toEqual({
      seat: 0, userId: "u0", displayName: "Ann", bot: false, lastSeen: Date.parse("2026-01-01T00:00:00.000Z"),
    });
    expect(loaded.seats[1].lastSeen).toBeNull();
    expect(args(db.queries[0], "eq")).toEqual(["id", "r1"]);
  });

  it("rebuilds the game state from the game row and the hands", async () => {
    let state = deal(mulberry32(4));
    state = applyMove(state, legalMoves(state, state.current)[0]);
    const deadline = "2026-01-01T00:01:00.000Z";
    reply = {
      data: {
        ...roomRow,
        room_seats: seatRows,
        room_games: {
          version: 7, current: state.current, first_move: state.firstMove, last_play: state.lastPlay,
          passes: state.passes, history: state.history, counts: state.hands.map((h) => h.length),
          winner: null, turn_deadline: deadline,
        },
        // Seat 3's hand row is missing.
        room_hands: [0, 1, 2].map((seat) => ({ seat, cards: state.hands[seat] })),
      },
    };
    const { loadRoom } = await server();
    const loaded = await loadRoom("r1");
    expect(loaded.game?.version).toBe(7);
    expect(loaded.game?.deadline).toBe(Date.parse(deadline));
    expect(loaded.game?.state.hands.slice(0, 3)).toEqual(state.hands.slice(0, 3));
    expect(loaded.game?.state.hands[3]).toEqual([]);
    expect(loaded.game?.state.history).toEqual(state.history);
  });

  it("puts the room's house rules on the game state", async () => {
    const rules = { opening: "any", flush: "suit", pass: "out" };
    const gameRow = {
      version: 1, current: 0, first_move: true, last_play: null, passes: 0, history: [],
      counts: [13, 13, 13, 13], winner: null, turn_deadline: null,
    };
    reply = { data: { ...roomRow, rules, room_seats: seatRows, room_hands: [], room_games: gameRow } };
    const { loadRoom } = await server();
    expect((await loadRoom("r1")).game?.state.rules).toEqual(rules);
    reply = { data: { ...roomRow, rules: null, room_seats: seatRows, room_hands: [], room_games: gameRow } };
    expect((await loadRoom("r1")).game?.state).not.toHaveProperty("rules");
  });

  it("has no deadline when the game row has none", async () => {
    const state = deal(mulberry32(4));
    reply = {
      data: {
        ...roomRow, room_seats: seatRows, room_hands: [],
        room_games: {
          version: 1, current: state.current, first_move: true, last_play: null, passes: 0, history: [],
          counts: [13, 13, 13, 13], winner: null, turn_deadline: null,
        },
      },
    };
    const { loadRoom } = await server();
    expect((await loadRoom("r1")).game?.deadline).toBeNull();
  });
});

describe("saveGame", () => {
  const seats = [0, 1, 2, 3].map((seat) => ({
    seat, userId: seat === 2 ? null : `u${seat}`, displayName: null, bot: seat === 2, lastSeen: null,
  }));
  const loaded = { room: { ...roomRow, status: "playing" as const, difficulty: "easy" as const, games: 1 as const }, seats, game: null };

  it("sends the public game and each seat's hand with the expected version", async () => {
    reply = { data: true };
    const state = deal(mulberry32(5));
    const { saveGame } = await server();
    await saveGame(loaded, state, Date.parse("2026-01-01T00:00:30.000Z"), 3);
    const [params] = args(db.queries[0], "rpc") as [Record<string, unknown>];
    expect(db.queries[0].table).toBe("rpc:save_room_game");
    expect(params.p_room).toBe("r1");
    expect(params.p_expected).toBe(3);
    expect(params.p_game).toMatchObject({ current: state.current, first_move: true, turn_deadline: "2026-01-01T00:00:30.000Z" });
    expect(params.p_hands).toEqual(state.hands.map((cards, seat) => ({ seat, user_id: seats[seat].userId, cards })));
  });

  it("sends no deadline when there is no timer", async () => {
    reply = { data: true };
    const { saveGame } = await server();
    await saveGame(loaded, deal(mulberry32(5)), null, null);
    const [params] = args(db.queries[0], "rpc") as [{ p_game: { turn_deadline: unknown } }];
    expect(params.p_game.turn_deadline).toBeNull();
  });

  it("refuses with 409 when someone else saved first", async () => {
    reply = { data: false };
    const { saveGame } = await server();
    await expect(saveGame(loaded, deal(mulberry32(5)), null, 1)).rejects.toMatchObject({ status: 409 });
  });
});

describe("serverBot", () => {
  const state: GameState = deal(mulberry32(6));

  it("plays a legal move for easy and medium bots", async () => {
    const { serverBot } = await server();
    const legal = legalMoves(state, state.current).map((m) => m.join());
    for (const difficulty of ["easy", "medium"] as const) {
      const move = await serverBot(difficulty)(state, state.current);
      expect(legal).toContain(move.join());
    }
    expect(fake.best).not.toHaveBeenCalled();
  });

  it("asks the trained model for hard bots", async () => {
    fake.best.mockReturnValue([0]);
    const { serverBot } = await server();
    await expect(serverBot("hard")(state, 2)).resolves.toEqual([0]);
    expect(fake.best).toHaveBeenCalledWith(state, 2);
  });
});
