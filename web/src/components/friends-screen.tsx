"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { GameScreen } from "@/components/game-screen";
import { OnlineScreen } from "@/components/online-screen";

/** Vs friends: one device passed around, or online rooms. A room link opens the online tab. */
export function FriendsScreen() {
  const joinCode = useSearchParams().get("room");
  const [tab, setTab] = useState<"device" | "online">(joinCode ? "online" : "device");
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="How you are playing" className="flex self-start border-3 border-ink">
        {([["device", "ONE DEVICE"], ["online", "ONLINE"]] as const).map(([value, label], i) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`px-4 py-3 text-sm font-extrabold ${i > 0 ? "border-l-3 border-ink" : ""} ${tab === value ? "bg-accent" : "bg-paper hover:bg-card"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "device" ? <GameScreen mode="friends" /> : <OnlineScreen joinCode={joinCode} />}
    </div>
  );
}
