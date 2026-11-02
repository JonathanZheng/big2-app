/** The trained model for Hard bots in online rooms, read from the files the browser also uses. */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { encodeState } from "@/lib/model/encoding";
import { Network, type WeightsManifest } from "@/lib/model/network";

let loading: Promise<{ best: (state: GameState, player: number) => Card[] }> | null = null;

export function serverModel() {
  loading ??= (async () => {
    const dir = path.join(process.cwd(), "public", "model");
    const [manifest, bytes] = await Promise.all([
      readFile(path.join(dir, "selfplay_v2.json"), "utf8").then((t) => JSON.parse(t) as WeightsManifest),
      readFile(path.join(dir, "selfplay_v2.bin")),
    ]);
    const net = Network.fromBuffers(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return {
      best(state: GameState, player: number): Card[] {
        const moves = legalMoves(state, player);
        const scores = net.scoreMoves(encodeState(state, player), moves);
        return moves[scores.indexOf(Math.max(...scores))];
      },
    };
  })();
  loading.catch(() => { loading = null; }); // try again on the next request
  return loading;
}
