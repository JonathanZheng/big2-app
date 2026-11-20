import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState, Play } from "@/lib/engine/game";
import { SOUND_KEY, readSoundOn, saveSoundOn, tableSounds } from "./events";

const state = (history: Play[], current: number, winner: number | null = null): GameState => ({
  hands: [[], [], [], []], current, firstMove: history.length === 0, lastPlay: null, passes: 0, history, winner,
});
const move = (player: number, n: number): Play => ({ player, cards: Array.from({ length: n }, (_, i) => i) });

afterEach(() => vi.unstubAllGlobals());

describe("tableSounds", () => {
  it("deals on a fresh game and stays quiet when joining one in progress", () => {
    expect(tableSounds(null, state([], 2), 0)).toEqual(["deal"]);
    expect(tableSounds(null, state([move(2, 1)], 3), 0)).toEqual([]);
  });

  it("deals again when the next game starts", () => {
    expect(tableSounds(state([move(0, 1), move(1, 0)], 2, 0), state([], 1), 0)).toEqual(["deal"]);
  });

  it("tells a single from a five-card play and a pass", () => {
    const before = state([move(1, 1)], 2);
    expect(tableSounds(before, state([move(1, 1), move(2, 2)], 3), 0)).toEqual(["play"]);
    expect(tableSounds(before, state([move(1, 1), move(2, 5)], 3), 0)).toEqual(["bigPlay"]);
    expect(tableSounds(before, state([move(1, 1), move(2, 0)], 3), 0)).toEqual(["pass"]);
  });

  it("cues your turn once, when it reaches you", () => {
    const before = state([move(2, 1)], 3);
    const yours = state([move(2, 1), move(3, 0)], 0);
    expect(tableSounds(before, yours, 0)).toEqual(["pass", "turn"]);
    expect(tableSounds(yours, { ...yours }, 0)).toEqual([]);
    expect(tableSounds(before, yours, null)).toEqual(["pass"]);
  });

  it("hears only the latest move after a jump", () => {
    expect(tableSounds(state([], 1), state([move(1, 1), move(2, 1), move(3, 0)], 0), 0)).toEqual(["pass", "turn"]);
  });

  it("plays a win or a loss once, for the right seat", () => {
    const before = state([move(1, 1)], 2);
    const over = state([move(1, 1), move(2, 1)], 3, 2);
    expect(tableSounds(before, over, 2)).toEqual(["play", "win"]);
    expect(tableSounds(before, over, 0)).toEqual(["play", "lose"]);
    expect(tableSounds(before, over, null)).toEqual(["play", "win"]);
    expect(tableSounds(over, { ...over }, 2)).toEqual([]);
  });

  it("makes no sound when nothing changed", () => {
    const s = state([move(1, 1)], 2);
    expect(tableSounds(s, { ...s, history: [...s.history] }, 0)).toEqual([]);
  });
});

describe("sound setting", () => {
  it("is on by default and remembers being turned off", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    expect(readSoundOn()).toBe(true);
    saveSoundOn(false);
    expect(data.get(SOUND_KEY)).toBe("off");
    expect(readSoundOn()).toBe(false);
    saveSoundOn(true);
    expect(readSoundOn()).toBe(true);
  });

  it("stays on when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readSoundOn()).toBe(true);
    expect(() => saveSoundOn(false)).not.toThrow();
  });
});
