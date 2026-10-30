"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { Hand } from "@/components/hand";
import { HistoryPanel } from "@/components/history-panel";
import { ReviewPanel } from "@/components/review-panel";
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
  type GameMode, type MatchConfig, type MatchState, endMatch, humanSeats, isBotSeat, matchWinners, nextGame,
  playMove, seatNames, startMatch,
} from "@/lib/session/match";
import { gameRecord, saveGameRecord } from "@/lib/session/profile";
import { saveReview } from "@/lib/session/saved-reviews";
import { recordGame, recordMatch } from "@/lib/session/stats";

type ModelStatus = "loading" | "ready" | "failed";
type Speed = "slow" | "normal" | "fast";
const BOT_DELAY: Record<Speed, number> = { slow: 1200, normal: 700, fast: 250 };
const MODEL_FAILED = "Model failed to load. Easy and Medium still work.";
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";

/** Keyboard shortcuts must not fire while a form control or editable text has focus. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/** Links and ordinary buttons keep Enter for their own action. A hand card is the exception. */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("button, a, [role='button']");
}

function isHandCard(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-card]");
}

/** The side column (and so the Best moves panel) shows from this width up. */
const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
const action = "h-14 sm:h-16 text-lg sm:text-2xl shadow-brutal";

const shortName = (name: string) => {
  if (name.startsWith("Player ")) return `P${name.slice(7)}`;
  if (name.startsWith("Bot ")) return `B${name.slice(4)}`;
  return name[0];
};

export function GameScreen({ mode = "bots" }: { mode?: GameMode }) {
  const client = useRef<ModelClient | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [match, setMatch] = useState<MatchState | null>(null);
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

  const start = (config: MatchConfig) => setMatch(startMatch(config, Date.now() % 1_000_000));

  if (!match) {
    return mode === "friends"
      ? <FriendsSetup modelStatus={modelStatus} modelError={modelError} onRetry={retryModel} onStart={start} />
      : <BotsSetup modelStatus={modelStatus} modelError={modelError} onRetry={retryModel} onStart={start} />;
  }
  return (
    <Game
      key={match.seed}
      initial={match}
      names={seatNames(match.config)}
      getClient={getClient}
      onNewMatch={() => setMatch(null)}
      onRestart={() => start(match.config)}
    />
  );
}

function DifficultyPicker({ difficulty, setDifficulty, modelStatus, modelError, onRetry }: {
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  modelStatus: ModelStatus;
  modelError: string | null;
  onRetry: () => void;
}) {
  const levels: [Difficulty, string, string][] = [
    ["easy", "EASY", "Greedy bots"],
    ["medium", "MEDIUM", "Smart bots"],
    ["hard", "HARD", "The trained model"],
  ];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-extrabold mb-3">BOT DIFFICULTY</legend>
      <div className="grid sm:grid-cols-3 gap-4">
        {levels.map(([value, label, note]) => {
          const disabled = value === "hard" && modelStatus !== "ready";
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
      {modelStatus === "loading" && <p className="font-mono text-sm">MODEL LOADING. HARD UNLOCKS WHEN IT IS READY.</p>}
      {modelStatus === "ready" && <p className="font-mono text-sm">MODEL READY. HARD AND HINTS ARE ON.</p>}
      {modelStatus === "failed" && (
        <div className="flex flex-col items-start gap-2">
          <p className="font-mono text-sm">{MODEL_FAILED}</p>
          {modelError && <p className="font-mono text-xs opacity-70">{modelError}</p>}
          <button type="button" onClick={onRetry} className={`${button} px-3 py-2 text-xs bg-paper`}>
            TRY AGAIN
          </button>
        </div>
      )}
    </fieldset>
  );
}

function LengthPicker({ games, setGames }: { games: MatchConfig["games"]; setGames: (g: MatchConfig["games"]) => void }) {
  return (
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
  );
}

function BotsSetup({ modelStatus, modelError, onRetry, onStart }: {
  modelStatus: ModelStatus;
  modelError: string | null;
  onRetry: () => void;
  onStart: (c: MatchConfig) => void;
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [games, setGames] = useState<MatchConfig["games"]>(5);
  return (
    <section className="flex flex-col gap-8 max-w-3xl">
      <h1 className="text-5xl font-black tracking-tight leading-none">VS BOTS</h1>
      <DifficultyPicker difficulty={difficulty} setDifficulty={setDifficulty} modelStatus={modelStatus}
        modelError={modelError} onRetry={onRetry} />
      <LengthPicker games={games} setGames={setGames} />
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

function FriendsSetup({ modelStatus, modelError, onRetry, onStart }: {
  modelStatus: ModelStatus;
  modelError: string | null;
  onRetry: () => void;
  onStart: (c: MatchConfig) => void;
}) {
  const [humans, setHumans] = useState(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [games, setGames] = useState<MatchConfig["games"]>(5);
  return (
    <section className="flex flex-col gap-8 max-w-3xl">
      <div className="flex flex-col gap-3">
        <h1 className="text-5xl font-black tracking-tight leading-none">VS FRIENDS</h1>
        <p className="font-mono text-sm leading-relaxed">
          ONE DEVICE, PASSED AROUND THE TABLE. THE HAND-OFF SCREEN HIDES EVERY HAND. EMPTY SEATS
          FILL WITH BOTS.
        </p>
      </div>
      <fieldset>
        <legend className="text-sm font-extrabold mb-3">HOW MANY PEOPLE</legend>
        <div className="flex flex-wrap gap-3">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={humans === n}
              onClick={() => setHumans(n)}
              className={`${button} px-4 py-3 shadow-brutal-sm ${humans === n ? "bg-accent" : "bg-card"}`}
            >
              {n} PEOPLE
            </button>
          ))}
        </div>
        <p className="mt-3 font-mono text-xs">
          {humans === 4 ? "FOUR PEOPLE, NO BOTS." : `${4 - humans} BOT${humans === 3 ? "" : "S"} FILL THE EMPTY SEATS.`}
        </p>
      </fieldset>
      {humans < 4 && (
        <DifficultyPicker difficulty={difficulty} setDifficulty={setDifficulty} modelStatus={modelStatus}
          modelError={modelError} onRetry={onRetry} />
      )}
      <LengthPicker games={games} setGames={setGames} />
      <button
        type="button"
        onClick={() => onStart({ mode: "friends", humans, difficulty, games })}
        className={`${button} self-start bg-ink text-paper text-2xl px-8 py-4 shadow-brutal`}
      >
        START
      </button>
    </section>
  );
}

function Game({ initial, getClient, onNewMatch, onRestart, names }: {
  initial: MatchState;
  getClient: () => ModelClient | null;
  onNewMatch: () => void;
  /** Start again with the same settings. */
  onRestart: () => void;
  names: string[];
}) {
  const config = initial.config;
  const friends = config.mode === "friends";
  const humans = useMemo(() => humanSeats(config), [config]);

  const [match, setMatch] = useState(initial);
  const [speed, setSpeed] = useState<Speed>("normal");
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortPreference());
  const [orders, setOrders] = useState<Record<number, Card[]>>({});
  const [undoOrder, setUndoOrder] = useState<Card[] | null>(null);
  const [groups, setGroups] = useState<Card[][]>([]);
  const [selected, setSelected] = useState<Card[]>([]);
  const [lastTapped, setLastTapped] = useState<Card | null>(null);
  const comboIndex = useRef(-1);
  const [adviceFor, setAdviceFor] = useState<{ game: GameState; seat: number; status: AdviceStatus } | null>(null);
  const [tab, setTab] = useState<"advice" | "history">("advice");
  const [sheet, setSheet] = useState<"advice" | "history" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [viewer, setViewer] = useState<number | null>(friends ? null : 0);
  const [leaving, setLeaving] = useState<"restart" | "exit" | null>(null);

  const game = match.game;
  const handSeat = friends
    ? (game.winner === null && viewer !== null && viewer === game.current ? viewer : null)
    : 0;
  const hand = useMemo(() => (handSeat === null ? [] : game.hands[handSeat]), [game, handSeat]);
  const myTurn = handSeat !== null && game.winner === null && game.current === handSeat;
  const legal = useMemo(() => (handSeat !== null && myTurn ? legalMoves(game, handSeat) : []), [game, handSeat, myTurn]);
  const legalKeys = useMemo(() => new Set(legal.map(key)), [legal]);
  const playable = useMemo(() => new Set(legal.flat()), [legal]);
  const canPlay = myTurn && selected.length > 0 && legalKeys.has(key(selected));
  const canPass = myTurn && legalKeys.has("");

  const baseOrder = useMemo(() => {
    if (handSeat === null) return [];
    return orders[handSeat] ?? sortHand(hand, sortMode === "manual" ? "rank" : sortMode);
  }, [hand, handSeat, orders, sortMode]);
  const shownOrder = useMemo(
    () => (handSeat === null ? [] : keepOrder(baseOrder, hand)),
    [baseOrder, hand, handSeat],
  );

  // Bots take their turns after a short delay.
  // Bots wait while the restart or exit question is open.
  const botTurn = game.winner === null && isBotSeat(config, game.current) && leaving === null;
  useEffect(() => {
    if (!botTurn) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setThinking(true);
      let move: Card[];
      try {
        move = await botMove(config.difficulty, game, game.current, getClient());
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
      // A cancelled turn must not leave the seat saying THINKING.
      setThinking(false);
    };
  }, [botTurn, config, game, getClient, speed]);

  const advice: AdviceStatus =
    adviceFor?.game === game && adviceFor.seat === handSeat ? adviceFor.status : { kind: "idle" };

  // A new position starts the combo cycle again.
  useEffect(() => {
    comboIndex.current = -1;
  }, [game, handSeat]);

  // Record each finished game and each finished match exactly once. One-device
  // games are shared, so they do not count towards any player's stats.
  const recordedGame = useRef<GameState | null>(null);
  // Turns of the current game on which a hint was asked for.
  const hintTurns = useRef(new Set<GameState>());
  useEffect(() => {
    if (friends || game.winner === null || recordedGame.current === game) return;
    recordedGame.current = game;
    recordGame(game.winner === 0);
    saveGameRecord(gameRecord(game, 0, config.difficulty, hintTurns.current.size, Date.now()));
    hintTurns.current = new Set();
  }, [config.difficulty, friends, game]);

  const recordedMatch = useRef<MatchState | null>(null);
  useEffect(() => {
    if (friends || !match.over || match.config.games === 1 || recordedMatch.current === match) return;
    recordedMatch.current = match;
    recordMatch(matchWinners(match).includes(0));
  }, [friends, match]);

  const finishTurn = useCallback(() => {
    setSelected([]);
    setGroups([]);
    setLastTapped(null);
    setUndoOrder(null);
    setAdviceFor(null);
    comboIndex.current = -1;
    if (friends) setViewer(null);
  }, [friends]);

  const play = useCallback(() => {
    if (!canPlay) return;
    setMatch((m) => playMove(m, selected));
    finishTurn();
  }, [canPlay, finishTurn, selected]);

  const pass = useCallback(() => {
    if (!canPass) return;
    setMatch((m) => playMove(m, []));
    finishTurn();
  }, [canPass, finishTurn]);

  const hint = useCallback(async () => {
    setTab("advice");
    if (!myTurn || handSeat === null) return;
    hintTurns.current.add(game);
    const client = getClient();
    if (!client) return setAdviceFor({ game, seat: handSeat, status: { kind: "error", message: MODEL_FAILED } });
    setAdviceFor({ game, seat: handSeat, status: { kind: "loading" } });
    try {
      const { moves, scores } = await client.score(game, handSeat);
      setAdviceFor({ game, seat: handSeat, status: { kind: "ready", advice: rankAdvice(moves, scores) } });
    } catch {
      setAdviceFor({ game, seat: handSeat, status: { kind: "error", message: MODEL_FAILED } });
    }
  }, [getClient, game, handSeat, myTurn]);

  const cycleCombos = useCallback(() => {
    const combos = combosContaining(comboAnchor(selected, lastTapped), legal);
    if (combos.length === 0) return;
    comboIndex.current = (comboIndex.current + 1) % combos.length;
    setSelected(combos[comboIndex.current]);
  }, [lastTapped, legal, selected]);

  const setSeatOrder = useCallback((next: Card[]) => {
    if (handSeat === null) return;
    setOrders((all) => ({ ...all, [handSeat]: next }));
  }, [handSeat]);

  const applySort = useCallback((mode: Exclude<SortMode, "manual">) => {
    if (handSeat === null) return;
    setUndoOrder(shownOrder);
    setSeatOrder(sortHand(hand, mode));
    setSortMode(mode);
    saveSortPreference(mode);
  }, [hand, handSeat, setSeatOrder, shownOrder]);

  const cycleSort = useCallback(() => {
    const modes: Exclude<SortMode, "manual">[] = ["rank", "suit", "combo"];
    applySort(modes[(modes.indexOf(sortMode as never) + 1) % modes.length]);
  }, [applySort, sortMode]);

  const group = useCallback(() => {
    if (handSeat === null || selected.length < 2) return;
    setUndoOrder(shownOrder);
    setSeatOrder(groupCards(shownOrder, selected));
    setGroups((gs) => [...gs.map((g) => g.filter((c) => !selected.includes(c))).filter((g) => g.length > 1), selected]);
    setSortMode("manual");
    setSelected([]);
  }, [handSeat, selected, setSeatOrder, shownOrder]);

  // Keyboard: Enter plays, P passes, C cycles combos, H hints, S switches the sort.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || leaving !== null) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        // Let a focused button or link do its own action; only a hand card
        // treats Enter as "play my selection".
        if (isInteractive(e.target) && !isHandCard(e.target)) return;
        if (handSeat === null) return;
        e.preventDefault();
        play();
        return;
      }
      if (isTyping(e.target) || handSeat === null) return;
      if (k === "p") pass();
      else if (k === "c") cycleCombos();
      else if (k === "h") void hint();
      else if (k === "s") cycleSort();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleCombos, cycleSort, handSeat, hint, leaving, pass, play]);

  function toggle(card: Card) {
    if (handSeat === null) return;
    setLastTapped(card);
    comboIndex.current = -1;
    setSelected((s) => (s.includes(card) ? s.filter((c) => c !== card) : [...s, card]));
  }

  function newDeal(next: MatchState) {
    setMatch(next);
    setOrders({});
    setUndoOrder(null);
    setGroups([]);
    setSelected([]);
    setLastTapped(null);
    setAdviceFor(null);
    setViewer(friends ? null : 0);
  }

  function ready() {
    setViewer(game.current);
    setSelected([]);
    setGroups([]);
    setUndoOrder(null);
    setLastTapped(null);
    setAdviceFor(null);
    comboIndex.current = -1;
    setSheet(null);
  }

  const panels = (which: "advice" | "history") =>
    which === "advice"
      ? <AdvicePanel status={advice} onPick={(cards) => setSelected(cards)} />
      : <HistoryPanel game={game} names={names} hand={hand} />;

  const handoff = friends && game.winner === null && humans.includes(game.current) && viewer !== game.current;
  const scoreboard = match.wins.map((wins, seat) => `${shortName(names[seat])} ${wins}`).join("  ");
  const difficultyLabel = friends && humans.length === 4 ? "NO BOTS" : match.config.difficulty.toUpperCase();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
        <span>
          {difficultyLabel} ·{" "}
          {match.config.games === 1 ? "SINGLE GAME" : `GAME ${match.gameIndex + 1} OF ${match.config.games}`} · WINS{" "}
          {scoreboard}
        </span>
        <div className="flex flex-wrap items-center gap-3">
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
          <button type="button" onClick={() => setLeaving("restart")}
            className={`${button} px-3 py-1.5 min-h-9 bg-card font-mono`}>RESTART</button>
          <button type="button" onClick={() => setLeaving("exit")}
            className={`${button} px-3 py-1.5 min-h-9 bg-card font-mono`}>EXIT</button>
        </div>
      </div>
      {notice && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          <Table
            game={game}
            thinking={thinking}
            names={names}
            seats={friends ? [0, 1, 2, 3] : [1, 2, 3]}
            youSeat={friends ? -1 : 0}
          />

          {handSeat === null ? (
            <div className="border-3 border-ink bg-card p-4 min-h-32 flex flex-col justify-center gap-2 shadow-brutal-sm">
              <span className="text-sm font-extrabold">HAND HIDDEN</span>
              <span className="font-mono text-xs">
                {game.winner !== null ? "THE GAME IS OVER." : `${names[game.current].toUpperCase()} IS PLAYING.`}
              </span>
            </div>
          ) : (
            <Hand
              order={shownOrder}
              selected={selected}
              playable={myTurn ? playable : new Set(hand)}
              groups={groups}
              onToggle={toggle}
              onSlideSelect={setSelected}
              onReorder={(o) => {
                setUndoOrder(shownOrder);
                setSeatOrder(o);
                setSortMode("manual");
                saveSortPreference("manual");
              }}
            />
          )}

          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <span className="self-center font-extrabold font-sans text-sm">SORT</span>
            {(["rank", "suit", "combo"] as const).map((m) => (
              <button key={m} type="button" onClick={() => applySort(m)} aria-pressed={sortMode === m}
                disabled={handSeat === null}
                className={`${button} px-3 py-2 min-h-11 ${sortMode === m ? "bg-accent" : "bg-card"}`}>
                {m.toUpperCase()}
              </button>
            ))}
            <button type="button" onClick={group} disabled={handSeat === null || selected.length < 2}
              className={`${button} px-3 py-2 min-h-11 bg-card`}>GROUP</button>
            <button type="button" onClick={() => {
              if (undoOrder && handSeat !== null) {
                setSeatOrder(undoOrder);
                setUndoOrder(null);
                setSortMode("manual");
              }
            }}
              disabled={!undoOrder || handSeat === null} className={`${button} px-3 py-2 min-h-11 bg-card`}>UNDO</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button type="button" onClick={play} disabled={!canPlay}
              className={`${button} ${action} bg-accent`}>PLAY</button>
            <button type="button" onClick={pass} disabled={!canPass}
              className={`${button} ${action} bg-card`}>PASS</button>
            <button type="button" onClick={cycleCombos} disabled={!myTurn}
              className={`${button} ${action} bg-card`}>COMBOS</button>
            <button type="button" onClick={() => { void hint(); if (!isWide()) setSheet("advice"); }} disabled={!myTurn}
              className={`${button} ${action} bg-card`}>HINT</button>
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

      {handoff && (
        <div className="fixed inset-0 z-[45] flex items-center justify-center bg-paper p-4">
          <section className="w-full max-w-md border-3 border-ink bg-card p-6 shadow-brutal flex flex-col gap-5">
            <span className="font-mono text-xs font-extrabold">HAND-OFF</span>
            <h2 className="text-4xl font-black leading-none">
              {game.history.length === 0 ? `${names[game.current].toUpperCase()} STARTS` : `PASS TO ${names[game.current].toUpperCase()}`}
            </h2>
            <p className="font-mono text-sm">
              TAP READY WHEN THE DEVICE IS WITH {names[game.current].toUpperCase()}. EVERY HAND IS HIDDEN.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={ready} className={`${button} px-6 py-3 bg-accent shadow-brutal-sm`}>
                READY
              </button>
              <button type="button" onClick={() => setLeaving("restart")}
                className={`${button} px-3 py-2 bg-card font-mono text-xs`}>RESTART</button>
              <button type="button" onClick={() => setLeaving("exit")}
                className={`${button} px-3 py-2 bg-card font-mono text-xs`}>EXIT</button>
            </div>
          </section>
        </div>
      )}

      {leaving && (
        <Confirm
          title={leaving === "restart" ? "RESTART?" : "EXIT THIS GAME?"}
          detail={leaving === "restart"
            ? "DEALS A NEW GAME WITH THE SAME SETTINGS. THE CURRENT GAME AND MATCH SCORE ARE DROPPED AND NOT COUNTED IN YOUR STATS."
            : "GOES BACK TO THE SETUP SCREEN. THE CURRENT GAME AND MATCH SCORE ARE DROPPED AND NOT COUNTED IN YOUR STATS."}
          confirm={leaving === "restart" ? "RESTART" : "EXIT"}
          onConfirm={leaving === "restart" ? onRestart : onNewMatch}
          onCancel={() => setLeaving(null)}
        />
      )}

      {game.winner !== null && (
        <Result
          match={match}
          names={names}
          onNext={() => newDeal(nextGame(match))}
          onEnd={() => setMatch(endMatch(match))}
          onNewMatch={onNewMatch}
          onReview={() => setReviewing(true)}
        />
      )}
      {reviewing && (
        <ReviewPanel
          final={game}
          getClient={getClient}
          onClose={() => setReviewing(false)}
          names={names}
          seats={friends ? [0, 1, 2, 3] : [1, 2, 3]}
          youSeat={friends ? -1 : 0}
          players={humans}
          scoreAll
          onSave={() => saveReview({
            id: `game-${match.seed}-${match.gameIndex}`,
            at: Date.now(),
            title: friends
              ? `VS FRIENDS · ${humans.length} PEOPLE · ${names[game.winner ?? 0].toUpperCase()} WON`
              : `VS BOTS · ${config.difficulty.toUpperCase()} · ${game.winner === 0 ? "WON" : "LOST"}`,
            final: game,
            names,
            seats: friends ? [0, 1, 2, 3] : [1, 2, 3],
            youSeat: friends ? -1 : 0,
            players: humans,
            scoreAll: true,
          })}
        />
      )}
    </div>
  );
}

function Confirm({ title, detail, confirm, onConfirm, onCancel }: {
  title: string; detail: string; confirm: string; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" onClick={onCancel}>
      <section role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-3 border-ink bg-card p-6 shadow-brutal flex flex-col gap-5">
        <h2 className="text-4xl font-black leading-none">{title}</h2>
        <p className="font-mono text-sm leading-relaxed">{detail}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" autoFocus onClick={onCancel} className={`${button} px-5 py-3 bg-card shadow-brutal-sm`}>KEEP PLAYING</button>
          <button type="button" onClick={onConfirm} className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>{confirm}</button>
        </div>
      </section>
    </div>
  );
}

function Result({ match, names, onNext, onEnd, onNewMatch, onReview }: {
  match: MatchState; names: string[]; onNext: () => void; onEnd: () => void; onNewMatch: () => void; onReview: () => void;
}) {
  const winner = match.game.winner!;
  const winners = matchWinners(match);
  const friends = match.config.mode === "friends";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <section role="dialog" aria-label="Game over" className="w-full max-w-md border-3 border-ink bg-card p-6 shadow-brutal flex flex-col gap-5">
        <h2 className="text-4xl font-black leading-none">
          {winner === 0 && !friends ? "YOU WIN" : `${names[winner].toUpperCase()} WINS`}
        </h2>
        {match.config.games > 1 && (
          <div className="grid grid-cols-4 border-3 border-ink">
            {match.wins.map((w, seat) => (
              <div key={seat} className={`p-2 text-center ${seat > 0 ? "border-l-3 border-ink" : ""} ${winners.includes(seat) && match.over ? "bg-accent" : ""}`}>
                <div className="font-mono text-xs">{shortName(names[seat]).toUpperCase()}</div>
                <div className="text-3xl font-black">{w}</div>
              </div>
            ))}
          </div>
        )}
        {match.over && match.config.games > 1 && (
          <p className="font-mono text-sm">
            {winners.length > 1
              ? `MATCH SHARED BY ${winners.map((s) => names[s].toUpperCase()).join(" AND ")}`
              : winners[0] === 0 && !friends ? "YOU WIN THE MATCH" : `${names[winners[0]].toUpperCase()} WINS THE MATCH`}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onReview} className={`${button} px-5 py-3 bg-card shadow-brutal-sm`}>REVIEW</button>
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
