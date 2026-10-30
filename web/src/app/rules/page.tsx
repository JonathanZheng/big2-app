import type { Metadata } from "next";
import Link from "next/link";
import { CardRow } from "@/components/card";
import { parseCards } from "@/lib/engine/cards";

export const metadata: Metadata = {
  title: "Rules · Big 2",
  description: "How to play Big 2 with the house rules this app uses, and how to read the bot's advice.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-3 border-ink bg-card p-5 sm:p-6 shadow-brutal flex flex-col gap-4">
      <h2 className="text-2xl font-black tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

const Example = ({ cards, label }: { cards: string; label: string }) => (
  <div className="flex flex-wrap items-center gap-3">
    <CardRow cards={parseCards(cards)} size="sm" />
    <span className="font-mono text-xs">{label}</span>
  </div>
);

export default function RulesPage() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h1 className="text-5xl font-black tracking-tight leading-none">RULES</h1>
      <p className="font-mono text-sm leading-relaxed">
        THE HOUSE RULES THIS APP AND ITS BOT PLAY BY, AND HOW TO READ THE BOT&apos;S ADVICE.
      </p>

      <Section title="THE AIM">
        <p>Four players get 13 cards each. Be the first to play every card in your hand.</p>
      </Section>

      <Section title="CARD ORDER">
        <p>Ranks from lowest to highest: 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2. The 2 is the highest card.</p>
        <p>When ranks tie, the suit decides: ♦ diamonds &lt; ♣ clubs &lt; ♥ hearts &lt; ♠ spades.</p>
        <Example cards="3d 3s 2d 2s" label="3♦ IS THE LOWEST CARD, 2♠ THE HIGHEST" />
      </Section>

      <Section title="WHAT YOU CAN PLAY">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><strong>Single:</strong> one card.</li>
          <li><strong>Pair:</strong> two cards of the same rank. The higher suit in the pair decides ties.</li>
          <li><strong>Triple:</strong> three cards of the same rank.</li>
          <li><strong>Five-card hand:</strong> one of the hands below.</li>
        </ul>
        <p>Five-card hands, lowest to highest:</p>
        <ol className="list-decimal pl-5 flex flex-col gap-1.5">
          <li><strong>Straight:</strong> five ranks in a row.</li>
          <li><strong>Flush:</strong> five cards of one suit, compared by the highest card.</li>
          <li><strong>Full house:</strong> a triple and a pair, compared by the triple.</li>
          <li><strong>Four of a kind plus one card,</strong> compared by the four.</li>
          <li><strong>Straight flush:</strong> a straight in one suit.</li>
        </ol>
        <Example cards="5d 5c 5s 9h 9s" label="FULL HOUSE" />
      </Section>

      <Section title="STRAIGHTS">
        <p>Lowest to highest:</p>
        <p className="font-mono text-sm">
          3-4-5-6-7 &lt; 4-5-6-7-8 &lt; ... &lt; 10-J-Q-K-A &lt; J-Q-K-A-2 &lt; 2-3-4-5-6 &lt; A-2-3-4-5
        </p>
        <p>
          Two straights of the same run are decided by the suit of the highest card, which is the 2 when the
          run has one. Straight flushes use the same order. Q-K-A-2-3 and K-A-2-3-4 are not straights.
        </p>
        <Example cards="Ad 2c 3h 4s 5d" label="A-2-3-4-5, THE HIGHEST STRAIGHT" />
      </Section>

      <Section title="HOW A GAME GOES">
        <ol className="list-decimal pl-5 flex flex-col gap-1.5">
          <li>Whoever holds the 3♦ starts, and their first move must include it. This is true for every game, including each game of a match.</li>
          <li>Play goes round the table. On your turn, beat the move on the table with the same number of cards, or pass.</li>
          <li>A five-card hand beats a lower kind of five-card hand. Otherwise moves must be the same kind: a pair only beats a pair.</li>
          <li>When the other three all pass, the trick is over and the last player to play leads anything they like.</li>
          <li>The first player out of cards wins. In a match, only wins are counted.</li>
        </ol>
      </Section>

      <Section title="THE BOT'S ADVICE">
        <p>
          <strong>Evaluation:</strong> one number for the position. 0 means even, the 1 in 4 chance everyone starts
          with. Plus is better than even and minus is worse. About ±1 is a small edge; ±5 or more is close to
          decided. It assumes the others play as well as the bot.
        </p>
        <p>
          <strong>Labels:</strong> each option is marked Best, Good, Inaccuracy, Mistake or Blunder by how much
          worse it is than the bot&apos;s top choice. Game reviews also show the bot&apos;s score for every move.
        </p>
      </Section>

      <Section title="CONTROLS">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Tap a card to raise or lower it. Slide across cards to pick several. Hold a card to drag it into your own order.</li>
          <li>Sort by rank, suit or combination, group cards you are saving, and undo a sort.</li>
          <li>Combos steps through the plays that include the card you last picked.</li>
        </ul>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-sm">
          <span className="font-semibold">ENTER</span><span>PLAY</span>
          <span className="font-semibold">P</span><span>PASS</span>
          <span className="font-semibold">C</span><span>COMBOS</span>
          <span className="font-semibold">H</span><span>HINT</span>
          <span className="font-semibold">S</span><span>NEXT SORT</span>
          <span className="font-semibold">← →</span><span>MOVE BETWEEN CARDS</span>
          <span className="font-semibold">SPACE</span><span>PICK A CARD</span>
        </div>
      </Section>

      <Link href="/play" className="self-start border-3 border-ink bg-accent px-6 py-3 font-extrabold shadow-brutal">
        PLAY VS BOTS
      </Link>
    </div>
  );
}
