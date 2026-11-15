import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { greedyMove } from "@/lib/bots/greedy";
import { type GameState, deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import {
  createRoom, heartbeat, joinRoom, makeMove, nextRoomGame, setDisplayName, startRoom, takeOverSeat, turnTimedOut,
} from "./actions";
import type { Seat } from "./room-logic";
import type { LoadedRoom, RoomRow } from "./server";
import { type FakeSupabase, type Query, type Reply, args, fakeSupabase, is } from "./test-helpers";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  loadRoom: vi.fn(),
  saveGame: vi.fn(async () => {}),
}));

vi.mock("./server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./server")>();
  return {
    ...actual,
    admin: () => mocks.db,
    loadRoom: mocks.loadRoom,
    saveGame: mocks.saveGame,
    serverBot: () => async (state: GameState, player: number) => greedyMove(state, player),
  };
});

let db: FakeSupabase;
let respond: (q: Query) => Reply;

beforeEach(() => {
  mocks.loadRoom.mockReset();
  mocks.saveGame.mockClear();
  // Signed-in players have a name unless a test says otherwise.
  respond = (q) => (is(q, "profiles", "select") ? { data: { display_name: "Ann" } } : {});
  db = fakeSupabase((q) => respond(q));
  mocks.db = db;
});

const user = (id = "u0") => ({ id }) as User;
const seat = (n: number, over: Partial<Seat> = {}): Seat => ({
  seat: n, userId: `u${n}`, displayName: `P${n}`, bot: false, lastSeen: Date.now(), ...over,
});
const room = (over: Partial<RoomRow> = {}): RoomRow => ({
  id: "r1", code: "ABCDEF", host: "u0", status: "playing", difficulty: "easy", games: 1, hints: false,
  turn_seconds: null, game_index: 0, wins: [0, 0, 0, 0], ...over,
});
const loaded = (over: Partial<LoadedRoom> = {}): LoadedRoom => ({
  room: room(),
  seats: [0, 1, 2, 3].map((n) => seat(n)),
  game: null,
  ...over,
});
const found = (q: string, method: string) => db.queries.filter((x) => is(x, q, method));

/** Seat 0 can win by playing the 2♠. */
const lastCard: GameState = {
  hands: [[51], [1, 2], [3, 4], [5, 6]], current: 0, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 3, cards: [7] }], winner: null,
};

describe("setDisplayName", () => {
  it("refuses empty and over-long names", async () => {
    await expect(setDisplayName(user(), "   ")).rejects.toMatchObject({ status: 400 });
    await expect(setDisplayName(user(), "x".repeat(21))).rejects.toMatchObject({ status: 400 });
  });

  it("saves the trimmed name on the profile and on every seat", async () => {
    await setDisplayName(user(), "  Ann  ");
    expect(args(found("profiles", "upsert")[0], "upsert")).toEqual([{ id: "u0", display_name: "Ann" }]);
    const seats = found("room_seats", "update")[0];
    expect(args(seats, "update")).toEqual([{ display_name: "Ann" }]);
    expect(args(seats, "eq")).toEqual(["user_id", "u0"]);
  });

  it("turns a database error into a 500", async () => {
    respond = () => ({ error: { message: "down" } });
    await expect(setDisplayName(user(), "Ann")).rejects.toMatchObject({ status: 500, message: "down" });
  });
});

describe("createRoom", () => {
  const settings = { difficulty: "easy" as const, games: 3 as const, hints: true, turnSeconds: 30 };

  it("asks for a display name first", async () => {
    respond = () => ({ data: null });
    await expect(createRoom(user(), settings)).rejects.toMatchObject({ status: 400, message: "Choose a display name first." });
  });

  it("creates the room and seats the host at seat 0 with three empty seats", async () => {
    const base = respond;
    respond = (q) => (is(q, "rooms", "insert") ? { data: { id: "r1", code: "ABCDEF" } } : base(q));
    await expect(createRoom(user(), settings)).resolves.toEqual({ id: "r1", code: "ABCDEF" });
    const [roomInsert] = args(found("rooms", "insert")[0], "insert") as [Record<string, unknown>];
    expect(roomInsert).toMatchObject({ host: "u0", difficulty: "easy", games: 3, hints: true, turn_seconds: 30 });
    expect(roomInsert.code).toMatch(/^[A-Z2-9]{6}$/);
    const [seats] = args(found("room_seats", "insert")[0], "insert") as [Record<string, unknown>[]];
    expect(seats.map((s) => s.user_id)).toEqual(["u0", null, null, null]);
    expect(seats[0].display_name).toBe("Ann");
    expect(seats[1].last_seen).toBeNull();
  });

  it("tries another code when one is already taken", async () => {
    const base = respond;
    let tries = 0;
    respond = (q) => {
      if (!is(q, "rooms", "insert")) return base(q);
      tries += 1;
      return tries < 3 ? { error: { message: "dup", code: "23505" } } : { data: { id: "r1", code: "XYZXYZ" } };
    };
    await expect(createRoom(user(), settings)).resolves.toEqual({ id: "r1", code: "XYZXYZ" });
    expect(tries).toBe(3);
  });

  it("gives up after five taken codes", async () => {
    const base = respond;
    respond = (q) => (is(q, "rooms", "insert") ? { error: { message: "dup", code: "23505" } } : base(q));
    await expect(createRoom(user(), settings)).rejects.toMatchObject({ status: 500, message: expect.stringContaining("free room code") });
    expect(found("rooms", "insert")).toHaveLength(5);
  });

  it("reports other insert failures", async () => {
    const base = respond;
    respond = (q) => (is(q, "rooms", "insert") ? { error: { message: "denied" } } : base(q));
    await expect(createRoom(user(), settings)).rejects.toMatchObject({ status: 500, message: "denied" });
    respond = (q) => (is(q, "rooms", "insert") ? {} : base(q));
    await expect(createRoom(user(), settings)).rejects.toMatchObject({ message: "Could not create the room." });
  });
});

describe("joinRoom", () => {
  const lobby = (seats: Seat[]) => loaded({ room: room({ status: "lobby" }), seats });
  const open = [seat(0), seat(1, { userId: null }), seat(2, { userId: null }), seat(3, { userId: null })];
  const withRoom = (status: string, rest: (q: Query) => Reply = () => ({})) => {
    const base = respond;
    respond = (q) => (is(q, "rooms", "select") ? { data: { id: "r1", status } } : is(q, "profiles", "select") ? base(q) : rest(q));
  };

  it("looks the code up in capitals and returns 404 when nothing matches", async () => {
    respond = () => ({ data: null });
    await expect(joinRoom(user("u9"), " abcdef ")).rejects.toMatchObject({ status: 404 });
    expect(args(db.queries[0], "eq")).toEqual(["code", "ABCDEF"]);
  });

  it("lets someone already seated back in, even after the start", async () => {
    withRoom("playing");
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u0"), "ABCDEF")).resolves.toEqual({ id: "r1" });
    expect(found("room_seats", "update")).toHaveLength(0);
  });

  it("refuses newcomers once the game has started", async () => {
    withRoom("playing");
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u9"), "ABCDEF")).rejects.toMatchObject({ status: 409 });
  });

  it("takes the next free seat when another player wins the race for the first", async () => {
    let attempts = 0;
    withRoom("lobby", (q) => {
      if (!is(q, "room_seats", "update")) return {};
      attempts += 1;
      return { data: attempts === 1 ? [] : [{ seat: 2 }] };
    });
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u9"), "ABCDEF")).resolves.toEqual({ id: "r1" });
    const updates = found("room_seats", "update");
    expect(updates).toHaveLength(2);
    expect(args(updates[1], "update")?.[0]).toMatchObject({ user_id: "u9", display_name: "Ann" });
  });

  it("succeeds when the player's other tab sat down first", async () => {
    withRoom("lobby", (q) => (is(q, "room_seats", "update") ? { error: { message: "dup", code: "23505" } } : {}));
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u9"), "ABCDEF")).resolves.toEqual({ id: "r1" });
  });

  it("reports other seat errors", async () => {
    withRoom("lobby", (q) => (is(q, "room_seats", "update") ? { error: { message: "denied" } } : {}));
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u9"), "ABCDEF")).rejects.toMatchObject({ status: 500, message: "denied" });
  });

  it("finds a seat taken in a race it lost on every free seat", async () => {
    withRoom("lobby", (q) => (is(q, "room_seats", "update") ? { data: [] } : is(q, "room_seats", "select") ? { data: [{ seat: 1 }] } : {}));
    mocks.loadRoom.mockResolvedValue(lobby(open));
    await expect(joinRoom(user("u9"), "ABCDEF")).resolves.toEqual({ id: "r1" });
  });

  it("says the room is full when no seat is free", async () => {
    withRoom("lobby", (q) => (is(q, "room_seats", "select") ? { data: [] } : {}));
    mocks.loadRoom.mockResolvedValue(lobby([0, 1, 2, 3].map((n) => seat(n))));
    await expect(joinRoom(user("u9"), "ABCDEF")).rejects.toMatchObject({ status: 409, message: "That room is full." });
  });
});

describe("startRoom", () => {
  it("is for the host only", async () => {
    mocks.loadRoom.mockResolvedValue(loaded());
    await expect(startRoom(user("u1"), "r1")).rejects.toMatchObject({ status: 403 });
  });

  it("deals only once when START is pressed twice", async () => {
    mocks.loadRoom.mockResolvedValue(loaded({ room: room({ status: "lobby" }) }));
    respond = (q) => (is(q, "rooms", "update") ? { data: [] } : {});
    await expect(startRoom(user(), "r1")).rejects.toMatchObject({ status: 409 });
  });

  it("fills empty seats with numbered bots, deals and lets the bots play", async () => {
    const seats = [seat(0), seat(1, { userId: null }), seat(2), seat(3, { userId: null })];
    const botted = seats.map((s) => (s.userId === null ? { ...s, bot: true } : s));
    mocks.loadRoom
      .mockResolvedValueOnce(loaded({ room: room({ status: "lobby" }), seats }))
      .mockResolvedValueOnce(loaded({ seats }))
      .mockResolvedValueOnce(loaded({ seats: botted }));
    respond = (q) => (is(q, "rooms", "update") ? { data: [{ id: "r1" }] } : {});
    await startRoom(user(), "r1");
    const names = found("room_seats", "update").map((q) => [args(q, "update")?.[0], args(q, "eq")]);
    expect(names).toEqual([
      [{ bot: true, display_name: "Bot 1" }, ["room_id", "r1"]],
      [{ bot: true, display_name: "Bot 2" }, ["room_id", "r1"]],
    ]);
    expect(mocks.saveGame).toHaveBeenCalledTimes(1);
    const [, state, , expected] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState, number | null, number | null];
    expect(expected).toBeNull();
    // Bots have played until a person is to move.
    expect(botted[state.current].bot).toBe(false);
  });
});

describe("nextRoomGame", () => {
  const over = { version: 4, state: { ...lastCard, winner: 0 }, deadline: null };

  it("is for the host only", async () => {
    mocks.loadRoom.mockResolvedValue(loaded({ game: over }));
    await expect(nextRoomGame(user("u1"), "r1")).rejects.toMatchObject({ status: 403 });
  });

  it("waits for the current game to end", async () => {
    for (const l of [
      loaded({ room: room({ status: "lobby" }), game: over }),
      loaded({ game: null }),
      loaded({ game: { ...over, state: lastCard } }),
    ]) {
      mocks.loadRoom.mockResolvedValue(l);
      await expect(nextRoomGame(user(), "r1")).rejects.toMatchObject({ status: 409 });
    }
  });

  it("moves to the next game and deals it against the current version", async () => {
    mocks.loadRoom.mockResolvedValue(loaded({ room: room({ games: 3, game_index: 1 }), game: over }));
    await nextRoomGame(user(), "r1");
    expect(args(found("rooms", "update")[0], "update")).toEqual([{ game_index: 2 }]);
    const [passed, state, , expected] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState, unknown, number];
    expect(passed.room.game_index).toBe(2);
    expect(state.hands.every((h) => h.length === 13)).toBe(true);
    expect(expected).toBe(4);
  });
});

describe("makeMove", () => {
  const playing = (state: GameState, over: Partial<LoadedRoom> = {}) =>
    loaded({ game: { version: 2, state, deadline: null }, ...over });

  it("refuses players who are not in the room", async () => {
    mocks.loadRoom.mockResolvedValue(playing(lastCard));
    await expect(makeMove(user("u9"), "r1", [51])).rejects.toMatchObject({ status: 403 });
  });

  it("refuses when no game is in progress", async () => {
    mocks.loadRoom.mockResolvedValue(loaded());
    await expect(makeMove(user(), "r1", [51])).rejects.toMatchObject({ status: 409 });
    mocks.loadRoom.mockResolvedValue(playing({ ...lastCard, winner: 1 }));
    await expect(makeMove(user(), "r1", [51])).rejects.toMatchObject({ status: 409 });
  });

  it("refuses out of turn and on a seat a bot has taken", async () => {
    mocks.loadRoom.mockResolvedValue(playing(lastCard));
    await expect(makeMove(user("u1"), "r1", [1])).rejects.toMatchObject({ message: "It is not your turn." });
    mocks.loadRoom.mockResolvedValue(playing(lastCard, { seats: [seat(0, { bot: true }), seat(1), seat(2), seat(3)] }));
    await expect(makeMove(user(), "r1", [51])).rejects.toMatchObject({ message: "It is not your turn." });
  });

  it("refuses an illegal move with 400", async () => {
    mocks.loadRoom.mockResolvedValue(playing(lastCard));
    await expect(makeMove(user(), "r1", [1])).rejects.toMatchObject({ status: 400 });
  });

  it("saves a legal move against the loaded version", async () => {
    const state = deal(mulberry32(2));
    const seats = [0, 1, 2, 3].map((n) => seat(n));
    mocks.loadRoom.mockResolvedValue(playing(state, { seats }));
    const mover = `u${state.current}`;
    await makeMove(user(mover), "r1", legalMoves(state, state.current)[0]);
    const [, saved, , expected] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState, unknown, number];
    expect(saved.history).toHaveLength(1);
    expect(expected).toBe(2);
  });

  it("scores a single game when the last card is played", async () => {
    mocks.loadRoom.mockResolvedValue(playing(lastCard));
    respond = (q) => (is(q, "player_stats", "select") && args(q, "eq")?.[1] === "u1" ? { data: { games: 4, wins: 1, matches: 2, match_wins: 1 } } : {});
    await makeMove(user(), "r1", [51]);
    expect(args(found("rooms", "update")[0], "update")).toEqual([{ wins: [1, 0, 0, 0], status: "finished" }]);
    const upserts = found("player_stats", "upsert").map((q) => args(q, "upsert")?.[0]);
    expect(upserts).toEqual([
      { user_id: "u0", games: 1, wins: 1, matches: 0, match_wins: 0 },
      { user_id: "u1", games: 5, wins: 1, matches: 2, match_wins: 1 },
      { user_id: "u2", games: 1, wins: 0, matches: 0, match_wins: 0 },
      { user_id: "u3", games: 1, wins: 0, matches: 0, match_wins: 0 },
    ]);
  });

  it("keeps a match going until its last game, then credits every seat with the most wins", async () => {
    mocks.loadRoom.mockResolvedValue(playing(lastCard, { room: room({ games: 3, game_index: 0 }) }));
    await makeMove(user(), "r1", [51]);
    expect(args(found("rooms", "update")[0], "update")).toEqual([{ wins: [1, 0, 0, 0], status: "playing" }]);
    expect(found("player_stats", "upsert").every((q) => (args(q, "upsert")?.[0] as { matches: number }).matches === 0)).toBe(true);

    db.queries.length = 0;
    mocks.loadRoom.mockResolvedValue(playing(lastCard, { room: room({ games: 3, game_index: 2, wins: [0, 1, 0, 0] }) }));
    await makeMove(user(), "r1", [51]);
    expect(args(found("rooms", "update")[0], "update")).toEqual([{ wins: [1, 1, 0, 0], status: "finished" }]);
    const matchWins = found("player_stats", "upsert").map((q) => (args(q, "upsert")?.[0] as { match_wins: number }).match_wins);
    expect(matchWins).toEqual([1, 1, 0, 0]);
  });
});

describe("heartbeat", () => {
  it("records the visit and gives the seat back from a bot", async () => {
    mocks.loadRoom.mockResolvedValue(loaded({ game: { version: 1, state: { ...lastCard, current: 1 }, deadline: null } }));
    await heartbeat(user(), "r1");
    const update = found("room_seats", "update")[0];
    expect(args(update, "update")?.[0]).toMatchObject({ bot: false });
    expect(update.steps.filter((s) => s.method === "eq").map((s) => s.args)).toEqual([["room_id", "r1"], ["seat", 0]]);
    expect(mocks.saveGame).not.toHaveBeenCalled();
  });

  it("restarts the timer when a returning player is on their own turn", async () => {
    const seats = [seat(0, { bot: true }), seat(1), seat(2), seat(3)];
    mocks.loadRoom.mockResolvedValue(loaded({ room: room({ turn_seconds: 30 }), seats, game: { version: 5, state: lastCard, deadline: null } }));
    const before = Date.now();
    await heartbeat(user(), "r1");
    const [, , deadline, expected] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState, number, number];
    expect(deadline).toBeGreaterThanOrEqual(before + 30_000);
    expect(expected).toBe(5);
  });

  it("does not touch the game when a returning player is waiting for another turn", async () => {
    const seats = [seat(0), seat(1, { bot: true }), seat(2), seat(3)];
    mocks.loadRoom.mockResolvedValue(loaded({ seats, game: { version: 5, state: lastCard, deadline: null } }));
    await heartbeat(user("u1"), "r1");
    expect(mocks.saveGame).not.toHaveBeenCalled();
  });
});

describe("takeOverSeat", () => {
  const away = () => seat(1, { lastSeen: Date.now() - 120_000 });

  it("is for the host only", async () => {
    mocks.loadRoom.mockResolvedValue(loaded());
    await expect(takeOverSeat(user("u1"), "r1", 2)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses missing seats and players who were seen recently", async () => {
    mocks.loadRoom.mockResolvedValue(loaded());
    await expect(takeOverSeat(user(), "r1", 7)).rejects.toMatchObject({ status: 409 });
    await expect(takeOverSeat(user(), "r1", 1)).rejects.toMatchObject({ status: 409 });
  });

  it("hands an away seat to a bot and plays on when it is that seat's turn", async () => {
    const state = { ...lastCard, current: 1, hands: [[51, 50], [1, 2], [3, 4], [5, 6]] };
    mocks.loadRoom.mockResolvedValue(loaded({ seats: [seat(0), away(), seat(2), seat(3)], game: { version: 3, state, deadline: null } }));
    await takeOverSeat(user(), "r1", 1);
    expect(args(found("room_seats", "update")[0], "update")).toEqual([{ bot: true }]);
    const [, saved] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState];
    expect(saved.history.length).toBeGreaterThan(state.history.length);
  });

  it("only marks the seat when no game is running", async () => {
    mocks.loadRoom.mockResolvedValue(loaded({ seats: [seat(0), away(), seat(2), seat(3)] }));
    await takeOverSeat(user(), "r1", 1);
    expect(mocks.saveGame).not.toHaveBeenCalled();
  });
});

describe("turnTimedOut", () => {
  const timed = (deadline: number | null, state = lastCard) => loaded({ game: { version: 6, state, deadline } });

  it("refuses players who are not in the room", async () => {
    mocks.loadRoom.mockResolvedValue(timed(1));
    await expect(turnTimedOut(user("u9"), "r1")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses while the turn still has time, has no timer, or no game is running", async () => {
    for (const l of [timed(Date.now() + 60_000), timed(null), timed(1, { ...lastCard, winner: 2 }), loaded()]) {
      mocks.loadRoom.mockResolvedValue(l);
      await expect(turnTimedOut(user("u1"), "r1")).rejects.toMatchObject({ status: 409 });
    }
  });

  it("plays the automatic move for the player who ran out of time", async () => {
    mocks.loadRoom.mockResolvedValue(timed(Date.now() - 1));
    await turnTimedOut(user("u1"), "r1");
    const [, saved, , expected] = mocks.saveGame.mock.calls[0] as unknown as [LoadedRoom, GameState, unknown, number];
    expect(saved.history.at(-1)).toEqual({ player: 0, cards: [51] });
    expect(expected).toBe(6);
  });
});
