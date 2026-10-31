"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Account, SignIn, useAccount } from "@/components/account-panel";
import { AdvicePanel, type AdviceStatus } from "@/components/advice-panel";
import { Hand } from "@/components/hand";
import { HistoryPanel } from "@/components/history-panel";
import { Table } from "@/components/table";
import type { Difficulty } from "@/lib/bots/bots";
import type { Card } from "@/lib/engine/cards";
import type { GameState, Play } from "@/lib/engine/game";
import { legalMoves } from "@/lib/engine/legal";
import { sortHand, keepOrder } from "@/lib/hand/sort";
import { rankAdvice } from "@/lib/model/advice";
import { ModelClient } from "@/lib/model/client";
import { OnlineError, callOnline, onlineClient } from "@/lib/online/client";
import { TAKEOVER_AFTER_MS } from "@/lib/online/room-logic";

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";
const ROOM_KEY = "big2.room.v1";
const HEARTBEAT_MS = 15_000;
const key = (cards: Card[]) => [...cards].sort((a, b) => a - b).join(",");

interface RoomView {
  id: string;
  code: string;
  host: string;
  status: "lobby" | "playing" | "finished";
  difficulty: Difficulty;
  games: number;
  hints: boolean;
  turn_seconds: number | null;
  game_index: number;
  wins: number[];
}
interface SeatView { seat: number; user_id: string | null; display_name: string | null; bot: boolean; last_seen: string | null }
interface GameView {
  current: number; first_move: boolean; last_play: Play | null; passes: number; history: Play[];
  counts: number[]; winner: number | null; turn_deadline: string | null;
}

const errorText = (e: unknown) => (e instanceof OnlineError || e instanceof Error ? e.message : String(e));

/** Online play: sign in, then create or join a room. A room link (`/friends?room=CODE`) joins directly. */
export function OnlineScreen({ joinCode }: { joinCode: string | null }) {
  const [account, refresh] = useAccount();
  const [roomId, setRoomId] = useState<string | null>(() => {
    try { return typeof window === "undefined" ? null : localStorage.getItem(ROOM_KEY); } catch { return null; }
  });
  const enterRoom = useCallback((id: string | null) => {
    setRoomId(id);
    try { if (id) localStorage.setItem(ROOM_KEY, id); else localStorage.removeItem(ROOM_KEY); } catch { /* not kept */ }
  }, []);

  if (!onlineClient()) {
    return <p className="border-3 border-ink bg-card p-5 font-mono text-sm shadow-brutal">ONLINE PLAY IS NOT SET UP ON THIS SITE YET. ONE-DEVICE GAMES STILL WORK.</p>;
  }
  if (account === undefined) return <p className="font-mono text-sm">CHECKING YOUR SIGN-IN...</p>;
  if (account === null || account.name === null) {
    return (
      <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
        <p className="font-mono text-sm">PLAYING ONLINE NEEDS AN ACCOUNT, SO YOUR SEAT AND STATS FOLLOW YOU.</p>
        <SignIn account={account} onChange={refresh} />
      </section>
    );
  }
  return roomId
    ? <Room roomId={roomId} account={account} onLeave={() => enterRoom(null)} />
    : <Lobby account={account} joinCode={joinCode} onEnter={enterRoom} />;
}

function Lobby({ account, joinCode, onEnter }: { account: Account; joinCode: string | null; onEnter: (id: string) => void }) {
  const [code, setCode] = useState(joinCode ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [games, setGames] = useState(1);
  const [hints, setHints] = useState(false);
  const [turnSeconds, setTurnSeconds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const joined = useRef(false);

  const run = useCallback(async (task: () => Promise<{ id: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      onEnter((await task()).id);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [onEnter]);

  // Opening a room link joins it straight away.
  useEffect(() => {
    if (!joinCode || joined.current) return;
    joined.current = true;
    void run(() => callOnline("join", { code: joinCode }));
  }, [joinCode, run]);

  const pick = (on: boolean) => `${button} px-3 py-2 shadow-brutal-sm ${on ? "bg-accent" : "bg-card"}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
        <h2 className="text-2xl font-black">CREATE A ROOM</h2>
        <p className="font-mono text-xs">SIGNED IN AS {account.name!.toUpperCase()}. BOTS FILL ANY EMPTY SEATS WHEN YOU START.</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold w-24">BOTS</span>
          {(["easy", "medium", "hard"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)} className={pick(difficulty === d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold w-24">LENGTH</span>
          {[1, 3, 5, 10].map((n) => (
            <button key={n} type="button" aria-pressed={games === n} onClick={() => setGames(n)} className={pick(games === n)}>{n === 1 ? "SINGLE" : `${n} GAMES`}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold w-24">TURN TIMER</span>
          {[null, 30, 60, 90].map((t) => (
            <button key={String(t)} type="button" aria-pressed={turnSeconds === t} onClick={() => setTurnSeconds(t)} className={pick(turnSeconds === t)}>{t === null ? "OFF" : `${t}S`}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold w-24">HINTS</span>
          <button type="button" aria-pressed={!hints} onClick={() => setHints(false)} className={pick(!hints)}>OFF</button>
          <button type="button" aria-pressed={hints} onClick={() => setHints(true)} className={pick(hints)}>ON FOR EVERYONE</button>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(() => callOnline("create", { difficulty, games, hints, turnSeconds }))}
          className={`${button} self-start px-6 py-3 bg-ink text-paper shadow-brutal`}>CREATE ROOM</button>
      </section>
      <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
        <h2 className="text-2xl font-black">JOIN A ROOM</h2>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => callOnline("join", { code })); }}>
          <label className="flex flex-col gap-2">
            <span className="text-xs font-extrabold">ROOM CODE</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6}
              className="border-3 border-ink bg-paper px-3 py-2 font-mono text-2xl tracking-[0.3em] uppercase min-h-11" />
          </label>
          <button type="submit" disabled={busy || code.trim().length !== 6} className={`${button} self-start px-6 py-3 bg-accent shadow-brutal-sm`}>JOIN</button>
        </form>
      </section>
      {message && <p className="lg:col-span-2 border-3 border-ink bg-card p-3 font-mono text-sm">{message}</p>}
    </div>
  );
}

function useRoom(roomId: string, userId: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    const supabase = onlineClient()!;
    const [r, s, g, h] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase.from("room_seats").select("*").eq("room_id", roomId).order("seat"),
      supabase.from("room_games").select("*").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_hands").select("cards").eq("room_id", roomId).eq("user_id", userId).maybeSingle(),
    ]);
    if (!r.data) return setMissing(true);
    setRoom(r.data as RoomView);
    setSeats((s.data ?? []) as SeatView[]);
    setGame((g.data ?? null) as GameView | null);
    setHand(((h.data as { cards: Card[] } | null)?.cards ?? []));
  }, [roomId, userId]);

  useEffect(() => {
    const supabase = onlineClient()!;
    queueMicrotask(() => void reload());
    const channel = supabase.channel(`room-${roomId}`);
    for (const table of ["rooms", "room_seats", "room_games", "room_hands"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `${table === "rooms" ? "id" : "room_id"}=eq.${roomId}` },
        () => void reload());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload, roomId]);

  return { room, seats, game, hand, missing, reload };
}

function Room({ roomId, account, onLeave }: { roomId: string; account: Account; onLeave: () => void }) {
  const userId = account.session.user.id;
  const { room, seats, game, hand, missing, reload } = useRoom(roomId, userId);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Card[]>([]);
  const [order, setOrder] = useState<Card[]>([]);
  const [advice, setAdvice] = useState<AdviceStatus>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const client = useRef<ModelClient | null>(null);

  const me = seats.find((s) => s.user_id === userId)?.seat ?? null;
  const send = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    setMessage(null);
    try {
      await callOnline(action, { roomId, ...payload });
      await reload();
      return true;
    } catch (e) {
      setMessage(errorText(e));
      return false;
    }
  }, [reload, roomId]);

  // Check in regularly, so the host can see who is still here.
  useEffect(() => {
    void callOnline("heartbeat", { roomId }).catch(() => undefined);
    const timer = setInterval(() => void callOnline("heartbeat", { roomId }).catch(() => undefined), HEARTBEAT_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); clearInterval(tick); client.current?.dispose(); };
  }, [roomId]);

  // The game as this player sees it: their own hand, and only card counts for everyone else.
  const state: GameState | null = useMemo(() => game && me !== null ? {
    hands: game.counts.map((n, s) => (s === me ? hand : Array<number>(n).fill(-1))),
    current: game.current, firstMove: game.first_move, lastPlay: game.last_play, passes: game.passes,
    history: game.history, winner: game.winner,
  } : null, [game, hand, me]);

  const deadline = game?.turn_deadline ? Date.parse(game.turn_deadline) : null;
  const secondsLeft = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  const reported = useRef<number | null>(null);
  useEffect(() => {
    if (deadline === null || now < deadline || reported.current === deadline) return;
    reported.current = deadline;
    void callOnline("timeout", { roomId }).then(() => reload(), () => undefined);
  }, [deadline, now, reload, roomId]);

  if (missing) {
    return (
      <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-3 items-start">
        <p className="font-mono text-sm">THIS ROOM IS NO LONGER AVAILABLE.</p>
        <button type="button" onClick={onLeave} className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>BACK TO THE LOBBY</button>
      </section>
    );
  }
  if (!room || me === null) return <p className="font-mono text-sm">LOADING THE ROOM...</p>;

  const isHost = room.host === userId;
  const names = seats.map((s) => (s.seat === me ? "You" : s.display_name ?? `Seat ${s.seat + 1}`));
  const shareLink = typeof window === "undefined" ? "" : `${window.location.origin}/friends?room=${room.code}`;
  const away = (s: SeatView) => !s.bot && s.user_id !== null && (!s.last_seen || now - Date.parse(s.last_seen) > TAKEOVER_AFTER_MS);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-black tracking-tight">ROOM {room.code}</h2>
        <span className="font-mono text-xs">
          {room.difficulty.toUpperCase()} BOTS · {room.games === 1 ? "SINGLE GAME" : `GAME ${room.game_index + 1} OF ${room.games}`}
          {room.turn_seconds ? ` · ${room.turn_seconds}S TURNS` : ""} · HINTS {room.hints ? "ON" : "OFF"}
        </span>
      </div>
      <button type="button" onClick={onLeave} className={`${button} px-3 py-2 bg-card font-mono text-xs shadow-brutal-sm`}>LEAVE ROOM</button>
    </div>
  );

  if (room.status === "lobby" || !game || !state) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
          <p className="font-mono text-sm">SHARE THE CODE OR THIS LINK. EMPTY SEATS ARE FILLED WITH BOTS WHEN THE HOST STARTS.</p>
          <div className="flex flex-wrap gap-3 items-center">
            <code className="border-3 border-ink bg-paper px-3 py-2 font-mono text-xs break-all">{shareLink}</code>
            <button type="button" className={`${button} px-3 py-2 bg-card shadow-brutal-sm text-xs`}
              onClick={() => void navigator.clipboard?.writeText(shareLink)}>COPY LINK</button>
          </div>
          <ul className="grid sm:grid-cols-4 gap-3">
            {seats.map((s) => (
              <li key={s.seat} className={`border-3 border-ink p-3 ${s.user_id ? "bg-accent" : "bg-paper"}`}>
                <div className="font-mono text-[11px]">SEAT {s.seat + 1}</div>
                <div className="font-extrabold">{s.user_id ? (s.seat === me ? `${s.display_name} (YOU)` : s.display_name) : "OPEN"}</div>
              </li>
            ))}
          </ul>
          {isHost
            ? <button type="button" onClick={() => void send("start")} className={`${button} self-start px-6 py-3 bg-ink text-paper shadow-brutal`}>START</button>
            : <p className="font-mono text-sm">WAITING FOR THE HOST TO START.</p>}
        </section>
        {message && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{message}</p>}
      </div>
    );
  }

  const myTurn = game.winner === null && game.current === me && !seats[me].bot;
  const legal = myTurn ? legalMoves(state, me) : [];
  const legalKeys = new Set(legal.map(key));
  const shown = keepOrder(order.length ? order : sortHand(hand, "rank"), hand);
  const others = [1, 2, 3].map((r) => (me + r) % 4);
  const matchOver = room.status === "finished";

  async function play(cards: Card[]) {
    if (await send("move", { cards })) {
      setSelected([]);
      setAdvice({ kind: "idle" });
    }
  }

  async function hint() {
    if (!state || me === null) return;
    client.current ??= new ModelClient();
    setAdvice({ kind: "loading" });
    try {
      const { moves, scores } = await client.current.score(state, me);
      setAdvice({ kind: "ready", advice: rankAdvice(moves, scores) });
    } catch {
      setAdvice({ kind: "error", message: "THE MODEL COULD NOT LOAD." });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          <Table game={state} thinking={false} names={names} seats={others} youSeat={me} />
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            {seats.map((s) => (
              <span key={s.seat} className="border-2 border-ink bg-card px-2 py-1">
                {names[s.seat].toUpperCase()}: {room.wins[s.seat]} {room.wins[s.seat] === 1 ? "WIN" : "WINS"}
                {s.bot && s.user_id ? " · BOT PLAYING" : ""}
                {away(s) && s.seat !== me ? " · AWAY" : ""}
                {isHost && s.seat !== me && away(s) && (
                  <button type="button" onClick={() => void send("takeover", { seat: s.seat })}
                    className="ml-2 underline font-semibold">HAND TO A BOT</button>
                )}
              </span>
            ))}
          </div>
          {secondsLeft !== null && game.winner === null && (
            <p className="font-mono text-sm font-semibold">{myTurn ? "YOUR TIME" : `${names[game.current].toUpperCase()}'S TIME`}: {secondsLeft}S</p>
          )}
          <Hand
            order={shown}
            selected={selected}
            playable={myTurn ? new Set(legal.flat()) : new Set(hand)}
            groups={[]}
            onToggle={(c) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
            onSlideSelect={setSelected}
            onReorder={setOrder}
          />
          <div className="grid grid-cols-3 gap-3">
            <button type="button" disabled={!myTurn || !legalKeys.has(key(selected)) || selected.length === 0}
              onClick={() => void play(selected)} className={`${button} h-14 sm:h-16 text-lg sm:text-2xl bg-accent shadow-brutal`}>PLAY</button>
            <button type="button" disabled={!myTurn || !legalKeys.has("")} onClick={() => void play([])}
              className={`${button} h-14 sm:h-16 text-lg sm:text-2xl bg-card shadow-brutal`}>PASS</button>
            <button type="button" disabled={!myTurn || !room.hints} onClick={() => void hint()}
              title={room.hints ? undefined : "The host turned hints off for this room"}
              className={`${button} h-14 sm:h-16 text-lg sm:text-2xl bg-card shadow-brutal`}>HINT</button>
          </div>
          {message && <p className="border-3 border-ink bg-card p-3 font-mono text-sm">{message}</p>}
          {game.winner !== null && (
            <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-3">
              <h3 className="text-3xl font-black">{game.winner === me ? "YOU WIN" : `${names[game.winner].toUpperCase()} WINS`}</h3>
              {matchOver
                ? <p className="font-mono text-sm">THE MATCH IS OVER. RESULTS ARE IN EVERYONE&apos;S STATS.</p>
                : isHost
                  ? <button type="button" onClick={() => void send("next")} className={`${button} self-start px-5 py-3 bg-accent shadow-brutal-sm`}>NEXT GAME</button>
                  : <p className="font-mono text-sm">WAITING FOR THE HOST TO DEAL THE NEXT GAME.</p>}
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-5">
          {room.hints && (
            <div className="border-3 border-ink bg-card shadow-brutal">
              <div className="border-b-3 border-ink p-3 text-sm font-extrabold">BEST MOVES</div>
              <AdvicePanel status={advice} onPick={setSelected} idleText="PRESS HINT ON YOUR TURN." />
            </div>
          )}
          <div className="border-3 border-ink bg-card shadow-brutal max-h-[70vh] overflow-y-auto">
            <div className="border-b-3 border-ink p-3 text-sm font-extrabold">HISTORY</div>
            <HistoryPanel game={state} names={names} hand={hand} />
          </div>
        </aside>
      </div>
    </div>
  );
}
