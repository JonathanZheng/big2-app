/**
 * House rules: the choices tables disagree on. A game without `rules` plays
 * the standard rules, the ones the model was trained on.
 */
import type { Play } from "./game";

export interface Rules {
  /** "three": the opening play must include the 3♦. "any": the 3♦ holder may lead anything. */
  opening: "three" | "any";
  /** "rank": flushes compare by highest card, then its suit. "suit": by suit, then highest card. */
  flush: "rank" | "suit";
  /** "rejoin": a player who passes may play later in the trick. "out": they pass until the trick ends. */
  pass: "rejoin" | "out";
}

export const STANDARD_RULES: Rules = { opening: "three", flush: "rank", pass: "rejoin" };

/**
 * Every choice, in the words the setup screens show. The first option is the
 * standard one; `tag` names the other in the game header.
 */
export const RULE_CHOICES: { key: keyof Rules; label: string; tag: string; options: { value: string; label: string }[] }[] = [
  {
    key: "opening", label: "OPENING PLAY", tag: "ANY OPENING",
    options: [{ value: "three", label: "MUST INCLUDE 3♦" }, { value: "any", label: "ANY PLAY" }],
  },
  {
    key: "flush", label: "FLUSHES", tag: "FLUSH BY SUIT",
    options: [{ value: "rank", label: "HIGHEST CARD FIRST" }, { value: "suit", label: "SUIT FIRST" }],
  },
  {
    key: "pass", label: "AFTER A PASS", tag: "PASS AND STAY OUT",
    options: [{ value: "rejoin", label: "CAN PLAY AGAIN" }, { value: "out", label: "OUT UNTIL THE TRICK ENDS" }],
  },
];

/** Short names of the house rules in play, empty for the standard rules. */
export function houseRuleTags(rules: Rules): string[] {
  return RULE_CHOICES.filter(({ key }) => rules[key] !== STANDARD_RULES[key]).map((c) => c.tag);
}

export function rulesOf(state: { rules?: Rules }): Rules {
  return state.rules ?? STANDARD_RULES;
}

export function isStandard(rules: Rules): boolean {
  return RULE_CHOICES.every(({ key }) => rules[key] === STANDARD_RULES[key]);
}

/** The rules in `value`, or null when it is not a complete, known set of choices. */
export function parseRules(value: unknown): Rules | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const ok = RULE_CHOICES.every(({ key, options }) => options.some((o) => o.value === v[key]));
  return ok ? { opening: v.opening, flush: v.flush, pass: v.pass } as Rules : null;
}

/** Whether `player` must pass because they passed earlier in this trick under the pass and stay out rule. */
export function isOut(state: { history: Play[]; lastPlay: Play | null; rules?: Rules }, player: number): boolean {
  return rulesOf(state).pass === "out" && state.lastPlay !== null && passedThisTrick(state).includes(player);
}

/** Seats that have passed since the current trick started, in seat order. */
export function passedThisTrick(state: { history: Play[] }): number[] {
  const passed = new Set<number>();
  let passes = 0;
  for (const play of state.history) {
    if (play.cards.length > 0) {
      passes = 0;
      continue;
    }
    passes += 1;
    passed.add(play.player);
    // Three passes in a row end the trick, as in applyMove.
    if (passes >= 3) {
      passed.clear();
      passes = 0;
    }
  }
  return [...passed].sort((a, b) => a - b);
}
