"use client";

import {
  DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useRef } from "react";
import { CardFace } from "@/components/card";
import { type Card, cardName } from "@/lib/engine/cards";

const HOLD_MS = 250;
const SLIDE_PX = 8;

interface HandProps {
  order: Card[];
  selected: Card[];
  /** Cards that are part of at least one legal play right now. */
  playable: Set<Card>;
  /** Cards kept together; drawn with a gap around each group. */
  groups: Card[][];
  disabled?: boolean;
  onToggle: (card: Card) => void;
  /** Sliding a finger or pointer across cards selects exactly those cards. */
  onSlideSelect: (cards: Card[]) => void;
  onReorder: (order: Card[]) => void;
}

/**
 * The player's cards. Tap or click toggles a card; sliding across cards
 * selects them; holding a card for a moment picks it up to drag. Arrow keys
 * move between cards and Space toggles.
 */
export function Hand({ order, selected, playable, groups, disabled, onToggle, onSlideSelect, onReorder }: HandProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: HOLD_MS, tolerance: SLIDE_PX } }),
  );
  const slide = useRef<{ x: number; y: number; at: number; cards: Card[]; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const groupStart = new Set(groups.filter((g) => g.length > 1).map((g) => order.find((c) => g.includes(c))));

  function onPointerDown(e: React.PointerEvent) {
    // Keep receiving the release even when the pointer leaves the hand. The
    // capture goes on the card so dnd-kit's listeners still see the events.
    const el = cardElementAt(e.clientX, e.clientY);
    if (el) {
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    }
    // A slide that ended outside the hand may not produce a click, so clear
    // the flag at the start of every gesture rather than relying on one.
    suppressClick.current = false;
    const card = el ? Number(el.dataset.card) : null;
    slide.current = card === null ? null : { x: e.clientX, y: e.clientY, at: Date.now(), cards: [card], active: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = slide.current;
    if (!s) return;
    // The button was released somewhere outside a pointerup handler.
    if (e.buttons === 0) {
      slide.current = null;
      return;
    }
    if (!s.active) {
      const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLIDE_PX;
      if (!moved) return;
      if (Date.now() - s.at >= HOLD_MS) return void (slide.current = null); // a drag, not a slide
      s.active = true;
    }
    const card = cardAt(e.clientX, e.clientY);
    if (card !== null && !s.cards.includes(card)) {
      s.cards.push(card);
      onSlideSelect([...s.cards]);
    }
  }

  function onPointerUp() {
    if (slide.current?.active) {
      onSlideSelect(slide.current.cards);
      suppressClick.current = true;
    }
    slide.current = null;
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(order, order.indexOf(Number(active.id)), order.indexOf(Number(over.id))));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-card]")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
    next?.focus();
    e.preventDefault();
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div
          role="group"
          aria-label="Your hand"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="grid items-end pt-7 touch-none"
          style={{ gridTemplateColumns: `repeat(${Math.max(order.length - 1, 0)}, minmax(0, 66px)) 66px` }}
        >
          {order.map((card) => (
            <HandCard
              key={card}
              card={card}
              selected={selected.includes(card)}
              dimmed={!playable.has(card)}
              gapBefore={groupStart.has(card) && card !== order[0]}
              disabled={disabled}
              onClick={() => {
                if (suppressClick.current) return void (suppressClick.current = false);
                onToggle(card);
              }}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function cardElementAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card]") ?? null;
}

function cardAt(x: number, y: number): Card | null {
  const el = cardElementAt(x, y);
  return el ? Number(el.dataset.card) : null;
}

function HandCard({ card, selected, dimmed, gapBefore, disabled, onClick }: {
  card: Card; selected: boolean; dimmed: boolean; gapBefore: boolean; disabled?: boolean; onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card, disabled });
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-card={card}
      aria-label={`${cardName(card)}${dimmed ? ", cannot be played now" : ""}`}
      disabled={disabled}
      onClick={onClick}
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
        zIndex: isDragging ? 50 : undefined,
      }}
      className={`relative text-left transition-[margin] ${selected ? "-mt-6 mb-6" : ""} ${gapBefore ? "ml-3" : ""}`}
    >
      <CardFace
        card={card}
        selected={selected}
        dimmed={dimmed}
        className="w-13 h-20 sm:w-16 sm:h-24 shadow-brutal-sm"
      />
    </button>
  );
}
