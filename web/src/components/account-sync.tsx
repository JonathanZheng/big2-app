"use client";

import { useEffect } from "react";
import { QUEUE_EVENT, readAccount, writeAccount } from "@/lib/account/store";
import { flushAccount, syncAccount } from "@/lib/account/sync";
import { onlineClient } from "@/lib/online/client";

/** Keeps the browser's copy of account history in step with sign-in, and sends queued changes. */
export function AccountSync() {
  useEffect(() => {
    const supabase = onlineClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) writeAccount(null);
      // Deferred: Supabase must not be called from inside its own auth callback.
      else if (event === "INITIAL_SESSION" || event === "SIGNED_IN") setTimeout(() => void syncAccount(session.user.id), 0);
    });
    const flush = () => {
      const userId = readAccount()?.userId;
      if (userId) void flushAccount(userId);
    };
    window.addEventListener("online", flush);
    window.addEventListener(QUEUE_EVENT, flush);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("online", flush);
      window.removeEventListener(QUEUE_EVENT, flush);
    };
  }, []);
  return null;
}
