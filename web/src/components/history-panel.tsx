import { CardRow } from "@/components/card";
import { RANK_NAMES, SUIT_SYMBOLS } from "@/lib/engine/cards";
import type { GameState } from "@/lib/engine/game";
import { cardOwners, groupTricks, highCardsElsewhere } from "@/lib/session/history";
import { SEAT_NAMES } from "@/lib/session/match";

/** Trick-by-trick log, a grid of every card played and by whom, and the 2s and Aces still out. */
export function HistoryPanel({ game }: { game: GameState }) {
  const tricks = groupTricks(game.history);
  const owners = cardOwners(game.history);
  const { twos, aces } = highCardsElsewhere(game.history, game.hands[0]);

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b-3 border-ink grid grid-cols-2 gap-3">
        <div>
          <div className="text-4xl font-black leading-none">{twos}</div>
          <div className="font-mono text-[11px]">2S IN OTHER HANDS</div>
        </div>
        <div>
          <div className="text-4xl font-black leading-none">{aces}</div>
          <div className="font-mono text-[11px]">ACES IN OTHER HANDS</div>
        </div>
      </div>

      <div className="p-4 border-b-3 border-ink">
        <div className="text-sm font-extrabold mb-2">CARDS PLAYED</div>
        <div className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-px bg-ink border-2 border-ink font-mono text-[11px]">
          <span className="bg-paper px-1" />
          {SUIT_SYMBOLS.map((s, i) => (
            <span key={s} className={`bg-paper text-center ${i % 2 === 0 ? "text-suit-red" : ""}`}>{s}</span>
          ))}
          {RANK_NAMES.map((r, ri) => [
            <span key={r} className="bg-paper px-1 font-semibold">{r}</span>,
            ...SUIT_SYMBOLS.map((_, si) => {
              const card = ri * 4 + si;
              const owner = owners.get(card);
              return (
                <span
                  key={card}
                  title={owner === undefined ? undefined : `${r}${SUIT_SYMBOLS[si]} played by ${SEAT_NAMES[owner]}`}
                  className={`text-center ${owner === undefined ? "bg-card" : owner === 0 ? "bg-accent" : "bg-ink text-paper"}`}
                >
                  {owner === undefined ? "" : SEAT_NAMES[owner][0]}
                </span>
              );
            }),
          ])}
        </div>
        <p className="mt-2 font-mono text-[11px]">Y = YOU, W = WEST, N = NORTH, E = EAST.</p>
      </div>

      <ol className="flex flex-col-reverse">
        {tricks.map((trick, t) => (
          <li key={t} className="p-4 border-b-2 border-ink flex flex-col gap-2">
            <span className="text-xs font-extrabold">TRICK {t + 1}</span>
            {trick.map((play, i) => (
              <div key={i} className="grid grid-cols-[64px_1fr] items-center gap-2">
                <span className="font-mono text-xs">{SEAT_NAMES[play.player].toUpperCase()}</span>
                {play.cards.length > 0 ? <CardRow cards={play.cards} size="sm" /> : <span className="font-mono text-xs">PASS</span>}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
