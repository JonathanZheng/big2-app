import { type Card, RANK_NAMES, SUIT_SYMBOLS, cardName, isRed, rank, suit } from "@/lib/engine/cards";

/** A face-up card. Size is set by the parent through `className`. */
export function CardFace({ card, selected = false, dimmed = false, compact = false, className = "" }: {
  card: Card;
  selected?: boolean;
  dimmed?: boolean;
  /** Small cards show only the corner. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-label={cardName(card)}
      className={`flex flex-col justify-between border-3 border-ink p-1 sm:p-1.5 select-none ${
        selected ? "bg-accent" : "bg-card"
      } ${dimmed ? "opacity-40" : ""} ${isRed(card) ? "text-suit-red" : "text-ink"} ${className}`}
    >
      {/* Rank and suit sit together in the corner so overlapped cards stay readable. */}
      <span aria-hidden className="flex flex-col items-start leading-none">
        <span className="text-[15px] sm:text-xl font-black tracking-tighter">{RANK_NAMES[rank(card)]}</span>
        <span className="text-sm sm:text-lg">{SUIT_SYMBOLS[suit(card)]}</span>
      </span>
      {!compact && <span aria-hidden className="self-end text-xl sm:text-2xl leading-none">{SUIT_SYMBOLS[suit(card)]}</span>}
    </span>
  );
}

/** Cards laid out in a row, for the table and history. */
export function CardRow({ cards, size = "md" }: { cards: Card[]; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-9 h-12 p-1" : "w-14 h-20 sm:w-16 sm:h-24";
  return (
    <span className="flex gap-1.5">
      {cards.map((c) => (
        <CardFace key={c} card={c} compact={size === "sm"} className={`${box} shadow-brutal-sm`} />
      ))}
    </span>
  );
}
