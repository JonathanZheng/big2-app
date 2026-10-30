import { describe, expect, it } from "vitest";
import { GROUP_GAP, groupBreaks, handOffsets } from "./layout";

describe("groupBreaks", () => {
  it("marks a gap before each group and after it", () => {
    // order: 1 2 [3 4] 5 [6 7]
    expect(groupBreaks([1, 2, 3, 4, 5, 6, 7], [[3, 4], [7, 6]])).toEqual([false, false, true, false, true, true, false]);
  });

  it("ignores groups of one card and a group at the very start", () => {
    expect(groupBreaks([1, 2, 3], [[1, 2], [3]])).toEqual([false, false, true]);
  });
});

describe("handOffsets", () => {
  it("spaces cards with a small gap when there is room", () => {
    expect(handOffsets(3, 1000, 64, [false, false, false])).toEqual([0, 6, 6]);
  });

  it("overlaps every card by the same amount when space is short", () => {
    const offsets = handOffsets(13, 400, 52, Array(13).fill(false));
    expect(new Set(offsets.slice(1)).size).toBe(1);
    // The last card ends exactly at the right edge.
    const width = 52 + offsets.slice(1).reduce((sum, o) => sum + 52 + o, 0);
    expect(width).toBeCloseTo(400, 5);
  });

  it("keeps the extra group gap and still fits the width", () => {
    const breaks = [false, false, true, false, false, true, false, false, false, false, false, false, false];
    const offsets = handOffsets(13, 400, 52, breaks);
    expect(offsets[2] - offsets[1]).toBe(GROUP_GAP);
    expect(offsets[5] - offsets[4]).toBe(GROUP_GAP);
    const width = 52 + offsets.slice(1).reduce((sum, o) => sum + 52 + o, 0);
    expect(width).toBeCloseTo(400, 5);
  });

  it("never steps less than a sliver of each card, even in a tiny space", () => {
    const offsets = handOffsets(13, 100, 52, Array(13).fill(false));
    expect(52 + offsets[1]).toBeGreaterThanOrEqual(12);
  });

  it("handles an empty hand and a single card", () => {
    expect(handOffsets(0, 300, 52, [])).toEqual([]);
    expect(handOffsets(1, 300, 52, [false])).toEqual([0]);
  });
});
