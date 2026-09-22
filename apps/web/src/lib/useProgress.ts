"use client";

// Polls the progress store (apps/api/src/progress/store.ts) on the side while a tool or workflow
// run's own POST request is in flight, so the UI can show a real percentage instead of an
// indeterminate spinner. Best-effort: if a poll fails, the run itself is unaffected.
import { useEffect, useState } from "react";

export interface ProgressInfo {
  percent: number;
  label: string;
}

const POLL_MS = 400;

export function newProgressToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Polls `GET /api/progress/:token` every 400ms while `active` is true. */
export function useProgressPolling(token: string | null, active: boolean): ProgressInfo | null {
  const [info, setInfo] = useState<ProgressInfo | null>(null);

  useEffect(() => {
    if (!active || !token) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/progress/${token}`, { cache: "no-store" });
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as {
          progress?: { percent: number; label: string };
        };
        if (!cancelled && body.progress) {
          setInfo({ percent: body.progress.percent, label: body.progress.label });
        }
      } catch {
        // Polling is a nicety, not a dependency of the run itself.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, active]);

  return info;
}
