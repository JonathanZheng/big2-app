import { describe, expect, it } from "vitest";
import { applyMove, deal, mulberry32 } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { announce } from "./table";

const names = ["You", "West", "North", "East"];

describe("announce", () => {
  it("names whose turn it is before anyone has played", () => {
    const game = deal(mulberry32(1));
    const turn = game.current === 0 ? "Your turn." : `${names[game.current]} to play.`;
    expect(announce(game, names, 0)).toBe(`New trick. ${turn}`);
  });

  it("speaks the cards of a play and then the next seat", () => {
    const start = deal(mulberry32(1));
    const move = legalMoves(start, start.current)[0];
    const game = applyMove(start, move);
    const who = start.current === 0 ? "You play" : `${names[start.current]} plays`;
    const said = announce(game, names, 0);
    expect(said.startsWith(`${who} 3 of diamonds`)).toBe(true);
    expect(said.endsWith(game.current === 0 ? "Your turn." : `${names[game.current]} to play.`)).toBe(true);
  });

  it("says when a seat passes", () => {
    const start = deal(mulberry32(1));
    const opened = applyMove(start, legalMoves(start, start.current)[0]);
    const game = applyMove(opened, []);
    const who = opened.current === 0 ? "You pass." : `${names[opened.current]} passes.`;
    expect(announce(game, names, 0).startsWith(who)).toBe(true);
  });
});
