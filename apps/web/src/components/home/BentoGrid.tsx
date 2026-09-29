"use client";

// The home page's bento grid (21-roadmap-expansion.md, roadmap §7.2).
//
// Panels of different weights instead of a uniform row of cards, and every tile tilts towards the
// cursor the way `ToolOrbit`'s cards already do on the landing page — so the 3D-tilt interaction the
// app has already built becomes a home-wide pattern rather than a one-off flourish.
//
// The tilt is one `transform` per tile, written in a pointer handler and cleared on leave: no layout
// work per frame, no library, and it is skipped entirely when decorations are off (reduced motion,
// reduced data, or a metered connection), where the tiles simply stay flat and still work.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { decorationsEnabled } from "@/lib/appearance";

export interface BentoTileProps {
  href: string;
  title: string;
  detail?: string;
  icon?: string;
  /** How much of the grid this tile takes. */
  size?: "large" | "wide" | "tall" | "small";
  children?: ReactNode;
  /** Renders as a plain panel rather than a link, for tiles with their own controls inside. */
  asPanel?: boolean;
}

const SPAN: Record<NonNullable<BentoTileProps["size"]>, string> = {
  large: "sm:col-span-2 sm:row-span-2",
  wide: "sm:col-span-2",
  tall: "sm:row-span-2",
  small: "",
};

/** Maximum tilt in degrees. Small on purpose: a card that swings is a distraction, not a delight. */
const MAX_TILT = 6;

export function BentoTile({ href, title, detail, icon, size = "small", children, asPanel = false }: BentoTileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    setLive(decorationsEnabled());
  }, []);

  const onMove = useCallback(
    (event: React.PointerEvent) => {
      const el = ref.current;
      if (!el || !live) return;
      const box = el.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      el.style.transform = `perspective(700px) rotateY(${(x * MAX_TILT).toFixed(2)}deg) rotateX(${(-y * MAX_TILT).toFixed(2)}deg)`;
      // The same custom properties `.os-glow` already reads, so the spotlight follows the cursor too.
      el.style.setProperty("--mx", `${((event.clientX - box.left) / box.width) * 100}%`);
      el.style.setProperty("--my", `${((event.clientY - box.top) / box.height) * 100}%`);
    },
    [live],
  );

  const reset = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = "";
  }, []);

  const body = (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className="os-glow flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-[var(--os-card-shadow)] transition-transform duration-150 will-change-transform"
      style={{ backgroundImage: "var(--os-surface-sheen)" }}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span aria-hidden="true" className={size === "large" ? "text-3xl" : "text-xl"}>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${size === "large" ? "text-lg" : "text-sm"}`}>{title}</p>
          {detail && <p className="text-xs text-fg-muted">{detail}</p>}
        </div>
      </div>
      {children}
    </div>
  );

  return (
    <div className={SPAN[size]}>
      {asPanel ? (
        body
      ) : (
        <Link href={href} className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
          {body}
        </Link>
      )}
    </div>
  );
}

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid auto-rows-[minmax(7rem,auto)] grid-cols-1 gap-3 sm:grid-cols-4">{children}</div>
  );
}
