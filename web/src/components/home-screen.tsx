"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { useAccount } from "@/components/account-panel";
import { readAccount, subscribeHistory } from "@/lib/account/store";
import { MODES } from "@/lib/modes";
import { onlineClient } from "@/lib/online/client";
import { dayKey, readResults } from "@/lib/puzzle/puzzle";
import { type GameRecord, readGameRecords, summarise } from "@/lib/session/profile";

const mono = "font-mono text-sm leading-relaxed";
const arrow = (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
    <path d="M3 11h15M12 5l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="3" />
  </svg>
);

// Read from storage on the client only; the page is prerendered without it.
const snapshot = () => JSON.stringify([readGameRecords(), !!readResults()[dayKey(new Date())], readAccount() !== null]);

/** The front page: what the app is, your record when you have one, and the ways to play. */
export function HomeScreen() {
  const [account] = useAccount();
  const raw = useSyncExternalStore(subscribeHistory, snapshot, () => null);
  const data = useMemo(() => {
    if (raw === null) return null;
    const [records, puzzleDone] = JSON.parse(raw) as [GameRecord[], boolean, boolean];
    return { profile: summarise(records), puzzleDone };
  }, [raw]);

  const p = data?.profile;
  const name = account?.name ?? null;
  const games = p?.games ?? 0;
  const last = p ? [...p.recent].reverse() : [];
  const [vsBots, ...others] = MODES;

  return (
    <div className="flex flex-col gap-10 pb-6">
      <section className="flex flex-wrap gap-8 items-stretch">
        <div className="flex-[1_1_520px] min-w-0 flex flex-col justify-between gap-7">
          <h1 className="text-5xl sm:text-7xl lg:text-[80px] font-black leading-[0.9] tracking-[-0.04em]">
            {name ? `BACK FOR GAME ${games + 1}, ${name.toUpperCase()}.` : "PLAY THE TRAINED BOT. THEN ASK IT WHY."}
          </h1>
          {!name && (
            <p className={`${mono} max-w-[52ch]`}>
              BIG 2 AGAINST BOTS, FRIENDS ON ONE DEVICE OR ONLINE, AND A BOT THAT RANKS EVERY MOVE YOU COULD HAVE MADE.
            </p>
          )}
          <Link href="/play" className="max-w-[460px] h-15 px-5 flex items-center justify-between border-3 border-ink bg-accent text-xl font-black shadow-brutal">
            {name ? "PLAY VS BOTS" : "START A GAME VS BOTS"}
            {arrow}
          </Link>
        </div>

        {name && p && games > 0 && (
          <section aria-label="Your record" className="flex-[0_1_400px] min-w-0 border-3 border-ink bg-card shadow-brutal p-6 flex flex-col gap-4">
            <div className="flex justify-between items-baseline gap-3">
              <h2 className="text-[22px] font-black">LAST {last.length} {last.length === 1 ? "GAME" : "GAMES"}</h2>
              <Link href="/profile" className="font-mono text-[13px] font-semibold underline underline-offset-4 decoration-1 hover:decoration-3">FULL PROFILE</Link>
            </div>
            <div role="img" aria-label={`Last ${last.length} games, oldest first: ${last.map((g) => (g.won ? "won" : "lost")).join(", ")}`}
              className="grid grid-cols-10 gap-1.5">
              {last.map((g) => (
                <span key={g.at} className={`h-9 border-3 border-ink ${g.won ? "bg-ink" : "bg-card"}`} />
              ))}
            </div>
            <p className="font-mono text-[13px] leading-relaxed text-ink/80">FILLED = WON. LATEST ON THE RIGHT.</p>
            <dl className="grid grid-cols-3 gap-3 border-t-3 border-ink pt-4">
              {[
                ["WON", `${p.wins} / ${games}`],
                ["HARD", `${p.byDifficulty.hard.wins} / ${p.byDifficulty.hard.games}`],
                ["BEST STREAK", String(p.bestStreak)],
              ].map(([term, value]) => (
                <div key={term} className="flex flex-col gap-1">
                  <dt className="font-mono text-xs text-ink/80">{term}</dt>
                  <dd className="text-2xl font-black tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </section>

      <section aria-label="Ways to play" className="grid gap-6 md:grid-cols-12">
        <Link href={vsBots.href} className="md:col-span-5 min-h-56 flex flex-col justify-between gap-6 p-7 border-3 border-ink bg-ink text-paper shadow-[6px_6px_0_var(--accent)] motion-safe:transition-[translate] motion-safe:duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5">
          <h2 className="text-[44px] font-black leading-[0.95] tracking-[-0.03em]">{vsBots.label}</h2>
          <span className="flex flex-col gap-2.5">
            <span className={`${mono} text-paper/90`}>YOU AGAINST THREE BOTS. EASY IS GREEDY, MEDIUM IS SMART, HARD IS THE TRAINED MODEL.</span>
            <span className="flex gap-2">
              {["EASY", "MEDIUM", "HARD"].map((d) => (
                <span key={d} className={`px-2.5 py-1.5 border-2 text-xs font-extrabold ${d === "HARD" ? "bg-accent text-ink border-accent" : "border-paper"}`}>{d}</span>
              ))}
            </span>
          </span>
        </Link>
        {others.map((mode, i) => (
          <Link key={mode.href} href={mode.href}
            className={`${i === 0 ? "md:col-span-4" : "md:col-span-3"} min-h-56 flex flex-col justify-between gap-6 p-7 border-3 border-ink bg-card shadow-brutal`}>
            <h2 className="text-[44px] font-black leading-[0.95] tracking-[-0.03em]">{mode.label}</h2>
            <span className={`${mono} text-ink/85`}>{mode.summary.toUpperCase()}</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-12">
        <Link href="/puzzle" className="md:col-span-7 flex flex-wrap items-center justify-between gap-4 px-7 py-5 border-3 border-ink bg-accent shadow-brutal">
          <span className="flex flex-col gap-1.5">
            <span className="text-[26px] font-black tracking-tight">DAILY PUZZLE</span>
            <span className="font-mono text-sm">
              {data?.puzzleDone ? "DONE FOR TODAY. A NEW ONE TOMORROW." : "ONE POSITION A DAY. FIND THE BOT'S BEST MOVE."}
            </span>
          </span>
          {!data?.puzzleDone && <span className="px-4 py-3 bg-ink text-paper text-sm font-extrabold">SOLVE IT</span>}
        </Link>
        <Link href="/rules" className="md:col-span-5 flex flex-wrap items-center justify-between gap-4 px-7 py-5 border-3 border-ink bg-card shadow-brutal">
          <span className="flex flex-col gap-1.5">
            <span className="text-[26px] font-black tracking-tight">NEW TO BIG 2?</span>
            <span className="font-mono text-sm">CARD ORDER, COMBOS, READING THE BOT.</span>
          </span>
          <span className="font-mono text-sm font-semibold">RULES</span>
        </Link>
      </section>

      {onlineClient() && account === null && (
        <section aria-label="Save your games" className="flex flex-wrap items-center justify-between gap-5 px-6 py-5 border-3 border-dashed border-ink">
          <p className={`${mono} flex-[1_1_420px]`}>
            {games > 0
              ? `YOU ARE PLAYING AS A GUEST. YOUR ${games} ${games === 1 ? "GAME IS" : "GAMES ARE"} SAVED IN THIS BROWSER ONLY. SIGN IN TO KEEP THEM ON EVERY DEVICE.`
              : "YOU ARE PLAYING AS A GUEST. SIGN IN TO KEEP YOUR GAMES ON EVERY DEVICE."}
          </p>
          <Link href="/signin" className="px-4.5 py-3 border-3 border-ink bg-card text-sm font-extrabold shadow-brutal-sm">SIGN IN OR CREATE ACCOUNT</Link>
        </section>
      )}
    </div>
  );
}
