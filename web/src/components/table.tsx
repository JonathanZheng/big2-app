import { CardFace, CardRow } from "@/components/card";
import { type Card, rank, suit } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { SEAT_NAMES } from "@/lib/session/match";

/** What a seat did most recently in the current trick, and where in the history it did it. */
function lastAction(game: GameState, seat: number): { label: string; at: number } {
  for (let i = game.history.length - 1; i >= 0; i--) {
    const play = game.history[i];
    if (play.player !== seat) continue;
    return { label: play.cards.length === 0 ? "PASSED" : "PLAYED", at: i };
  }
  return { label: "WAITING", at: -1 };
}

/** Where a play comes from, by seat relative to the hand shown: you below, then west, north, east. */
const ENTER_FROM = [{ x: 0, y: 220 }, { x: -260, y: -40 }, { x: 0, y: -160 }, { x: 260, y: -40 }];

/** Index in the history of the most recent play with cards, so a new play can be told from a pass. */
function lastPlayIndex(game: GameState): number {
  for (let i = game.history.length - 1; i >= 0; i--) if (game.history[i].cards.length > 0) return i;
  return -1;
}

const SPOKEN_RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace", "2"];
const SPOKEN_SUITS = ["diamonds", "clubs", "hearts", "spades"];

/**
 * One sentence for screen readers about the latest event at the table, such as
 * "West plays 9 of hearts, 9 of spades. Your turn." Motion is never the only signal.
 */
export function announce(game: GameState, names: string[], youSeat: number): string {
  const said = (seat: number, verb: string) =>
    seat === youSeat ? `You ${verb}` : `${names[seat]} ${verb}s`;
  const last = game.history.at(-1);
  const event = !last
    ? ""
    : last.cards.length === 0
      ? `${said(last.player, "pass")}. `
      : `${said(last.player, "play")} ${last.cards.map((c) => `${SPOKEN_RANKS[rank(c)]} of ${SPOKEN_SUITS[suit(c)]}`).join(", ")}. `;
  if (game.winner !== null) return `${event}${game.winner === youSeat ? "You win." : `${names[game.winner]} wins.`}`;
  const lead = game.lastPlay ? "" : "New trick. ";
  return `${event}${lead}${game.current === youSeat ? "Your turn." : `${names[game.current]} to play.`}`;
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
  const trickIndex = lastPlayIndex(game);
  // After everyone passes, the trick that was just won leaves toward its winner.
  const cleared = !game.lastPlay && trickIndex >= 0 ? game.history[trickIndex] : null;
  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce(game, names, youSeat)}</p>
      <div className={`grid gap-2 sm:gap-4 ${seats.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {seats.map((seat) => {
          const turn = game.winner === null && game.current === seat;
          const action = lastAction(game, seat);
          const count = game.hands[seat].length;
          return (
            <div
              key={seat}
              className={`border-3 border-ink p-2 sm:p-3 flex flex-col gap-1 motion-safe:transition-[background-color,box-shadow] motion-safe:duration-150 ${turn ? "bg-accent" : "bg-card"} ${
                lastPlayer === seat ? "shadow-brutal" : "shadow-brutal-sm"
              } ${turn && thinking ? "motion-safe:animate-[think_700ms_ease-in-out_infinite]" : ""}`}
            >
              <div className="flex justify-between items-baseline gap-1">
                <span className="text-xs sm:text-sm font-extrabold tracking-wide">{names[seat].toUpperCase()}</span>
                {turn && thinking ? (
                  <span className="font-mono text-[10px] sm:text-xs">THINKING</span>
                ) : (
                  // Keyed by the play, so each new pass is stamped on and nothing else replays.
                  <span key={action.at} className={`font-mono text-[10px] sm:text-xs ${
                    action.label === "PASSED" ? "font-bold motion-safe:animate-[stamp_220ms_cubic-bezier(0.16,1,0.3,1)]" : ""
                  }`}>
                    {action.label}
                  </span>
                )}
              </div>
              <span key={count} className="origin-bottom-left text-4xl sm:text-6xl font-black leading-none tracking-tighter motion-safe:animate-[count_220ms_cubic-bezier(0.16,1,0.3,1)]">
                {String(count).padStart(2, "0")}
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
        <div className="relative min-h-24 flex items-center">
          {game.lastPlay ? (
            // Keyed by the play, so each new play travels in from its seat and passes leave it still.
            <CardRow key={trickIndex} cards={game.lastPlay.cards} enterFrom={ENTER_FROM[(game.lastPlay.player - youSeat + 4) % 4]} />
          ) : (
            <>
              <span className="font-mono text-sm">EMPTY TABLE</span>
              {cleared && (
                <Sweep key={trickIndex} cards={cleared.cards} to={ENTER_FROM[(cleared.player - youSeat + 4) % 4]} />
              )}
            </>
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

/**
 * The trick that was just won, leaving the table toward its winner. It ends
 * invisible and stays out of the way of pointer and screen reader. With
 * reduced motion it is not drawn at all.
 */
function Sweep({ cards, to }: { cards: Card[]; to: { x: number; y: number } }) {
  return (
    <span aria-hidden className="absolute inset-y-0 left-0 flex items-center gap-1.5 pointer-events-none motion-reduce:hidden">
      {cards.map((c, i) => (
        <span key={c} className="animate-[sweep_300ms_cubic-bezier(0.7,0,0.84,0)_forwards]"
          style={{ "--dx": `${to.x - i * 30}px`, "--dy": `${to.y}px`, "--rot": `${i % 2 ? -8 : 8}deg`, animationDelay: `${i * 30}ms` } as React.CSSProperties}>
          <CardFace card={c} className="w-14 h-20 sm:w-16 sm:h-24 shadow-brutal-sm" />
        </span>
      ))}
    </span>
  );
}
