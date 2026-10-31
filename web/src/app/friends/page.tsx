import { Suspense } from "react";
import { FriendsScreen } from "@/components/friends-screen";

export default function Page() {
  // The room code comes from the link, which is only known in the browser.
  return (
    <Suspense fallback={<p className="font-mono text-sm">LOADING...</p>}>
      <FriendsScreen />
    </Suspense>
  );
}
