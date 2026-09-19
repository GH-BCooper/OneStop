"use client";

// Talking to the service worker from the page (18-pwa-offline.md).
//
// The worker itself is `apps/web/public/sw.js` - plain JS, served as-is. This module is the only
// place the page touches it, so registration, update handling and the /status readout all agree on
// one protocol (the SKIP_WAITING / CACHE_STATUS / CLEAR_CACHES messages the worker handles).

export const SW_URL = "/sw.js";
export const SW_SCOPE = "/";

export interface CacheStatus {
  version: string;
  caches: string[];
  entries: number;
  shellUrls: string[];
  shellCached: string[];
}

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/**
 * Whether registering is wanted here. A dev server's assets change on every keystroke and a stale
 * cached shell is the classic "why is my edit not showing" bug, so the worker is production-only
 * unless `NEXT_PUBLIC_ENABLE_SW=1` asks for it.
 */
export function serviceWorkerEnabled(): boolean {
  if (!serviceWorkerSupported()) return false;
  if (process.env.NEXT_PUBLIC_ENABLE_SW === "1") return true;
  if (process.env.NEXT_PUBLIC_ENABLE_SW === "0") return false;
  return process.env.NODE_ENV === "production";
}

export interface RegisterResult {
  registration: ServiceWorkerRegistration | null;
  /** Why registration did not happen, when it did not. */
  skipped?: "unsupported" | "disabled" | "insecure" | "failed";
}

/**
 * Registers the worker. Never throws: a browser that refuses (private mode, an insecure origin,
 * a blocked worker) must leave the app working exactly as it did before.
 */
export async function registerServiceWorker(): Promise<RegisterResult> {
  if (!serviceWorkerSupported()) return { registration: null, skipped: "unsupported" };
  if (!serviceWorkerEnabled()) return { registration: null, skipped: "disabled" };
  // Workers need a secure context; localhost counts as one, so a local `next start` is fine.
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return { registration: null, skipped: "insecure" };
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    return { registration };
  } catch (err) {
    console.error("[pwa] service worker registration failed", err);
    return { registration: null, skipped: "failed" };
  }
}

/** Sends one message and waits for the worker's reply on a private channel. */
async function ask<T>(type: string, timeoutMs = 4000): Promise<T | null> {
  if (!serviceWorkerSupported()) return null;
  const worker = navigator.serviceWorker.controller;
  if (!worker) return null;
  return new Promise<T | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data as T);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

/** What the worker has cached, for /status. `null` when no worker controls this page. */
export function readCacheStatus(): Promise<CacheStatus | null> {
  return ask<CacheStatus>("CACHE_STATUS");
}

/** Empties OneStop's caches and re-fetches the shell. */
export async function clearCaches(): Promise<boolean> {
  const result = await ask<{ ok: boolean }>("CLEAR_CACHES", 15_000);
  return Boolean(result?.ok);
}

/** Tells a waiting worker to take over now; the caller reloads afterwards. */
export function activateUpdate(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
}

/** True when the app is running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
    navigatorStandalone === true
  );
}
