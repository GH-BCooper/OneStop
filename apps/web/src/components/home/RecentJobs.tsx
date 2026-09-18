"use client";

// The Home page's "Recent jobs" panel (14-history-favorites.md).
//
// Phase 02 filled this with sample data and a note saying real history arrives with accounts.
// It now shows the last few real runs: from the account when signed in, from this device's
// IndexedDB otherwise. Nothing is invented - an empty list says so.
import { getTool } from "@onestop/tool-registry";
import type { HistoryEntry, HistoryPage } from "@onestop/types";
import { Badge, Card } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readLocalHistory } from "@/lib/localHistory";

const tones: Record<string, "success" | "danger" | "primary" | "neutral"> = {
  success: "success",
  failed: "danger",
  processing: "primary",
  validating: "primary",
  pending: "neutral",
};

function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function RecentJobs() {
  const { data: session, status } = useSession();
  const signedIn = Boolean(session?.user);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    const load = async () => {
      if (signedIn) {
        try {
          const response = await fetch("/api/history?page=1");
          if (response.ok) {
            const body = (await response.json()) as HistoryPage;
            if (!cancelled) setEntries(body.entries.slice(0, 5));
            return;
          }
        } catch {
          // fall through to the device's own history
        }
      }
      const local = await readLocalHistory();
      if (!cancelled) setEntries(local.slice(0, 5));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [signedIn, status]);

  return (
    <section aria-labelledby="jobs-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="jobs-heading" className="text-xl font-semibold">
          Recent jobs
        </h2>
        <Link href="/history" className="text-sm text-primary hover:underline">
          All history →
        </Link>
      </div>
      <Card className="p-0">
        {entries === null ? (
          <p className="px-4 py-3 text-sm text-fg-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-muted">
            Nothing yet. Run a tool and it will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {getTool(entry.toolId)?.name ?? entry.toolId}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {[entry.inputs[0], when(entry.createdAt)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge tone={tones[entry.status] ?? "neutral"}>{entry.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-fg-muted">
        {signedIn
          ? "Saved to your account and synced across devices."
          : "Kept in this browser only. Sign in to save your history."}
      </p>
    </section>
  );
}
