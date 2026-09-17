"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "./ConnectionBadge";
import { Nav } from "./Nav";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-lg font-bold text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className="text-primary">
            ◆
          </span>
          OneStop
        </Link>
        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <Nav />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <ConnectionBadge />
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
