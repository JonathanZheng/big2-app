"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODES } from "@/lib/modes";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="w-full max-w-7xl mx-auto px-4 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4 py-5 border-b-4 border-ink">
        <Link href="/" className="text-5xl font-black tracking-tighter leading-none">
          BIG 2
        </Link>
        <nav aria-label="Pages" className="w-full sm:w-auto grid grid-cols-4 sm:flex border-3 border-ink">
          {[...MODES, { href: "/profile", label: "PROFILE" }].map((page, i) => {
            const active = pathname.startsWith(page.href);
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-center text-center px-2 sm:px-4 py-3 text-xs sm:text-sm font-extrabold leading-tight ${i > 0 ? "border-l-3 border-ink" : ""} ${
                  active ? "bg-accent" : "bg-paper hover:bg-card"
                }`}
              >
                {page.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
