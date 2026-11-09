import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/engine/game";
import { saveGameRecord, type GameRecord } from "@/lib/session/profile";
import type { SavedReview } from "@/lib/session/saved-reviews";
import { readGuestBundle } from "./guest";
import { type AccountHistory, emptyHistory } from "./merge";
import { addToQueue, finishInflight, queueChange, readAccount, readQueue, takeQueue, writeAccount } from "./store";
import { flushAccount, handleAuthChange, resetAccountHistory, signOutAccount, syncAccount } from "./sync";
import { memoryStorage } from "./test-helpers";
import { parseBundle } from "./validate";

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
const refuse = (status: number) => new Response(JSON.stringify({ error: "no" }), { status });

const final: GameState = {
  hands: [[], [5], [6, 7], [8]], current: 1, firstMove: false, lastPlay: null, passes: 0,
  history: [{ player: 0, cards: [0] }], winner: 0,
};
const review = (i: number): SavedReview => ({
  id: `r${i}`, at: i + 1, title: "VS BOTS · EASY", final, names: [], seats: [], youSeat: 0, players: [0], scoreAll: true,
});

/** Answer like /api/history: refuse a bundle its checks reject, otherwise reply with an empty history. */
function serverChecks() {
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return body.action === "merge" && !parseBundle(body.bundle) ? refuse(400) : reply(emptyHistory());
  });
}

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

  it("shows guest games added to an existing account copy even when the upload fails", async () => {
    saveGameRecord(game(1));
    writeAccount({ userId: "a", history: history([game(7)]) });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await syncAccount("a")).toBe(false);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1, 7]);
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

  it("still shows another tab's game while that tab's flight is out", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(1)] });
    let answer: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const flushing = flushAccount("a");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    addToQueue("a", { games: [game(2)] }); // another tab finishes game 2 and starts sending it
    const otherTab = takeQueue("a");
    answer(reply(history([game(1)])));
    expect(await flushing).toBe(true);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1, 2]);
    finishInflight("a", false, otherTab);
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([2]);
  });

  it("failed flushes never add queued matches to the screen again", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ matches: [{ id: "m1", matches: 1, matchWins: 1 }] });
    fetchMock.mockRejectedValue(new TypeError("offline"));
    for (let i = 0; i < 3; i++) expect(await flushAccount("a")).toBe(false);
    expect(readAccount()?.history.matches).toBe(1);
    expect(readAccount()?.history.matchWins).toBe(1);
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

describe("server limits", () => {
  it("a queue that outgrew the server's caps still reaches the account", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    addToQueue("a", { reviews: Array.from({ length: 50 }, (_, i) => review(i)) });
    addToQueue("a", { reviews: [review(50)] });
    serverChecks();
    expect(await flushAccount("a")).toBe(true);
    expect(readQueue("a")).toBeNull();
    expect(sent(0).bundle.reviews.map((r: SavedReview) => r.id)).toContain("r50");
  });

  it("sends more puzzle days than one request allows in parts", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    addToQueue("a", { puzzles: Object.fromEntries(Array.from({ length: 401 }, (_, i) => [day(i), { cards: [1], label: "Good" as const }])) });
    serverChecks();
    expect(await flushAccount("a")).toBe(true);
    expect(readQueue("a")).toBeNull();
    const days = fetchMock.mock.calls.flatMap((_, i) => Object.keys(sent(i).bundle.puzzles));
    expect(new Set(days).size).toBe(401);
  });

  it("drops changes the server refuses instead of retrying them forever", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(1)] });
    fetchMock.mockResolvedValueOnce(refuse(400)).mockResolvedValueOnce(reply(emptyHistory()));
    expect(await flushAccount("a")).toBe(true);
    expect(readQueue("a")).toBeNull();
    expect(sent(1)).toEqual({ action: "load" });
    expect(readAccount()?.history.games).toEqual([]);
  });

  it("leaves out an item the server would refuse and sends the rest", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    addToQueue("a", { games: [game(1), { ...game(2), suits: undefined } as unknown as GameRecord] });
    serverChecks();
    expect(await flushAccount("a")).toBe(true);
    expect(sent(0).bundle.games.map((g: GameRecord) => g.at)).toEqual([1]);
    expect(readQueue("a")).toBeNull();
  });

  it("keeps changes queued when the sign-in has expired", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(1)] });
    fetchMock.mockResolvedValueOnce(refuse(401));
    expect(await flushAccount("a")).toBe(false);
    expect(readQueue("a")?.games.map((g) => g.at)).toEqual([1]);
  });
});

describe("handleAuthChange", () => {
  const session = { user: { id: "a" } };

  it("keeps the account copy when the first session check fails offline", () => {
    writeAccount({ userId: "a", history: history([game(1)]) });
    handleAuthChange("INITIAL_SESSION", null);
    expect(readAccount()?.history.games.map((g) => g.at)).toEqual([1]);
  });

  it("clears the account copy on sign-out", () => {
    writeAccount({ userId: "a", history: history([game(1)]) });
    handleAuthChange("SIGNED_OUT", null);
    expect(readAccount()).toBeNull();
  });

  it("syncs when a refreshed token brings the session back", async () => {
    writeAccount({ userId: "a", history: emptyHistory() });
    queueChange({ games: [game(1)] });
    fetchMock.mockResolvedValueOnce(reply(history([game(1)])));
    handleAuthChange("TOKEN_REFRESHED", session);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent(0).action).toBe("merge");
  });

  it("syncs on sign-in and on the first session check", async () => {
    fetchMock.mockImplementation(async () => reply(emptyHistory()));
    handleAuthChange("SIGNED_IN", session);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    handleAuthChange("INITIAL_SESSION", session);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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
