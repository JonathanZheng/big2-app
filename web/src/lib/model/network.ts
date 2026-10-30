/**
 * Forward pass of big2_ai/models/selfplay_network.py:
 * h1 = relu(W_s state + b_s + W_m move), h2 = relu(fc2 h1), h3 = relu(fc3 h2), score = out h3.
 */
import type { Card } from "@/lib/engine/cards";
import { MOVE_DIM, STATE_DIM, moveFeatures } from "./encoding";

export interface WeightsManifest {
  games: number;
  layers: { name: string; shape: number[]; offset: number }[];
}

const H1 = 512;
const H2 = 512;
const H3 = 256;

export class Network {
  private constructor(
    private stateW: Float32Array,
    private stateB: Float32Array,
    private moveW: Float32Array,
    private fc2W: Float32Array,
    private fc2B: Float32Array,
    private fc3W: Float32Array,
    private fc3B: Float32Array,
    private outW: Float32Array,
    private outB: number,
  ) {}

  static fromBuffers(manifest: WeightsManifest, buffer: ArrayBuffer): Network {
    const all = new Float32Array(buffer);
    const layer = (name: string) => {
      const entry = manifest.layers.find((l) => l.name === name);
      if (!entry) throw new Error(`Missing layer ${name}`);
      const size = entry.shape.reduce((a, b) => a * b, 1);
      return all.subarray(entry.offset, entry.offset + size);
    };
    return new Network(
      layer("state_in.weight"), layer("state_in.bias"), layer("move_in.weight"),
      layer("fc2.weight"), layer("fc2.bias"), layer("fc3.weight"), layer("fc3.bias"),
      layer("out.weight"), layer("out.bias")[0],
    );
  }

  /** Score each move for the position encoded in `state`. Higher is better. */
  scoreMoves(state: Float32Array, moves: Card[][]): Float32Array {
    // The state part of the first layer is shared by every move.
    const base = Float64Array.from(this.stateB);
    for (let i = 0; i < STATE_DIM; i++) {
      if (state[i] === 0) continue;
      for (let j = 0; j < H1; j++) base[j] += this.stateW[j * STATE_DIM + i] * state[i];
    }

    const h1 = new Float64Array(H1);
    const h2 = new Float64Array(H2);
    const scores = new Float32Array(moves.length);
    moves.forEach((cards, m) => {
      const features = moveFeatures(cards);
      for (let j = 0; j < H1; j++) {
        let v = base[j];
        for (const f of features) v += this.moveW[j * MOVE_DIM + f];
        h1[j] = v > 0 ? v : 0;
      }
      for (let j = 0; j < H2; j++) {
        let v = this.fc2B[j];
        const row = j * H1;
        for (let k = 0; k < H1; k++) v += this.fc2W[row + k] * h1[k];
        h2[j] = v > 0 ? v : 0;
      }
      let score = this.outB;
      for (let j = 0; j < H3; j++) {
        let v = this.fc3B[j];
        const row = j * H2;
        for (let k = 0; k < H2; k++) v += this.fc3W[row + k] * h2[k];
        if (v > 0) score += this.outW[j] * v;
      }
      scores[m] = score;
    });
    return scores;
  }
}
