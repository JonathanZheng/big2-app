import { describe, expect, it } from "vitest";
import { cardName, parseCards } from "./cards";
import { MoveType, canBeat, detectMoveType } from "./moves";

describe("cards", () => {
  it("parses and names cards", () => {
    expect(parseCards("3d 10h Th 2s")).toEqual([0, 30, 30, 51]);
    expect(cardName(0)).toBe("3♦");
    expect(cardName(30)).toBe("10♥");
  });
});

describe("move types", () => {
  it("detects basic types", () => {
    expect(detectMoveType([])).toBe(MoveType.Pass);
    expect(detectMoveType(parseCards("3d"))).toBe(MoveType.Single);
    expect(detectMoveType(parseCards("3d 3c"))).toBe(MoveType.Pair);
    expect(detectMoveType(parseCards("3d 4c"))).toBe(MoveType.Invalid);
    expect(detectMoveType(parseCards("3d 3c 3h"))).toBe(MoveType.Triple);
    expect(detectMoveType(parseCards("3d 4d 5d 6d 8d"))).toBe(MoveType.Flush);
    expect(detectMoveType(parseCards("3d 3c 3h 4d 4c"))).toBe(MoveType.FullHouse);
    expect(detectMoveType(parseCards("3d 3c 3h 3s 4d"))).toBe(MoveType.Quad);
    expect(detectMoveType(parseCards("3d 4c 5h 6s 9d"))).toBe(MoveType.Invalid);
    expect(detectMoveType(parseCards("3d 3c 4h 4s"))).toBe(MoveType.Invalid);
  });

  it("treats the wrap-around straights as straights", () => {
    expect(detectMoveType(parseCards("Jd Qc Kh As 2d"))).toBe(MoveType.Straight);
    expect(detectMoveType(parseCards("2d 3c 4h 5s 6d"))).toBe(MoveType.Straight);
    expect(detectMoveType(parseCards("Ad 2c 3h 4s 5d"))).toBe(MoveType.Straight);
  });

  it("does not treat other wrap-arounds as straights", () => {
    expect(detectMoveType(parseCards("Qd Kc Ah 2s 3d"))).toBe(MoveType.Invalid);
    expect(detectMoveType(parseCards("Kd Ac 2h 3s 4d"))).toBe(MoveType.Invalid);
  });
});

describe("canBeat", () => {
  it("orders straights by the house rules", () => {
    const order = ["3d 4c 5h 6s 7d", "9d 10c Jh Qs Kd", "10d Jc Qh Ks Ad",
      "Jd Qc Kh As 2d", "2d 3c 4h 5s 6d", "Ad 2c 3h 4s 5d"];
    for (let i = 0; i + 1 < order.length; i++) {
      expect(canBeat(parseCards(order[i + 1]), parseCards(order[i]))).toBe(true);
      expect(canBeat(parseCards(order[i]), parseCards(order[i + 1]))).toBe(false);
    }
  });

  it("compares the same run by the suit of the 2", () => {
    expect(canBeat(parseCards("Ad 2s 3d 4d 5c"), parseCards("As 2h 3s 4s 5s"))).toBe(true);
    expect(canBeat(parseCards("2s 3d 4d 5d 6c"), parseCards("2h 3s 4s 5s 6s"))).toBe(true);
    expect(canBeat(parseCards("2c 3s 4s 5s 6s"), parseCards("2h 3d 4d 5d 6c"))).toBe(false);
  });

  it("orders straight flushes the same way", () => {
    const low = parseCards("10s Js Qs Ks As");
    const high = parseCards("Ad 2d 3d 4d 5d");
    expect(detectMoveType(high)).toBe(MoveType.StraightFlush);
    expect(canBeat(high, low)).toBe(true);
    expect(canBeat(low, high)).toBe(false);
  });

  it("ranks four of a kind between full house and straight flush", () => {
    const quad = parseCards("6d 6c 6h 6s 3h");
    expect(canBeat(quad, parseCards("9d 9c 9h 4s 4d"))).toBe(true);
    expect(canBeat(parseCards("7d 7c 7h 7s 3d"), quad)).toBe(true);
    expect(canBeat(parseCards("3s 4s 5s 6s 7s"), quad)).toBe(true);
    expect(canBeat(quad, parseCards("3s 4s 5s 6s 7s"))).toBe(false);
  });

  it("compares singles and pairs by rank then suit, and needs the same size", () => {
    expect(canBeat(parseCards("3c"), parseCards("3d"))).toBe(true);
    expect(canBeat(parseCards("2d"), parseCards("As"))).toBe(true);
    expect(canBeat(parseCards("5d 5s"), parseCards("5c 5h"))).toBe(true);
    expect(canBeat(parseCards("4d 4c"), parseCards("3d"))).toBe(false);
    expect(canBeat(parseCards("3d"), [])).toBe(true);
  });
});
