import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import { encodeState } from "@/lib/model/encoding";
import { reviewStates } from "@/lib/session/review";
import { memoryStorage } from "@/lib/account/test-helpers";
import {
  applyFollow, clearFollow, followFinalState, followToGame, readFollow, replayFollow, saveFollow, selectableCards, startFollow,
} from "./follow";

const INITIAL = parseCards("3d 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac 2c");

describe("follow", () => {
  it("starts with me opening when I hold the 3♦, otherwise waits for its holder", () => {
    const mine = startFollow(INITIAL);
    expect(mine.current).toBe(0);
    const theirs = startFollow(parseCards("4d 5d 6d 7d 8d 9d 10d Jd Qd Kd Ad 2d 3c"));
    expect(theirs.current).toBeNull();
    expect(theirs.opening).toBe(true);
  });

  it("records a trick and gives the lead back after three passes", () => {
    let state = startFollow(INITIAL);
    state = applyFollow(state, 0, parseCards("3d"));
    expect(state.current).toBe(1);
    expect(state.myHand).toHaveLength(12);
    state = applyFollow(state, 1, parseCards("4d"));
    state = applyFollow(state, 2, []);
    state = applyFollow(state, 3, []);
    state = applyFollow(state, 0, []);
    expect(state.lastPlay).toBeNull();
    expect(state.passes).toBe(0);
    expect(state.current).toBe(1);
    expect(state.history).toHaveLength(5);
  });

  it("rejects passes when leading, wrong turns and the opening without the 3♦", () => {
    let state = startFollow(INITIAL);
    expect(() => applyFollow(state, 0, [])).toThrow("cannot pass");
    expect(() => applyFollow(state, 1, parseCards("4d"))).toThrow("turn");
    expect(() => applyFollow(state, 0, parseCards("4c"))).toThrow("3♦");
    state = applyFollow(state, 0, parseCards("3d"));
    expect(() => applyFollow(state, 1, parseCards("3d"))).toThrow("already been played");
    expect(() => applyFollow(state, 1, parseCards("5c"))).toThrow("in your hand");
    expect(() => applyFollow(state, 1, parseCards("4d 4h"))).toThrow("not beat");
  });

  it("only offers my cards on my turn and unseen cards on theirs", () => {
    const state = startFollow(INITIAL);
    expect([...selectableCards(state, 0)].sort((a, b) => a - b)).toEqual([...INITIAL].sort((a, b) => a - b));
    const theirs = selectableCards(state, 1);
    expect(theirs.has(0)).toBe(false);
    expect(theirs.has(parseCards("4c")[0])).toBe(false);
    expect(theirs.size).toBe(39);
  });

  it("builds the model state with the real history and known played cards", () => {
    let state = startFollow(INITIAL);
    state = applyFollow(state, 0, parseCards("3d"));
    state = applyFollow(state, 1, parseCards("4d"));
    const game = followToGame(state);
    expect(game.hands[0]).toEqual(state.myHand);
    expect(game.lastPlay).toEqual({ player: 1, cards: parseCards("4d") });
    expect(game.history).toHaveLength(2);
    expect(game.playedBy?.[0]).toEqual(parseCards("3d"));
    expect(game.playedBy?.[1]).toEqual(parseCards("4d"));
    const encoded = encodeState(game, 0);
    expect(encoded[0]).toBe(0); // the 3♦ is no longer in my hand
    expect(encoded[104 + parseCards("4d")[0]]).toBe(1); // West's played pile
  });

  it("replays a saved record and can hand it to the review screen", () => {
    let state = startFollow(INITIAL);
    state = applyFollow(state, 0, parseCards("3d"));
    state = applyFollow(state, 1, parseCards("4d"));
    state = applyFollow(state, 2, []);
    state = applyFollow(state, 3, []);
    state = applyFollow(state, 0, []);

    const replay = replayFollow(INITIAL, state.history);
    expect(replay.myHand).toEqual(state.myHand);
    expect(replay.played).toEqual(state.played);

    const final = followFinalState(state);
    const states = reviewStates(final);
    expect(states).toHaveLength(state.history.length + 1);
    expect(states[0].hands[0]).toEqual(INITIAL);
    expect(states[0].hands.every((hand) => hand.length === 13)).toBe(true);
    expect(states[0].hands.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe("follow rules", () => {
  const theirs = parseCards("4d 5d 6d 7d 8d 9d 10d Jd Qd Kd Ad 2d 3c");

  it("needs 13 different real cards to start", () => {
    expect(() => startFollow(INITIAL.slice(1))).toThrow("13 different cards");
    expect(() => startFollow([...INITIAL.slice(1), INITIAL[1]])).toThrow("13 different cards");
    expect(() => startFollow([...INITIAL.slice(1), 52])).toThrow("13 different cards");
  });

  it("refuses moves once the game is over", () => {
    const over = { ...startFollow(INITIAL), winner: 2 };
    expect(() => applyFollow(over, 0, parseCards("3d"))).toThrow("The game is over.");
  });

  it("names whose turn it is", () => {
    const state = applyFollow(startFollow(INITIAL), 0, parseCards("3d"));
    expect(() => applyFollow(state, 2, [])).toThrow("It is another turn.");
    expect(() => applyFollow({ ...state, current: 0 }, 1, [])).toThrow("It is your turn.");
  });

  it("waits for the 3♦ holder to open when I do not hold it", () => {
    const state = startFollow(theirs);
    expect(() => applyFollow(state, 0, parseCards("4d"))).toThrow("you do not hold it");
    expect(() => applyFollow(state, 2, [])).toThrow("cannot pass");
    const opened = applyFollow(state, 2, parseCards("3d"));
    expect(opened.current).toBe(3);
    expect(opened.played[2]).toEqual(parseCards("3d"));
    expect(opened.myHand).toEqual([...theirs].sort((a, b) => a - b));
  });

  it("refuses repeated cards, cards I do not hold and moves that are not combinations", () => {
    let state = startFollow(INITIAL);
    expect(() => applyFollow(state, 0, [0, 0])).toThrow("played twice");
    expect(() => applyFollow(state, 0, parseCards("3d 4c"))).toThrow("not a legal Big 2 move");
    state = applyFollow(state, 0, parseCards("3d"));
    state = applyFollow(state, 1, parseCards("4d"));
    state = applyFollow(state, 2, []);
    state = applyFollow(state, 3, []);
    expect(() => applyFollow(state, 0, parseCards("5d"))).toThrow("not in your hand");
  });

  it("ends the game when I play my last card", () => {
    const state = { ...startFollow(INITIAL), myHand: parseCards("2c"), opening: false };
    const after = applyFollow(state, 0, parseCards("2c"));
    expect(after.winner).toBe(0);
    expect(after.myHand).toEqual([]);
  });

  it("ends the game when another seat has played 13 cards", () => {
    const twelve = parseCards("3h 4h 5h 6h 7h 8h 9h 10h Jh Qh Kh Ah");
    const state = { ...startFollow(INITIAL), current: 1, opening: false, played: [[], twelve, [], []] };
    expect(applyFollow(state, 1, parseCards("2h")).winner).toBe(1);
  });

  it("starts the model state at seat 0 while the 3♦ holder is unknown", () => {
    const game = followToGame(startFollow(theirs));
    expect(game.current).toBe(0);
    expect(game.firstMove).toBe(true);
    expect(game.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(followFinalState(startFollow(theirs)).current).toBe(0);
  });

  it("offers nothing to select before the holder is known", () => {
    expect(selectableCards(startFollow(theirs), null).size).toBe(0);
  });
});

describe("saved follow record", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves, reads back and clears a record", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readFollow()).toBeNull();
    const history = [{ player: 0, cards: parseCards("3d") }];
    saveFollow(INITIAL, history);
    expect(readFollow()).toEqual({ initial: INITIAL, history });
    clearFollow();
    expect(readFollow()).toBeNull();
  });

  it("ignores records that are malformed or no longer replay", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    for (const raw of ["{", JSON.stringify({ initial: INITIAL }), JSON.stringify({ initial: INITIAL, history: [{ player: 1, cards: [5] }] })]) {
      storage.setItem("big2.follow.v1", raw);
      expect(readFollow()).toBeNull();
    }
  });

  it("keeps working when storage is blocked", () => {
    const blocked = () => { throw new Error("blocked"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readFollow()).toBeNull();
    expect(() => saveFollow(INITIAL, [])).not.toThrow();
    expect(() => clearFollow()).not.toThrow();
  });
});
