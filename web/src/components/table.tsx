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

/** The three opponents across the top and the trick in the middle. */
export function Table({ game, thinking }: { game: GameState; thinking: boolean }) {
  const lastPlayer = game.history.at(-1)?.player;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[1, 2, 3].map((seat) => {
          const turn = game.winner === null && game.current === seat;
          return (
            <div
              key={seat}
              className={`border-3 border-ink p-2 sm:p-3 flex flex-col gap-1 ${turn ? "bg-accent" : "bg-card"} ${
                lastPlayer === seat ? "shadow-brutal" : "shadow-brutal-sm"
              }`}
            >
              <div className="flex justify-between items-baseline gap-1">
                <span className="text-xs sm:text-sm font-extrabold tracking-wide">{SEAT_NAMES[seat].toUpperCase()}</span>
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
              ? `TO BEAT: ${SEAT_NAMES[game.lastPlay.player].toUpperCase()}`
              : game.firstMove
                ? "OPENING: MUST INCLUDE 3♦"
                : `${SEAT_NAMES[game.current].toUpperCase()} LEADS`}
          </span>
          {game.lastPlay && <span>{game.passes} {game.passes === 1 ? "PASS" : "PASSES"}</span>}
        </div>
        <div className="min-h-24 flex items-center">
          {game.lastPlay ? <CardRow cards={game.lastPlay.cards} /> : <span className="font-mono text-sm">EMPTY TABLE</span>}
        </div>
        <div className="font-mono text-xs">
          {game.winner !== null
            ? `${SEAT_NAMES[game.winner].toUpperCase()} ${game.winner === 0 ? "WIN" : "WINS"}`
            : game.current === 0
              ? "YOUR TURN"
              : `${SEAT_NAMES[game.current].toUpperCase()} TO PLAY`}
        </div>
      </section>
    </div>
  );
}
