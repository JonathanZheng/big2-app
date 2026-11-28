import type { Metadata } from "next";
import { Suspense } from "react";
import { PuzzleScreen } from "@/components/puzzle-screen";

export const metadata: Metadata = {
  title: "Daily puzzle · Big 2",
  description: "A new Big 2 position every day. Find the bot's best move.",
};

export default function Page() {
  // A puzzle from the archive comes from the link (?day=), which is only known in the browser.
  return (
    <Suspense fallback={<p className="font-mono text-sm">LOADING THE PUZZLE...</p>}>
      <PuzzleScreen />
    </Suspense>
  );
}
