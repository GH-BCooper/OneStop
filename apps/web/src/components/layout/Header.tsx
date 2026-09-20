"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { buttonClasses } from "@onestop/ui";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { ConnectionBadge } from "./ConnectionBadge";
import { Nav } from "./Nav";
import { ThemeToggle } from "./ThemeToggle";

function Wordmark() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 text-lg font-bold focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Image src="/images/Logo.png" alt="" width={32} height={32} className="rounded-md" priority />
      <span className="brand-gradient">OneStop</span>
    </Link>
  );
}

export function Header({ accountsEnabled = false }: { accountsEnabled?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  // A guest on an instance that genuinely has no accounts is not "signed out" - there is nothing to
  // sign in to, so that instance always gets the full nav (it always has, and hiding it would trap
  // every visitor with nothing but a dead "Sign in" button).
  const guestOnlyChrome = accountsEnabled && status !== "loading" && !session?.user;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (guestOnlyChrome) {
    return (
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Wordmark />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link href="/auth/login" className={buttonClasses("primary", "sm")}>
              Sign in
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Wordmark />
        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <Nav />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <ConnectionBadge />
          {accountsEnabled && <AccountMenu />}
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>
      {menuOpen && (
        <div id="mobile-nav" className="border-t border-border px-4 py-2 lg:hidden">
          <Nav orientation="vertical" label="Mobile" onNavigate={() => setMenuOpen(false)} />
        </div>
      )}
    </header>
  );
}
