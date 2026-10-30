"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { CardGrid } from "@/components/card-grid";
import { ReviewPanel } from "@/components/review-panel";
import { Table } from "@/components/table";
import { EMPTY_BOARD, cardsWithOwner, type Board, type CardOwner } from "@/lib/best-move/board";
import {
  type FollowState, clearFollow, followFinalState, followToGame, readFollow, replayFollow, saveFollow,
  selectableCards, startFollow,
} from "@/lib/best-move/follow";
import type { Card } from "@/lib/engine/cards";
import type { Play } from "@/lib/engine/game";
import { rankAdvice } from "@/lib/model/advice";
import type { ModelClient } from "@/lib/model/client";
import { SEAT_NAMES } from "@/lib/session/match";
import { saveReview } from "@/lib/session/saved-reviews";

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";
const MODEL_FAILED = "Model failed to load. You can still record the game, but advice needs the model.";
const sortedCards = (cards: Card[]) => [...cards].sort((a, b) => a - b);

export function FollowGame({ getClient }: { getClient: () => ModelClient | null }) {
  const requestId = useRef(0);
  const [setupOwners, setSetupOwners] = useState<CardOwner[]>(Array<CardOwner>(52).fill("unseen"));
  const [initial, setInitial] = useState<Card[] | null>(null);
  const [history, setHistory] = useState<Play[]>([]);
  const [opener, setOpener] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AdviceStatus>({ kind: "idle" });
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    const saved = readFollow();
    // Storage is only available after mount, so this cannot be a lazy initializer.
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitial(saved.initial);
      setHistory(saved.history);
    }
  }, []);

  const setupBoard: Board = { ...EMPTY_BOARD, owners: setupOwners };
  const setupHand = cardsWithOwner(setupBoard, "mine");
  const state = useMemo<FollowState | null>(() => {
    if (!initial) return null;
    try {
      return replayFollow(initial, history);
    } catch {
      return null;
    }
  }, [initial, history]);

  const player = state ? (state.current ?? opener) : null;
  const selectable = state ? selectableCards(state, player) : new Set<Card>();
  const game = state ? followToGame(state) : null;
  const display = game && state && state.current === null ? { ...game, current: opener } : game;

  function reset() {
    clearFollow();
    setInitial(null);
    setHistory([]);
    setSelected([]);
    setError(null);
    setStatus({ kind: "idle" });
    setSetupOwners(Array<CardOwner>(52).fill("unseen"));
    setReviewing(false);
  }

  function start() {
    try {
      const started = startFollow(setupHand);
      setInitial(started.initial);
      setHistory([]);
      setSelected([]);
      setError(null);
      setStatus({ kind: "idle" });
      saveFollow(started.initial, []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function record(cards: Card[]) {
    if (!initial || !state) return;
    const who = state.current ?? opener;
    try {
      const next = [...history, { player: who, cards: sortedCards(cards) }];
      replayFollow(initial, next);
      setHistory(next);
      setSelected([]);
      setError(null);
      setStatus({ kind: "idle" });
      saveFollow(initial, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function pass() {
    if (!state || !initial || state.lastPlay === null || state.current === null) return;
    try {
      const next = [...history, { player: state.current, cards: [] }];
      replayFollow(initial, next);
      setHistory(next);
      setSelected([]);
      setError(null);
      setStatus({ kind: "idle" });
      saveFollow(initial, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function undo() {
    if (!initial || history.length === 0) return;
    const next = history.slice(0, -1);
    setHistory(next);
    setSelected([]);
    setError(null);
    setStatus({ kind: "idle" });
    saveFollow(initial, next);
  }

  async function ask() {
    if (!state || state.current !== 0 || state.winner !== null) return;
    const client = getClient();
    if (!client) {
      setStatus({ kind: "error", message: MODEL_FAILED });
      return;
    }
    const id = ++requestId.current;
    setStatus({ kind: "loading" });
    try {
      const { moves, scores } = await client.score(followToGame(state), 0);
      if (id !== requestId.current) return;
      setStatus({ kind: "ready", advice: rankAdvice(moves, scores) });
    } catch {
      if (id !== requestId.current) return;
      setStatus({ kind: "error", message: MODEL_FAILED });
    }
  }

  if (!initial || !state || !game || !display) {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h2 className="text-3xl font-black tracking-tight leading-none">FOLLOW A REAL GAME</h2>
          <p className="max-w-3xl font-mono text-sm leading-relaxed">
            MARK THE 13 CARDS YOU WERE DEALT. THEN RECORD EACH MOVE AS IT HAPPENS. THE BOT GETS
            THE FULL MOVE ORDER, SO ITS ADVICE IS AS STRONG AS DURING A GAME.
          </p>
        </header>
        <CardGrid
          board={setupBoard}
          onCard={(card) => setSetupOwners((owners) => {
            const next = [...owners];
            next[card] = next[card] === "mine" ? "unseen" : "mine";
            return next;
          })}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-3 border-ink bg-card p-4 shadow-brutal-sm">
          <div className="font-mono text-sm">
            {setupHand.length} OF 13 CARDS MARKED
            {setupHand.length === 13 && (
              <span className="ml-3 font-extrabold">
                {setupHand.includes(0) ? "YOU HOLD 3♦ AND OPEN" : "THE 3♦ HOLDER OPENS"}
              </span>
            )}
          </div>
          <button type="button" onClick={start} disabled={setupHand.length !== 13}
            className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>
            START RECORDING
          </button>
        </div>
        {error && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{error}</p>}
      </div>
    );
  }

  const winner = state.winner;
  const gridBoard: Board = {
    ...EMPTY_BOARD,
    owners: Array.from({ length: 52 }, (_, card) => {
      if (state.played[0].includes(card)) return "minePlayed";
      if (state.played[1].includes(card)) return "west";
      if (state.played[2].includes(card)) return "north";
      if (state.played[3].includes(card)) return "east";
      if (state.myHand.includes(card)) return "mine";
      return "unseen";
    }),
    lastCards: state.lastPlay?.cards ?? [],
    passes: state.passes as 0 | 1 | 2,
  };

  const playedCards = new Set(state.played.flat());
  // Played cards stay legible even though they cannot be selected again.
  const disabled = new Set(
    Array.from({ length: 52 }, (_, card) => card).filter((card) => !selectable.has(card) && !playedCards.has(card)),
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-black tracking-tight leading-none">FOLLOW A REAL GAME</h2>
          <p className="mt-2 font-mono text-xs">
            {winner !== null
              ? `${SEAT_NAMES[winner].toUpperCase()} WINS`
              : state.current === null
                ? "THE 3♦ HOLDER OPENS. WHO PLAYED?"
                : state.current === 0 ? "YOUR TURN" : `${SEAT_NAMES[state.current].toUpperCase()} TO PLAY`}
            {state.history.length > 0 && ` · ${state.history.length} MOVES RECORDED`}
          </p>
        </div>
        <button type="button" onClick={reset} className={`${button} px-3 py-2 bg-paper text-xs`}>NEW RECORD</button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4 min-w-0">
          <Table game={display} thinking={false} />
          <CardGrid
            board={gridBoard}
            selected={selected}
            disabledCards={winner === null ? disabled : undefined}
            onCard={(card) => {
              if (winner !== null || playedCards.has(card)) return;
              setSelected((cards) => cards.includes(card) ? cards.filter((c) => c !== card) : [...cards, card]);
              setError(null);
            }}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <span>BLACK IS PLAYED. ORANGE IS YOUR HAND. TAP CARDS TO SELECT A MOVE.</span>
          </div>

          {winner === null && (
            <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm flex flex-col gap-3">
              {state.current === null && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-extrabold">WHO OPENED?</span>
                  {([1, 2, 3] as const).map((seat) => (
                    <button key={seat} type="button" aria-pressed={opener === seat} onClick={() => { setOpener(seat); setSelected([]); }}
                      className={`${button} px-3 py-2 text-xs ${opener === seat ? "bg-accent" : "bg-paper"}`}>
                      {SEAT_NAMES[seat].toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => record(selected)} disabled={selected.length === 0}
                  className={`${button} px-4 py-3 bg-accent shadow-brutal-sm`}>
                  RECORD {selected.length > 0 ? `${selected.length} CARD${selected.length === 1 ? "" : "S"}` : "MOVE"}
                </button>
                <button type="button" onClick={pass} disabled={state.lastPlay === null || state.current === null}
                  className={`${button} px-4 py-3 bg-paper shadow-brutal-sm`}>
                  RECORD PASS
                </button>
                <button type="button" onClick={undo} disabled={history.length === 0}
                  className={`${button} px-4 py-3 bg-paper shadow-brutal-sm`}>
                  UNDO
                </button>
              </div>
              {error && <p className="border-2 border-ink bg-paper p-2 font-mono text-xs">{error}</p>}
            </div>
          )}

          {winner !== null && (
            <div className="border-3 border-ink bg-card p-4 shadow-brutal flex flex-wrap items-center gap-3">
              <span className="text-2xl font-black">{winner === 0 ? "YOU WIN" : `${SEAT_NAMES[winner].toUpperCase()} WINS`}</span>
              <button type="button" onClick={() => setReviewing(true)} className={`${button} px-4 py-3 bg-accent shadow-brutal-sm`}>
                REVIEW
              </button>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm">
            <div className="text-sm font-extrabold">SCOREBOARD</div>
            <div className="mt-3 grid grid-cols-4 border-3 border-ink">
              {[0, 1, 2, 3].map((seat) => (
                <div key={seat} className={`p-2 text-center ${seat > 0 ? "border-l-3 border-ink" : ""} ${state.current === seat ? "bg-accent" : ""}`}>
                  <div className="font-mono text-[10px]">{seat === 0 ? "YOU" : SEAT_NAMES[seat].toUpperCase()}</div>
                  <div className="text-2xl font-black">{13 - state.played[seat].length}</div>
                  <div className="font-mono text-[9px]">LEFT</div>
                </div>
              ))}
            </div>
          </div>

          {state.current === 0 && state.winner === null && (
            <>
              <button type="button" onClick={() => void ask()} className={`${button} px-4 py-3 bg-accent shadow-brutal-sm`}>
                ASK THE BOT FOR MY MOVE
              </button>
              <AdvicePanel status={status} onPick={(cards) => setSelected(cards)} idleText="ASK WHEN YOU WANT THE BEST MOVE." />
            </>
          )}
          {state.current !== 0 && state.winner === null && (
            <p className="border-3 border-ink bg-card p-4 font-mono text-sm shadow-brutal-sm">
              RECORD WHAT {state.current === null ? "THE 3♦ HOLDER" : SEAT_NAMES[state.current].toUpperCase()} PLAYED.
              TAP THE CARDS, THEN RECORD.
            </p>
          )}
        </aside>
      </div>

      {reviewing && (
        <ReviewPanel
          final={followFinalState(state)}
          getClient={getClient}
          onClose={() => setReviewing(false)}
          onSave={() => {
            const final = followFinalState(state);
            return saveReview({
              id: `follow-${state.initial.join("-")}-${final.history.length}`,
              at: Date.now(),
              title: `REAL GAME · ${final.winner === 0 ? "WON" : "LOST"}`,
              final,
              names: [...SEAT_NAMES],
              seats: [1, 2, 3],
              youSeat: 0,
              players: [0],
              // Other hands are not known in a real game, so only my moves are scored.
              scoreAll: false,
            });
          }}
        />
      )}
    </div>
  );
}
