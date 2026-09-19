"use client";

// The header's connection indicator (18-pwa-offline.md). Phase 02 shipped a hard-coded "Online";
// this reads the shared connectivity monitor, which verifies both the OneStop server and the
// server's own Internet access rather than trusting `navigator.onLine`.
import { Badge } from "@onestop/ui";
import Link from "next/link";
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
  // "Checking…" would flicker on every page load, so the first probe shows the neutral state
  // without drawing the eye; anything else is worth noticing.
  const title = `${described.detail}${detail ? ` ${detail}` : ""}`;

  return (
    <Link
      href="/status"
      title={title}
      className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Badge
        tone={described.tone}
        aria-label={`Connection status: ${described.label}. ${described.detail} Open the status page.`}
        data-reach={reach}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot[described.tone]}`} />
        <span className="hidden sm:inline">{described.label}</span>
      </Badge>
    </Link>
  );
}
