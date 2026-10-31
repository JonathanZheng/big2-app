import { type Card, RANK_NAMES, SUIT_SYMBOLS, cardName, isRed } from "@/lib/engine/cards";
import type { Board, CardOwner } from "@/lib/best-move/board";
import { OWNER_LABEL } from "@/lib/best-move/board";

const OWNER_SHORT: Record<CardOwner, string> = {
  unseen: "",
  mine: "YOU",
  minePlayed: "YOU",
  west: "W",
  north: "N",
  east: "E",
  out: "OUT",
};

/** All 52 cards; tapping a card cycles who has it or selects it. */
export function CardGrid({ board, onCard, highlight = [], tableCards = [], selected, disabledCards }: {
  board: Board;
  onCard: (card: Card) => void;
  /** Cards the advice points at, outlined in red. */
  highlight?: Card[];
  /** Cards in the trick, marked with a bar. */
  tableCards?: Card[];
  /** When given, the grid reports selection rather than ownership as pressed. */
  selected?: Card[];
  /** Cards that cannot be tapped right now. */
  disabledCards?: Set<Card>;
}) {
  return (
    <div
      role="grid"
      aria-label="All 52 cards. Tap a card to change who has it."
      className="grid grid-cols-[1.4rem_repeat(4,minmax(0,1fr))] gap-px bg-ink border-3 border-ink"
    >
      <span className="bg-paper" />
      {SUIT_SYMBOLS.map((symbol, s) => (
        <span key={`suit-${symbol}`} className={`bg-paper text-center font-mono text-sm ${s % 2 === 0 ? "text-suit-red" : ""}`}>
          {symbol}
        </span>
      ))}
      {RANK_NAMES.map((name, r) => [
        <span key={`rank-${name}`} className="bg-paper flex items-center justify-center font-mono text-xs font-semibold">{name}</span>,
        ...SUIT_SYMBOLS.map((symbol, s) => {
          const card = r * 4 + s;
          const owner = board.owners[card];
          const inTrick = tableCards.includes(card);
          const pointed = highlight.includes(card);
          const dark = owner === "west" || owner === "north" || owner === "east" || owner === "minePlayed";
          const disabled = disabledCards?.has(card) ?? false;
          const picked = selected?.includes(card) ?? false;
          return (
            <button
              key={`card-${card}`}
              type="button"
              aria-label={`${cardName(card)}, ${OWNER_LABEL[owner].toLowerCase()}`}
              aria-pressed={selected ? selected.includes(card) : owner !== "unseen"}
              disabled={disabled}
              onClick={() => onCard(card)}
              className={`relative min-h-11 px-1 py-0.5 text-left font-mono leading-none border-0 ${
                picked ? "bg-picked" : owner === "mine" ? "bg-accent" : owner === "unseen" ? "bg-card" : owner === "out" ? "bg-paper" : "bg-ink"
              } ${dark && !picked ? "text-paper" : "text-ink"} ${
                // Fade only the text: fading the cell would let the black grid lines show through it.
                // Your own cards stay fully readable; they just cannot be picked for another player.
                disabled ? `cursor-not-allowed ${owner === "mine" ? "" : "[&>span]:opacity-45"}` : ""
              } ${
                picked ? "outline-2 -outline-offset-2 outline-ink" : pointed ? "outline-3 -outline-offset-2 outline-suit-red" : ""
              }`}
            >
              <span className={`block text-sm font-black ${isRed(card) && !dark && !picked && owner !== "mine" ? "text-suit-red" : ""}`}>
                {name}{symbol}
              </span>
              <span className={`mt-1 block truncate text-[9px] ${owner === "out" ? "opacity-50" : ""}`}>
                {picked ? "PICKED" : OWNER_SHORT[owner]}
              </span>
              {inTrick && <span aria-hidden className="absolute inset-x-1 bottom-0 h-1 bg-accent" />}
            </button>
          );
        }),
      ])}
    </div>
  );
}
