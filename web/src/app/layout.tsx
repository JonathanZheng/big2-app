import type { Metadata } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AccountSync } from "@/components/account-sync";
import { ServiceWorker } from "@/components/service-worker";
import { SiteHeader } from "@/components/site-header";
import { ACCENT_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "600", "800", "900"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Big 2",
  description: "Play Big 2 against a trained bot, with friends, or ask the bot for the best move.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
      // The saved accent is set on <html> before React loads.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ServiceWorker />
        <AccountSync />
        <SiteHeader />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-10 py-8">
          {children}
        </main>
        <footer className="w-full max-w-7xl mx-auto px-4 sm:px-10 pb-8">
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t-4 border-ink pt-4 font-mono text-xs">
            <Link href="/puzzle" className="font-semibold underline underline-offset-4">DAILY PUZZLE</Link>
            <Link href="/rules" className="font-semibold underline underline-offset-4">RULES AND HOW TO READ THE BOT</Link>
            <Link href="/profile" className="font-semibold underline underline-offset-4">PROFILE</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
