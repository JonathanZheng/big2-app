import { describe, expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import { encodeState } from "@/lib/model/encoding";
import { reviewStates } from "@/lib/session/review";
import { applyFollow, followFinalState, followToGame, replayFollow, selectableCards, startFollow } from "./follow";

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
