// Real connectivity detection (18-pwa-offline.md).
//
// `navigator.onLine` only says whether the device has *a* network - a captive portal or a dropped
// uplink both report true - so it is the cheap negative signal, never the positive one. The
// positive answer comes from two probes, because OneStop has two kinds of "online":
//
//   - the OneStop server, which every tool needs (processing happens in `/api/tools/run`), and
//   - the wider Internet, which only `network: "required"` tools need.
//
// A laptop running OneStop locally with the Wi-Fi off is the interesting case: the server is up,
// so every `offline: true` tool works, and only the online-only tools must be blocked. That is
// the `limited` state below, and it is why the badge has three colours rather than two.
import type { ToolMeta } from "@onestop/tool-registry";
import { ERROR_MESSAGES } from "@onestop/types";

/** Where the probes go. `/api/ping` never touches the network; `/api/connectivity` does. */
export const PING_ENDPOINT = "/api/ping";
export const CONNECTIVITY_ENDPOINT = "/api/connectivity";

/** How long a probe waits before it counts as a failure. */
export const PROBE_TIMEOUT_MS = 6000;
/** How often the badge re-checks while the tab is visible. */
export const RECHECK_INTERVAL_MS = 60_000;

export type Reach =
  /** No probe has answered yet. */
  | "checking"
  /** The OneStop server and the Internet both answered: everything is available. */
  | "online"
  /** The server answered but it has no Internet: local tools work, online-only tools do not. */
  | "limited"
  /** The server could not be reached at all: only what the service worker cached is available. */
  | "offline";

export interface ConnectivitySnapshot {
  reach: Reach;
  /** What the browser thinks, unverified. */
  navigatorOnline: boolean;
  /** The OneStop server answered a probe. */
  appReachable: boolean;
  /** The server reached a public host. `null` when it could not be asked. */
  internetReachable: boolean | null;
  /** `Date.now()` of the last completed probe, or null before the first one. */
  checkedAt: number | null;
  /** Set when the probe failed, for the /status page. Never shown as a tool error. */
  detail?: string;
}

export const UNKNOWN_CONNECTIVITY: ConnectivitySnapshot = {
  reach: "checking",
  navigatorOnline: true,
  appReachable: false,
  internetReachable: null,
  checkedAt: null,
};

/** The one place the three states are derived, so the badge, /status and tool pages agree. */
export function reachFrom(input: {
  navigatorOnline: boolean;
  appReachable: boolean;
  internetReachable: boolean | null;
}): Reach {
  if (!input.appReachable) return "offline";
  if (input.internetReachable === true) return "online";
  if (input.internetReachable === false) return "limited";
  // The server answered but did not report on the Internet (an older build, or the check itself
  // errored). Trust the browser rather than claiming a problem we did not observe.
  return input.navigatorOnline ? "online" : "limited";
}

interface ConnectivityBody {
  ok?: boolean;
  internet?: boolean;
  detail?: string;
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: boolean; body: ConnectivityBody | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, body: null };
    try {
      return { ok: true, body: (await response.json()) as ConnectivityBody };
    } catch {
      return { ok: true, body: null };
    }
  } catch {
    return { ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Overridable so tests need no DOM. Defaults to `navigator.onLine`. */
  navigatorOnline?: boolean;
  /** Bypass the server's short-lived cache - the "Check again" buttons. */
  force?: boolean;
}

/**
 * Asks the server where we stand. Never throws: a probe that fails *is* the answer.
 *
 * When the browser already says it is offline, the network probe is skipped - but the server may
 * still be reachable over localhost, so `/api/ping` is still tried. That is what keeps a locally
 * hosted OneStop fully usable with the uplink down.
 */
export async function probeConnectivity(options: ProbeOptions = {}): Promise<ConnectivitySnapshot> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const navigatorOnline =
    options.navigatorOnline ??
    (typeof navigator === "undefined" ? true : navigator.onLine !== false);

  if (!fetchImpl) {
    return { ...UNKNOWN_CONNECTIVITY, navigatorOnline, detail: "No fetch available." };
  }

  if (!navigatorOnline) {
    // The device reports no network. The server might still be on this machine.
    const ping = await fetchJson(PING_ENDPOINT, fetchImpl, timeoutMs);
    const snapshot = {
      navigatorOnline,
      appReachable: ping.ok,
      internetReachable: false as boolean | null,
      checkedAt: Date.now(),
      detail: ping.ok
        ? "The device reports no network; the OneStop server is still reachable."
        : "The device reports no network and the OneStop server did not answer.",
    };
    return { ...snapshot, reach: reachFrom(snapshot) };
  }

  const endpoint = options.force ? `${CONNECTIVITY_ENDPOINT}?force=1` : CONNECTIVITY_ENDPOINT;
  const probe = await fetchJson(endpoint, fetchImpl, timeoutMs);
  if (!probe.ok) {
    const snapshot = {
      navigatorOnline,
      appReachable: false,
      internetReachable: null as boolean | null,
      checkedAt: Date.now(),
      detail: "The OneStop server did not answer.",
    };
    return { ...snapshot, reach: reachFrom(snapshot) };
  }
  const internet = typeof probe.body?.internet === "boolean" ? probe.body.internet : null;
  const snapshot = {
    navigatorOnline,
    appReachable: true,
    internetReachable: internet,
    checkedAt: Date.now(),
    ...(probe.body?.detail ? { detail: probe.body.detail } : {}),
  };
  return { ...snapshot, reach: reachFrom(snapshot) };
}

export interface ReachDescription {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  detail: string;
}

/** One wording per state, used by the header badge and by /status. */
export function describeReach(reach: Reach): ReachDescription {
  switch (reach) {
    case "online":
      return {
        label: "Online",
        tone: "success",
        detail: "Every tool is available.",
      };
    case "limited":
      return {
        label: "Offline",
        tone: "warning",
        detail:
          "No Internet connection. Tools that run on this device still work; tools that need the Internet are unavailable.",
      };
    case "offline":
      return {
        label: "No connection",
        tone: "danger",
        detail:
          "OneStop cannot be reached. You can keep browsing pages you have already opened; processing needs the app to be reachable.",
      };
    default:
      return { label: "Checking…", tone: "neutral", detail: "Checking the connection…" };
  }
}

/**
 * Shown when the OneStop server itself cannot be reached, which blocks every tool rather than
 * only the online-only ones. Same shape as master plan §22: short, and it says what to do.
 */
export const UNREACHABLE_MESSAGE = "OneStop cannot be reached. Reconnect and try again.";

export type ToolAvailability =
  { available: true } | { available: false; reason: "offline"; message: string };

/**
 * Whether a tool can run in the current state, and the master plan §22 wording when it cannot.
 * Registry-driven: `network` says what the tool needs, and `offline` (set only by the registry's
 * VERIFIED_OFFLINE list) says what has actually been proven to work without a network.
 */
export function toolAvailability(
  tool: Pick<ToolMeta, "network" | "offline">,
  snapshot: Pick<ConnectivitySnapshot, "reach">,
): ToolAvailability {
  const { reach } = snapshot;
  if (reach === "checking" || reach === "online") return { available: true };
  if (reach === "offline") {
    // Nothing can be processed: every tool runs through the server (04-file-core.md).
    return { available: false, reason: "offline", message: UNREACHABLE_MESSAGE };
  }
  // limited: the server is up but has no Internet.
  if (tool.network === "required") {
    return { available: false, reason: "offline", message: ERROR_MESSAGES.offline };
  }
  return { available: true };
}
