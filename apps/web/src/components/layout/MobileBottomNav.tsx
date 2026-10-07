"use client";

import { cn } from "@onestop/ui";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** The compact, app-wide phone navigation. Secondary destinations live under More. */
export function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const itemClass = (active: boolean) =>
    cn(
      "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors",
      active ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg",
    );

  const toolsActive = isCurrent(pathname, "/tools");
  const assistantActive = isCurrent(pathname, "/assistant");
  const moreActive = ["/workflows", "/history", "/settings", "/account"].some((href) =>
    isCurrent(pathname, href),
  );

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-border bg-surface/95 px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden"
    >
      {moreOpen && (
        <nav
          aria-label="More navigation"
          className="absolute bottom-[calc(100%+0.5rem)] right-3 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          {[
            ["🔁", "Workflows", "/workflows"],
            ["🕘", "History", "/history"],
            ["⚙", "Settings", "/account?tab=personal"],
          ].map(([icon, label, href]) => (
            <Link
              key={label}
              href={href}
              onClick={(event) => {
                const [targetPath, targetQuery] = href.split("?");
                const alreadyThere = targetQuery
                  ? pathname === targetPath &&
                    (searchParams.toString() === targetQuery ||
                      (targetQuery === "tab=personal" && searchParams.toString() === ""))
                  : isCurrent(pathname, targetPath!);
                if (alreadyThere) event.preventDefault();
                setMoreOpen(false);
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
      )}
      <nav aria-label="Mobile primary">
        <div className="mx-auto flex max-w-md gap-1">
          <Link
            href="/tools"
            aria-current={toolsActive ? "page" : undefined}
            onClick={(event) => toolsActive && event.preventDefault()}
            className={itemClass(toolsActive)}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              🧰
            </span>
            <span>All Tools</span>
          </Link>
          <Link
            href="/assistant"
            aria-current={assistantActive ? "page" : undefined}
            onClick={(event) => assistantActive && event.preventDefault()}
            className={itemClass(assistantActive)}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ✨
            </span>
            <span>AI Assistant</span>
          </Link>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((open) => !open)}
            className={itemClass(moreOpen || moreActive)}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              •••
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
