---
name: big2-motion
description: Use when adding, changing or reviewing animation, transitions, feedback or hit areas in the Big 2 web app (web/), especially the play table, hand, seats, trick, result dialog, puzzle and sign-in deal. Covers animation principles (squash and stretch, anticipation, staging, arcs, secondary action, timing, exaggeration, depth, appeal) and UX laws (Fitts, Hick, Miller, Doherty, Postel, Jakob) as they apply to this game.
---

# Big 2 motion

Motion in this app explains what just happened at the table: who played, who passed, who won the trick, whose turn it is, why a move was refused. It is never decoration. The visual world is Swiss brutal (paper, ink, 3px rules, hard offset shadows, one accent), so motion is short, hard and decisive: things snap, slam and stamp. They do not float, wobble or bounce.

The table layout is settled. Motion is welcome on it; layout changes are not, unless the user asks.

## Tokens

Use these values. If a new value seems needed, say why in the commit.

| Token | Value | Use |
|---|---|---|
| feedback | 120ms | press, hover lift, toggles |
| state | 150ms | card raise on select, colour changes |
| reveal | 220ms | inline messages, stamps, fields opening |
| sweep | 300ms | trick leaving the table, hand closing gaps, sort reorder |
| land | 420ms | cards travelling to the table |
| deal | 640ms | cards dealt at the start (the one authored entrance) |
| beat | 600ms | hold after the last card before the result appears |
| stagger | 50ms per card | multi-card plays; cap the total at 250ms |
| ease out | `cubic-bezier(0.16, 1, 0.3, 1)` | arrivals and everything by default |
| ease in | `cubic-bezier(0.7, 0, 0.84, 0)` | exits (trick sweep); exits are faster than entrances |

No `bounce`, `elastic` or spring overshoot curves. Overshoot, when wanted, is an explicit keyframe of at most 4% scale (see squash).

Keyframes live in `web/src/app/globals.css`. Components use them through Tailwind arbitrary animations, e.g. `motion-safe:animate-[land_420ms_cubic-bezier(0.16,1,0.3,1)_both]`.

## Principles mapped to game moments

| Principle | Where it lives in Big 2 | How |
|---|---|---|
| Squash and stretch | Card landing on the trick; cards-left numeral dropping | Final keyframes scale 1.04 then 0.98 then 1. Never on text other than the big numerals |
| Anticipation | Bot about to play | The bot's seat pulses (shadow offset grows and returns) from the moment its turn starts, not when the delay ends |
| Staging | Whose turn, what is on the table | One focal thing at a time: the acting seat is accent and raised, the trick is the stage. Do not animate two areas at once |
| Pose to pose | Every travel | Define the start pose (seat position, rotation) and end pose (slot on table). Let CSS fill the middle |
| Arcs | Cards travelling from a seat | Add a midpoint keyframe offset perpendicular to the path, so cards curve in rather than slide |
| Secondary action | Seat that just played; hand after a play | Seat shadow kicks out and back; remaining hand cards close the gap (FLIP) |
| Timing | Everything | Use the token table. Long feedback reads as lag |
| Exaggeration | PASS, illegal move, win | PASS stamp scales in from 1.3; illegal move shakes the selected cards 4px for 180ms with the reason in text; a win slams the winner's count to 00 |
| Depth (solid drawing) | Drag, flight, hover | Depth comes only from the hard shadow offset (4px rest, 6 to 8px lifted, 0px pressed). No perspective, no 3D flips, no blur shadows |
| Appeal | Deal, ending | The deal and the ending are the two authored moments. Everything else stays quick |

## UX laws checklist

- **Fitts:** PLAY and PASS are the largest targets and within thumb reach on phones (bottom of the screen below 1024px). Touch targets at least 44px tall.
- **Hick:** on a turn, PLAY and PASS carry the visual weight; sorting and tools are quieter.
- **Miller:** group controls into at most 4 per cluster. Spell names rather than one-letter codes.
- **Doherty:** something visible changes within 100ms of every action and within 400ms of a bot turn starting.
- **Postel:** accept the attempt, then explain. An illegal PLAY is pressable when cards are selected; it refuses with a shake and a reason.
- **Jakob:** keep card-game conventions: tap raises a card, selected cards sit higher, played cards fly to the middle, the hand closes up.

## Rules

1. Animate `transform`, `translate`, `scale`, `rotate`, `opacity`, `box-shadow` and colour. Never `width`, `height`, `top`, `left` or margins; use FLIP for layout moves.
2. Every keyframe animation goes through `motion-safe:`. Every transition that moves something has a reduced-motion path: keep colour and opacity changes, drop the movement. Feedback must still be legible with reduced motion (a stamp can appear without scaling).
3. Content is visible in the default state. Animations use `both` fill only for entrances that start hidden for at most their own duration.
4. Re-key an element to replay an entrance (the trick row is keyed by play index). Do not replay entrances on unrelated re-renders.
5. Pair every animated game event with text in the `aria-live` game log, so motion is never the only signal.
6. Exits are shorter than entrances and use ease in.

## Common mistakes

- Starting "thinking" feedback after the bot delay instead of when the turn begins.
- Unmounting something the instant its state ends, so its exit (trick sweep, last card landing) never shows. Keep the previous state for the exit duration.
- Showing an overlay on top of a motion that is still running (result dialog over the final landing).
- Gating keyframes with `motion-safe:` but leaving `transition-[translate]` moving under reduced motion.
- Adding a spring library for an effect a keyframe can do.

## Verify

- Play a full game vs bots on FAST and SLOW at desktop and 390px width.
- Toggle reduced motion (DevTools Rendering panel, "prefers-reduced-motion: reduce") and confirm every event is still visible and announced.
- Interrupt: restart mid-animation, play during a sweep, sort during a play. Nothing sticks half-way.
