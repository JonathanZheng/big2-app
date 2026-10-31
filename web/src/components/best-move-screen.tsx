"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { CardFace } from "@/components/card";
import { CardGrid } from "@/components/card-grid";
import { FollowGame } from "@/components/follow-game";
import { type Board, EMPTY_BOARD, SEAT_LABEL, autoCounts, boardToGame, checkBoard, cycleOwner, isOpening, lastPlayerCards, myHand, opponentCounts, readBoard, saveBoard, setOwner, toggleLastCard } from "@/lib/best-move/board";
import { type Card, cardName } from "@/lib/engine/cards";
import { rankAdvice } from "@/lib/model/advice";
import { ModelClient } from "@/lib/model/client";

const MODEL_FAILED = "Model failed to load. The board editor still works, but advice needs the model.";
const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";

export function BestMoveScreen() {
  const client = useRef<ModelClient | null>(null);
  const requestId = useRef(0);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [status, setStatus] = useState<AdviceStatus>({ kind: "idle" });
  const [highlight, setHighlight] = useState<Card[]>([]);
  const [tab, setTab] = useState<"board" | "follow">("board");
  const getClient = useCallback(() => (modelStatus === "failed" ? null : client.current), [modelStatus]);
  const retryModel = useCallback(() => {
    setModelStatus("loading");
    setModelError(null);
    setModelAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let c: ModelClient;
    try {
      c = new ModelClient();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queueMicrotask(() => {
        setModelError(message);
        setModelStatus("failed");
      });
      return;
    }
    client.current = c;
    c.ready.then(
      () => { setModelStatus("ready"); setModelError(null); },
      (error: unknown) => {
        console.error("Model failed to load", error);
        setModelError(error instanceof Error ? error.message : String(error));
        setModelStatus("failed");
      },
    );
    return () => {
      c.dispose();
      if (client.current === c) client.current = null;
    };
  }, [modelAttempt]);

  useEffect(() => {
    const saved = readBoard();
    // Storage is only available after mount, so this cannot be a lazy initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setBoard(saved);
  }, []);

  /** Every edit belongs to a new position: drop advice that answered the old one. */
  function changeBoard(next: Board) {
    requestId.current += 1;
    setBoard(next);
    setStatus({ kind: "idle" });
    setHighlight([]);
    saveBoard(next);
  }

  const check = checkBoard(board);
  const counts = opponentCounts(board);
  const auto = autoCounts(board);
  const opening = isOpening(board);

  async function ask() {
    if (check.errors.length > 0) {
      setStatus({ kind: "error", message: check.errors[0] });
      return;
    }
    const c = client.current;
    if (modelStatus === "failed" || !c) {
      setStatus({ kind: "error", message: MODEL_FAILED });
      return;
    }
    const id = ++requestId.current;
    setStatus({ kind: "loading" });
    try {
      const { moves, scores } = await c.score(boardToGame(board), 0);
      if (id !== requestId.current) return;
      setStatus({ kind: "ready", advice: rankAdvice(moves, scores) });
    } catch {
      if (id !== requestId.current) return;
      setStatus({ kind: "error", message: MODEL_FAILED });
    }
  }

  function editCount(index: number, raw: string) {
    const value = Math.max(0, Math.min(13, Number.parseInt(raw, 10) || 0));
    const next = [...counts] as [number, number, number];
    next[index] = value;
    changeBoard({ ...board, counts: next });
  }

  const hand = myHand(board);
  const lastCards = lastPlayerCards(board);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-5xl font-black tracking-tight leading-none">BEST MOVE</h1>
        <div className="flex w-fit border-3 border-ink">
          {(["board", "follow"] as const).map((value, i) => (
            <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
              className={`px-4 py-2 text-sm font-extrabold ${i > 0 ? "border-l-3 border-ink" : ""} ${tab === value ? "bg-accent" : "bg-paper"}`}>
              {value === "board" ? "SET UP A BOARD" : "FOLLOW A GAME"}
            </button>
          ))}
        </div>
      </header>

      {tab === "follow" ? <FollowGame getClient={getClient} /> : (
      <>
      <p className="max-w-3xl font-mono text-sm leading-relaxed">
        MARK EVERY CARD, SET THE TRICK ON THE TABLE, THEN ASK THE BOT. YOUR HAND, THE OTHER
        HANDS, THE TRICK AND THE PASSES ARE ALL IT NEEDS.
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4 min-w-0">
          <CardGrid
            board={board}
            highlight={highlight}
            tableCards={board.lastCards}
            onCard={(card) => changeBoard(setOwner(board, card, cycleOwner(board.owners[card])))}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <Legend className="bg-accent" label="YOUR HAND" />
            <Legend className="bg-ink" label="PLAYED BY A SEAT" />
            <Legend className="bg-paper hatch border-2 border-ink" label="OUT OF THE GAME" />
            <Legend className="bg-card border-2 border-ink" label="NOT SEEN YET" />
            <span>THE BAR UNDER A CARD MARKS THE TRICK ON THE TABLE.</span>
          </div>

          <div className="border-3 border-ink bg-card p-4 shadow-brutal-sm">
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-sm font-extrabold">YOUR HAND</span>
              <span className="font-mono text-xs">{hand.length} CARDS</span>
            </div>
            {hand.length === 0 ? (
              <p className="mt-2 font-mono text-xs">TAP CARDS UNTIL THEY SAY YOU.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hand.map((card) => (
                  <CardFace key={card} card={card} compact className="w-8 h-11 p-1 shadow-brutal-sm" />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          <div className="border-3 border-ink bg-card p-4 shadow-brutal flex flex-col gap-4">
            <div>
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-sm font-extrabold">HOW MANY CARDS THEY HOLD</span>
                <button
                  type="button"
                  onClick={() => changeBoard({ ...board, counts: null })}
                  disabled={board.counts === null}
                  className={`${button} px-2 py-1 text-[11px] bg-paper`}
                >
                  AUTO
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                {([1, 2, 3] as const).map((seat, i) => (
                  <label key={seat} className="flex flex-col gap-1 font-mono text-[11px]">
                    <span className="font-sans text-xs font-extrabold">{SEAT_LABEL[seat].toUpperCase()}</span>
                    <input
                      type="number"
                      min={0}
                      max={13}
                      inputMode="numeric"
                      value={counts[i]}
                      onChange={(e) => editCount(i, e.target.value)}
                      className="w-full border-2 border-ink bg-paper px-2 py-1 font-mono"
                    />
                    <span className="opacity-60">AUTO {auto[i]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t-2 border-ink pt-3">
              <span className="text-sm font-extrabold">THE TABLE</span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={board.lastPlayer === null}
                  onClick={() => changeBoard({ ...board, lastPlayer: null, lastCards: [], passes: 0 })}
                  className={`${button} px-3 py-2 text-xs ${board.lastPlayer === null ? "bg-accent" : "bg-paper"}`}
                >
                  I AM LEADING
                </button>
                {([1, 2, 3] as const).map((seat) => (
                  <button
                    key={seat}
                    type="button"
                    aria-pressed={board.lastPlayer === seat}
                    onClick={() => changeBoard({ ...board, lastPlayer: seat, lastCards: [], passes: 0 })}
                    className={`${button} px-3 py-2 text-xs ${board.lastPlayer === seat ? "bg-accent" : "bg-paper"}`}
                  >
                    {SEAT_LABEL[seat].toUpperCase()} PLAYED
                  </button>
                ))}
              </div>

              {board.lastPlayer === null ? (
                <p className="mt-3 font-mono text-xs">
                  {opening ? "OPENING: YOUR MOVE MUST INCLUDE 3♦." : "YOU LEAD THE NEXT TRICK."}
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="font-mono text-xs">TAP THE CARDS THAT ARE ON THE TABLE:</p>
                  {lastCards.length === 0 ? (
                    <p className="font-mono text-xs opacity-60">
                      NOTHING MARKED AS PLAYED BY {SEAT_LABEL[board.lastPlayer].toUpperCase()} YET.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {lastCards.map((card) => (
                        <button
                          key={card}
                          type="button"
                          aria-pressed={board.lastCards.includes(card)}
                          onClick={() => changeBoard(toggleLastCard(board, card))}
                          className={`${button} px-2 py-1 font-mono text-xs ${board.lastCards.includes(card) ? "bg-accent" : "bg-paper"}`}
                        >
                          {cardName(card)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">PASSES SINCE:</span>
                    {([0, 1, 2] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={board.passes === n}
                        onClick={() => changeBoard({ ...board, passes: n })}
                        className={`${button} h-9 w-9 font-mono text-xs ${board.passes === n ? "bg-accent" : "bg-paper"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-3">
              <button type="button" onClick={() => void ask()} disabled={modelStatus !== "ready" || check.errors.length > 0}
                className={`${button} flex-1 px-4 py-3 bg-accent shadow-brutal-sm`}>
                {modelStatus === "loading" ? "LOADING MODEL" : "ASK THE BOT"}
              </button>
              <button type="button" onClick={() => changeBoard(EMPTY_BOARD)} className={`${button} px-3 py-3 bg-paper`}>
                CLEAR
              </button>
            </div>
            {modelStatus === "failed" && (
              <div className="flex flex-col items-start gap-2">
                <p className="font-mono text-xs">{MODEL_FAILED}</p>
                {modelError && <p className="font-mono text-xs opacity-70">{modelError}</p>}
                <button type="button" onClick={retryModel} className={`${button} px-3 py-2 text-xs bg-paper`}>
                  TRY AGAIN
                </button>
              </div>
            )}
            {check.errors.map((error) => (
              <p key={error} className="border-2 border-ink bg-paper p-2 font-mono text-xs">{error}</p>
            ))}
            {check.warnings.map((warning) => (
              <p key={warning} className="font-mono text-xs opacity-70">{warning}</p>
            ))}
            <p className="font-mono text-[11px] opacity-70">
              IT ONLY KNOWS THE MOVE ON THE TABLE, NOT THE EARLIER TRICKS, SO THIS ADVICE IS
              SLIGHTLY WEAKER THAN DURING A GAME.
            </p>
          </div>

          <AdvicePanel
            status={status}
            onPick={(cards) => setHighlight(cards)}
            idleText="SET THE BOARD, THEN ASK THE BOT."
          />
        </aside>
      </div>
      </>
      )}
    </section>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`inline-block h-3 w-3 ${className}`} />
      {label}
    </span>
  );
}
