import { describe, expect, it } from "vitest";
import fixtures from "@/lib/engine/__fixtures__/positions.json";
import type { Card } from "@/lib/engine/cards";
import { type Fixture, type GameState, applyMove, deal, mulberry32, stateFromFixture } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { botMove } from "./bots";
import { greedyMove } from "./greedy";
import { smartMove } from "./smart";

const positions = fixtures as Fixture[];
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");

function agreement(bot: (s: GameState, p: number) => Card[], expected: (f: Fixture) => Card[]) {
  let same = 0;
  for (const f of positions) {
    const state = stateFromFixture(f);
    const move = bot(state, f.current);
    expect(legalMoves(state, f.current).map(key)).toContain(key(move));
    if (key(move) === key(expected(f))) same++;
  }
  console.info(`agreement ${same}/${positions.length}`);
  return same / positions.length;
}

function playOut(bot: (s: GameState, p: number) => Card[], seed: number): number {
  let state = deal(mulberry32(seed));
  while (state.winner === null) state = applyMove(state, bot(state, state.current));
  return state.winner;
}

describe("greedyMove", () => {
  it("plays legal moves and agrees with the Python greedy bot on at least 95% of positions", () => {
    expect(agreement(greedyMove, (f) => f.greedy)).toBeGreaterThanOrEqual(0.95);
  });

  it("finishes 50 games between four greedy bots", () => {
    for (let seed = 0; seed < 50; seed++) expect(playOut(greedyMove, seed)).toBeGreaterThanOrEqual(0);
  });
});

describe("smartMove", () => {
  it("plays legal moves and agrees with the Python Smart bot on at least 95% of positions", () => {
    expect(agreement(smartMove, (f) => f.smart)).toBeGreaterThanOrEqual(0.95);
  });

  it("finishes 50 games between four Smart bots", () => {
    for (let seed = 0; seed < 50; seed++) expect(playOut(smartMove, seed)).toBeGreaterThanOrEqual(0);
  });
});

describe("botMove", () => {
  it("refuses hard difficulty without the model", async () => {
    const state = deal(mulberry32(3));
    await expect(botMove("hard", state, state.current, null)).rejects.toThrow("model unavailable");
  });

  it("uses the easy and medium bots without the model", async () => {
    const state = deal(mulberry32(3));
    expect(await botMove("easy", state, state.current, null)).toEqual(greedyMove(state, state.current));
    expect(await botMove("medium", state, state.current, null)).toEqual(smartMove(state, state.current));
  });
});
