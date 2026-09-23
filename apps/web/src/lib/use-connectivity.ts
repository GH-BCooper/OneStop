"use client";

// One shared connectivity monitor for the whole app (18-pwa-offline.md).
//
// The header badge, the /status page and every tool page read the same snapshot, so they can never
// disagree, and the probe runs once per interval rather than once per component. It probes on
// mount, on the browser's online/offline events, when the tab becomes visible again, and every
// RECHECK_INTERVAL_MS while visible - and unbinds entirely when the last listener goes away, so a
// page with no connection indicator is not polling in the background.
import { useCallback, useEffect, useState } from "react";
import {
  probeConnectivity,
  RECHECK_INTERVAL_MS,
  UNKNOWN_CONNECTIVITY,
  type ConnectivitySnapshot,
} from "./connectivity";

type Listener = (snapshot: ConnectivitySnapshot) => void;

const listeners = new Set<Listener>();
let current: ConnectivitySnapshot = UNKNOWN_CONNECTIVITY;
let inFlight: Promise<ConnectivitySnapshot> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let bound = false;

// Fast self-healing retries while the app looks unreachable (18-pwa-offline.md). A cold-started
// host (Render's free tier spins down when idle) or a dev server compiling a route on demand can
// take longer to answer than the very first probe waits, which used to show "No connection" until
// the visitor clicked "Check again" or switched tabs. Retrying quickly with backoff clears that up
// on its own; it stops as soon as the app is reachable and falls back to the slow steady-state poll.
const RETRY_BACKOFF_MS = [2000, 4000, 8000, 15000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void refreshConnectivity();
    }
  }, delay);
}

function publish(snapshot: ConnectivitySnapshot): void {
  current = snapshot;
  for (const listener of listeners) listener(snapshot);
  if (snapshot.reach === "offline" || snapshot.reach === "checking") {
    scheduleRetry();
  } else {
    clearRetry();
  }
}

/** Runs a probe, collapsing concurrent callers onto one request. */
export function refreshConnectivity(options: { force?: boolean } = {}): Promise<ConnectivitySnapshot> {
  inFlight ??= probeConnectivity(options)
    .then((snapshot) => {
      publish(snapshot);
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const onNetworkEvent = () => void refreshConnectivity();

function onVisibility(): void {
  if (document.visibilityState === "visible") void refreshConnectivity();
}

function onTick(): void {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    void refreshConnectivity();
  }
}

function start(): void {
  if (bound || typeof window === "undefined") return;
  bound = true;
  window.addEventListener("online", onNetworkEvent);
  window.addEventListener("offline", onNetworkEvent);
  document.addEventListener("visibilitychange", onVisibility);
  timer = setInterval(onTick, RECHECK_INTERVAL_MS);
  void refreshConnectivity();
}

function stop(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onNetworkEvent);
    window.removeEventListener("offline", onNetworkEvent);
    document.removeEventListener("visibilitychange", onVisibility);
  }
  if (timer) clearInterval(timer);
  timer = null;
  bound = false;
  clearRetry();
}

/** Forgets everything the monitor has learned and unbinds it. Used by the test setup. */
export function resetConnectivityMonitor(): void {
  listeners.clear();
  current = UNKNOWN_CONNECTIVITY;
  inFlight = null;
  stop();
}

export interface UseConnectivity extends ConnectivitySnapshot {
  /** Probe again now - the "Try again" / "Check again" buttons. */
  recheck: () => Promise<ConnectivitySnapshot>;
}

export function useConnectivity(): UseConnectivity {
  const [snapshot, setSnapshot] = useState<ConnectivitySnapshot>(current);

  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(current);
    start();
    return () => {
      listeners.delete(setSnapshot);
      if (listeners.size === 0) stop();
    };
  }, []);

  const recheck = useCallback(() => refreshConnectivity({ force: true }), []);
  return { ...snapshot, recheck };
}
