// @vitest-environment jsdom
//
// Phase 18 tests (18-pwa-offline.md): the manifest and icon set, the service worker's four rules,
// the real connectivity detection, the offline UX those states drive, and the /status page's numbers
// against the registry's own `offline` flags.
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTool, tools, toolHref, CATEGORIES, GROUPS } from "@onestop/tool-registry";
import { ERROR_MESSAGES } from "@onestop/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionBadge } from "@/components/layout/ConnectionBadge";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { cameraPreflight } from "@/components/qr/QRScanner";
import { OfflineCatalogue } from "@/components/status/OfflineCatalogue";
import { ToolPage } from "@/components/tools/ToolPage";
import {
  describeReach,
  probeConnectivity,
  reachFrom,
  toolAvailability,
  UNREACHABLE_MESSAGE,
  type Reach,
} from "@/lib/connectivity";
import {
  categoryOfflineSummaries,
  groupOfflineSummaries,
  offlineClass,
  offlineTotals,
} from "@/lib/offline-status";
import { resetConnectivityMonitor } from "@/lib/use-connectivity";

const webRoot = path.resolve(import.meta.dirname, "../..");
const publicDir = path.join(webRoot, "public");

function readPublic(file: string): string {
  return readFileSync(path.join(publicDir, file), "utf8");
}

/** PNG dimensions from the IHDR chunk, so the icons are checked rather than trusted. */
function pngSize(file: string): { width: number; height: number } | null {
  const buffer = readFileSync(path.join(publicDir, file));
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts?: { url: string }[];
}

const manifest = JSON.parse(readPublic("manifest.json")) as Manifest;

describe("manifest and icons (installability)", () => {
  it("declares everything a browser needs to offer installation", () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.start_url.startsWith("/")).toBe(true);
    expect(manifest.scope).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ships real PNG icons at the installable sizes, including a maskable one", () => {
    const pngs = manifest.icons.filter((icon) => icon.type === "image/png");
    for (const icon of pngs) {
      const size = pngSize(icon.src.replace(/^\//, ""));
      expect(size, `${icon.src} is not a PNG`).not.toBeNull();
      const [declared] = icon.sizes.split("x").map(Number);
      expect(size?.width).toBe(declared);
      expect(size?.height).toBe(declared);
    }
    expect(pngs.some((i) => i.sizes === "192x192")).toBe(true);
    expect(pngs.some((i) => i.sizes === "512x512")).toBe(true);
    expect(pngs.some((i) => (i.purpose ?? "").split(/\s+/).includes("maskable"))).toBe(true);
  });

  it("only links shortcuts that are real routes", () => {
    const known = new Set(["/tools", "/assistant", "/status", ...tools.map((t) => toolHref(t))]);
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(known, shortcut.url).toContain(shortcut.url.split("?")[0]);
    }
  });

  it("the theme colour matches the layout's dark theme colour", () => {
    const layout = readFileSync(path.join(webRoot, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain(manifest.theme_color);
    expect(layout).toContain('manifest: "/manifest.json"');
  });
});

// --- service worker ------------------------------------------------------------------------------

interface SwInternals {
  VERSION: string;
  SHELL_CACHE: string;
  ASSET_CACHE: string;
  PAGE_CACHE: string;
  SHELL_URLS: string[];
  OFFLINE_URL: string;
  OFFLINE_MESSAGE: string;
  routeFor: (request: Request) => string;
  handleRequest: (request: Request) => Promise<Response> | null;
  handleApi: (request: Request) => Promise<Response>;
  handleAsset: (request: Request) => Promise<Response>;
  handleNavigate: (request: Request) => Promise<Response>;
  handleRuntime: (request: Request) => Promise<Response>;
  precache: () => Promise<void>;
  dropOldCaches: () => Promise<void>;
  cacheStatus: () => Promise<{ version: string; entries: number; shellCached: string[] }>;
}

/** A minimal Cache/CacheStorage pair - enough for the worker's put/match/keys/delete calls. */
class FakeCache {
  entries = new Map<string, Response>();
  async put(request: RequestInfo, response: Response) {
    this.entries.set(typeof request === "string" ? request : request.url, response);
  }
  async match(request: RequestInfo, options?: { ignoreSearch?: boolean }) {
    const url = typeof request === "string" ? request : request.url;
    const direct =
      this.entries.get(url) ?? this.entries.get(new URL(url, "http://localhost").pathname);
    if (direct) return direct;
    if (options?.ignoreSearch) {
      const bare = url.split("?")[0];
      for (const [key, value] of this.entries) if (key.split("?")[0] === bare) return value;
    }
    return undefined;
  }
  async keys() {
    return [...this.entries.keys()].map(
      (url) => new Request(new URL(url, "http://localhost").href),
    );
  }
}

function fakeCaches() {
  const store = new Map<string, FakeCache>();
  return {
    store,
    api: {
      async open(name: string) {
        const existing = store.get(name) ?? new FakeCache();
        store.set(name, existing);
        return existing;
      },
      async keys() {
        return [...store.keys()];
      },
      async delete(name: string) {
        return store.delete(name);
      },
      async match(request: RequestInfo, options?: { ignoreSearch?: boolean }) {
        for (const cache of store.values()) {
          const hit = await cache.match(request, options);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
}

interface SwHarness {
  sw: SwInternals;
  caches: ReturnType<typeof fakeCaches>;
  fetchMock: ReturnType<typeof vi.fn>;
  listeners: Map<string, ((event: unknown) => void)[]>;
}

/**
 * Loads `public/sw.js` into a fake ServiceWorkerGlobalScope and hands back its internals. The file
 * is plain JS served as-is, so this is the only honest way to test it: the same bytes the browser
 * runs, driven by hand.
 */
function loadServiceWorker(fetchImpl: (request: Request) => Promise<Response>): SwHarness {
  const source = readPublic("sw.js");
  const caches = fakeCaches();
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) =>
    fetchImpl(input instanceof Request ? input : new Request(input, init)),
  );
  const scope: Record<string, unknown> = {
    location: new URL("http://localhost/sw.js"),
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    registration: {},
  };
  // The worker resolves relative URLs against its scope; Node's Request needs them absolute.
  class ScopedRequest extends Request {
    constructor(input: RequestInfo, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost/").href : input, init);
    }
  }
  const fn = new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "Request",
    "URL",
    "setTimeout",
    "clearTimeout",
    "Promise",
    `${source}\nreturn self.__sw;`,
  );
  const sw = fn(
    scope,
    caches.api,
    fetchMock,
    Response,
    ScopedRequest,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
  ) as SwInternals;
  return { sw, caches, fetchMock, listeners };
}

const online = async (request: Request) =>
  new Response(`fresh:${new URL(request.url).pathname}`, { status: 200 });
const dead = async () => {
  throw new TypeError("Failed to fetch");
};

describe("service worker", () => {
  it("routes every kind of request to the right rule", () => {
    const { sw } = loadServiceWorker(online);
    const route = (url: string, init?: RequestInit & { mode?: string }) =>
      sw.routeFor(new Request(`http://localhost${url}`, init as RequestInit));

    expect(route("/api/tools/run", { method: "POST" })).toBe("api");
    expect(route("/api/files/abc")).toBe("api");
    expect(route("/q/abcde23456")).toBe("api");
    expect(route("/_next/static/chunks/main.js")).toBe("asset");
    expect(route("/icons/icon-192.png")).toBe("asset");
    expect(route("/manifest.json")).toBe("asset");
    expect(route("/tools/pdf/merge-pdf")).toBe("runtime");
    expect(sw.routeFor(new Request("https://example.com/x"))).toBe("passthrough");
  });

  it("treats a document request as a navigation", () => {
    const { sw } = loadServiceWorker(online);
    const request = new Request("http://localhost/tools");
    Object.defineProperty(request, "mode", { value: "navigate" });
    expect(sw.routeFor(request)).toBe("navigate");
  });

  it("answers a failed /api call with the master plan §22 offline message", async () => {
    const { sw } = loadServiceWorker(dead);
    const response = await sw.handleApi(
      new Request("http://localhost/api/tools/run", { method: "POST" }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("OFFLINE");
    expect(body.error.message).toBe(ERROR_MESSAGES.offline);
  });

  it("keeps the worker's offline wording identical to the shared error message", () => {
    const { sw } = loadServiceWorker(online);
    expect(sw.OFFLINE_MESSAGE).toBe(ERROR_MESSAGES.offline);
  });

  it("never caches an /api response", async () => {
    const { sw, caches } = loadServiceWorker(online);
    await sw.handleApi(new Request("http://localhost/api/ping"));
    expect([...caches.store.keys()]).toHaveLength(0);
  });

  it("serves build assets from the cache once they are there", async () => {
    const { sw, caches, fetchMock } = loadServiceWorker(online);
    const url = "http://localhost/_next/static/chunks/main.js";
    await sw.handleAsset(new Request(url));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cache = await caches.api.open(sw.ASSET_CACHE);
    expect(await cache.match(url)).toBeDefined();
    const second = await sw.handleAsset(new Request(url));
    expect(fetchMock).toHaveBeenCalledTimes(1); // cache-first: no second request
    expect(await second.text()).toBe("fresh:/_next/static/chunks/main.js");
  });

  it("precaches the shell, tolerating a URL that does not answer", async () => {
    const { sw, caches } = loadServiceWorker(async (request) =>
      new URL(request.url).pathname === "/status"
        ? new Response("nope", { status: 500 })
        : new Response("page", { status: 200 }),
    );
    await sw.precache();
    const cache = await caches.api.open(sw.SHELL_CACHE);
    const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
    expect(cached).toContain("/");
    expect(cached).toContain("/offline");
    expect(cached).not.toContain("/status");
  });

  it("falls back to the cached page, then /offline, when a navigation fails", async () => {
    const harness = loadServiceWorker(online);
    await harness.sw.precache();
    const request = new Request("http://localhost/tools/pdf/merge-pdf");
    Object.defineProperty(request, "mode", { value: "navigate" });
    await harness.sw.handleNavigate(request); // caches the page while online

    const offlineHarness = loadServiceWorker(dead);
    offlineHarness.caches.store.set(
      harness.sw.PAGE_CACHE,
      harness.caches.store.get(harness.sw.PAGE_CACHE)!,
    );
    const cachedAnswer = await offlineHarness.sw.handleNavigate(request);
    expect(await cachedAnswer.text()).toBe("fresh:/tools/pdf/merge-pdf");

    const bare = loadServiceWorker(dead);
    bare.caches.store.set(
      harness.sw.SHELL_CACHE,
      harness.caches.store.get(harness.sw.SHELL_CACHE)!,
    );
    const fallback = await bare.sw.handleNavigate(new Request("http://localhost/never-visited"));
    expect(await fallback.text()).toBe("fresh:/offline");
  });

  it("answers with an explanation when even /offline was never cached", async () => {
    const { sw } = loadServiceWorker(dead);
    const response = await sw.handleNavigate(new Request("http://localhost/anything"));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("offline");
  });

  it("drops caches from a previous version and reports what it holds", async () => {
    const { sw, caches } = loadServiceWorker(online);
    await caches.api.open("onestop-shell-v0");
    await caches.api.open("some-other-app");
    await sw.precache();
    await sw.dropOldCaches();
    const names = await caches.api.keys();
    expect(names).not.toContain("onestop-shell-v0");
    expect(names).toContain("some-other-app"); // not ours to delete
    const status = await sw.cacheStatus();
    expect(status.version).toBe(sw.VERSION);
    expect(status.shellCached).toContain("/offline");
    expect(status.entries).toBeGreaterThan(0);
  });

  it("registers install, activate, fetch and message handlers", () => {
    const { listeners } = loadServiceWorker(online);
    expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message"]);
  });
});

// --- connectivity --------------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("connectivity detection", () => {
  it("derives the three states from the two probes", () => {
    expect(reachFrom({ navigatorOnline: true, appReachable: true, internetReachable: true })).toBe(
      "online",
    );
    expect(reachFrom({ navigatorOnline: true, appReachable: true, internetReachable: false })).toBe(
      "limited",
    );
    expect(reachFrom({ navigatorOnline: true, appReachable: false, internetReachable: null })).toBe(
      "offline",
    );
    expect(reachFrom({ navigatorOnline: false, appReachable: true, internetReachable: null })).toBe(
      "limited",
    );
    expect(reachFrom({ navigatorOnline: true, appReachable: true, internetReachable: null })).toBe(
      "online",
    );
  });

  it("reports online when the server says it reached the Internet", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, internet: true }));
    const snapshot = await probeConnectivity({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(snapshot.reach).toBe("online");
    expect(snapshot.appReachable).toBe(true);
    expect(snapshot.internetReachable).toBe(true);
    expect(snapshot.checkedAt).toBeTypeOf("number");
  });

  it("reports the limited state when the app is up but has no Internet", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, internet: false }));
    const snapshot = await probeConnectivity({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(snapshot.reach).toBe("limited");
  });

  it("reports offline when the server cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const snapshot = await probeConnectivity({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(snapshot.reach).toBe("offline");
    expect(snapshot.detail).toMatch(/did not answer/);
  });

  it("still finds a locally hosted app when the device reports no network", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("/api/ping");
      return jsonResponse({ ok: true });
    });
    const snapshot = await probeConnectivity({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      navigatorOnline: false,
    });
    expect(snapshot.reach).toBe("limited");
    expect(snapshot.appReachable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no pointless Internet probe
  });

  it("treats an HTTP error from the probe as unreachable", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 502 }));
    const snapshot = await probeConnectivity({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(snapshot.reach).toBe("offline");
  });

  it("gives every state a short, actionable description", () => {
    for (const reach of ["checking", "online", "limited", "offline"] as Reach[]) {
      const described = describeReach(reach);
      expect(described.label.length).toBeGreaterThan(0);
      expect(described.detail.length).toBeGreaterThan(0);
      expect(described.detail).not.toMatch(/error|exception|stack/i);
    }
  });
});

describe("registry-driven tool availability", () => {
  const onlineOnly = tools.find((t) => t.network === "required")!;
  const offlineTool = tools.find((t) => t.offline)!;

  it("lets everything run while online or still checking", () => {
    for (const reach of ["online", "checking"] as Reach[]) {
      expect(toolAvailability(onlineOnly, { reach }).available).toBe(true);
      expect(toolAvailability(offlineTool, { reach }).available).toBe(true);
    }
  });

  it("blocks only the online-only tools when the app has no Internet", () => {
    const blocked = toolAvailability(onlineOnly, { reach: "limited" });
    expect(blocked.available).toBe(false);
    expect(blocked.available === false && blocked.message).toBe(ERROR_MESSAGES.offline);
    expect(toolAvailability(offlineTool, { reach: "limited" }).available).toBe(true);
  });

  it("blocks every tool, with its own wording, when OneStop itself is unreachable", () => {
    const blocked = toolAvailability(offlineTool, { reach: "offline" });
    expect(blocked.available).toBe(false);
    expect(blocked.available === false && blocked.message).toBe(UNREACHABLE_MESSAGE);
  });

  it("agrees with the registry for every entry", () => {
    for (const tool of tools) {
      const limited = toolAvailability(tool, { reach: "limited" });
      expect(limited.available, tool.id).toBe(tool.network !== "required");
    }
  });
});

// --- offline UX ----------------------------------------------------------------------------------

function stubConnectivity(body: { internet: boolean }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/connectivity")) {
      return jsonResponse({ ok: true, app: true, ...body });
    }
    if (typeof url === "string" && url.startsWith("/api/ping")) return jsonResponse({ ok: true });
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubUnreachable() {
  const fetchMock = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetConnectivityMonitor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConnectivityMonitor();
});

describe("offline UX", () => {
  it("shows a verified Online badge, linked to /status", async () => {
    stubConnectivity({ internet: true });
    render(<ConnectionBadge />);
    await waitFor(() => expect(screen.getByRole("link").dataset.reach ?? "").not.toBe("checking"));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/status");
    expect(screen.getByLabelText(/Connection status: Online/)).toBeTruthy();
  });

  it("shows the offline badge when the app has no Internet", async () => {
    stubConnectivity({ internet: false });
    render(<ConnectionBadge />);
    await waitFor(() => expect(screen.getByLabelText(/Connection status: Offline/)).toBeTruthy());
  });

  it("shows no banner while online and an explanatory one when not", async () => {
    stubConnectivity({ internet: true });
    const { unmount } = render(<OfflineBanner />);
    await waitFor(() => expect(screen.queryByTestId("offline-banner")).toBeNull());
    unmount();
    resetConnectivityMonitor();

    stubConnectivity({ internet: false });
    render(<OfflineBanner />);
    const banner = await screen.findByTestId("offline-banner");
    expect(banner.textContent).toContain("No Internet connection");
    expect(banner.textContent).toContain("still work");
    expect(screen.getByRole("link", { name: /What works offline/ }).getAttribute("href")).toBe(
      "/status",
    );
  });

  it("re-probes when the visitor asks the banner to check again", async () => {
    const fetchMock = stubConnectivity({ internet: false });
    render(<OfflineBanner />);
    await screen.findByTestId("offline-banner");
    const calls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
  });

  it("blocks an online-only tool with the §22 message and no request", async () => {
    const fetchMock = stubConnectivity({ internet: false });
    const tool = tools.find((t) => t.network === "required")!;
    render(<ToolPage tool={tool} />);
    const panel = await waitFor(() => {
      const card = document.querySelector('[data-state="unavailable"]');
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });
    expect(panel.textContent).toContain(ERROR_MESSAGES.offline);
    expect(panel.textContent).toContain("Internet connection required");
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/connectivity"))).toBe(
      true,
    );
  });

  it("keeps an offline-capable tool usable when the Internet is gone", async () => {
    stubConnectivity({ internet: false });
    const tool = getTool("uuid-generator")!;
    expect(tool.offline).toBe(true);
    render(<ToolPage tool={tool} />);
    await waitFor(() => expect(document.querySelector('[data-state="unavailable"]')).toBeNull());
    expect(screen.getByRole("button", { name: `Run ${tool.name}` })).toBeTruthy();
  });

  it("blocks even a local tool when OneStop itself cannot be reached", async () => {
    stubUnreachable();
    render(<ToolPage tool={getTool("uuid-generator")!} />);
    const panel = await waitFor(() => {
      const card = document.querySelector('[data-state="unavailable"]');
      expect(card).not.toBeNull();
      return card as HTMLElement;
    });
    expect(panel.textContent).toContain(UNREACHABLE_MESSAGE);
  });

  it("unblocks an online-only tool by itself when the connection comes back", async () => {
    let internet = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, app: true, internet })),
    );
    const tool = tools.find((t) => t.network === "required")!;
    render(<ToolPage tool={tool} />);
    await waitFor(() =>
      expect(document.querySelector('[data-state="unavailable"]')).not.toBeNull(),
    );
    internet = true;
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(document.querySelector('[data-state="unavailable"]')).toBeNull());
  });
});

describe("camera in the installed app", () => {
  it("asks for the camera only in a secure context", () => {
    expect(cameraPreflight({ hasMediaDevices: true, secureContext: true })).toEqual({ ok: true });
    const insecure = cameraPreflight({ hasMediaDevices: true, secureContext: false });
    expect(insecure.ok).toBe(false);
    expect(insecure.ok === false && insecure.message).toMatch(/https/);
    const noCamera = cameraPreflight({ hasMediaDevices: false, secureContext: true });
    expect(noCamera.ok === false && noCamera.message).toMatch(/Upload a photo/);
  });
});

// --- /status -------------------------------------------------------------------------------------

describe("/status offline capability", () => {
  it("classifies every tool from its registry flags alone", () => {
    for (const tool of tools) {
      const expected = tool.offline
        ? "offline"
        : tool.network === "required"
          ? "online-only"
          : "unverified";
      expect(offlineClass(tool), tool.id).toBe(expected);
    }
  });

  it("counts each category exactly as the registry does", () => {
    const summaries = categoryOfflineSummaries();
    expect(summaries.map((s) => s.id)).toEqual(CATEGORIES.map((c) => c.id));
    for (const summary of summaries) {
      const registryTools = tools.filter((t) => t.category === summary.id);
      expect(summary.total, summary.id).toBe(registryTools.length);
      expect(summary.offline, summary.id).toBe(registryTools.filter((t) => t.offline).length);
      expect(summary.onlineOnly, summary.id).toBe(
        registryTools.filter((t) => !t.offline && t.network === "required").length,
      );
      expect(summary.offline + summary.onlineOnly + summary.unverified).toBe(summary.total);
    }
  });

  it("rolls categories up into the catalogue's eight groups", () => {
    const groups = groupOfflineSummaries();
    expect(groups.map((g) => g.id)).toEqual(GROUPS.map((g) => g.id));
    const media = groups.find((g) => g.id === "media")!;
    expect(media.categories.map((c) => c.id)).toEqual(["audio", "video", "online-media"]);
    expect(media.total).toBe(media.categories.reduce((sum, c) => sum + c.total, 0));
    // Online Media is Internet-only by definition, Audio/Video are local: a partially offline group.
    expect(media.availability).toBe("partial");
  });

  it("totals the whole catalogue", () => {
    const totals = offlineTotals();
    expect(totals.total).toBe(tools.length);
    expect(totals.offline).toBe(tools.filter((t) => t.offline).length);
    expect(totals.offline + totals.onlineOnly + totals.unverified).toBe(totals.total);
    expect(totals.offlinePercent).toBe(Math.round((totals.offline / totals.total) * 100));
  });

  it("renders the real numbers, not a placeholder", () => {
    const totals = offlineTotals();
    render(<OfflineCatalogue totals={totals} groups={groupOfflineSummaries()} />);
    const tiles = screen.getByTestId("offline-totals");
    expect(tiles.textContent).toContain(String(totals.total));
    expect(tiles.textContent).toContain(`${totals.offline} (${totals.offlinePercent}%)`);
    for (const group of GROUPS) expect(screen.getByTestId(`status-group-${group.id}`)).toBeTruthy();
    // A sample tool from a different category each way round.
    expect(screen.getByRole("link", { name: "Merge PDF" })).toBeTruthy();
    const qr = screen.getByTestId("status-group-qr");
    expect(qr.textContent).toContain("Some work offline");
  });
});
