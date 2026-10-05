"use client";

import { getTool } from "@onestop/tool-registry";
import type { HistoryEntry, HistoryPage } from "@onestop/types";
import { Badge } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { readLocalHistory } from "@/lib/localHistory";

type LoadState = { entries: HistoryEntry[] | null; error: boolean };

const statusVisual: Record<
  string,
  { tone: "success" | "danger" | "primary" | "warning" | "neutral"; icon: string; label: string }
> = {
  success: { tone: "success", icon: "✓", label: "Completed" },
  failed: { tone: "danger", icon: "!", label: "Failed" },
  processing: { tone: "primary", icon: "↻", label: "Processing" },
  validating: { tone: "primary", icon: "↻", label: "Preparing" },
  pending: { tone: "neutral", icon: "•", label: "Queued" },
  cancelled: { tone: "warning", icon: "—", label: "Cancelled" },
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
  const [state, setState] = useState<LoadState>({ entries: null, error: false });

  const load = useCallback(async () => {
    if (status === "loading") return;
    setState({ entries: null, error: false });
    try {
      if (signedIn) {
        const response = await fetch("/api/history?page=1");
        if (response.ok) {
          const body = (await response.json()) as HistoryPage;
          setState({ entries: body.entries.slice(0, 5), error: false });
          return;
        }
      }
      setState({ entries: (await readLocalHistory()).slice(0, 5), error: false });
    } catch {
      // A failed account read should still attempt local history. If IndexedDB is unavailable,
      // show a contained retry state instead of taking the dashboard down.
      try {
        setState({ entries: (await readLocalHistory()).slice(0, 5), error: false });
      } catch {
        setState({ entries: [], error: true });
      }
    }
  }, [signedIn, status]);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <section aria-labelledby="jobs-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 id="jobs-heading" className="text-xl font-semibold tracking-tight">
            Recent jobs
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Your latest operations and their status.</p>
        </div>
        <Link href="/history" className="shrink-0 text-sm font-medium text-primary hover:underline">
          All history <span aria-hidden="true">→</span>
        </Link>
      </div>
      {state.entries === null ? (
        <div aria-live="polite" className="space-y-2">
          <span className="sr-only">Loading recent jobs…</span>
          <div className="h-20 animate-pulse rounded-xl bg-surface-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-surface-muted" />
        </div>
      ) : state.error ? (
        <div className="rounded-xl border border-danger/40 bg-surface p-4">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-sm text-fg-muted">We couldn’t load this section.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      ) : state.entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/70 p-4">
          <p className="font-medium">No jobs yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            Your completed and recent operations will appear here.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {state.entries.map((entry) => {
            const visual = statusVisual[entry.status] ?? {
              tone: "neutral" as const,
              icon: "•",
              label: entry.status,
            };
            const tool = getTool(entry.toolId);
            return (
              <li
                key={entry.id}
                className="flex items-start gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted"
                >
                  ✦
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{tool?.name ?? entry.toolId}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {entry.summary || entry.inputs[0] || "Operation started"}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">{when(entry.createdAt)}</p>
                </div>
                <Badge
                  tone={visual.tone}
                  aria-label={`Status: ${visual.label}`}
                  className="mt-0.5 shrink-0"
                >
                  <span aria-hidden="true">{visual.icon}</span>
                  <span className="hidden sm:inline">{visual.label}</span>
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-fg-muted">
        {signedIn
          ? "Saved to your account and synced across devices."
          : "Kept in this browser only. Sign in to save your history."}
      </p>
    </section>
  );
}
