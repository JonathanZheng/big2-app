"use client";

import { useEffect } from "react";
import { MODEL } from "@/lib/model/current";

/** Registers the offline service worker in production builds only. It is told which model to keep offline. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?model=${MODEL}`, { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.error("Service worker failed to register", error);
    });
  }, []);
  return null;
}
