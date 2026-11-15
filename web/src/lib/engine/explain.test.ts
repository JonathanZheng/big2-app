import { describe, expect, it } from "vitest";
import { parseCards } from "./cards";
import type { GameState } from "./game";
import { whyIllegal } from "./explain";

const names = ["You", "West", "North", "East"];

/** Just the fields whyIllegal reads. */
function state(firstMove: boolean, last: string | null): GameState {
  return {
    firstMove,
    lastPlay: last === null ? null : { player: 1, cards: parseCards(last) },
  } as GameState;
}

describe("whyIllegal", () => {
  it("rejects cards that are not a combination", () => {
    expect(whyIllegal(state(false, null), parseCards("3c 5d"), names)).toBe("THOSE CARDS ARE NOT A COMBINATION");
  });

  it("asks for the 3 of diamonds on the opening play", () => {
    expect(whyIllegal(state(true, null), parseCards("4c"), names)).toBe("THE OPENING PLAY MUST INCLUDE THE 3♦");
  });

  it("asks for the same number of cards as the play on the table", () => {
    expect(whyIllegal(state(false, "9h 9s"), parseCards("Kd"), names)).toBe("PLAY 2 CARDS TO MATCH WEST");
  });

  it("says when the cards are too low", () => {
    expect(whyIllegal(state(false, "9h 9s"), parseCards("4d 4c"), names)).toBe("THAT DOES NOT BEAT WEST'S PLAY");
  });
});

describe("whyIllegal edge cases", () => {
  const names = ["You", "West", "North", "East"];
  const base: GameState = {
    hands: [[], [], [], []], current: 0, firstMove: false, lastPlay: null, passes: 0, history: [], winner: null,
  };

  it("gives a general reason when nothing is on the table", () => {
    expect(whyIllegal(base, parseCards("5d"), names)).toBe("THOSE CARDS CANNOT BE PLAYED");
  });

  it("says CARD, not CARDS, when a single is on the table", () => {
    const game = { ...base, lastPlay: { player: 1, cards: parseCards("5d") } };
    expect(whyIllegal(game, parseCards("6d 6c"), names)).toBe("PLAY 1 CARD TO MATCH WEST");
  });
});
