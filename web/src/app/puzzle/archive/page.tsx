import type { Metadata } from "next";
import { PuzzleArchive } from "@/components/puzzle-archive";

export const metadata: Metadata = {
  title: "Puzzle archive · Big 2",
  description: "Every past Big 2 daily puzzle. Play the ones you missed.",
};

export default function Page() {
  return <PuzzleArchive />;
}
