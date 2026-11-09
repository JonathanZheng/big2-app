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
      className={`flex flex-col justify-between border-ink select-none ${compact ? "border-2 p-0.5" : "border-3 p-1 sm:p-1.5"} ${
        selected ? "bg-accent" : "bg-card"
      } ${dimmed ? "opacity-40" : ""} ${isRed(card) ? "text-suit-red" : "text-ink"} ${className}`}
    >
      {/* Rank and suit sit together in the corner so overlapped cards stay readable. */}
      <span aria-hidden className="flex flex-col items-start leading-none">
        <span className={`font-black tracking-tighter ${compact ? "text-sm" : "text-[15px] sm:text-xl"}`}>{RANK_NAMES[rank(card)]}</span>
        <span className={compact ? "text-xs" : "text-sm sm:text-lg"}>{SUIT_SYMBOLS[suit(card)]}</span>
      </span>
      {!compact && <span aria-hidden className="self-end text-xl sm:text-2xl leading-none">{SUIT_SYMBOLS[suit(card)]}</span>}
    </span>
  );
}

/**
 * Cards laid out in a row, for the table and history. With `enterFrom`, the
 * cards travel in from that offset (the seat that played them), one after another.
 */
export function CardRow({ cards, size = "md", enterFrom }: { cards: Card[]; size?: "sm" | "md"; enterFrom?: { x: number; y: number } }) {
  const box = size === "sm" ? "w-8 h-11" : "w-14 h-20 sm:w-16 sm:h-24";
  return (
    <span className="flex gap-1.5">
      {cards.map((c, i) =>
        enterFrom ? (
          <span key={c} className="motion-safe:animate-[land_420ms_cubic-bezier(0.16,1,0.3,1)_both]"
            style={{ "--dx": `${enterFrom.x - i * 30}px`, "--dy": `${enterFrom.y}px`, "--rot": `${i % 2 ? 6 : -6}deg`, animationDelay: `${i * 50}ms` } as React.CSSProperties}>
            <CardFace card={c} className={`${box} shadow-brutal-sm`} />
          </span>
        ) : (
          <CardFace key={c} card={c} compact={size === "sm"} className={`${box} shadow-brutal-sm`} />
        ),
      )}
    </span>
  );
}
