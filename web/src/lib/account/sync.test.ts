import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGameRecord, type GameRecord } from "@/lib/session/profile";
import { readGuestBundle } from "./guest";
import { type AccountHistory, emptyHistory } from "./merge";
import { addToQueue, queueChange, readAccount, readQueue, writeAccount } from "./store";
import { flushAccount, resetAccountHistory, signOutAccount, syncAccount } from "./sync";
import { memoryStorage } from "./test-helpers";

const auth = vi.hoisted(() => ({
  getSession: async () => ({ data: { session: { access_token: "t", user: { id: "a" } } } }),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/online/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/online/client")>();
  return { ...actual, onlineClient: () => ({ auth }) };
});

const game = (at: number): GameRecord => ({ at, difficulty: "easy", won: true, cardsLeft: 0, plays: [], suits: [0, 0, 0, 0], hints: 0 });
const history = (games: GameRecord[]): AccountHistory => ({ ...emptyHistory(), games });
const reply = (h: AccountHistory) => new Response(JSON.stringify({ history: h }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  auth.signOut.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe("syncAccount", () => {
  it("uploads guest data on sign-in and clears it", async () => {
    saveGameRecord(game(1));
    fetchMock.mockResolvedValueOnce(reply(history([game(1), game(7)])));
    expect(await syncAccount("a")).toBe(true);
    expect(sent(0).action).toBe("merge");
    expect(sent(0).bundle.games.map((g: GameRecord) => g.at)).toEqual([1]);
    expect(readGuestBundle()).toBeNull();
    expect(readQueue("a")).toBeNull();
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1, 7]);
  });

  it("keeps guest data queued for the account when the upload fails", async () => {
    saveGameRecord(game(1));
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await syncAccount("a")).toBe(false);
    expect(readGuestBundle()).toBeNull();
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([1]);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1]);
  });

  it("never sends another account's queue", async () => {
    addToQueue("b", { games: [game(9)] });
    fetchMock.mockResolvedValueOnce(reply(emptyHistory()));
    await syncAccount("a");
    expect(sent(0)).toEqual({ action: "load" });
    expect(readQueue("b")?.games.map((g) => g.at)).toEqual([9]);
  });

  it("replaces another account's copy before syncing", async () => {
    writeAccount({ userId: "b", history: history([game(9)]) });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await syncAccount("a");
    expect(readAccount()).toEqual({ userId: "a", history: emptyHistory() });
  });
});

describe("flushAccount", () => {
  it("keeps changes queued during a flush", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    let answer: (r: Response) => void = () => undefined;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }))
      .mockImplementationOnce(async () => reply(history([game(2)])));
    const flushing = flushAccount("a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    queueChange({ games: [game(2)] });
    answer(reply(emptyHistory())); // the server has not seen game 2 yet
    expect(await flushing).toBe(true);
    expect(sent(1).bundle.games.map((g: GameRecord) => g.at)).toEqual([2]);
    expect(readQueue("a")).toBeNull();
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([2]);
  });

  it("shows queued changes on top of the server's history after a failed flush", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(3)] });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "down" }), { status: 500 }));
    expect(await flushAccount("a")).toBe(false);
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([3]);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([3]);
  });
});

describe("resetAccountHistory", () => {
  it("reset refuses while offline", async () => {
    writeAccount({ userId: "a", history: history([game(1)]) });
    vi.stubGlobal("navigator", { onLine: false });
    await expect(resetAccountHistory()).rejects.toThrow("RESET NEEDS A CONNECTION.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends queued changes first, then resets", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(1)] });
    fetchMock.mockResolvedValueOnce(reply(history([game(1)]))).mockResolvedValueOnce(reply(emptyHistory()));
    await resetAccountHistory();
    expect([sent(0).action, sent(1).action]).toEqual(["merge", "reset"]);
    expect(readAccount()?.history.games).toEqual([]);
  });
});

describe("signOutAccount", () => {
  it("sign-out clears the account copy", async () => {
    writeAccount({ userId: "a", history: history([game(1)]) });
    fetchMock.mockResolvedValueOnce(reply(history([game(1)])));
    await signOutAccount();
    expect(readAccount()).toBeNull();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("keeps unsent changes for the same account when sign-out cannot reach the server", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(4)] });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await signOutAccount();
    expect(readAccount()).toBeNull();
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([4]);
  });
});
