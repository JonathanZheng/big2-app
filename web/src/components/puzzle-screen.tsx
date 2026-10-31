"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { CardRow } from "@/components/card";
import { Hand } from "@/components/hand";
import { HistoryPanel } from "@/components/history-panel";
import { Table } from "@/components/table";
import { type Card, cardName } from "@/lib/engine/cards";
import { legalMoves } from "@/lib/engine/legal";
import { sortHand } from "@/lib/hand/sort";
import { type Label, evaluation, rankAdvice } from "@/lib/model/advice";
import { ModelClient } from "@/lib/model/client";
import {
  type Puzzle, type PuzzleResult, dayKey, puzzleFor, puzzleState, readResults, saveResult, streak,
} from "@/lib/puzzle/puzzle";

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");
const RELATIVE = ["You", "West", "North", "East"];
const formatEval = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

const VERDICT: Record<Label, string> = {
  Best: "SOLVED. THAT IS THE BOT'S BEST MOVE.",
  Good: "CLOSE. GOOD, BUT NOT THE BEST MOVE.",
  Inaccuracy: "NOT QUITE. AN INACCURACY.",
  Mistake: "MISSED IT. A MISTAKE.",
  Blunder: "MISSED IT. A BLUNDER.",
};

// Results live in localStorage; read them on every render on the client.
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export function PuzzleScreen() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const resultsRaw = useSyncExternalStore(subscribe, () => JSON.stringify(readResults()), () => null);
  // The day is read on the client only; the page is prerendered without it.
  const day = useSyncExternalStore(subscribe, () => dayKey(new Date()), () => null);
  const today = useMemo(() => {
    if (day === null) return null;
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [day]);

  useEffect(() => {
    fetch("/puzzles.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Puzzle[]>;
      })
      .then(setPuzzles, (e: unknown) => setLoadError(String(e)));
  }, []);

  const client = useRef<ModelClient | null>(null);
  const getClient = useCallback(() => (client.current ??= new ModelClient()), []);
  useEffect(() => () => client.current?.dispose(), []);

  if (loadError) return <p className="font-mono text-sm">TODAY&apos;S PUZZLE COULD NOT LOAD. CHECK YOUR CONNECTION AND REFRESH.</p>;
  if (!puzzles || resultsRaw === null || today === null || day === null) return <p className="font-mono text-sm">LOADING TODAY&apos;S PUZZLE...</p>;

  const results = JSON.parse(resultsRaw) as Record<string, PuzzleResult>;
  const index = puzzleFor(today, puzzles.length);
  return (
    <Board
      key={day}
      puzzle={puzzles[index]}
      number={index + 1}
      result={results[day] ?? null}
      solved={Object.values(results).filter((r) => r.label === "Best").length}
      played={Object.keys(results).length}
      streak={streak(results, today)}
      getClient={getClient}
      onAnswer={(r) => { saveResult(day, r); setVersion((v) => v + 1); }}
    />
  );
}

function Board({ puzzle, number, result, solved, played, streak: run, getClient, onAnswer }: {
  puzzle: Puzzle; number: number; result: PuzzleResult | null; solved: number; played: number; streak: number;
  getClient: () => ModelClient; onAnswer: (r: PuzzleResult) => void;
}) {
  const state = useMemo(() => puzzleState(puzzle), [puzzle]);
  const me = puzzle.current;
  // Names relative to the solver: the next seat is West, then North, then East.
  const names = useMemo(() => [0, 1, 2, 3].map((seat) => RELATIVE[(seat - me + 4) % 4]), [me]);
  const others = [1, 2, 3].map((r) => (me + r) % 4);
  const hand = state.hands[me];
  const legal = useMemo(() => legalMoves(state, me), [me, state]);
  const legalKeys = useMemo(() => new Set(legal.map(key)), [legal]);
  const [order, setOrder] = useState(() => sortHand(hand, "rank"));
  const [selected, setSelected] = useState<Card[]>([]);
  const [advice, setAdvice] = useState<AdviceStatus>({ kind: "idle" });
  // Raw scores, so any move's score can be shown, not only the top three.
  const [scored, setScored] = useState<{ moves: Card[][]; scores: Float32Array } | null>(null);
  const answered = result !== null;

  // Once answered, show how every option scores.
  useEffect(() => {
    if (!answered) return;
    let cancelled = false;
    getClient().score(state, me).then(
      ({ moves, scores }) => {
        if (cancelled) return;
        setScored({ moves, scores });
        setAdvice({ kind: "ready", advice: rankAdvice(moves, scores) });
      },
      () => { if (!cancelled) setAdvice({ kind: "error", message: "THE MODEL COULD NOT LOAD, SO THE OPTIONS CANNOT BE SHOWN." }); },
    );
    return () => { cancelled = true; };
  }, [answered, getClient, me, state]);

  async function submit(cards: Card[]) {
    if (answered || !legalKeys.has(key(cards))) return;
    setAdvice({ kind: "loading" });
    try {
      const { moves, scores } = await getClient().score(state, me);
      const ranked = rankAdvice(moves, scores);
      const mine = ranked.find((a) => key(a.cards) === key(cards));
      onAnswer({ cards, label: mine?.label ?? "Blunder" });
    } catch {
      setAdvice({ kind: "error", message: "THE MODEL COULD NOT LOAD. TRY AGAIN WHEN YOU ARE ONLINE." });
    }
  }

  const topEval = advice.kind === "ready" ? advice.advice[0].evaluation : null;
  const chosenIndex = scored && result ? scored.moves.findIndex((m) => key(m) === key(result.cards)) : -1;
  const chosenEval = scored && chosenIndex >= 0 ? evaluation(scored.scores[chosenIndex]) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-5xl font-black tracking-tight leading-none">DAILY PUZZLE</h1>
          <p className="font-mono text-xs">PUZZLE {number}. FIND THE BOT&apos;S BEST MOVE. ONE TRY A DAY.</p>
        </div>
        <div className="flex gap-3 font-mono text-xs">
          <span className="border-3 border-ink bg-card px-3 py-2 shadow-brutal-sm">STREAK <strong className="text-base">{run}</strong></span>
          <span className="border-3 border-ink bg-card px-3 py-2 shadow-brutal-sm">SOLVED <strong className="text-base">{solved}</strong> OF {played}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          <Table game={state} thinking={false} names={names} seats={others} youSeat={me} />

          {answered ? (
            <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-3">
              <h2 className="text-2xl font-black">{VERDICT[result.label]}</h2>
              <div className="flex flex-wrap items-center gap-3 font-mono text-sm">
                <span>YOU PLAYED</span>
                {result.cards.length ? <CardRow cards={result.cards} size="sm" /> : <strong>PASS</strong>}
                {chosenEval !== null && <span>SCORE {formatEval(chosenEval)}</span>}
              </div>
              {key(result.cards) !== key(puzzle.best) && (
                <div className="flex flex-wrap items-center gap-3 font-mono text-sm">
                  <span>BEST MOVE</span>
                  {puzzle.best.length ? <CardRow cards={puzzle.best} size="sm" /> : <strong>PASS</strong>}
                  {topEval !== null && <span>SCORE {formatEval(topEval)}</span>}
                </div>
              )}
              <p className="font-mono text-xs">A NEW PUZZLE EVERY DAY. {result.label === "Best" ? "KEEP THE STREAK GOING." : ""}</p>
            </section>
          ) : (
            <>
              <Hand
                order={order}
                selected={selected}
                playable={new Set(legal.flat())}
                groups={[]}
                onToggle={(c) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
                onSlideSelect={setSelected}
                onReorder={setOrder}
              />
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled={!legalKeys.has(key(selected)) || selected.length === 0 || advice.kind === "loading"}
                  onClick={() => void submit(selected)}
                  className={`${button} h-14 sm:h-16 text-lg sm:text-2xl bg-accent shadow-brutal`}>
                  {selected.length ? `PLAY ${selected.map(cardName).join(" ")}` : "PICK YOUR MOVE"}
                </button>
                <button type="button" disabled={!legalKeys.has("") || advice.kind === "loading"} onClick={() => void submit([])}
                  className={`${button} h-14 sm:h-16 text-lg sm:text-2xl bg-card shadow-brutal`}>
                  PASS
                </button>
              </div>
              {advice.kind === "error" && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{advice.message}</p>}
            </>
          )}
        </div>

        <aside className="flex flex-col gap-5">
          {answered && (
            <div className="border-3 border-ink bg-card shadow-brutal">
              <div className="border-b-3 border-ink p-3 text-sm font-extrabold">EVERY OPTION</div>
              <AdvicePanel status={advice} onPick={() => undefined} />
            </div>
          )}
          <div className="border-3 border-ink bg-card shadow-brutal max-h-[70vh] overflow-y-auto">
            <div className="border-b-3 border-ink p-3 text-sm font-extrabold">HOW WE GOT HERE</div>
            <HistoryPanel game={state} names={names} hand={hand} />
          </div>
        </aside>
      </div>
    </div>
  );
}

