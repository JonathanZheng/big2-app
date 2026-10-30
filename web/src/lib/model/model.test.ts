import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fixtures from "@/lib/engine/__fixtures__/positions.json";
import { type Fixture, stateFromFixture } from "@/lib/engine/game";
import { STATE_DIM, encodeState } from "./encoding";
import { Network, type WeightsManifest } from "./network";

const positions = fixtures as Fixture[];
const modelDir = path.resolve(__dirname, "../../../public/model");

function loadNetwork(): Network {
  const manifest = JSON.parse(readFileSync(path.join(modelDir, "selfplay_v1.json"), "utf8")) as WeightsManifest;
  const bytes = readFileSync(path.join(modelDir, "selfplay_v1.bin"));
  return Network.fromBuffers(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe("encodeState", () => {
  it("matches the Python encoding on every fixture position", () => {
    for (const f of positions) {
      const encoded = encodeState(stateFromFixture(f), f.current);
      expect(encoded.length).toBe(STATE_DIM);
      const ones = [...encoded.keys()].filter((i) => encoded[i] === 1);
      expect(ones).toEqual(f.stateOnes);
      expect(encoded.every((v) => v === 0 || v === 1)).toBe(true);
    }
  });
});

describe("Network", () => {
  it("scores every fixture move within 1e-4 of PyTorch", () => {
    const net = loadNetwork();
    for (const f of positions) {
      const scores = net.scoreMoves(encodeState(stateFromFixture(f), f.current), f.legal);
      expect(scores.length).toBe(f.legal.length);
      f.scores.forEach((s, i) => expect(Math.abs(scores[i] - s)).toBeLessThan(1e-4));
    }
  });
});
