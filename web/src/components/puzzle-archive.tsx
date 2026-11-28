"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { subscribeHistory } from "@/lib/account/store";
import { type PuzzleResult, archiveDays, dayKey, parseDay, readResults } from "@/lib/puzzle/puzzle";

const button = "border-3 border-ink font-extrabold";
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Status = "solved" | "late" | "missed" | "open";

const STATUS: Record<Status, { label: string; cell: string }> = {
  open: { label: "TO PLAY", cell: "bg-card shadow-brutal-sm" },
  solved: { label: "SOLVED", cell: "bg-accent" },
  late: { label: "SOLVED LATE", cell: "bg-accent" },
  missed: { label: "NOT SOLVED", cell: "bg-paper opacity-60" },
};

function statusOf(result: PuzzleResult | undefined): Status {
  if (!result) return "open";
  if (result.label !== "Best") return "missed";
  return result.late ? "late" : "solved";
}

/** Past daily puzzles by month, newest first, each day marked by how it went. */
export function PuzzleArchive() {
  const resultsRaw = useSyncExternalStore(subscribeHistory, () => JSON.stringify(readResults()), () => null);
  // The day is read on the client only; the page is prerendered without it.
  const day = useSyncExternalStore(subscribeHistory, () => dayKey(new Date()), () => null);

  const months = useMemo(() => {
    if (day === null) return [];
    const byMonth = new Map<string, string[]>();
    for (const d of archiveDays(parseDay(day)!)) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
    return [...byMonth.entries()];
  }, [day]);

  if (resultsRaw === null || day === null) return <p className="font-mono text-sm">LOADING THE ARCHIVE...</p>;
  const results = JSON.parse(resultsRaw) as Record<string, PuzzleResult>;
  const days = months.flatMap(([, ds]) => ds);
  const open = days.filter((d) => !results[d]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-5xl font-black tracking-tight leading-none">PUZZLE ARCHIVE</h1>
          <p className="font-mono text-xs max-w-xl">
            EVERY PAST DAILY PUZZLE. ONE TRY EACH. A LATE SOLVE COUNTS AS SOLVED, BUT NOT TOWARDS YOUR STREAK.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/puzzle" className={`${button} px-4 py-3 bg-card shadow-brutal-sm`}>TODAY&apos;S PUZZLE</Link>
          {open.length > 0 && (
            <Link href={`/puzzle?day=${open[0]}`} className={`${button} px-4 py-3 bg-accent shadow-brutal-sm`}>
              PLAY THE NEWEST MISSED ONE
            </Link>
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="border-3 border-ink bg-card p-5 font-mono text-sm shadow-brutal">
          NO PAST PUZZLES YET. COME BACK TOMORROW, OR PLAY TODAY&apos;S.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <p className="font-mono text-sm">
              {open.length === 0 ? "YOU HAVE PLAYED EVERY PUZZLE IN THE ARCHIVE." : `${open.length} OF ${days.length} STILL TO PLAY.`}
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px]" aria-label="Key">
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span aria-hidden className={`w-5 h-5 border-2 border-ink flex items-center justify-center text-[9px] font-bold ${STATUS[s].cell}`}>
                    {s === "late" ? "L" : ""}
                  </span>
                  {STATUS[s].label}
                </li>
              ))}
            </ul>
          </div>
          {months.map(([month, ds]) => <Month key={month} month={month} days={ds} results={results} />)}
        </>
      )}
    </div>
  );
}

function Month({ month, days, results }: { month: string; days: string[]; results: Record<string, PuzzleResult> }) {
  const [y, m] = month.split("-").map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
  const inArchive = new Set(days);
  // Monday-first grid with blanks before the 1st.
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const length = new Date(y, m, 0).getDate();
  const all = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => dayKey(new Date(y, m - 1, i + 1)))];
  // Only the weeks with a puzzle to open, so the launch month is not a page of greyed-out days.
  const cells = Array.from({ length: Math.ceil(all.length / 7) }, (_, w) => all.slice(w * 7, w * 7 + 7))
    .filter((week) => week.some((d) => d !== null && inArchive.has(d)))
    .flat();

  return (
    <section className="border-3 border-ink bg-card p-5 shadow-brutal flex flex-col gap-4">
      <h2 className="text-sm font-extrabold">{title}</h2>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 max-w-2xl">
        {WEEKDAYS.map((w) => <span key={w} className="font-mono text-[10px] sm:text-[11px] text-center">{w}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`blank-${i}`} />;
          const n = Number(d.slice(8));
          // Days outside the archive: before launch, today and later.
          if (!inArchive.has(d)) return <span key={d} className="aspect-square p-1.5 font-mono text-xs opacity-30">{n}</span>;
          const status = statusOf(results[d]);
          const date = parseDay(d)!.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
          return (
            <Link key={d} href={`/puzzle?day=${d}`} aria-label={`${date}: ${STATUS[status].label.toLowerCase()}`}
              className={`aspect-square border-2 border-ink p-1.5 flex flex-col justify-between motion-safe:transition-transform hover:-translate-y-0.5 ${STATUS[status].cell}`}>
              <span className="font-black text-sm sm:text-base leading-none">{n}</span>
              {status === "late" && <span className="font-mono text-[9px] sm:text-[10px] leading-none">LATE</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
