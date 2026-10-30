import Link from "next/link";
import { MODES } from "@/lib/modes";

export default function Home() {
  return (
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
  );
}
