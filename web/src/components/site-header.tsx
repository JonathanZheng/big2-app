"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODES } from "@/lib/modes";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="w-full max-w-6xl mx-auto px-4 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4 py-5 border-b-4 border-ink">
        <Link href="/" className="text-5xl font-black tracking-tighter leading-none">
          BIG 2
        </Link>
        <nav aria-label="Modes" className="flex border-3 border-ink">
          {MODES.map((mode, i) => {
            const active = pathname.startsWith(mode.href);
            return (
              <Link
                key={mode.href}
                href={mode.href}
                aria-current={active ? "page" : undefined}
                className={`px-4 py-3 text-sm font-extrabold ${i > 0 ? "border-l-3 border-ink" : ""} ${active ? "bg-accent" : "bg-paper hover:bg-card"}`}
              >
                {mode.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
