import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/positions.json";
import { parseCards } from "./cards";
import { type Fixture, type GameState, stateFromFixture } from "./game";
import { canonicalOrder, legalMoves } from "./legal";

const positions = fixtures as Fixture[];

function handState(hand: string, last: string | null): GameState {
  const cards = parseCards(hand).sort((a, b) => a - b);
  return {
    hands: [cards, [], [], []],
    current: 0,
    firstMove: last === null && cards.includes(0),
    lastPlay: last === null ? null : { player: 1, cards: parseCards(last) },
    passes: 0,
    history: [],
    winner: null,
  };
}

const sorted = (text: string) => parseCards(text).sort((a, b) => a - b);

describe("legalMoves", () => {
  it("matches the Python engine on every fixture position", () => {
    for (const f of positions) {
      expect(canonicalOrder(legalMoves(stateFromFixture(f), f.current))).toEqual(f.legal);
    }
  });

  it("lets wrap-around straights open the game, and every opening move holds the 3♦", () => {
    const legal = legalMoves(handState("3d Ac 2h 4s 5d 6c 9h", null), 0);
    expect(legal).toContainEqual(sorted("Ac 2h 3d 4s 5d"));
    expect(legal).toContainEqual(sorted("2h 3d 4s 5d 6c"));
    expect(legal.every((m) => m.includes(0))).toBe(true);
  });

  it("offers wrap-around straights when leading, with no pass", () => {
    const legal = legalMoves(handState("Ac 2h 3c 4s 5h Jd Qd Kc", null), 0);
    expect(legal).toContainEqual(sorted("Ac 2h 3c 4s 5h"));
    expect(legal).toContainEqual(sorted("Jd Qd Kc Ac 2h"));
    expect(legal).not.toContainEqual([]);
  });

  it("only offers moves that beat the table, plus pass", () => {
    expect(legalMoves(handState("Jd Qc Kh As 2h 9c", "2d 3c 4h 5s 6d"), 0)).toEqual([[]]);
    const legal = legalMoves(handState("Ad 2d 3d 4d 5d 9c", "10s Js Qs Ks As"), 0);
    expect(legal).toContainEqual(sorted("Ad 2d 3d 4d 5d"));
  });
});
