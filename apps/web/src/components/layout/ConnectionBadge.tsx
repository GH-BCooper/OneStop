"use client";

// The header's connection indicator (18-pwa-offline.md). Phase 02 shipped a hard-coded "Online";
// this reads the shared connectivity monitor, which verifies both the OneStop server and the
// server's own Internet access rather than trusting `navigator.onLine`.
import { Badge } from "@onestop/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { describeReach } from "@/lib/connectivity";
import { useConnectivity } from "@/lib/use-connectivity";

const dot: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-fg-muted",
};

export function ConnectionBadge() {
  const { reach, detail } = useConnectivity();
  const described = describeReach(reach);
  const [longPressTooltipOpen, setLongPressTooltipOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  // "Checking…" would flicker on every page load, so the first probe shows the neutral state
  // without drawing the eye; anything else is worth noticing.
  const accessibleStatus = `Connection status: ${described.label}. ${described.detail}${detail ? ` ${detail}` : ""}`;

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const clearPressTimer = () => {
    if (!pressTimer.current) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <Link
      href="/status"
      title="Status"
      aria-label={`${accessibleStatus} Open the status page.`}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        clearPressTimer();
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setLongPressTooltipOpen(false);
        longPressTriggered.current = false;
        pressTimer.current = setTimeout(() => {
          longPressTriggered.current = true;
          setLongPressTooltipOpen(true);
        }, 500);
      }}
      onPointerUp={() => {
        clearPressTimer();
        if (!longPressTriggered.current) return;
        hideTimer.current = setTimeout(() => {
          setLongPressTooltipOpen(false);
          longPressTriggered.current = false;
          hideTimer.current = null;
        }, 1400);
      }}
      onPointerCancel={() => {
        clearPressTimer();
        setLongPressTooltipOpen(false);
        longPressTriggered.current = false;
      }}
      onClick={(event) => {
        if (!longPressTriggered.current) return;
        // A hold is for revealing the label, not for navigating away to the status page.
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        if (longPressTriggered.current) event.preventDefault();
      }}
      className="group relative inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Badge tone={described.tone} data-reach={reach} aria-hidden="true">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot[described.tone]}`} />
        <span className="hidden sm:inline">{described.label}</span>
      </Badge>
      <span
        role="tooltip"
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-full z-[130] mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-fg shadow-xl transition-opacity ${
          longPressTooltipOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        Status
      </span>
    </Link>
  );
}
