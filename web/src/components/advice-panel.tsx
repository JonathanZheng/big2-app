import { CardRow } from "@/components/card";
import type { Card } from "@/lib/engine/cards";
import type { Advice } from "@/lib/model/advice";

export type AdviceStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; advice: Advice[] };

const formatEval = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

/** The evaluation bar and every option, best first. */
export function AdvicePanel({ status, onPick }: { status: AdviceStatus; onPick: (cards: Card[]) => void }) {
  if (status.kind === "idle") {
    return <p className="p-4 font-mono text-sm">PRESS HINT (H) ON YOUR TURN TO SEE THE BEST MOVES.</p>;
  }
  if (status.kind === "loading") return <p className="p-4 font-mono text-sm">THINKING...</p>;
  if (status.kind === "error") return <p className="p-4 font-mono text-sm">{status.message}</p>;

  const top = status.advice[0]?.evaluation ?? 0;
  const fill = Math.round(((top + 10) / 20) * 100);
  return (
    <div className="flex flex-col">
      <div className="p-4 border-b-3 border-ink flex flex-col gap-2">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-extrabold">EVALUATION</span>
          <span className="font-mono text-2xl font-semibold">{formatEval(top)}</span>
        </div>
        <div className="h-4 border-3 border-ink bg-paper relative" aria-hidden>
          <div className="h-full bg-ink" style={{ width: `${fill}%` }} />
          <div className="absolute inset-y-0 left-1/2 w-0.5 bg-accent" />
        </div>
        <p className="font-mono text-[11px] leading-snug">
          0 IS EVEN. PLUS IS BETTER THAN EVEN, MINUS IS WORSE. ASSUMES THE OTHERS PLAY AS WELL AS THE BOT.
        </p>
      </div>
      <ol className="flex flex-col">
        {status.advice.map((a, i) => (
          <li key={a.cards.join(",") || "pass"}>
            <button
              type="button"
              onClick={() => onPick(a.cards)}
              className={`w-full grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 border-b-2 border-ink text-left hover:bg-paper ${
                i === 0 ? "bg-accent hover:bg-accent" : "bg-card"
              }`}
            >
              <span className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold">{a.label.toUpperCase()}</span>
                {a.cards.length > 0 ? <CardRow cards={a.cards} size="sm" /> : <span className="font-black">PASS</span>}
              </span>
              <span className="font-mono text-sm">{a.evaluation === null ? "" : formatEval(a.evaluation)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
