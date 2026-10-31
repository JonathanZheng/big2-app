"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { callOnline, onlineClient } from "@/lib/online/client";

const button = "border-3 border-ink font-extrabold disabled:opacity-40 disabled:cursor-not-allowed";
const input = "border-3 border-ink bg-card px-3 py-2 font-mono text-base min-h-11";

export interface Account {
  session: Session;
  name: string | null;
}

/** The signed-in account, kept up to date. `undefined` while loading, null when signed out. */
export function useAccount(): [Account | null | undefined, () => void] {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const supabase = onlineClient();
    if (!supabase) {
      queueMicrotask(() => setAccount(null));
      return;
    }
    let cancelled = false;
    const load = async (session: Session | null) => {
      if (!session) return !cancelled && setAccount(null);
      const { data } = await supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle();
      if (!cancelled) setAccount({ session, name: (data as { display_name: string } | null)?.display_name ?? null });
    };
    void supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => void load(session));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [version]);
  return [account, () => setVersion((v) => v + 1)];
}

/** Sign in with an emailed 6-digit code, then choose a display name. */
export function SignIn({ account, onChange }: { account: Account | null; onChange: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = onlineClient();
  if (!supabase) return <p className="font-mono text-sm">ONLINE PLAY IS NOT SET UP ON THIS SITE YET.</p>;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (account && account.name === null) {
    return (
      <form className="flex flex-col gap-3 max-w-md" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => { await callOnline("name", { name }); onChange(); });
      }}>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-extrabold">CHOOSE A DISPLAY NAME</span>
          <input className={input} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className={`${button} self-start px-5 py-3 bg-accent shadow-brutal-sm`}>SAVE</button>
        {message && <p className="font-mono text-sm">{message}</p>}
      </form>
    );
  }

  return step === "email" ? (
    <form className="flex flex-col gap-3 max-w-md" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
        if (error) throw error;
        setStep("code");
      });
    }}>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-extrabold">SIGN IN WITH YOUR EMAIL</span>
        <input className={input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <p className="font-mono text-xs">WE EMAIL YOU A 6-DIGIT CODE. NO PASSWORD NEEDED.</p>
      <button type="submit" disabled={busy} className={`${button} self-start px-5 py-3 bg-accent shadow-brutal-sm`}>SEND CODE</button>
      {message && <p className="font-mono text-sm">{message}</p>}
    </form>
  ) : (
    <form className="flex flex-col gap-3 max-w-md" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
        if (error) throw error;
        onChange();
      });
    }}>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-extrabold">ENTER THE CODE SENT TO {email.toUpperCase()}</span>
        <input className={`${input} tracking-[0.4em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || code.length !== 6} className={`${button} px-5 py-3 bg-accent shadow-brutal-sm`}>SIGN IN</button>
        <button type="button" onClick={() => { setStep("email"); setCode(""); }} className={`${button} px-5 py-3 bg-card shadow-brutal-sm`}>USE ANOTHER EMAIL</button>
      </div>
      {message && <p className="font-mono text-sm">{message}</p>}
    </form>
  );
}
