import type { GameState } from "@/lib/engine/game";

export type Sound = "select" | "play" | "bigPlay" | "pass" | "deal" | "turn" | "nope" | "win" | "lose";

/**
 * The sounds a change at the table should make. `you` is the seat whose turn
 * gets a cue and whose win or loss is heard; null on a shared device, where
 * every finish sounds like a win and turns are announced by the hand-off.
 * Only the latest move is heard, so a jump of several moves (an online poll)
 * makes one sound, not a burst.
 */
export function tableSounds(prev: GameState | null, next: GameState, you: number | null): Sound[] {
  const fresh = next.history.length === 0 && next.winner === null;
  if (!prev) return fresh ? ["deal"] : [];
  if (next.history.length < prev.history.length) return fresh ? ["deal"] : [];

  const sounds: Sound[] = [];
  if (next.history.length > prev.history.length) {
    const cards = next.history.at(-1)!.cards.length;
    sounds.push(cards === 0 ? "pass" : cards === 5 ? "bigPlay" : "play");
  }
  if (next.winner !== null) {
    if (prev.winner === null) sounds.push(you === null || next.winner === you ? "win" : "lose");
  } else if (you !== null && next.current === you && prev.current !== you) {
    sounds.push("turn");
  }
  return sounds;
}

export const SOUND_KEY = "big2.sound.v1";

/** Sound is on unless it was turned off. */
export function readSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSoundOn(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}
