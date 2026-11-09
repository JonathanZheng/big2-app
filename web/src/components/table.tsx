import { CardRow } from "@/components/card";
import type { GameState } from "@/lib/engine/game";
import { SEAT_NAMES } from "@/lib/session/match";

/** What a seat did most recently in the current trick. */
function lastAction(game: GameState, seat: number): string {
  for (let i = game.history.length - 1; i >= 0; i--) {
    const play = game.history[i];
    if (play.player !== seat) continue;
    return play.cards.length === 0 ? "PASSED" : "PLAYED";
  }
  return "WAITING";
}

/** Where a play comes from, by seat relative to the hand shown: you below, then west, north, east. */
const ENTER_FROM = [{ x: 0, y: 220 }, { x: -260, y: -40 }, { x: 0, y: -160 }, { x: 260, y: -40 }];

/** Index in the history of the play on the table, so a new play can be told from a pass. */
function lastPlayIndex(game: GameState): number {
  for (let i = game.history.length - 1; i >= 0; i--) if (game.history[i].cards.length > 0) return i;
  return -1;
}

/**
 * The seats and the trick in the middle. Vs bots shows the three opponents;
 * one-device games show all four seats.
 */
export function Table({ game, thinking, names = SEAT_NAMES, seats = [1, 2, 3], youSeat = 0 }: {
  game: GameState;
  thinking: boolean;
  names?: string[];
  seats?: number[];
  /** The seat the hand below belongs to, or -1 when no hand is shown. */
  youSeat?: number;
}) {
  const lastPlayer = game.history.at(-1)?.player;
  return (
    <div className="flex flex-col gap-4">
      <div className={`grid gap-2 sm:gap-4 ${seats.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {seats.map((seat) => {
          const turn = game.winner === null && game.current === seat;
          return (
            <div
              key={seat}
              className={`border-3 border-ink p-2 sm:p-3 flex flex-col gap-1 ${turn ? "bg-accent" : "bg-card"} ${
                lastPlayer === seat ? "shadow-brutal" : "shadow-brutal-sm"
              }`}
            >
              <div className="flex justify-between items-baseline gap-1">
                <span className="text-xs sm:text-sm font-extrabold tracking-wide">{names[seat].toUpperCase()}</span>
                <span className="font-mono text-[10px] sm:text-xs">
                  {turn && thinking ? "THINKING" : lastAction(game, seat)}
                </span>
              </div>
              <span className="text-4xl sm:text-6xl font-black leading-none tracking-tighter">
                {String(game.hands[seat].length).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] sm:text-xs">CARDS LEFT</span>
            </div>
          );
        })}
      </div>

      <section
        aria-label="Table"
        className="border-3 border-ink bg-ink text-paper p-4 min-h-44 flex flex-col justify-between gap-3"
      >
        <div className="flex flex-wrap justify-between gap-2 font-mono text-xs">
          <span>
            {game.lastPlay
              ? `TO BEAT: ${names[game.lastPlay.player].toUpperCase()}`
              : game.firstMove
                ? "OPENING: MUST INCLUDE 3♦"
                : names[game.current] === "You" ? "YOU LEAD" : `${names[game.current].toUpperCase()} LEADS`}
          </span>
          {game.lastPlay && <span>{game.passes} {game.passes === 1 ? "PASS" : "PASSES"}</span>}
        </div>
        <div className="min-h-24 flex items-center">
          {game.lastPlay ? (
            // Keyed by the play, so each new play travels in from its seat and passes leave it still.
            <CardRow key={lastPlayIndex(game)} cards={game.lastPlay.cards} enterFrom={ENTER_FROM[(game.lastPlay.player - youSeat + 4) % 4]} />
          ) : (
            <span className="font-mono text-sm">EMPTY TABLE</span>
          )}
        </div>
        <div className="font-mono text-xs">
          {game.winner !== null
            ? `${names[game.winner].toUpperCase()} ${game.winner === youSeat ? "WIN" : "WINS"}`
            : game.current === youSeat
              ? "YOUR TURN"
              : `${names[game.current].toUpperCase()} TO PLAY`}
        </div>
      </section>
    </div>
  );
}
