"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameState } from "@/lib/engine/game";
import { tableSounds } from "@/lib/sound/events";
import { playSound, setSoundOn, soundOn, subscribeSound } from "@/lib/sound/play";

/** The win or loss sound waits for the result, which waits a beat after the last card. */
const RESULT_BEAT_MS = 600;

/** Turns sound effects on or off. Kept with the other table controls. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => true);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        setSoundOn(!on);
        if (!on) playSound("select");
      }}
      className={`border-3 border-ink font-extrabold px-3 py-1.5 min-h-9 font-mono ${on ? "bg-card" : "bg-ink text-paper"} ${className}`}
    >
      {on ? "SOUND ON" : "SOUND OFF"}
    </button>
  );
}

/** Plays the table's sounds as the game moves: deals, plays, passes, your turn and the result. */
export function useGameSounds(game: GameState | null, you: number | null) {
  const prev = useRef<GameState | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!game) return;
    const sounds = tableSounds(prev.current, game, you);
    prev.current = game;
    for (const sound of sounds) {
      if (sound === "win" || sound === "lose") {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        timers.current.push(setTimeout(() => playSound(sound), reduce ? 0 : RESULT_BEAT_MS));
      } else {
        playSound(sound);
      }
    }
  }, [game, you]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
}
