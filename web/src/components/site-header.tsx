"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAccount } from "@/components/account-panel";
import { MODES } from "@/lib/modes";
import { onlineClient } from "@/lib/online/client";

/** SIGN IN when signed out, the player's name when signed in; nothing on a site without accounts. */
function AccountLink({ pathname }: { pathname: string }) {
  const [account, refresh] = useAccount();
  // A name chosen on another page shows up after the next navigation.
  useEffect(() => refresh(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!onlineClient() || account === undefined) return null;
  const box = "flex items-center gap-2.5 border-3 border-ink text-xs sm:text-sm font-extrabold leading-tight shadow-brutal-sm";
  if (!account) {
    return (
      <Link href="/signin" aria-current={pathname === "/signin" ? "page" : undefined}
        className={`${box} px-4 py-3 ${pathname === "/signin" ? "bg-accent" : "bg-ink text-paper"}`}>
        SIGN IN
      </Link>
    );
  }
  const name = (account.name ?? "ACCOUNT").toUpperCase();
  return (
    <Link href="/profile" aria-label={`Account: ${account.name ?? "choose a display name"}`} className={`${box} bg-card py-1 pl-1 pr-3.5`}>
      <span aria-hidden className="size-8 flex items-center justify-center bg-accent border-2 border-ink font-black text-[15px]">{name[0]}</span>
      <span className="max-w-[12ch] truncate">{name}</span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="w-full max-w-7xl mx-auto px-4 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4 py-5 border-b-4 border-ink">
        <Link href="/" className="text-5xl font-black tracking-tighter leading-none">
          BIG 2
        </Link>
        <div className="w-full sm:w-auto flex flex-wrap items-center gap-3">
          <nav aria-label="Pages" className="flex-1 sm:flex-none grid grid-cols-4 sm:flex border-3 border-ink">
            {[...MODES, { href: "/profile", label: "PROFILE" }].map((page, i) => {
              const active = pathname.startsWith(page.href);
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-center text-center px-2 sm:px-4 py-3 text-xs sm:text-sm font-extrabold leading-tight transition-colors duration-150 ${i > 0 ? "border-l-3 border-ink" : ""} ${
                    active ? "bg-accent" : "bg-paper hover:bg-accent"
                  }`}
                >
                  {page.label}
                </Link>
              );
            })}
          </nav>
          <AccountLink pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
