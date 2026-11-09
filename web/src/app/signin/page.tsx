import type { Metadata } from "next";
import { SignInScreen } from "@/components/sign-in-screen";

export const metadata: Metadata = {
  title: "Sign in · Big 2",
  description: "Sign in or create an account to keep your Big 2 games, reviews and puzzle streak on every device.",
};

export default function Page() {
  return <SignInScreen />;
}
