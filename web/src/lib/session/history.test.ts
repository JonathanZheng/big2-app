import { describe, expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import type { Play } from "@/lib/engine/game";
import { cardOwners, groupTricks, highCardsElsewhere } from "./history";

const play = (player: number, cards: string): Play => ({ player, cards: cards ? parseCards(cards) : [] });

describe("groupTricks", () => {
  it("starts a new trick after three passes", () => {
    const history = [play(0, "3d"), play(1, "5c"), play(2, ""), play(3, ""), play(0, ""), play(1, "4d 4c"), play(2, "")];
    expect(groupTricks(history)).toEqual([history.slice(0, 5), history.slice(5)]);
  });

  it("returns no tricks before anyone has played", () => {
    expect(groupTricks([])).toEqual([]);
  });
});

describe("cardOwners", () => {
  it("maps each played card to the seat that played it", () => {
    const owners = cardOwners([play(0, "3d"), play(1, ""), play(2, "5c 5h")]);
    expect(owners.get(0)).toBe(0);
    expect(owners.get(parseCards("5c")[0])).toBe(2);
    expect(owners.size).toBe(3);
  });
});

describe("highCardsElsewhere", () => {
  it("counts the 2s and Aces neither played nor in my hand", () => {
    const history = [play(1, "2d"), play(2, "As")];
    expect(highCardsElsewhere(history, parseCards("2s Ac 3d"))).toEqual({ twos: 2, aces: 2 });
  });
});
