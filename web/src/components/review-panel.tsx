"use client";

import { useEffect, useMemo, useState } from "react";
import { CardFace } from "@/components/card";
import { Table } from "@/components/table";
import { type Card, cardName } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { type Label, rankAdvice } from "@/lib/model/advice";
import type { ModelClient } from "@/lib/model/client";
import { myDecisions, reviewStates } from "@/lib/session/review";
import { SEAT_NAMES } from "@/lib/session/match";

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");
const DEFAULT_PLAYERS = [0];

type Mark = { label: Label; best: Card[] } | "pending" | "unavailable";

/** Step through a finished game, with a label for each of my moves. */
export function ReviewPanel({ final, getClient, onClose, names = SEAT_NAMES, seats = [1, 2, 3], youSeat = 0, players = DEFAULT_PLAYERS }: {
  final: GameState;
  getClient: () => ModelClient | null;
  onClose: () => void;
  names?: string[];
  seats?: number[];
  youSeat?: number;
  players?: number[];
}) {
  const states = useMemo(() => reviewStates(final), [final]);
  const decisions = useMemo(() => myDecisions(final, players), [final, players]);
  const [step, setStep] = useState(0);
  const [marks, setMarks] = useState<Record<number, Mark>>(() =>
    Object.fromEntries(decisions.map((d) => [d.step, "pending"])),
  );
  const [done, setDone] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client = getClient();
      if (!client) {
        if (cancelled) return;
        setMarks(Object.fromEntries(decisions.map((d) => [d.step, "unavailable"])));
        setDone(decisions.length);
        return;
      }
      let finished = 0;
      for (const decision of decisions) {
        try {
          const { moves, scores } = await client.score(states[decision.step], decision.player);
          if (cancelled) return;
          const advice = rankAdvice(moves, scores);
          const chosen = advice.find((a) => key(a.cards) === key(decision.cards));
          setMarks((previous) => ({
            ...previous,
            [decision.step]: chosen ? { label: chosen.label, best: advice[0].cards } : "unavailable",
          }));
        } catch {
          if (cancelled) return;
          setMarks((previous) => ({ ...previous, [decision.step]: "unavailable" }));
        }
        finished += 1;
        if (!cancelled) setDone(finished);
      }
    })();
    return () => { cancelled = true; };
  }, [decisions, getClient, states]);

  const game = states[step];
  const play = step === 0 ? null : final.history[step - 1];
  const mark = play && players.includes(play.player) ? marks[step - 1] : null;
  const handSeat = players.length > 1 ? (players.includes(game.current) ? game.current : null) : 0;
  const shownHand = handSeat === null ? [] : game.hands[handSeat];
  const counts = { Inaccuracy: 0, Mistake: 0, Blunder: 0 };
  for (const m of Object.values(marks)) {
    if (m === "pending" || m === "unavailable") continue;
    if (m.label === "Inaccuracy" || m.label === "Mistake" || m.label === "Blunder") counts[m.label] += 1;
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-4xl font-black tracking-tight leading-none">GAME REVIEW</h2>
            <p className="mt-2 font-mono text-xs">
              {done < decisions.length
                ? `ANALYSING YOUR MOVES: ${done} OF ${decisions.length}`
                : `INACCURACIES ${counts.Inaccuracy} · MISTAKES ${counts.Mistake} · BLUNDERS ${counts.Blunder}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className={`${button} px-4 py-2 bg-card shadow-brutal-sm`}>CLOSE</button>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={`${button} px-4 py-2 bg-card`}>PREVIOUS</button>
          <span className="font-mono text-sm">{step === 0 ? "START" : `MOVE ${step} OF ${final.history.length}`}</span>
          <button type="button" disabled={step === states.length - 1} onClick={() => setStep((s) => Math.min(states.length - 1, s + 1))}
            className={`${button} px-4 py-2 bg-accent`}>NEXT</button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Table game={game} thinking={false} names={names} seats={seats} youSeat={youSeat} />
            <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm">
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-sm font-extrabold">
                  {handSeat === null ? "HAND HIDDEN" : names[handSeat] === "You" ? "MY HAND" : `${names[handSeat].toUpperCase()}'S HAND`}
                </span>
                <span className="font-mono text-xs">{shownHand.length} CARDS</span>
              </div>
              {shownHand.length === 0 ? (
                <p className="mt-2 font-mono text-xs">{handSeat === null ? "NO HUMAN IS TO PLAY." : "NO CARDS LEFT."}</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {shownHand.map((card) => (
                    <CardFace key={card} card={card} compact className="w-8 h-11 p-1 shadow-brutal-sm" />
                  ))}
                </div>
              )}
            </div>

            <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm">
              <div className="text-sm font-extrabold">{step === 0 ? "START OF THE GAME" : `MOVE ${step}`}</div>
              {play && (
                <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-sm">
                  <span className="font-extrabold">{names[play.player].toUpperCase()}</span>
                  {play.cards.length === 0
                    ? <span>PASSED</span>
                    : play.cards.map((card) => (
                      <span key={card} className="border-2 border-ink bg-paper px-1.5 py-1">{cardName(card)}</span>
                    ))}
                </div>
              )}
              {mark && mark !== "pending" && mark !== "unavailable" && (
                <div className="mt-3 flex flex-col gap-2 border-t-2 border-ink pt-3">
                  <div className="font-mono text-sm">
                    {play?.player === 0 ? "YOUR MOVE" : `${names[play!.player].toUpperCase()} MOVE`}:{" "}
                    <span className="font-extrabold">{mark.label.toUpperCase()}</span>
                  </div>
                  {key(mark.best) !== key(play?.cards ?? []) && (
                    <div className="font-mono text-xs">
                      MODEL PREFERRED: {mark.best.length === 0 ? "PASS" : mark.best.map(cardName).join(" ")}
                    </div>
                  )}
                </div>
              )}
              {mark === "unavailable" && <p className="mt-3 font-mono text-xs">NO LABEL FOR THIS MOVE.</p>}
            </div>
          </div>

          <aside className="flex max-h-[70vh] flex-col overflow-y-auto border-3 border-ink bg-card shadow-brutal">
            <div className="border-b-3 border-ink p-3 text-sm font-extrabold">MOVES</div>
            <button type="button" onClick={() => setStep(0)}
              className={`border-b-2 border-ink px-3 py-2 text-left font-mono text-xs ${step === 0 ? "bg-accent" : "bg-paper"}`}>
              START
            </button>
            {final.history.map((p, i) => {
              const m = players.includes(p.player) ? marks[i] : null;
              return (
                <button key={i} type="button" onClick={() => setStep(i + 1)}
                  className={`border-b-2 border-ink px-3 py-2 text-left font-mono text-xs ${step === i + 1 ? "bg-accent" : "bg-paper"}`}>
                  <span className="font-extrabold">{names[p.player].toUpperCase()}</span>{" "}
                  {p.cards.length === 0 ? "PASS" : p.cards.map(cardName).join(" ")}
                  {m && m !== "pending" && m !== "unavailable" && <span className="ml-2 font-extrabold">{m.label.toUpperCase()}</span>}
                </button>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}
