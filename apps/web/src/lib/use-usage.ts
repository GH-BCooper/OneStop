"use client";

// Real usage data behind the registry's "popularity" and "recently used" sorts
// (14-history-favorites.md; phase 03 left both as stubs).
//
// Two sources are merged: what this device has run (IndexedDB, works for a guest and offline) and
// what the account has run (`/api/usage`, only when signed in). A signed-in user therefore sees
// their own history reflected on every device, and a guest still gets a useful ordering.
import { useEffect, useState } from "react";
import { localRecentToolIds, localToolUsage } from "./localHistory";
import { readRecentTools } from "./recent-tools";

export interface Usage {
  /** Runs per tool id, device and account combined. */
  counts: Record<string, number>;
  /** Tool ids, most recently used first. */
  recent: string[];
  loading: boolean;
}

interface UsageResponse {
  usage?: Record<string, number>;
  recent?: string[];
}

function mergeRecent(...lists: string[][]): string[] {
  const seen: string[] = [];
  // Round-robin, so neither source can crowd the other out of the top of the list.
  for (let i = 0; i < Math.max(...lists.map((l) => l.length), 0); i += 1) {
    for (const list of lists) {
      const id = list[i];
      if (id && !seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

export function useUsage(): Usage {
  const [usage, setUsage] = useState<Usage>({ counts: {}, recent: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      // The device's own data first: it needs no network and works offline.
      const [counts, recent] = await Promise.all([localToolUsage(), localRecentToolIds()]);
      // Phase 02's localStorage list still records *opening* a tool page, which history does not.
      const opened = readRecentTools();
      if (!cancelled) {
        setUsage({ counts, recent: mergeRecent(recent, opened), loading: false });
      }

      let body: UsageResponse;
      try {
        const response = await fetch("/api/usage", { signal: controller.signal });
        if (!response.ok) return;
        body = (await response.json()) as UsageResponse;
      } catch {
        return; // offline, or no account: the device's numbers stand on their own
      }
      if (cancelled) return;
      const merged = { ...counts };
      for (const [id, n] of Object.entries(body.usage ?? {})) {
        merged[id] = (merged[id] ?? 0) + n;
      }
      setUsage({
        counts: merged,
        recent: mergeRecent(body.recent ?? [], recent, opened),
        loading: false,
      });
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return usage;
}
