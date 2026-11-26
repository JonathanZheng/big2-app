"use client";

import { useState } from "react";
import { BOT_RATINGS, type RatedGame, START_RATING } from "@/lib/session/rating";

/** Games shown, newest last. Older games still count towards the rating. */
const SHOWN = 100;
const LEVELS = [["HARD", BOT_RATINGS.hard], ["MEDIUM", BOT_RATINGS.medium], ["EASY", BOT_RATINGS.easy]] as const;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * The rating after each of the last hundred games, from the start rating or
 * the rating before the first game shown. Dashed lines mark the bot levels.
 * Point at the chart, or focus it and use the arrow keys, to read a game.
 */
export function RatingChart({ history }: { history: RatedGame[] }) {
  const shown = history.slice(-SHOWN);
  const firstNumber = history.length - shown.length;
  const startRating = firstNumber === 0 ? START_RATING : history[firstNumber - 1].rating;
  const points = [startRating, ...shown.map((g) => g.rating)];
  const [active, setActive] = useState<number | null>(null);

  const values = [...points, ...LEVELS.map(([, r]) => r)];
  const low = Math.min(...values) - 20;
  const high = Math.max(...values) + 20;
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const y = (r: number) => ((high - r) / (high - low)) * 100;
  const path = points.map((r, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(r)}`).join(" ");

  function pick(clientX: number, box: DOMRect) {
    const i = Math.round(((clientX - box.left) / box.width) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.max(0, Math.min(points.length - 1, (i ?? points.length - 1) + step)));
  }

  const game = active !== null && active > 0 ? shown[active - 1] : null;
  const label = active === null ? null : game
    ? `GAME ${firstNumber + active} · ${game.won ? "WON" : "LOST"} VS ${game.difficulty.toUpperCase()} · ${game.rating} (${signed(game.change)})`
    : `${firstNumber === 0 ? "START" : `AFTER GAME ${firstNumber}`} · ${startRating}`;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs">
        {firstNumber === 0 ? "YOUR RATING AFTER EACH GAME" : `YOUR RATING OVER THE LAST ${shown.length} GAMES`}
      </span>
      <div className="flex gap-3 pt-8">
        <div
          role="img"
          tabIndex={0}
          aria-label={`Rating over ${shown.length} games, from ${startRating} to ${points.at(-1)}. Use the arrow keys to read each game.`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="relative flex-1 h-48 border-b-3 border-l-3 border-ink touch-none focus-visible:outline-3 focus-visible:outline-accent"
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
            {LEVELS.map(([name, r]) => (
              <line key={name} x1="0" x2="100" y1={y(r)} y2={y(r)} stroke="var(--color-ink)" strokeOpacity="0.35"
                strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-accent border-2 border-ink pointer-events-none"
            style={{ left: "100%", top: `${y(points.at(-1)!)}%` }} />
          {active !== null && (
            <>
              <div className="absolute top-0 bottom-0 w-0.5 bg-ink/40 pointer-events-none" style={{ left: `${x(active)}%` }} />
              <div className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-accent border-2 border-ink pointer-events-none"
                style={{ left: `${x(active)}%`, top: `${y(points[active])}%` }} />
              <div className={`absolute top-0 -translate-y-[calc(100%+6px)] border-2 border-ink bg-card px-2 py-1 font-mono text-[11px] whitespace-nowrap pointer-events-none ${
                x(active) > 60 ? "-translate-x-full" : ""}`} style={{ left: `${x(active)}%` }}>
                {label}
              </div>
            </>
          )}
        </div>
        <div className="relative w-16 h-48 font-mono text-[11px]" aria-hidden>
          {LEVELS.map(([name, r]) => (
            <span key={name} className="absolute -translate-y-1/2" style={{ top: `${y(r)}%` }}>{name}</span>
          ))}
        </div>
      </div>
      <p className="font-mono text-[11px]">DASHED LINES MARK THE BOT LEVELS. POINT AT THE LINE, OR FOCUS IT AND USE THE ARROW KEYS, TO READ A GAME.</p>
    </div>
  );
}
