"use client";

import {
  DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useLayoutEffect, useRef, useState } from "react";
import { CardFace } from "@/components/card";
import { type Card, cardName } from "@/lib/engine/cards";
import { groupBreaks, handOffsets } from "@/lib/hand/layout";

const HOLD_MS = 250;
const SLIDE_PX = 8;
/** Sweep timing from the big2-motion skill, for cards closing up or reordering. */
const CLOSE_MS = 300;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

interface HandProps {
  order: Card[];
  selected: Card[];
  /** Cards that are part of at least one legal play right now. */
  playable: Set<Card>;
  /** Cards kept together; drawn with a gap around each group. */
  groups: Card[][];
  /** Set when a play was refused; the selected cards shake once per new value. */
  refused?: number;
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
export function Hand({ order, selected, playable, groups, refused, disabled, onToggle, onSlideSelect, onReorder }: HandProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: HOLD_MS, tolerance: SLIDE_PX } }),
  );
  const slide = useRef<{ x: number; y: number; at: number; cards: Card[]; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  // Measure the row and a card so every card can be placed evenly. The row is
  // measured again whenever it changes size, such as when the window resizes.
  const row = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: Infinity, card: 64 });
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const face = el.querySelector<HTMLElement>("[data-card] > span");
      setSize({ width: el.clientWidth, card: face?.offsetWidth || 64 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const offsets = handOffsets(order.length, size.width, size.card, groupBreaks(order, groups));

  // FLIP: after each render, a card whose place in the row changed slides from
  // its old place to its new one, so the hand closes up after a play and a sort
  // can be followed by eye. Drags animate themselves, and a resize just snaps.
  const dragging = useRef(false);
  const lefts = useRef<{ width: number; at: Map<Card, number> }>({ width: 0, at: new Map() });
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const before = lefts.current;
    // Only a play (cards leave) or a reorder (same cards) slides. A new deal or
    // another seat's hand brings cards that were not there, and just appears.
    const sameOrFewer = order.every((card) => before.at.has(card));
    const animate = sameOrFewer && before.width === size.width && !dragging.current
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = new Map<Card, number>();
    for (const button of el.querySelectorAll<HTMLElement>("button[data-card]")) {
      const card = Number(button.dataset.card);
      // offsetLeft is the layout position, unaffected by running animations.
      const left = button.offsetLeft;
      at.set(card, left);
      const from = before.at.get(card);
      if (animate && from !== undefined && from !== left) {
        button.animate(
          [{ transform: `translateX(${from - left}px)` }, { transform: "none" }],
          { duration: CLOSE_MS, easing: EASE_OUT, composite: "add" },
        );
      }
    }
    lefts.current = { width: size.width, at };
  });

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
    // The dropped order is already on screen through dnd-kit's own transforms,
    // so the render that commits it must not slide anything again.
    requestAnimationFrame(() => { dragging.current = false; });
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
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={() => { dragging.current = true; }}
      onDragEnd={onDragEnd}
      onDragCancel={() => { dragging.current = false; }}>
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        <div
          ref={row}
          role="group"
          aria-label="Your hand"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="flex items-end pt-7 touch-none min-w-0"
        >
          {order.map((card, i) => (
            <HandCard
              key={card}
              card={card}
              selected={selected.includes(card)}
              dimmed={!playable.has(card)}
              offset={offsets[i]}
              refused={selected.includes(card) ? refused : undefined}
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

function HandCard({ card, selected, dimmed, offset, refused, disabled, onClick }: {
  card: Card; selected: boolean; dimmed: boolean; offset: number; refused?: number; disabled?: boolean; onClick: () => void;
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
        marginLeft: offset,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
        zIndex: isDragging ? 50 : undefined,
      }}
      // A raised card moves with `translate`, which does not change the layout,
      // so selecting never shifts the other cards. With reduced motion, cards
      // move straight to their place, dnd-kit's sorting transition included.
      className={`relative shrink-0 text-left motion-safe:transition-[translate] motion-reduce:transition-none! ${selected ? "-translate-y-6" : ""}`}
    >
      {/* Keyed by the refusal, so each refused PLAY shakes the selection once. */}
      <span key={refused} className={`block ${refused ? "motion-safe:animate-[shake_180ms_linear]" : ""}`}>
        <CardFace
          card={card}
          selected={selected}
          dimmed={dimmed}
          className="w-13 h-20 sm:w-16 sm:h-24 shadow-brutal-sm"
        />
      </span>
    </button>
  );
}
