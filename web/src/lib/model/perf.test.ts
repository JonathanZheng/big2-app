import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { encodeState } from "./encoding";
import { Network, type WeightsManifest } from "./network";

it("finds and scores every move of a hand with many five-card options in under 300 ms", () => {
  const dir = path.resolve(__dirname, "../../../public/model");
  const manifest = JSON.parse(readFileSync(path.join(dir, "selfplay_v1.json"), "utf8")) as WeightsManifest;
  const bytes = readFileSync(path.join(dir, "selfplay_v1.bin"));
  const net = Network.fromBuffers(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  const hand = parseCards("3d 3c 4d 4c 5d 5c 6d 6c 7d 7c 8d 8c 9d").sort((a, b) => a - b);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !hand.includes(c));
  const state: GameState = {
    hands: [hand, rest.slice(0, 13), rest.slice(13, 26), rest.slice(26, 39)],
    current: 0,
    firstMove: false,
    lastPlay: null,
    passes: 0,
    history: [],
    winner: null,
  };

  net.scoreMoves(encodeState(state, 0), [[0]]); // warm up
  const start = performance.now();
  const moves = legalMoves(state, 0);
  const scores = net.scoreMoves(encodeState(state, 0), moves);
  const ms = performance.now() - start;

  console.info(`${moves.length} moves in ${ms.toFixed(0)} ms`);
  expect(moves.length).toBeGreaterThan(100);
  expect(scores.length).toBe(moves.length);
  expect(ms).toBeLessThan(300);
});
