/*
 * OneStop service worker (18-pwa-offline.md).
 *
 * Hand-written rather than Workbox-generated: the whole policy is the four rules below, which is
 * less code than the config would be, and it adds no dependency and no build step (CLAUDE.md §2,
 * §3 - see PROGRESS.md for the deviation note).
 *
 *   1. App shell + icons + manifest  -> precached at install, so the app opens with no network.
 *   2. Build assets (/_next/static/) -> cache-first; their URLs contain a content hash.
 *   3. Other same-origin GETs        -> stale-while-revalidate, then cache, then /offline.
 *   4. Anything that processes work   -> never cached. /api/* is network-only, and a failed
 *      request answers with the master plan §22 offline wording instead of a browser error page.
 *
 * Nothing a tool produces is ever cached: downloads live under /api/files, which rule 4 covers,
 * so a result is not silently served twice (CLAUDE.md §5 - temp files expire server-side).
 *
 * The file is plain JS on purpose (it is served from /public as-is and must parse in a worker
 * with no bundler). `self.__sw` exposes the internals so `apps/web/src/test/pwa.test.tsx` can
 * drive them in a fake worker scope.
 */

// Bump when the shell or these rules change: it renames the caches, so the next activation drops
// the previous build's entries.
const VERSION = "v1";
const SHELL_CACHE = `onestop-shell-${VERSION}`;
const ASSET_CACHE = `onestop-assets-${VERSION}`;
const PAGE_CACHE = `onestop-pages-${VERSION}`;
const OWNED = [SHELL_CACHE, ASSET_CACHE, PAGE_CACHE];

/** The offline fallback, and the routes worth having before the first offline visit. */
const OFFLINE_URL = "/offline";
const SHELL_URLS = [
  OFFLINE_URL,
  "/",
  "/tools",
  "/status",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/icon.svg",
];

/** How long a navigation waits for the network before the cache answers instead. */
const NAV_TIMEOUT_MS = 3500;

/** Master plan §22 wording, kept byte-identical to ERROR_MESSAGES.offline in @onestop/types. */
const OFFLINE_MESSAGE = "This tool needs an Internet connection. Connect and try again.";

/** Same-origin paths that must always go to the server: they do work, or they report state. */
function isNeverCached(pathname) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/q/") || // dynamic QR redirects resolve server-side (11-qr-tools.md)
    pathname.startsWith("/_next/image")
  );
}

/** Build output: immutable, content-hashed URLs. */
function isBuildAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

/** Static files we ship in /public. */
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.json" ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js|txt|webmanifest)$/.test(pathname)
  );
}

/** Which of the four rules applies. Pure, so the test suite can assert the routing table. */
function routeFor(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "passthrough";
  }
  if (url.origin !== self.location.origin) return "passthrough";
  if (request.method !== "GET") return isNeverCached(url.pathname) ? "api" : "passthrough";
  if (isNeverCached(url.pathname)) return "api";
  if (isBuildAsset(url.pathname)) return "asset";
  if (request.mode === "navigate" || request.destination === "document") return "navigate";
  if (isStaticAsset(url.pathname)) return "asset";
  return "runtime";
}

function offlineApiResponse() {
  return new Response(
    JSON.stringify({ ok: false, error: { code: "OFFLINE", message: OFFLINE_MESSAGE } }),
    {
      status: 503,
      statusText: "Offline",
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

/** A GET response worth keeping: a real 200 from this origin, not a partial or an opaque one. */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type !== "opaque";
}

async function putInCache(cacheName, request, response) {
  if (!isCacheable(response)) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    // A full or blocked storage bucket must never fail the request the user is waiting on.
  }
}

/** Rule 4: straight to the network, with the §22 message instead of a browser error page. */
async function handleApi(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineApiResponse();
  }
}

/** Rule 2: cache-first. Hashed URLs never change contents, so a hit needs no revalidation. */
async function handleAsset(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  void putInCache(ASSET_CACHE, request, response);
  return response;
}

function timeout(ms) {
  return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

/**
 * Rule 3 (documents): network-first with a short timeout, then this page from the cache, then any
 * cached shell page, then /offline. A stale page beats a dinosaur, and /offline explains itself.
 */
async function handleNavigate(request) {
  try {
    const response = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]);
    void putInCache(PAGE_CACHE, request, response);
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { ignoreVary: true });
    if (offline) return offline;
    const root = await caches.match("/", { ignoreVary: true });
    if (root) return root;
    return new Response(
      "<!doctype html><title>Offline</title><p>OneStop is offline and this page was never cached.",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

/** Rule 3 (everything else): answer from the cache at once, refresh it in the background. */
async function handleRuntime(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  const fetching = fetch(request)
    .then((response) => {
      const target = request.destination === "script" ? ASSET_CACHE : PAGE_CACHE;
      void putInCache(target, request, response);
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await fetching;
  if (fresh) return fresh;
  return new Response("", { status: 504, statusText: "Offline" });
}

function handleRequest(request) {
  switch (routeFor(request)) {
    case "api":
      return handleApi(request);
    case "asset":
      return handleAsset(request);
    case "navigate":
      return handleNavigate(request);
    case "runtime":
      return handleRuntime(request);
    default:
      return null; // passthrough: the browser handles it as if no worker existed.
  }
}

async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  // One at a time and individually tolerant: a single 404 must not fail the whole install, or the
  // worker never activates and the app has no offline shell at all.
  await Promise.all(
    SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (isCacheable(response)) await cache.put(url, response.clone());
      } catch {
        // Offline at install time, or the route is gone: the runtime rules will fill it later.
      }
    }),
  );
}

async function dropOldCaches() {
  const names = await caches.keys();
  const stale = names.filter((n) => n.startsWith("onestop-") && !OWNED.includes(n));
  await Promise.all(stale.map((n) => caches.delete(n)));
}

async function clearOwnCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith("onestop-")).map((n) => caches.delete(n)));
}

/** What /status reports about the cache, so the page never guesses. */
async function cacheStatus() {
  const names = (await caches.keys()).filter((n) => n.startsWith("onestop-"));
  let entries = 0;
  for (const name of names) {
    const cache = await caches.open(name);
    entries += (await cache.keys()).length;
  }
  const shell = await caches.open(SHELL_CACHE);
  const shellKeys = await shell.keys();
  return {
    version: VERSION,
    caches: names,
    entries,
    shellUrls: SHELL_URLS,
    shellCached: shellKeys.map((r) => new URL(r.url).pathname),
  };
}

self.addEventListener("install", (event) => {
  // The shell is small and the worker is useless without it, so install waits for it.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await dropOldCaches();
      if (self.registration && self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch {
          // Not supported here; harmless.
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const response = handleRequest(event.request);
  if (response) event.respondWith(response);
});

self.addEventListener("message", (event) => {
  const data = event.data;
  const type = typeof data === "string" ? data : data && data.type;
  if (type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }
  const reply = (payload) => {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
  };
  if (type === "CACHE_STATUS") {
    event.waitUntil(cacheStatus().then(reply));
    return;
  }
  if (type === "CLEAR_CACHES") {
    event.waitUntil(
      clearOwnCaches()
        .then(() => precache())
        .then(() => reply({ ok: true })),
    );
  }
});

// Test seam: see the header comment. Unused by the browser.
self.__sw = {
  VERSION,
  SHELL_CACHE,
  ASSET_CACHE,
  PAGE_CACHE,
  SHELL_URLS,
  OFFLINE_URL,
  OFFLINE_MESSAGE,
  NAV_TIMEOUT_MS,
  routeFor,
  handleRequest,
  handleApi,
  handleAsset,
  handleNavigate,
  handleRuntime,
  precache,
  dropOldCaches,
  clearOwnCaches,
  cacheStatus,
  offlineApiResponse,
};
