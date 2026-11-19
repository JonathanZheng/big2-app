import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/online/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  setDisplayName: vi.fn(), createRoom: vi.fn(), joinRoom: vi.fn(), startRoom: vi.fn(), nextRoomGame: vi.fn(),
  makeMove: vi.fn(), heartbeat: vi.fn(), takeOverSeat: vi.fn(), turnTimedOut: vi.fn(),
}));

vi.mock("@/lib/online/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/online/server")>()),
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/online/actions", () => mocks);

const user = { id: "u1" };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireUser.mockResolvedValue(user);
});

const post = (body: unknown) =>
  POST(new Request("http://app.test/api/online", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

describe("POST /api/online", () => {
  it("passes on a sign-in refusal with its status", async () => {
    mocks.requireUser.mockRejectedValue(new HttpError(401, "Sign in first."));
    await expectError(await post({ action: "join" }), 401, "Sign in first.");
  });

  it("refuses a body that is not JSON and an unknown action", async () => {
    await expectError(await post("not json"), 400, "The request was not valid.");
    await expectError(await post({ action: "dance" }), 400, "Unknown action.");
  });

  it("sets the display name, as text even when missing", async () => {
    expect(await (await post({ action: "name", name: "Ann" })).json()).toEqual({ ok: true });
    expect(mocks.setDisplayName).toHaveBeenCalledWith(user, "Ann");
    await post({ action: "name" });
    expect(mocks.setDisplayName).toHaveBeenLastCalledWith(user, "");
  });

  it("checks the room settings before creating a room", async () => {
    const good = { action: "create", difficulty: "hard", games: 3, turnSeconds: null, hints: true };
    await expectError(await post({ ...good, difficulty: "insane" }), 400, "Pick a difficulty.");
    await expectError(await post({ ...good, games: 2 }), 400, "Pick a length.");
    await expectError(await post({ ...good, turnSeconds: 45 }), 400, "Pick a turn timer.");
    expect(mocks.createRoom).not.toHaveBeenCalled();

    mocks.createRoom.mockResolvedValue({ id: "r1", code: "ABCDEF" });
    expect(await (await post(good)).json()).toEqual({ id: "r1", code: "ABCDEF" });
    expect(mocks.createRoom).toHaveBeenCalledWith(user, { difficulty: "hard", games: 3, hints: true, turnSeconds: null });
    await post({ ...good, hints: "yes", turnSeconds: 30 });
    expect(mocks.createRoom).toHaveBeenLastCalledWith(user, { difficulty: "hard", games: 3, hints: false, turnSeconds: 30 });
  });

  it("joins by code", async () => {
    mocks.joinRoom.mockResolvedValue({ id: "r1" });
    expect(await (await post({ action: "join", code: "abc" })).json()).toEqual({ id: "r1" });
    expect(mocks.joinRoom).toHaveBeenCalledWith(user, "abc");
    await post({ action: "join" });
    expect(mocks.joinRoom).toHaveBeenLastCalledWith(user, "");
  });

  it("sends room actions with the room id, or an empty id when it is not text", async () => {
    for (const [action, fn] of [
      ["start", mocks.startRoom], ["next", mocks.nextRoomGame], ["heartbeat", mocks.heartbeat], ["timeout", mocks.turnTimedOut],
    ] as const) {
      expect(await (await post({ action, roomId: "r1" })).json()).toEqual({ ok: true });
      expect(fn).toHaveBeenCalledWith(user, "r1");
    }
    await post({ action: "start", roomId: 5 });
    expect(mocks.startRoom).toHaveBeenLastCalledWith(user, "");
  });

  it("hands a seat to a bot by number", async () => {
    expect(await (await post({ action: "takeover", roomId: "r1", seat: "2" })).json()).toEqual({ ok: true });
    expect(mocks.takeOverSeat).toHaveBeenCalledWith(user, "r1", 2);
  });

  it("only accepts card numbers 0 to 51 as a move", async () => {
    for (const cards of [undefined, "3d", [1.5], [-1], [52]]) {
      await expectError(await post({ action: "move", roomId: "r1", cards }), 400, "Those are not cards.");
    }
    expect(mocks.makeMove).not.toHaveBeenCalled();
    expect(await (await post({ action: "move", roomId: "r1", cards: [0, 51] })).json()).toEqual({ ok: true });
    expect(mocks.makeMove).toHaveBeenCalledWith(user, "r1", [0, 51]);
  });

  it("returns an action's refusal with its status", async () => {
    mocks.makeMove.mockRejectedValue(new HttpError(409, "It is not your turn."));
    await expectError(await post({ action: "move", roomId: "r1", cards: [] }), 409, "It is not your turn.");
  });

  it("logs unexpected failures and hides their details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.heartbeat.mockRejectedValue(new Error("secret detail"));
    await expectError(await post({ action: "heartbeat", roomId: "r1" }), 500, "Something went wrong on the server.");
    expect(log).toHaveBeenCalledWith("Online action failed", expect.any(Error));
    log.mockRestore();
  });

  it("hides database error text carried by a server error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.startRoom.mockRejectedValue(new HttpError(500, 'invalid input syntax for type uuid: "x"'));
    await expectError(await post({ action: "start", roomId: "x" }), 500, "Something went wrong on the server.");
    expect(log).toHaveBeenCalledWith("Online action failed", expect.any(HttpError));
    log.mockRestore();
  });

  it("still tells the player when online play is not set up", async () => {
    mocks.requireUser.mockRejectedValue(new HttpError(503, "Online play is not set up on this server."));
    await expectError(await post({ action: "join" }), 503, "Online play is not set up on this server.");
  });
});
