import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GameState } from "@/lib/engine/game";
import { STATE_DIM, encodeState } from "./encoding";
import { MODEL } from "./current";
import { Network, type WeightsManifest } from "./network";

const dir = path.resolve(__dirname, "../../../public/model");
const manifest = JSON.parse(readFileSync(path.join(dir, `${MODEL}.json`), "utf8")) as WeightsManifest;
const bytes = readFileSync(path.join(dir, `${MODEL}.bin`));
const weights = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const layer = (name: string) => manifest.layers.find((l) => l.name === name)!;
const withLayer = (name: string, change: object): WeightsManifest =>
  ({ ...manifest, layers: manifest.layers.map((l) => (l.name === name ? { ...l, ...change } : l)) });

describe("Network.fromBuffers", () => {
  it("rejects weights that are not float32 data, empty or not finite", () => {
    expect(() => Network.fromBuffers(manifest, new ArrayBuffer(6))).toThrow("not float32 data");
    expect(() => Network.fromBuffers(manifest, new ArrayBuffer(0))).toThrow("empty");
    const bad = weights();
    new Float32Array(bad)[3] = Number.NaN;
    expect(() => Network.fromBuffers(manifest, bad)).toThrow("invalid numbers");
  });

  it("rejects a manifest with a missing, misplaced or wrongly sized layer", () => {
    const missing = { ...manifest, layers: manifest.layers.filter((l) => l.name !== "fc2.bias") };
    expect(() => Network.fromBuffers(missing, weights())).toThrow("Missing layer fc2.bias");
    for (const offset of [-1, 1.5, 1e9]) {
      expect(() => Network.fromBuffers(withLayer("fc2.bias", { offset }), weights())).toThrow("Model layer fc2.bias is outside the weights file");
    }
    const smaller = layer("fc2.bias").shape.map((d, i) => (i === 0 ? d - 1 : d));
    expect(() => Network.fromBuffers(withLayer("fc2.bias", { shape: smaller }), weights())).toThrow("Model layer fc2.bias has the wrong size");
  });
});

describe("Network.scoreMoves", () => {
  it("refuses to return scores that overflow", () => {
    const buffer = weights();
    const all = new Float32Array(buffer);
    const fill = (name: string, value: number) => {
      const { offset, shape } = layer(name);
      all.fill(value, offset, offset + shape.reduce((a, b) => a * b, 1));
    };
    // Every last hidden unit is 1, so the score is far beyond float32.
    fill("fc3.weight", 0);
    fill("fc3.bias", 1);
    fill("out.weight", 3e38);
    fill("out.bias", 3e38);
    const net = Network.fromBuffers(manifest, buffer);
    expect(() => net.scoreMoves(new Float32Array(STATE_DIM), [[0]])).toThrow("Model produced an invalid score");
  });
});

describe("encodeState", () => {
  it("leaves the card count empty for an opponent with no cards", () => {
    const state: GameState = {
      hands: [[0], [3], [1], [2]], current: 0, firstMove: false, lastPlay: null, passes: 0, history: [], winner: null,
    };
    const ones = (x: Float32Array) => x.reduce((a, b) => a + b, 0);
    const withCard = encodeState(state, 0);
    const empty = encodeState({ ...state, hands: [[0], [], [1], [2]] }, 0);
    expect(ones(withCard) - ones(empty)).toBe(1);
  });
});
