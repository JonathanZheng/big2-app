import { type Card, RANK_NAMES, SUIT_SYMBOLS, cardName, isRed, rank, suit } from "@/lib/engine/cards";

/** A face-up card. Size is set by the parent through `className`. */
export function CardFace({ card, selected = false, dimmed = false, className = "" }: {
  card: Card;
  selected?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-label={cardName(card)}
      className={`flex flex-col justify-between border-3 border-ink p-1.5 select-none ${
        selected ? "bg-accent" : "bg-card"
      } ${dimmed ? "opacity-40" : ""} ${isRed(card) ? "text-suit-red" : "text-ink"} ${className}`}
    >
      <span aria-hidden className="text-lg sm:text-xl font-black leading-none">{RANK_NAMES[rank(card)]}</span>
      <span aria-hidden className="self-end text-lg sm:text-xl leading-none">{SUIT_SYMBOLS[suit(card)]}</span>
    </span>
  );
}

/** Cards laid out in a row, for the table and history. */
export function CardRow({ cards, size = "md" }: { cards: Card[]; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-9 h-12 text-sm" : "w-14 h-20 sm:w-16 sm:h-24";
  return (
    <span className="flex gap-1.5">
      {cards.map((c) => (
        <CardFace key={c} card={c} className={`${box} shadow-brutal-sm`} />
      ))}
    </span>
  );
}
