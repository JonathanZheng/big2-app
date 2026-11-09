"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignIn, useAccount } from "@/components/account-panel";
import { signOutAccount } from "@/lib/account/sync";
import { onlineClient } from "@/lib/online/client";

const button = "border-3 border-ink font-extrabold";

interface OnlineStats { games: number; wins: number; matches: number; match_wins: number }

/** Sign in or out, and the online stats that follow your account. */
export function AccountSection() {
  const [account, refresh] = useAccount();
  const [stats, setStats] = useState<OnlineStats | null>(null);
  const supabase = onlineClient();

  useEffect(() => {
    if (!supabase || !account) return;
    let cancelled = false;
    void supabase.from("player_stats").select("games, wins, matches, match_wins").eq("user_id", account.session.user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setStats((data as OnlineStats | null) ?? { games: 0, wins: 0, matches: 0, match_wins: 0 }); });
    return () => { cancelled = true; };
  }, [account, supabase]);

  if (!supabase) return <p className="font-mono text-sm">ACCOUNTS ARE NOT SET UP ON THIS SITE YET. YOUR STATS STAY IN THIS BROWSER.</p>;
  if (account === undefined) return <p className="font-mono text-sm">CHECKING YOUR SIGN-IN...</p>;
  if (account === null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-sm max-w-[52ch]">PLAYING AS A GUEST. SIGN IN TO KEEP THESE STATS ON EVERY DEVICE.</p>
        <Link href="/signin" className={`${button} px-4 py-3 bg-accent shadow-brutal-sm text-sm`}>SIGN IN OR CREATE ACCOUNT</Link>
      </div>
    );
  }
  if (account.name === null) return <SignIn account={account} onChange={refresh} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm">SIGNED IN AS <strong>{account.name.toUpperCase()}</strong> ({account.session.user.email})</p>
        <button type="button" onClick={() => void signOutAccount().then(refresh)} className={`${button} px-3 py-2 bg-card shadow-brutal-sm text-xs`}>SIGN OUT</button>
      </div>
      {stats && (
        <p className="font-mono text-sm">
          ONLINE: {stats.wins} {stats.wins === 1 ? "WIN" : "WINS"} FROM {stats.games} {stats.games === 1 ? "GAME" : "GAMES"} ·{" "}
          {stats.match_wins} {stats.match_wins === 1 ? "MATCH" : "MATCHES"} WON OF {stats.matches}
        </p>
      )}
    </div>
  );
}
