"use client";

// The app-wide offline notice (18-pwa-offline.md, master plan §22).
//
// A tool page blocks itself when it needs the Internet, but a visitor who loses the connection
// while browsing deserves to know before they pick a tool that cannot run. The banner says what
// still works rather than only what does not, and it disappears the moment a probe succeeds.
import { Badge } from "@onestop/ui";
import Link from "next/link";
import { describeReach } from "@/lib/connectivity";
import { useConnectivity } from "@/lib/use-connectivity";

export function OfflineBanner() {
  const { reach, recheck } = useConnectivity();
  if (reach === "online" || reach === "checking") return null;
  const described = describeReach(reach);

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="border-b border-warning/60 bg-warning/10 px-4 py-2 text-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={described.tone}>{described.label}</Badge>
        <span className="min-w-0">{described.detail}</span>
        <Link href="/status" className="text-primary hover:underline">
          What works offline →
        </Link>
        <button
          type="button"
          onClick={() => void recheck()}
          className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Check again
        </button>
      </div>
    </div>
  );
}
