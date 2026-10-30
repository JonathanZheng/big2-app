import { describe, expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import { evaluation, labelMoves, rankAdvice, winChance } from "./advice";

describe("winChance", () => {
  it("interpolates the self-play calibration points and clamps", () => {
    expect(winChance(-0.5)).toBeCloseTo(0.188, 3);
    expect(winChance(0.0)).toBeCloseTo(0.4885, 3);
    expect(winChance(-3)).toBe(0.013);
    expect(winChance(3)).toBe(0.952);
  });
});

describe("evaluation", () => {
  it("is about 0 for an even position (a 1 in 4 chance)", () => {
    expect(Math.abs(evaluation(-0.4))).toBeLessThan(0.2);
  });

  it("rises with the score and stays within ±9.9", () => {
    const values = [-1, -0.6, -0.2, 0.2, 0.6, 1].map(evaluation);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(9.9);
  });

  it("rounds to one decimal", () => {
    expect(Number.isInteger(evaluation(0.3) * 10)).toBe(true);
  });
});

describe("labelMoves", () => {
  it("labels by the drop in win chance against the best move", () => {
    expect(labelMoves(Float32Array.from([0.1, 0.09, 0.0, -0.5]))).toEqual(["Best", "Good", "Mistake", "Blunder"]);
  });

  it("gives tied moves the Best label", () => {
    expect(labelMoves(Float32Array.from([0.2, 0.2, -0.9]))).toEqual(["Best", "Best", "Blunder"]);
  });
});

describe("rankAdvice", () => {
  it("sorts best first and only shows numbers for the top three", () => {
    const moves = [[], parseCards("3d"), parseCards("4d"), parseCards("5d"), parseCards("6d")];
    const advice = rankAdvice(moves, Float32Array.from([-0.9, 0.1, 0.3, -0.2, 0.0]));
    expect(advice.map((a) => a.cards)).toEqual([parseCards("4d"), parseCards("3d"), parseCards("6d"), parseCards("5d"), []]);
    expect(advice[0].label).toBe("Best");
    expect(advice.slice(0, 3).every((a) => a.evaluation !== null)).toBe(true);
    expect(advice.slice(3).every((a) => a.evaluation === null)).toBe(true);
  });
});
