import { describe, expect, it } from "vitest";
import { parseCards } from "./cards";
import { type GameState, applyMove, deal, mulberry32, replayMove } from "./game";
import { whyIllegal } from "./explain";
import { legalMoves } from "./legal";
import { canBeat } from "./moves";
import { type Rules, STANDARD_RULES, houseRuleTags, isStandard, parseRules, passedThisTrick } from "./rules";

const sorted = (text: string) => parseCards(text).sort((a, b) => a - b);
const has = (moves: number[][], text: string) => moves.some((m) => m.join(",") === sorted(text).join(","));

function position(hands: string[], current: number, rules?: Partial<Rules>): GameState {
  return {
    hands: hands.map(sorted),
    current,
    firstMove: false,
    lastPlay: null,
    passes: 0,
    history: [],
    winner: null,
    ...(rules ? { rules: { ...STANDARD_RULES, ...rules } } : {}),
  };
}

describe("parseRules", () => {
  it("accepts every complete set of choices", () => {
    expect(parseRules(STANDARD_RULES)).toEqual(STANDARD_RULES);
    expect(parseRules({ opening: "any", flush: "suit", pass: "out" })).toEqual({ opening: "any", flush: "suit", pass: "out" });
  });

  it("refuses unknown values, missing fields and non-objects", () => {
    expect(parseRules({ opening: "any", flush: "suit" })).toBeNull();
    expect(parseRules({ ...STANDARD_RULES, flush: "colour" })).toBeNull();
    expect(parseRules(null)).toBeNull();
    expect(parseRules("standard")).toBeNull();
    expect(parseRules([])).toBeNull();
  });

  it("names only the house rules that differ from the standard ones", () => {
    expect(houseRuleTags(STANDARD_RULES)).toEqual([]);
    expect(houseRuleTags({ opening: "any", flush: "rank", pass: "out" })).toEqual(["ANY OPENING", "PASS AND STAY OUT"]);
  });

  it("keeps only the known fields", () => {
    expect(parseRules({ ...STANDARD_RULES, extra: 1 })).toEqual(STANDARD_RULES);
  });
});

describe("deal", () => {
  it("leaves standard rules off the state, so standard games look as they always did", () => {
    expect(deal(mulberry32(1))).not.toHaveProperty("rules");
    expect(deal(mulberry32(1), STANDARD_RULES)).not.toHaveProperty("rules");
    expect(isStandard(STANDARD_RULES)).toBe(true);
    expect(isStandard({ ...STANDARD_RULES, pass: "out" })).toBe(false);
  });

  it("keeps house rules on the state and every state after it", () => {
    const rules: Rules = { ...STANDARD_RULES, opening: "any" };
    const state = deal(mulberry32(1), rules);
    expect(state.rules).toEqual(rules);
    expect(applyMove(state, legalMoves(state, state.current)[0]).rules).toEqual(rules);
  });
});

describe("opening play", () => {
  const opening = (rules?: Partial<Rules>) => ({ ...position(["3d 4c 9h 9s", "", "", ""], 0, rules), firstMove: true });

  it("must include the 3♦ under standard rules", () => {
    const moves = legalMoves(opening(), 0);
    expect(has(moves, "3d")).toBe(true);
    expect(has(moves, "9h 9s")).toBe(false);
  });

  it("can be anything from the 3♦ holder when the house allows it", () => {
    const moves = legalMoves(opening({ opening: "any" }), 0);
    expect(has(moves, "9h 9s")).toBe(true);
    expect(has(moves, "4c")).toBe(true);
    expect(whyIllegal(opening({ opening: "any" }), sorted("3d 4c"), ["You", "W", "N", "E"])).toBe("THOSE CARDS ARE NOT A COMBINATION");
  });
});

describe("flush order", () => {
  const heartsToK = sorted("3h 5h 7h 9h Kh");
  const spadesTo10 = sorted("3s 4s 6s 8s 10s");
  const bySuit: Rules = { ...STANDARD_RULES, flush: "suit" };

  it("compares the highest card first under standard rules", () => {
    expect(canBeat(heartsToK, spadesTo10)).toBe(true);
    expect(canBeat(spadesTo10, heartsToK)).toBe(false);
  });

  it("compares the suit first when the house says so", () => {
    expect(canBeat(spadesTo10, heartsToK, bySuit)).toBe(true);
    expect(canBeat(heartsToK, spadesTo10, bySuit)).toBe(false);
  });

  it("still compares the highest card within one suit", () => {
    expect(canBeat(sorted("4h 5h 7h 9h Ah"), heartsToK, bySuit)).toBe(true);
    expect(canBeat(heartsToK, sorted("4h 5h 7h 9h Ah"), bySuit)).toBe(false);
  });

  it("does not change how flushes rank against other five-card hands", () => {
    expect(canBeat(sorted("3d 3c 3h 4d 4c"), spadesTo10, bySuit)).toBe(true);
    expect(canBeat(spadesTo10, sorted("5d 6c 7h 8s 9d"), bySuit)).toBe(true);
  });

  it("is used by legal moves", () => {
    const state = { ...position(["3s 4s 6s 8s 10s", "", "", ""], 0, { flush: "suit" }), lastPlay: { player: 1, cards: heartsToK } };
    expect(has(legalMoves(state, 0), "3s 4s 6s 8s 10s")).toBe(true);
    expect(has(legalMoves({ ...state, rules: undefined }, 0), "3s 4s 6s 8s 10s")).toBe(false);
  });
});

describe("pass and stay out", () => {
  const hands = ["5d 9c Ad", "6d 10c Ac", "7d Jc Ah", "8d Qc As"];

  it("lets a player who passed play again later in the trick under standard rules", () => {
    let s = position(hands, 0);
    s = applyMove(s, sorted("5d"));
    s = applyMove(s, []); // seat 1 passes
    s = applyMove(s, sorted("7d"));
    s = applyMove(s, sorted("8d"));
    s = applyMove(s, sorted("9c"));
    expect(s.current).toBe(1);
    expect(has(legalMoves(s, 1), "10c")).toBe(true);
  });

  it("passes for a player who already passed in this trick", () => {
    let s = position(hands, 0, { pass: "out" });
    s = applyMove(s, sorted("5d"));
    s = applyMove(s, []); // seat 1 passes and is out
    s = applyMove(s, sorted("7d"));
    s = applyMove(s, sorted("8d"));
    s = applyMove(s, sorted("9c"));
    // Seat 1 is skipped with a pass, and seat 2 is to move.
    expect(s.history.at(-1)).toEqual({ player: 1, cards: [] });
    expect(s.current).toBe(2);
    expect(passedThisTrick(s)).toEqual([1]);
    expect(legalMoves({ ...s, current: 1 }, 1)).toEqual([[]]);
  });

  it("ends the trick when everyone else is out, and the next trick starts fresh", () => {
    let s = position(hands, 0, { pass: "out" });
    s = applyMove(s, sorted("5d"));
    s = applyMove(s, []); // 1 out
    s = applyMove(s, []); // 2 out
    s = applyMove(s, sorted("8d")); // 3 plays over 0
    s = applyMove(s, []); // 0 out: 1 and 2 pass for them, and 3 leads
    expect(s.lastPlay).toBeNull();
    expect(s.current).toBe(3);
    expect(passedThisTrick(s)).toEqual([]);
    expect(s.history.slice(-3)).toEqual([{ player: 0, cards: [] }, { player: 1, cards: [] }, { player: 2, cards: [] }]);
  });

  it("replays a recorded game without adding the automatic passes twice", () => {
    let s = position(hands, 0, { pass: "out" });
    for (const move of [sorted("5d"), [], [], sorted("8d"), []]) s = applyMove(s, move);
    let replay = position(hands, 0, { pass: "out" });
    for (const play of s.history) replay = replayMove(replay, play.cards);
    expect(replay).toEqual(s);
  });

  it("does not pass for anyone after the game is won", () => {
    let s = position(["5d 9c", "6d 10c", "7d Jc", "8d Qc"], 1, { pass: "out" });
    s = applyMove(s, sorted("6d"));
    s = applyMove(s, []); // 2 out
    s = applyMove(s, sorted("8d"));
    s = applyMove(s, []); // 0 out
    s = applyMove(s, sorted("10c")); // seat 1's last card
    expect(s.winner).toBe(1);
    expect(s.history.at(-1)).toEqual({ player: 1, cards: sorted("10c") });
  });
});
