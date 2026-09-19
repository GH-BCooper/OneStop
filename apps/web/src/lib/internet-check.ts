// Server-side "does this machine have Internet?" probe (18-pwa-offline.md).
//
// `navigator.onLine` in the browser cannot answer this, and it is the answer that decides whether
// an online-only tool can run: the tool's request is made by the *server*, so it is the server's
// uplink that matters. The probe is a HEAD to a captive-portal style endpoint - no payload, no
// account, no key, nothing about the user sent anywhere (CLAUDE.md §2, §5).
//
// The result is cached briefly so the badge's polling, several open tabs and the /status page
// share one outbound request.

/** Endpoints that answer a tiny fixed response and are free to use. Tried in order. */
const DEFAULT_TARGETS = [
  "https://connectivitycheck.gstatic.com/generate_204",
  "https://cloudflare.com/cdn-cgi/trace",
] as const;

const TIMEOUT_MS = 2500;
/** How long a result is reused. Short enough to feel live, long enough to stop a request storm. */
export const CACHE_MS = 10_000;

export interface InternetCheck {
  internet: boolean;
  /** The endpoint that answered, or the last one tried. Shown on /status for disclosure. */
  target: string;
  checkedAt: string;
  /** A short, non-technical note for /status. Never shown as a tool error. */
  detail: string;
  /** True when this answer came from the short-lived cache rather than a fresh request. */
  cached: boolean;
}

let cache: { at: number; value: InternetCheck } | null = null;

/**
 * The endpoints to probe. `CONNECTIVITY_CHECK_URL` lets a self-hosted instance point this at
 * something it already trusts (or at its own LAN host); anything but an http(s) URL is ignored
 * rather than trusted (CLAUDE.md §6).
 */
export function checkTargets(): string[] {
  const configured = (process.env.CONNECTIVITY_CHECK_URL ?? "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return [url.toString()];
    } catch {
      // fall through to the defaults
    }
    console.warn("[connectivity] ignoring invalid CONNECTIVITY_CHECK_URL");
  }
  return [...DEFAULT_TARGETS];
}

async function reachable(target: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(target, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    // Any answer at all proves the uplink works - a 204, a 200, even a redirect or a 4xx.
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface InternetCheckOptions {
  fetchImpl?: typeof fetch;
  /** Ignore the cache (the /status page's "Check again"). */
  force?: boolean;
  now?: number;
}

export async function checkInternet(options: InternetCheckOptions = {}): Promise<InternetCheck> {
  const now = options.now ?? Date.now();
  if (!options.force && cache && now - cache.at < CACHE_MS) {
    return { ...cache.value, cached: true };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = checkTargets();
  let last = targets[0] ?? "";
  for (const target of targets) {
    last = target;
    if (await reachable(target, fetchImpl)) {
      const value: InternetCheck = {
        internet: true,
        target,
        checkedAt: new Date(now).toISOString(),
        detail: "The server reached the Internet.",
        cached: false,
      };
      cache = { at: now, value };
      return value;
    }
  }
  const value: InternetCheck = {
    internet: false,
    target: last,
    checkedAt: new Date(now).toISOString(),
    detail: "The server could not reach the Internet. Tools that run on this device still work.",
    cached: false,
  };
  cache = { at: now, value };
  return value;
}

/** Test seam. */
export function resetInternetCheckCache(): void {
  cache = null;
}
