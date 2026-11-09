"use client";

import { useEffect } from "react";
import { QUEUE_EVENT, readAccount } from "@/lib/account/store";
import { flushAccount, handleAuthChange } from "@/lib/account/sync";
import { onlineClient } from "@/lib/online/client";

/** Keeps the browser's copy of account history in step with sign-in, and sends queued changes. */
export function AccountSync() {
  useEffect(() => {
    const supabase = onlineClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(handleAuthChange);
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
