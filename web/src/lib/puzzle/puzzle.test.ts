import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legalMoves } from "@/lib/engine/legal";
import { encodeState } from "@/lib/model/encoding";
import { MODEL } from "@/lib/model/current";
import { Network, type WeightsManifest } from "@/lib/model/network";
import { readQueue } from "@/lib/account/store";
import { signedIn } from "@/lib/account/test-helpers";
import {
  PUZZLE_LAUNCH, type Puzzle, archiveDays, dayKey, isArchiveDay, parseDay, puzzleFor, puzzleState, readGuestResults, readResults,
  saveResult, streak,
} from "./puzzle";

const publicDir = path.resolve(__dirname, "../../../public");
const puzzles = JSON.parse(readFileSync(path.join(publicDir, "puzzles.json"), "utf8")) as Puzzle[];
const key = (cards: number[]) => [...cards].sort((a, b) => a - b).join(",");

describe("puzzles.json", () => {
  it("has a puzzle for every day of a year, each with a legal best move", () => {
    expect(puzzles.length).toBe(365);
    for (const p of puzzles) {
      const legal = legalMoves(puzzleState(p), p.current).map(key);
      expect(legal.length).toBeGreaterThanOrEqual(4);
      expect(legal).toContain(key(p.best));
    }
  });

  it("gets the same best move from the browser model as from Python", () => {
    const manifest = JSON.parse(readFileSync(path.join(publicDir, `model/${MODEL}.json`), "utf8")) as WeightsManifest;
    const bytes = readFileSync(path.join(publicDir, `model/${MODEL}.bin`));
    const net = Network.fromBuffers(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    for (const p of puzzles) {
      const state = puzzleState(p);
      const moves = legalMoves(state, p.current);
      const scores = net.scoreMoves(encodeState(state, p.current), moves);
      const best = moves[scores.indexOf(Math.max(...scores))];
      expect(key(best)).toBe(key(p.best));
    }
  });
});

describe("daily choice", () => {
  it("uses the local calendar day and changes each day", () => {
    expect(dayKey(new Date(2026, 9, 31, 23, 59))).toBe("2026-10-31");
    expect(puzzleFor(new Date(2026, 9, 31), 365)).not.toBe(puzzleFor(new Date(2026, 10, 1), 365));
    expect(puzzleFor(new Date(2026, 9, 31, 1), 365)).toBe(puzzleFor(new Date(2026, 9, 31, 23), 365));
  });
});

describe("results and streak", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts consecutive solved days ending today or yesterday", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    saveResult("2026-10-28", { cards: [1], label: "Best" });
    saveResult("2026-10-29", { cards: [1], label: "Good" });
    saveResult("2026-10-30", { cards: [1], label: "Best" });
    expect(readResults()["2026-10-29"].label).toBe("Good");
    // A Good answer is not a solve, so the streak is just the 30th.
    expect(streak(readResults(), new Date(2026, 9, 30))).toBe(1);
    expect(streak(readResults(), new Date(2026, 9, 31))).toBe(1); // today not played yet
    expect(streak(readResults(), new Date(2026, 10, 2))).toBe(0);
  });

  it("survives blocked storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } });
    expect(readResults()).toEqual({});
    expect(() => saveResult("2026-10-31", { cards: [], label: "Best" })).not.toThrow();
  });
});

describe("archive", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads only real calendar days", () => {
    expect(dayKey(parseDay("2026-11-03")!)).toBe("2026-11-03");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-1-3")).toBeNull();
    expect(parseDay("yesterday")).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it("lists every day from launch up to yesterday, newest first", () => {
    const days = archiveDays(new Date(2026, 10, 5));
    expect(days[0]).toBe("2026-11-04");
    expect(days.at(-1)).toBe(PUZZLE_LAUNCH);
    expect(days).toHaveLength(5); // 31 Oct to 4 Nov
    expect(archiveDays(new Date(2026, 9, 31))).toEqual([]); // launch day: nothing past yet
  });

  it("goes back at most a year, so no puzzle shows twice", () => {
    const days = archiveDays(new Date(2028, 0, 1));
    expect(days).toHaveLength(364);
    expect(new Set(days.map((d) => puzzleFor(parseDay(d)!, 365))).size).toBe(364);
  });

  it("opens past days only, not today, the future or before launch", () => {
    const today = new Date(2026, 10, 5);
    expect(isArchiveDay("2026-11-04", today)).toBe(true);
    expect(isArchiveDay(PUZZLE_LAUNCH, today)).toBe(true);
    expect(isArchiveDay("2026-11-05", today)).toBe(false);
    expect(isArchiveDay("2026-11-06", today)).toBe(false);
    expect(isArchiveDay("2026-10-30", today)).toBe(false);
  });

  it("does not count late answers towards the streak", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    saveResult("2026-11-03", { cards: [1], label: "Best" });
    saveResult("2026-11-04", { cards: [1], label: "Best", late: true });
    saveResult("2026-11-05", { cards: [1], label: "Best" });
    expect(readResults()["2026-11-04"].late).toBe(true);
    expect(streak(readResults(), new Date(2026, 10, 5))).toBe(1);
  });
});

describe("signed in", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves puzzle results to the account", () => {
    signedIn();
    saveResult("2026-11-01", { cards: [1], label: "Good" });
    expect(readResults()["2026-11-01"].label).toBe("Good");
    expect(readGuestResults()).toEqual({});
    expect(readQueue("a")?.puzzles["2026-11-01"].label).toBe("Good");
  });
});

describe("readGuestResults with unexpected data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ignores a saved value that is not an object", () => {
    for (const raw of ["5", "null"]) {
      vi.stubGlobal("localStorage", { getItem: () => raw, setItem: () => {}, removeItem: () => {} });
      expect(readGuestResults()).toEqual({});
    }
  });
});
