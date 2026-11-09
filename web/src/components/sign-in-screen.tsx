"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignIn, useAccount } from "@/components/account-panel";
import { CardFace } from "@/components/card";
import { parseCards } from "@/lib/engine/cards";
import { callOnline, onlineClient } from "@/lib/online/client";
import { authErrorMessage, checkSignUp } from "@/lib/online/auth-messages";

const label = "font-extrabold text-sm";
const field = "h-13 border-3 border-ink bg-card px-3.5 font-mono text-base text-ink focus:outline-3 focus:outline-accent focus:outline-offset-2";
const note = "font-mono text-[13px] leading-relaxed text-ink/80";
const FAN = parseCards("Ah 2d 2s");

type Mode = "signin" | "create" | "code";

/** Sign in or create an account with email and password; an emailed code is the fallback. */
export function SignInScreen() {
  const router = useRouter();
  const [account, refresh] = useAccount();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = onlineClient();

  // Signed in with a name, whether just now or before: go home.
  useEffect(() => {
    if (account?.name) router.replace("/");
  }, [account, router]);

  if (!supabase) return <p className="font-mono text-sm">ACCOUNTS ARE NOT SET UP ON THIS SITE YET. YOUR STATS STAY IN THIS BROWSER.</p>;

  function choose(next: Mode) {
    setMode(next);
    setMessage(null);
  }

  async function submit() {
    if (!supabase) return;
    setMessage(null);
    if (mode === "create") {
      const problem = checkSignUp({ name, email, password });
      if (problem) return setMessage(problem);
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return setMessage(authErrorMessage(error));
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) return setMessage(authErrorMessage(error));
        if (!data.session) return setMessage("CHECK YOUR EMAIL TO CONFIRM YOUR ACCOUNT, THEN SIGN IN HERE.");
        await callOnline("name", { name: name.trim() });
      }
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message.toUpperCase() : String(error));
    } finally {
      setBusy(false);
    }
  }

  const tab = (value: Mode, text: string) => (
    <button type="button" role="tab" aria-selected={mode === value} onClick={() => choose(value)}
      className={`-mb-[3px] pb-3 text-2xl sm:text-[28px] font-black tracking-tight border-b-6 transition-colors duration-200 ${
        mode === value ? "border-accent text-ink" : "border-transparent text-ink/60 hover:text-ink hover:border-accent/40"
      }`}>
      {text}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-12 items-start py-6">
      <section aria-label="Account form" className="flex-[1_1_460px] min-w-0 border-3 border-ink bg-card shadow-brutal p-6 sm:p-10 flex flex-col gap-7">
        <div role="tablist" aria-label="Sign in or create an account" className="flex flex-wrap gap-7 border-b-3 border-ink">
          {tab("signin", "SIGN IN")}
          {tab("create", "CREATE ACCOUNT")}
        </div>

        {mode === "code" ? (
          <div className="flex flex-col gap-4">
            <SignIn account={account ?? null} onChange={refresh} />
            <button type="button" onClick={() => choose("signin")} className="self-start font-mono text-[13px] font-semibold underline underline-offset-4 decoration-1 hover:decoration-3">
              USE A PASSWORD INSTEAD
            </button>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {mode === "create" && (
              <label className="flex flex-col gap-2 motion-safe:animate-[reveal_220ms_cubic-bezier(0.16,1,0.3,1)]">
                <span className={label}>DISPLAY NAME</span>
                <input className={field} autoComplete="nickname" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} required />
                <span className={note}>SHOWN TO FRIENDS IN ONLINE GAMES. UP TO 20 LETTERS.</span>
              </label>
            )}
            <label className="flex flex-col gap-2">
              <span className={label}>EMAIL</span>
              <input className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className={label}>PASSWORD</label>
              <div className="flex border-3 border-ink bg-card focus-within:outline-3 focus-within:outline-accent focus-within:outline-offset-2">
                <input id="password" className="flex-1 min-w-0 h-[46px] px-3.5 font-mono text-base bg-card text-ink focus:outline-none"
                  type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShowPassword((s) => !s)} aria-pressed={showPassword} aria-controls="password"
                  className="min-w-19 border-l-3 border-ink bg-paper text-[13px] font-extrabold transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                  {showPassword ? "HIDE" : "SHOW"}
                </button>
              </div>
              {mode === "create" && <span className={note}>AT LEAST 8 CHARACTERS.</span>}
            </div>
            {message && (
              <p role="alert" className="flex gap-3 items-start bg-ink text-paper px-4 py-3.5 font-mono text-sm leading-relaxed motion-safe:animate-[reveal_220ms_cubic-bezier(0.16,1,0.3,1)]">
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="shrink-0 mt-px text-accent">
                  <rect x="1.5" y="1.5" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="3" />
                  <path d="M10 5.5v6M10 13.5v2" stroke="currentColor" strokeWidth="3" />
                </svg>
                <span>{message}</span>
              </p>
            )}
            <button type="submit" disabled={busy}
              className="h-14 border-3 border-ink bg-accent text-lg font-black shadow-brutal-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? "ONE MOMENT..." : mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
            </button>
          </form>
        )}

        {mode !== "code" && (
          <>
            <div className="flex items-center gap-3.5 font-mono text-[13px] text-ink/80">
              <span className="flex-1 h-[3px] bg-ink" /><span>OR</span><span className="flex-1 h-[3px] bg-ink" />
            </div>
            <button type="button" onClick={() => choose("code")} className="h-13 border-3 border-ink bg-card text-[15px] font-extrabold shadow-brutal-sm">
              EMAIL ME A SIGN-IN CODE INSTEAD
            </button>
          </>
        )}
      </section>

      <aside className="flex-[1_1_360px] min-w-0 flex flex-col gap-8 pt-2">
        <div aria-hidden className="relative h-44">
          {FAN.map((card, i) => (
            <span key={card} className="absolute motion-safe:animate-[deal_640ms_cubic-bezier(0.16,1,0.3,1)_both]"
              style={{ left: i * 84, top: [18, 6, 14][i], rotate: `${[-8, -1, 7][i]}deg`, animationDelay: `${i * 90}ms` }}>
              <CardFace card={card} selected={i === 2} className="w-27 h-[150px] shadow-brutal-sm" />
            </span>
          ))}
        </div>
        <h1 className="text-5xl sm:text-[56px] font-black leading-[0.95] tracking-[-0.035em] max-w-[12ch]">YOUR GAMES, ON EVERY DEVICE.</h1>
        <ul className="border-t-3 border-ink">
          {[
            ["VS BOTS STATS AND HISTORY", "LAST 500 GAMES"],
            ["SAVED REVIEWS", "UP TO 50"],
            ["DAILY PUZZLE STREAK", "EVERY DAY YOU PLAY"],
            ["ONLINE ROOMS WITH FRIENDS", "NEEDS AN ACCOUNT"],
          ].map(([what, detail]) => (
            <li key={what} className="flex justify-between gap-4 py-3.5 border-b-3 border-ink">
              <span className="font-extrabold">{what}</span>
              <span className="font-mono text-[13px] text-ink/80 text-right">{detail}</span>
            </li>
          ))}
        </ul>
        <p className="font-mono text-sm leading-relaxed max-w-[46ch]">
          NO ACCOUNT NEEDED TO PLAY. GAMES YOU PLAY AS A GUEST MOVE INTO YOUR ACCOUNT WHEN YOU SIGN IN.{" "}
          <Link href="/play" className="font-semibold underline underline-offset-4 decoration-1 hover:decoration-3">PLAY AS GUEST</Link>
        </p>
      </aside>
    </div>
  );
}
