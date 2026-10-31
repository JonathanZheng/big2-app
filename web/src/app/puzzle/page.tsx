import type { Metadata } from "next";
import { PuzzleScreen } from "@/components/puzzle-screen";

export const metadata: Metadata = {
  title: "Daily puzzle · Big 2",
  description: "A new Big 2 position every day. Find the bot's best move.",
};

export default function Page() {
  return <PuzzleScreen />;
}
