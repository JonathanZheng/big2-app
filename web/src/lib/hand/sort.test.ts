import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import { combosContaining, groupCards, keepOrder, readSortPreference, saveSortPreference, sortHand } from "./sort";

const hand = parseCards("2c Kd 9s 3c 4h Qd 9h 5s 6d Jd 7c 9d 3d");

describe("sortHand", () => {
  it("sorts by rank, then suit within a rank", () => {
    expect(sortHand(hand, "rank")).toEqual(parseCards("3d 3c 4h 5s 6d 7c 9d 9h 9s Jd Qd Kd 2c"));
  });

  it("sorts by suit, then rank", () => {
    expect(sortHand(hand, "suit")).toEqual(parseCards("3d 6d 9d Jd Qd Kd 3c 7c 2c 4h 9h 5s 9s"));
  });

  it("puts five-card hands first, then triples, pairs and singles", () => {
    expect(sortHand(hand, "combo")).toEqual(parseCards("3d 3c 9d 9h 9s 4h 5s 6d 7c Jd Qd Kd 2c"));
    expect(sortHand(parseCards("Kh 2s 8c 7d 6s 5h 4c 3d Kd"), "combo"))
      .toEqual(parseCards("3d 4c 5h 6s 7d Kd Kh 8c 2s"));
  });
});

describe("keepOrder", () => {
  it("drops played cards, keeps the rest in place and adds new cards at the end", () => {
    expect(keepOrder([5, 1, 9, 3], [1, 3, 9, 20])).toEqual([1, 9, 3, 20]);
  });
});

describe("groupCards", () => {
  it("moves a group together at the position of its first card", () => {
    expect(groupCards([5, 1, 3, 9, 20], [9, 1])).toEqual([5, 1, 9, 3, 20]);
  });
});

describe("combosContaining", () => {
  const legal = [[], [1], [1, 2], [2, 3], [1, 2, 3, 4, 5]];
  it("returns the legal plays holding the card", () => {
    expect(combosContaining(1, legal)).toEqual([[1], [1, 2], [1, 2, 3, 4, 5]]);
  });

  it("returns every legal play when no card is chosen", () => {
    expect(combosContaining(null, legal)).toEqual(legal.slice(1));
  });
});

describe("sort preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the chosen sort and falls back to rank", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    expect(readSortPreference()).toBe("rank");
    saveSortPreference("combo");
    expect(readSortPreference()).toBe("combo");
  });

  it("falls back to rank when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => saveSortPreference("suit")).not.toThrow();
    expect(readSortPreference()).toBe("rank");
  });
});
