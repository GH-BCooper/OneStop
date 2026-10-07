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

function MobileDrawer({ close }: { close: () => void }) {
  const shortcuts = [
    ["★", "Favourites", "/#quick-access"],
    ["🔥", "Popular", "/#popular-heading"],
    ["◷", "Recent", "/#recent-tools"],
  ] as const;
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Dismiss navigation"
        className="fixed inset-x-0 bottom-0 top-14 z-[105] cursor-default bg-black/45 backdrop-blur-[1px] lg:hidden"
        onClick={close}
      />
      <aside
        id="mobile-nav"
        aria-label="Mobile navigation"
        className="fixed inset-x-3 top-[4.25rem] z-[110] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-2xl motion-safe:animate-[os-drawer-in_180ms_ease-out] lg:hidden"
      >
        <p className="px-3 pb-2 text-sm font-semibold">OneStop</p>
        <Nav orientation="vertical" label="Mobile" onNavigate={close} />
        <div className="my-3 border-t border-border" />
        <nav aria-label="Dashboard shortcuts">
          <ul className="flex flex-col gap-1">
            {shortcuts.map(([icon, label, href]) => (
              <li key={label}>
                <Link
                  href={href}
                  onClick={close}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span aria-hidden="true">{icon}</span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="my-3 border-t border-border" />
        <nav aria-label="Secondary navigation">
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href="/account?tab=personal"
                onClick={close}
                className="flex rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                ⚙ Settings
              </Link>
            </li>
            <li>
              <Link
                href="/status"
                onClick={close}
                className="flex rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                ◌ Connection status
              </Link>
            </li>
            <li>
              <Link
                href="/account?tab=app"
                onClick={close}
                className="flex rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                ⓘ About & account
              </Link>
            </li>
          </ul>
        </nav>
        <div className="mt-3 border-t border-border pt-3">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}

export function Header({ accountsEnabled = false }: { accountsEnabled?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const guestOnlyChrome = accountsEnabled && status !== "loading" && !session?.user;

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

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
          <span className="hidden lg:contents">{accountsEnabled && <NotificationBell />}</span>
          {accountsEnabled && (
            <AccountMenu
              isOpen={accountOpen}
              onToggle={() => {
                setMenuOpen(false);
                setAccountOpen((open) => !open);
              }}
              onClose={() => setAccountOpen(false)}
            />
          )}
          <span className="hidden lg:contents">
            <ThemeToggle />
          </span>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => {
              setAccountOpen(false);
              setMenuOpen((open) => !open);
            }}
          >
            <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          </button>
        </div>
      </div>
      {menuOpen && <MobileDrawer close={() => setMenuOpen(false)} />}
    </header>
  );
}
