import { describe, expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import type { Play } from "@/lib/engine/game";
import { cardOwners, groupTricks, highCardsElsewhere, seatLabels } from "./history";

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

describe("seatLabels", () => {
  it("uses each name's first letter", () => {
    expect(seatLabels(["You", "West", "North", "East"])).toEqual(["Y", "W", "N", "E"]);
  });

  it("keeps the number so bots and players stay apart", () => {
    expect(seatLabels(["You", "Friend", "Bot 1", "Bot 2"])).toEqual(["Y", "F", "B1", "B2"]);
    expect(seatLabels(["Player 1", "Player 2", "Bot 3", "Bot 4"])).toEqual(["P1", "P2", "B3", "B4"]);
  });

  it("falls back to seat numbers when two labels would match", () => {
    expect(seatLabels(["Sam", "Sara", "You", "Bot 4"])).toEqual(["1", "2", "3", "4"]);
  });
});
