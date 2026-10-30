"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { Hand } from "@/components/hand";
import { HistoryPanel } from "@/components/history-panel";
import { Table } from "@/components/table";
import { type Difficulty, botMove } from "@/lib/bots/bots";
import { smartMove } from "@/lib/bots/smart";
import type { Card } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import {
  type SortMode, comboAnchor, combosContaining, groupCards, keepOrder, readSortPreference, saveSortPreference, sortHand,
} from "@/lib/hand/sort";
import { rankAdvice } from "@/lib/model/advice";
import { ModelClient } from "@/lib/model/client";
import {
  type MatchConfig, type MatchState, SEAT_NAMES, endMatch, matchWinners, nextGame, playMove, startMatch,
} from "@/lib/session/match";
import { recordResult } from "@/lib/session/stats";

type ModelStatus = "loading" | "ready" | "failed";
type Speed = "slow" | "normal" | "fast";
const BOT_DELAY: Record<Speed, number> = { slow: 1200, normal: 700, fast: 250 };
const MODEL_FAILED = "Model failed to load. Easy and Medium still work.";
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";

export function GameScreen() {
  const client = useRef<ModelClient | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("loading");
  const [match, setMatch] = useState<MatchState | null>(null);

  useEffect(() => {
    const c = new ModelClient();
    client.current = c;
    c.ready.then(() => setModelStatus("ready"), () => setModelStatus("failed"));
    return () => c.dispose();
  }, []);

  if (!match) {
    return <Setup modelStatus={modelStatus} onStart={(config) => setMatch(startMatch(config, Date.now() % 1_000_000))} />;
  }
  return (
    <Game
      key={match.seed}
      initial={match}
      getClient={() => (modelStatus === "failed" ? null : client.current)}
      onNewMatch={() => setMatch(null)}
    />
  );
}

function Setup({ modelStatus, onStart }: { modelStatus: ModelStatus; onStart: (c: MatchConfig) => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [games, setGames] = useState<MatchConfig["games"]>(5);
  const levels: [Difficulty, string, string][] = [
    ["easy", "EASY", "Greedy bots"],
    ["medium", "MEDIUM", "Smart bots"],
    ["hard", "HARD", "The trained model"],
  ];
  return (
    <section className="flex flex-col gap-8 max-w-3xl">
      <h1 className="text-5xl font-black tracking-tight leading-none">VS BOTS</h1>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-extrabold mb-3">DIFFICULTY</legend>
        <div className="grid sm:grid-cols-3 gap-4">
          {levels.map(([value, label, note]) => {
            const disabled = value === "hard" && modelStatus === "failed";
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={difficulty === value}
                onClick={() => setDifficulty(value)}
                className={`${button} p-4 text-left shadow-brutal ${difficulty === value ? "bg-accent" : "bg-card"}`}
              >
                <span className="block text-2xl font-black">{label}</span>
                <span className="block font-mono text-xs mt-2">{note}</span>
              </button>
            );
          })}
        </div>
        {modelStatus === "failed" && <p className="font-mono text-sm">{MODEL_FAILED}</p>}
      </fieldset>
      <fieldset>
        <legend className="text-sm font-extrabold mb-3">LENGTH</legend>
        <div className="flex flex-wrap gap-3">
          {([1, 3, 5, 10] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={games === n}
              onClick={() => setGames(n)}
              className={`${button} px-4 py-3 shadow-brutal-sm ${games === n ? "bg-accent" : "bg-card"}`}
            >
              {n === 1 ? "SINGLE GAME" : `${n} GAMES`}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        onClick={() => onStart({ difficulty, games })}
        className={`${button} self-start bg-ink text-paper text-2xl px-8 py-4 shadow-brutal`}
      >
        START
      </button>
    </section>
  );
}

function Game({ initial, getClient, onNewMatch }: {
  initial: MatchState; getClient: () => ModelClient | null; onNewMatch: () => void;
}) {
  const [match, setMatch] = useState(initial);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortPreference());
  const [order, setOrder] = useState<Card[]>(() => sortHand(initial.game.hands[0], sortMode === "manual" ? "rank" : sortMode));
  const [undoOrder, setUndoOrder] = useState<Card[] | null>(null);
  const [groups, setGroups] = useState<Card[][]>([]);
  const [selected, setSelected] = useState<Card[]>([]);
  const [lastTapped, setLastTapped] = useState<Card | null>(null);
  const comboIndex = useRef(-1);
  // Advice belongs to the position it was asked for.
  const [adviceFor, setAdviceFor] = useState<{ game: GameState; status: AdviceStatus } | null>(null);
  const [tab, setTab] = useState<"advice" | "history">("advice");
  const [sheet, setSheet] = useState<"advice" | "history" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  const game = match.game;
  const hand = game.hands[0];
  const myTurn = game.winner === null && game.current === 0;
  const legal = useMemo(() => (myTurn ? legalMoves(game, 0) : []), [game, myTurn]);
  const legalKeys = useMemo(() => new Set(legal.map(key)), [legal]);
  const playable = useMemo(() => new Set(legal.flat()), [legal]);
  const canPlay = myTurn && selected.length > 0 && legalKeys.has(key(selected));
  const canPass = myTurn && legalKeys.has("");

  // Keep the on-screen order in step with the hand as cards are played or dealt.
  const shownOrder = useMemo(() => keepOrder(order, hand), [order, hand]);

  // Bots take their turns after a short delay.
  useEffect(() => {
    if (game.winner !== null || game.current === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setThinking(true);
      let move: Card[];
      try {
        move = await botMove(match.config.difficulty, game, game.current, getClient());
      } catch {
        setNotice(`${MODEL_FAILED} The bots are playing as Medium.`);
        move = smartMove(game, game.current);
      }
      if (cancelled) return;
      setThinking(false);
      setMatch((m) => (m.game === game ? playMove(m, move) : m));
    }, BOT_DELAY[speed]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [game, match.config.difficulty, getClient, speed]);

  const advice: AdviceStatus = adviceFor?.game === game ? adviceFor.status : { kind: "idle" };

  // A new position starts the combo cycle again.
  useEffect(() => {
    comboIndex.current = -1;
  }, [game]);

  // Record each finished game once.
  const recorded = useRef<GameState | null>(null);
  useEffect(() => {
    if (game.winner === null || recorded.current === game) return;
    recorded.current = game;
    const matchWon = match.over && match.config.games > 1 ? matchWinners(match).includes(0) : null;
    recordResult(game.winner === 0, matchWon);
  }, [game, match]);

  const play = useCallback(() => {
    if (!canPlay) return;
    setMatch((m) => playMove(m, selected));
    setSelected([]);
    setGroups((gs) => gs.map((g) => g.filter((c) => !selected.includes(c))).filter((g) => g.length > 1));
  }, [canPlay, selected]);

  const pass = useCallback(() => {
    if (!canPass) return;
    setMatch((m) => playMove(m, []));
    setSelected([]);
  }, [canPass]);

  const hint = useCallback(async () => {
    setTab("advice");
    if (!myTurn) return;
    const client = getClient();
    if (!client) return setAdviceFor({ game, status: { kind: "error", message: MODEL_FAILED } });
    setAdviceFor({ game, status: { kind: "loading" } });
    try {
      const { moves, scores } = await client.score(game, 0);
      setAdviceFor({ game, status: { kind: "ready", advice: rankAdvice(moves, scores) } });
    } catch {
      setAdviceFor({ game, status: { kind: "error", message: MODEL_FAILED } });
    }
  }, [getClient, game, myTurn]);

  const cycleCombos = useCallback(() => {
    const combos = combosContaining(comboAnchor(selected, lastTapped), legal);
    if (combos.length === 0) return;
    comboIndex.current = (comboIndex.current + 1) % combos.length;
    setSelected(combos[comboIndex.current]);
  }, [lastTapped, legal, selected]);

  const applySort = useCallback((mode: Exclude<SortMode, "manual">) => {
    setUndoOrder(shownOrder);
    setOrder(sortHand(hand, mode));
    setSortMode(mode);
    saveSortPreference(mode);
  }, [hand, shownOrder]);

  const cycleSort = useCallback(() => {
    const modes: Exclude<SortMode, "manual">[] = ["rank", "suit", "combo"];
    applySort(modes[(modes.indexOf(sortMode as never) + 1) % modes.length]);
  }, [applySort, sortMode]);

  const group = useCallback(() => {
    if (selected.length < 2) return;
    setUndoOrder(shownOrder);
    setOrder(groupCards(shownOrder, selected));
    setGroups((gs) => [...gs.map((g) => g.filter((c) => !selected.includes(c))).filter((g) => g.length > 1), selected]);
    setSortMode("manual");
    setSelected([]);
  }, [selected, shownOrder]);

  // Keyboard: Enter plays, P passes, C cycles combos, H hints, S switches the sort.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "enter") { e.preventDefault(); play(); }
      else if (k === "p") pass();
      else if (k === "c") cycleCombos();
      else if (k === "h") void hint();
      else if (k === "s") cycleSort();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, pass, cycleCombos, hint, cycleSort]);

  function toggle(card: Card) {
    setLastTapped(card);
    comboIndex.current = -1;
    setSelected((s) => (s.includes(card) ? s.filter((c) => c !== card) : [...s, card]));
  }

  function newDeal(next: MatchState) {
    setMatch(next);
    const mode = sortMode === "manual" ? "rank" : sortMode;
    setOrder(sortHand(next.game.hands[0], mode));
    setUndoOrder(null);
    setGroups([]);
    setSelected([]);
  }

  const panels = (which: "advice" | "history") =>
    which === "advice"
      ? <AdvicePanel status={advice} onPick={(cards) => setSelected(cards)} />
      : <HistoryPanel game={game} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
        <span>
          {match.config.difficulty.toUpperCase()} ·{" "}
          {match.config.games === 1 ? "SINGLE GAME" : `GAME ${match.gameIndex + 1} OF ${match.config.games}`} · WINS{" "}
          {match.wins.map((w, s) => `${SEAT_NAMES[s][0]} ${w}`).join("  ")}
        </span>
        <label className="flex items-center gap-2">
          BOT SPEED
          <select
            value={speed}
            onChange={(e) => setSpeed(e.target.value as Speed)}
            className="border-2 border-ink bg-card px-2 py-1 font-mono"
          >
            <option value="slow">SLOW</option>
            <option value="normal">NORMAL</option>
            <option value="fast">FAST</option>
          </select>
        </label>
      </div>
      {notice && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          <Table game={game} thinking={thinking} />

          <Hand
            order={shownOrder}
            selected={selected}
            playable={myTurn ? playable : new Set(hand)}
            groups={groups}
            onToggle={toggle}
            onSlideSelect={setSelected}
            onReorder={(o) => { setUndoOrder(shownOrder); setOrder(o); setSortMode("manual"); saveSortPreference("manual"); }}
          />

          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <span className="self-center font-extrabold font-sans text-sm">SORT</span>
            {(["rank", "suit", "combo"] as const).map((m) => (
              <button key={m} type="button" onClick={() => applySort(m)} aria-pressed={sortMode === m}
                className={`${button} px-3 py-2 min-h-11 ${sortMode === m ? "bg-accent" : "bg-card"}`}>
                {m.toUpperCase()}
              </button>
            ))}
            <button type="button" onClick={group} disabled={selected.length < 2}
              className={`${button} px-3 py-2 min-h-11 bg-card`}>GROUP</button>
            <button type="button" onClick={() => { if (undoOrder) { setOrder(undoOrder); setUndoOrder(null); setSortMode("manual"); } }}
              disabled={!undoOrder} className={`${button} px-3 py-2 min-h-11 bg-card`}>UNDO</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button type="button" onClick={play} disabled={!canPlay}
              className={`${button} h-16 text-2xl bg-accent shadow-brutal`}>PLAY</button>
            <button type="button" onClick={pass} disabled={!canPass}
              className={`${button} h-16 text-2xl bg-card shadow-brutal`}>PASS</button>
            <button type="button" onClick={cycleCombos} disabled={!myTurn}
              className={`${button} h-12 sm:h-16 bg-card shadow-brutal-sm`}>COMBOS</button>
            <button type="button" onClick={() => { void hint(); setSheet("advice"); }} disabled={!myTurn}
              className={`${button} h-12 sm:h-16 bg-card shadow-brutal-sm lg:hidden`}>HINT</button>
            <button type="button" onClick={() => void hint()} disabled={!myTurn}
              className={`${button} h-16 bg-card shadow-brutal-sm hidden lg:block`}>HINT</button>
            <button type="button" onClick={() => setSheet("history")}
              className={`${button} h-12 bg-card shadow-brutal-sm lg:hidden col-span-2 sm:col-span-4`}>HISTORY</button>
          </div>
        </div>

        <aside className="hidden lg:flex flex-col border-3 border-ink bg-card shadow-brutal self-start max-h-[calc(100vh-180px)]">
          <div className="grid grid-cols-2 border-b-3 border-ink">
            {(["advice", "history"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
                className={`py-3 font-extrabold ${t === "history" ? "border-l-3 border-ink" : ""} ${tab === t ? "bg-accent" : "bg-card"}`}>
                {t === "advice" ? "BEST MOVES" : "HISTORY"}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto">{panels(tab)}</div>
        </aside>
      </div>

      {sheet && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end bg-ink/40" onClick={() => setSheet(null)}>
          <div className="bg-card border-t-3 border-ink max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b-3 border-ink px-4 py-2">
              <span className="font-extrabold">{sheet === "advice" ? "BEST MOVES" : "HISTORY"}</span>
              <button type="button" onClick={() => setSheet(null)} className={`${button} px-4 py-2 bg-paper`}>CLOSE</button>
            </div>
            <div className="overflow-y-auto">{panels(sheet)}</div>
          </div>
        </div>
      )}

      {game.winner !== null && (
        <Result
          match={match}
          onNext={() => newDeal(nextGame(match))}
          onEnd={() => setMatch(endMatch(match))}
          onNewMatch={onNewMatch}
        />
      )}
    </div>
  );
}

function Result({ match, onNext, onEnd, onNewMatch }: {
  match: MatchState; onNext: () => void; onEnd: () => void; onNewMatch: () => void;
}) {
  const winner = match.game.winner!;
  const winners = matchWinners(match);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <section role="dialog" aria-label="Game over" className="w-full max-w-md border-3 border-ink bg-card p-6 shadow-brutal flex flex-col gap-5">
        <h2 className="text-4xl font-black leading-none">
          {winner === 0 ? "YOU WIN" : `${SEAT_NAMES[winner].toUpperCase()} WINS`}
        </h2>
        {match.config.games > 1 && (
          <div className="grid grid-cols-4 border-3 border-ink">
            {match.wins.map((w, s) => (
              <div key={s} className={`p-2 text-center ${s > 0 ? "border-l-3 border-ink" : ""} ${winners.includes(s) && match.over ? "bg-accent" : ""}`}>
                <div className="font-mono text-xs">{SEAT_NAMES[s].toUpperCase()}</div>
                <div className="text-3xl font-black">{w}</div>
              </div>
            ))}
          </div>
        )}
        {match.over && match.config.games > 1 && (
          <p className="font-mono text-sm">
            {winners.length > 1
              ? `MATCH SHARED BY ${winners.map((s) => SEAT_NAMES[s].toUpperCase()).join(" AND ")}`
              : winners[0] === 0 ? "YOU WIN THE MATCH" : `${SEAT_NAMES[winners[0]].toUpperCase()} WINS THE MATCH`}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {!match.over && (
            <>
              <button type="button" onClick={onNext} className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>NEXT GAME</button>
              <button type="button" onClick={onEnd} className={`${button} px-5 py-3 bg-card shadow-brutal-sm`}>FINISH MATCH</button>
            </>
          )}
          {match.over && (
            <button type="button" onClick={onNewMatch} className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>PLAY AGAIN</button>
          )}
        </div>
      </section>
    </div>
  );
}
