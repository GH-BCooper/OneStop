"use client";

import { buttonClasses } from "@onestop/ui";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { openCommandPalette } from "./CommandPalette";
import { ConnectionBadge } from "./ConnectionBadge";
import { Nav } from "./Nav";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

function PaletteButton() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="hidden h-9 items-center gap-2 rounded-md border border-border px-2.5 text-sm text-fg-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring sm:inline-flex"
      aria-label="Open the command palette"
      aria-keyshortcuts="Control+K Meta+K"
      title="Search everything (Ctrl+K)"
    >
      <span aria-hidden="true">🔍</span>
      <kbd className="rounded border border-border px-1 py-0.5 text-[10px] leading-none">
        Ctrl K
      </kbd>
    </button>
  );
}

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
  const [accountOpen, setAccountOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const guestOnlyChrome = accountsEnabled && status !== "loading" && !session?.user;

  useEffect(() => {
    setAccountOpen(false);
  }, [pathname]);

  if (guestOnlyChrome) {
    return (
      <header className="sticky top-0 z-[100] overflow-visible border-b border-border bg-surface/95 backdrop-blur">
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
    <header className="sticky top-0 z-[100] overflow-visible border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Wordmark />
        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <Nav />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <PaletteButton />
          <ConnectionBadge />
          <ThemeToggle className="order-2 lg:order-5" />
          {accountsEnabled && session?.user && (
            <span className="hidden order-4 lg:order-3 lg:block">
              <NotificationBell />
            </span>
          )}
          {accountsEnabled && (
            <div className="order-3 lg:order-4">
              <AccountMenu
                isOpen={accountOpen}
                onToggle={() => setAccountOpen((open) => !open)}
                onClose={() => setAccountOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
