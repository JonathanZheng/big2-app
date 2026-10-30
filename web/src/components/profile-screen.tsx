"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ReviewPanel } from "@/components/review-panel";
import { SUIT_SYMBOLS } from "@/lib/engine/cards";
import { MoveType } from "@/lib/engine/moves";
import { ModelClient } from "@/lib/model/client";
import { type GameRecord, clearProfile, readGameRecords, summarise } from "@/lib/session/profile";
import { type SavedReview, deleteSavedReview, readSavedReviews } from "@/lib/session/saved-reviews";
import { readStats } from "@/lib/session/stats";

const COMBOS: [MoveType, string][] = [
  [MoveType.Single, "SINGLE"],
  [MoveType.Pair, "PAIR"],
  [MoveType.Triple, "TRIPLE"],
  [MoveType.Straight, "STRAIGHT"],
  [MoveType.Flush, "FLUSH"],
  [MoveType.FullHouse, "FULL HOUSE"],
  [MoveType.Quad, "FOUR OF A KIND"],
  [MoveType.StraightFlush, "STRAIGHT FLUSH"],
];
const SUIT_NAMES = ["DIAMONDS", "CLUBS", "HEARTS", "SPADES"];
const button = "border-3 border-ink font-extrabold";

// Read straight from storage on every render; the server has no stats.
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const snapshot = () => JSON.stringify([readGameRecords(), readStats(), readSavedReviews()]);

export function ProfileScreen() {
  const [, setVersion] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [open, setOpen] = useState<SavedReview | null>(null);
  // The model only loads when a saved review is opened.
  const client = useRef<ModelClient | null>(null);
  const getClient = useCallback(() => {
    if (!client.current) client.current = new ModelClient();
    return client.current;
  }, []);
  useEffect(() => () => client.current?.dispose(), []);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const data = useMemo(() => {
    if (raw === null) return null;
    const [records, stats, reviews] = JSON.parse(raw) as [GameRecord[], ReturnType<typeof readStats>, SavedReview[]];
    return { profile: summarise(records), stats, reviews };
  }, [raw]);

  if (!data) return <p className="font-mono text-sm">LOADING STATS...</p>;
  const { profile: p, stats, reviews } = data;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-5xl font-black tracking-tight leading-none">PROFILE</h1>
          <p className="font-mono text-xs">STATS FROM YOUR VS BOTS GAMES, KEPT IN THIS BROWSER.</p>
        </div>
        {p.games > 0 && (confirmReset ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs">DELETE EVERY STAT IN THIS BROWSER?</span>
            <button type="button" onClick={() => setConfirmReset(false)} className={`${button} px-3 py-2 bg-card`}>KEEP</button>
            <button type="button" className={`${button} px-3 py-2 bg-accent`}
              onClick={() => { clearProfile(); setConfirmReset(false); setVersion((v) => v + 1); }}>DELETE</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className={`${button} px-3 py-2 bg-card font-mono text-xs`}>
            RESET STATS
          </button>
        ))}
      </div>

      <Section title="SAVED REVIEWS">
        {reviews.length === 0 ? (
          <p className="font-mono text-sm">NO SAVED REVIEWS. AFTER A GAME, OPEN REVIEW AND PRESS SAVE REVIEW.</p>
        ) : (
          <ul className="flex flex-col">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink/20 py-2.5">
                <span className="flex flex-col">
                  <span className="font-extrabold text-sm">{r.title}</span>
                  <span className="font-mono text-[11px]">
                    {new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}
                    {" · "}{r.final.history.length} MOVES
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setOpen(r)} className={`${button} px-3 py-2 text-xs bg-accent shadow-brutal-sm`}>OPEN</button>
                  <button type="button" className={`${button} px-3 py-2 text-xs bg-card shadow-brutal-sm`}
                    onClick={() => { deleteSavedReview(r.id); setVersion((v) => v + 1); }}>DELETE</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {open && (
        <ReviewPanel
          final={open.final}
          getClient={getClient}
          onClose={() => setOpen(null)}
          names={open.names}
          seats={open.seats}
          youSeat={open.youSeat}
          players={open.players}
          scoreAll={open.scoreAll}
          saved
        />
      )}

      {p.games === 0 ? (
        <section className="border-3 border-ink bg-card p-6 shadow-brutal flex flex-col gap-4 items-start">
          <p className="font-mono text-sm">NO GAMES YET. FINISH A GAME AGAINST THE BOTS AND YOUR STATS SHOW UP HERE.</p>
          <Link href="/play" className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>PLAY VS BOTS</Link>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile label="GAMES" value={p.games} />
            <Tile label="WINS" value={p.wins} note={`OF ${p.games}`} />
            <Tile label="WIN STREAK" value={p.currentStreak} note={`BEST ${p.bestStreak}`} />
            <Tile label="MATCHES WON" value={stats.matchWins} note={`OF ${stats.matches}`} />
          </div>

          <Section title="BY DIFFICULTY">
            <div className="grid sm:grid-cols-3 gap-4">
              {(["easy", "medium", "hard"] as const).map((d) => {
                const { games, wins } = p.byDifficulty[d];
                return (
                  <div key={d} className="flex flex-col gap-2">
                    <div className="flex justify-between items-baseline">
                      <span className="font-extrabold">{d.toUpperCase()}</span>
                      <span className="font-mono text-sm">{wins} WINS OF {games}</span>
                    </div>
                    <Bar value={wins} max={games} label={`${d} wins`} />
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="grid lg:grid-cols-2 gap-6">
            <Section title="FAVOURITE SUIT">
              {p.favouriteSuit === null ? (
                <p className="font-mono text-sm">NO CARDS PLAYED YET.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <span aria-hidden className={`text-7xl leading-none ${p.favouriteSuit % 2 === 0 ? "text-suit-red" : ""}`}>
                      {SUIT_SYMBOLS[p.favouriteSuit]}
                    </span>
                    <div>
                      <div className="text-2xl font-black">{SUIT_NAMES[p.favouriteSuit]}</div>
                      <div className="font-mono text-xs">{p.suits[p.favouriteSuit]} CARDS PLAYED</div>
                    </div>
                  </div>
                  <Bars rows={p.suits.map((n, s) => [`${SUIT_SYMBOLS[s]} ${SUIT_NAMES[s]}`, n, s === p.favouriteSuit])} />
                </div>
              )}
            </Section>

            <Section title="WHAT YOU PLAY">
              <Bars rows={COMBOS.map(([t, name]) => [name, p.combos[t], t === p.favouriteCombo])} />
              <p className="mt-4 font-mono text-xs">PASSED {p.combos[MoveType.Pass]} TIMES.</p>
            </Section>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Tile label="CARDS LEFT WHEN YOU LOSE" value={p.avgCardsLeftWhenLosing ?? "NONE"} note="AVERAGE" />
            <Tile label="HINTS PER GAME" value={p.hintsPerGame ?? 0} note="TURNS WITH A HINT" />
          </div>

          <Section title="RECENT GAMES">
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b-3 border-ink">
                    <th className="py-2 pr-4">RESULT</th>
                    <th className="py-2 pr-4">DIFFICULTY</th>
                    <th className="py-2 pr-4">CARDS LEFT</th>
                    <th className="py-2">HINTS</th>
                  </tr>
                </thead>
                <tbody>
                  {p.recent.map((r, i) => (
                    <tr key={`${r.at}-${i}`} className="border-b-2 border-ink/20">
                      <td className={`py-2 pr-4 font-semibold ${r.won ? "" : "opacity-60"}`}>{r.won ? "WON" : "LOST"}</td>
                      <td className="py-2 pr-4">{r.difficulty.toUpperCase()}</td>
                      <td className="py-2 pr-4">{r.cardsLeft}</td>
                      <td className="py-2">{r.hints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm flex flex-col gap-1">
      <span className="font-mono text-[11px] font-semibold">{label}</span>
      <span className="text-5xl font-black leading-none tracking-tighter">{value}</span>
      {note && <span className="font-mono text-[11px]">{note}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
      <h2 className="text-sm font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Bar({ value, max, label, highlight = false }: { value: number; max: number; label: string; highlight?: boolean }) {
  const width = max > 0 ? (value / max) * 100 : 0;
  return (
    <div role="img" aria-label={`${label}: ${value} of ${max}`} className="h-4 border-2 border-ink bg-paper">
      <div className={`h-full ${highlight ? "bg-accent" : "bg-ink"}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Labelled bars scaled to the largest value; the highlighted row is the favourite. */
function Bars({ rows }: { rows: [string, number, boolean][] }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map(([name, n, highlight]) => (
        <li key={name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem] items-center gap-3">
          <span className={`font-mono text-xs ${highlight ? "font-semibold" : ""}`}>{name}</span>
          <div className="h-4 border-2 border-ink bg-paper">
            <div className={`h-full ${highlight ? "bg-accent" : "bg-ink"}`} style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-right">{n}</span>
        </li>
      ))}
    </ul>
  );
}
