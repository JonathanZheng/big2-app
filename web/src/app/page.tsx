import Link from "next/link";
import { MODES } from "@/lib/modes";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        {MODES.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="flex flex-col gap-10 justify-between border-3 border-ink bg-card p-6 shadow-brutal transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
          >
            <h2 className="text-4xl font-black tracking-tight leading-none">{mode.label}</h2>
            <p className="font-mono text-sm leading-relaxed">{mode.summary}</p>
          </Link>
        ))}
      </div>
      <Link
        href="/rules"
        className="flex flex-wrap items-center justify-between gap-3 border-3 border-ink bg-ink text-paper p-5 shadow-brutal hover:-translate-x-0.5 hover:-translate-y-0.5 transition-transform"
      >
        <span className="text-2xl font-black tracking-tight">NEW TO BIG 2? READ THE RULES</span>
        <span className="font-mono text-xs">CARD ORDER, STRAIGHTS, AND HOW TO READ THE BOT</span>
      </Link>
    </div>
  );
}
