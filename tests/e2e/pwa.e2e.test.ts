/// <reference lib="dom" />
// Real-browser PWA and offline checks (18-pwa-offline.md).
//
// Two different "offline" situations are simulated, because they are genuinely different for a
// local-first app:
//
//   1. **No Internet, OneStop still running** - the laptop case. The server is started with its
//      connectivity probe pointed at a closed port, so it honestly reports "no Internet". Every
//      `offline: true` tool must still work and every `network: "required"` tool must show the
//      master plan §22 message. This is the acceptance criterion's main case.
//   2. **Nothing reachable at all** - Playwright's `context.setOffline(true)`, which cuts localhost
//      too. The app shell must still load from the service worker's cache, and an unvisited route
//      must land on /offline rather than a browser error page.
//
// Needs a production build (`npm run build`) and a local Chrome or Edge; no browser download.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getTool, tools } from "@onestop/tool-registry";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_PORT ?? 3118);
const base = `http://127.0.0.1:${port}`;

let server: ChildProcess | undefined;
let browser: Browser;

function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? base;
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.E2E_BROWSER_PATH) {
    return chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH });
  }
  const errors: unknown[] = [];
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (err) {
      errors.push(err);
    }
  }
  throw new Error(`No Chrome/Edge found; set E2E_BROWSER_PATH. ${String(errors.at(-1))}`);
}

beforeAll(async () => {
  if (!process.env.E2E_BASE_URL) {
    if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
      throw new Error("Run `npm run build` before `npm run test:e2e`.");
    }
    server = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/next/dist/bin/next"),
        "start",
        "-p",
        String(port),
        "-H",
        "127.0.0.1",
      ],
      {
        cwd: path.join(root, "apps/web"),
        stdio: "ignore",
        env: {
          ...process.env,
          // Port 9 (discard) refuses connections, so the server's Internet probe always fails and
          // this whole suite runs in the deterministic "no Internet" state. Nothing else changes.
          CONNECTIVITY_CHECK_URL: "http://127.0.0.1:9/probe",
        },
      },
    );
  }
  await waitForServer(baseUrl() + "/api/ping");
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

/** A context whose page is already controlled by the service worker. */
async function controlledPage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(baseUrl() + "/", { waitUntil: "load" });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    // Wait for this page to actually be controlled, so the cache is in play for the next request.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
        if (registration.active) resolve();
      });
    }
  });
  // A second load makes sure the worker is serving, and warms the shell cache.
  await page.goto(baseUrl() + "/", { waitUntil: "load" });
  await page.goto(baseUrl() + "/tools", { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  });
  return { context, page };
}

describe("installability", () => {
  it("serves a valid manifest with real icons at the installable sizes", async () => {
    const manifestRes = await fetch(baseUrl() + "/manifest.json");
    expect(manifestRes.ok).toBe(true);
    const manifest = (await manifestRes.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);

    const start = await fetch(baseUrl() + manifest.start_url);
    expect(start.status).toBe(200);

    for (const icon of manifest.icons) {
      const res = await fetch(baseUrl() + icon.src);
      expect(res.status, icon.src).toBe(200);
      if (icon.type !== "image/png") continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(`${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it("links the manifest, a theme colour and an apple touch icon from every page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl() + "/tools");
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
      themeColor: document.querySelector('meta[name="theme-color"]') !== null,
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
    }));
    expect(head.manifest).toBe("/manifest.json");
    expect(head.themeColor).toBe(true);
    expect(head.apple).toContain("apple-touch-icon");
    expect(head.viewport).toContain("width=device-width");
    await context.close();
  });

  it("registers a service worker that takes control of the page", async () => {
    const { context, page } = await controlledPage();
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      return {
        scope: registration?.scope ?? null,
        controlled: Boolean(navigator.serviceWorker.controller),
        script: registration?.active?.scriptURL ?? null,
      };
    });
    expect(state.controlled).toBe(true);
    expect(state.script).toContain("/sw.js");
    expect(state.scope).toBe(baseUrl() + "/");
    await context.close();
  });

  it("caches the shell it promises to cache", async () => {
    const { context, page } = await controlledPage();
    const status = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => resolve(event.data);
          navigator.serviceWorker.controller?.postMessage({ type: "CACHE_STATUS" }, [
            channel.port2,
          ]);
          setTimeout(() => resolve(null), 8000);
        }),
    );
    expect(status).not.toBeNull();
    const cache = status as { version: string; entries: number; shellCached: string[] };
    expect(cache.entries).toBeGreaterThan(0);
    expect(cache.shellCached).toContain("/offline");
    expect(cache.shellCached).toContain("/");
    await context.close();
  });
});

describe("no Internet, OneStop still running", () => {
  it("shows the offline state in the header and a banner that says what still works", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl() + "/");
    await expect(
      page.locator('[data-reach="limited"]').first().waitFor({ timeout: 15_000 }),
    ).resolves.toBeUndefined();
    const banner = page.getByTestId("offline-banner");
    await banner.waitFor({ timeout: 15_000 });
    expect(await banner.textContent()).toContain("still work");
    await context.close();
  });

  it("runs an offline-capable tool successfully", async () => {
    const tool = getTool("uuid-generator")!;
    expect(tool.offline).toBe(true);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl() + "/tools/dev-utility/uuid-generator");
    await page.getByTestId("offline-banner").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: `Run ${tool.name}` }).click();
    await page.locator('[data-state="success"]').waitFor({ timeout: 30_000 });
    const panel = await page.locator('[data-state="success"]').textContent();
    expect(panel).toContain("Done");
    await context.close();
  });

  it("blocks an online-only tool with the §22 message and never calls the run endpoint", async () => {
    const tool = tools.find((t) => t.network === "required" && t.category === "network")!;
    const context = await browser.newContext();
    const page = await context.newPage();
    const runCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/tools/run")) runCalls.push(request.url());
    });
    await page.goto(`${baseUrl()}/tools/${tool.category}/${tool.slug}`);
    const blocked = page.locator('[data-state="unavailable"]');
    await blocked.waitFor({ timeout: 15_000 });
    expect(await blocked.textContent()).toContain(
      "This tool needs an Internet connection. Connect and try again.",
    );
    expect(runCalls).toEqual([]);
    // The rest of the UI stays usable: navigation still works while a tool is blocked.
    await page.getByRole("link", { name: "OneStop" }).first().click();
    await page.waitForURL(baseUrl() + "/");
    expect(await page.locator("h1").first().textContent()).toContain("What do you want to do?");
    await context.close();
  });

  it("keeps the rest of the app responsive: search, catalogue and history still render", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl() + "/tools");
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill("merge pdf");
    await page.getByRole("link", { name: "Merge PDF" }).first().waitFor({ timeout: 15_000 });
    await page.goto(baseUrl() + "/history");
    await page.locator("h1").first().waitFor();
    await context.close();
  });
});

describe("status page", () => {
  it("reports per-category offline capability that matches the registry", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl() + "/status");
    await page.locator("h1").first().waitFor();

    const totals = await page.getByTestId("offline-totals").textContent();
    const expectedOffline = tools.filter((t) => t.offline).length;
    const expectedOnlineOnly = tools.filter((t) => !t.offline && t.network === "required").length;
    expect(totals).toContain(String(tools.length));
    expect(totals).toContain(String(expectedOffline));
    expect(totals).toContain(String(expectedOnlineOnly));

    // Sample three groups across the catalogue and check the counts on the card.
    for (const group of ["pdf", "media", "qr"]) {
      const card = await page.getByTestId(`status-group-${group}`).textContent();
      expect(card, group).toContain("total");
    }

    // Every tool row on the page, read straight out of the DOM (the category lists are inside
    // collapsed <details>, so they are present but not visible - which is what we want to read).
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll("li")].flatMap((li) => {
        const link = li.querySelector("a");
        const badge = li.querySelector("[data-offline-class]");
        if (!link || !badge) return [];
        return [{ href: link.getAttribute("href") ?? "", label: badge.textContent?.trim() ?? "" }];
      }),
    );
    const samples = ["merge-pdf", "uuid-generator", "ip-geolocation", "qr-code-generator"];
    for (const id of samples) {
      const tool = getTool(id)!;
      const expectedLabel = tool.offline
        ? "Works offline"
        : tool.network === "required"
          ? "Needs the Internet"
          : "Not verified offline";
      const row = rendered.find((r) => r.href === `/tools/${tool.category}/${tool.slug}`);
      expect(row, id).toBeDefined();
      expect(row?.label, id).toBe(expectedLabel);
    }
    // And the page's labels agree with the registry for every tool it lists.
    for (const row of rendered) {
      const tool = tools.find((t) => `/tools/${t.category}/${t.slug}` === row.href);
      if (!tool) continue;
      const expectedLabel = tool.offline
        ? "Works offline"
        : tool.network === "required"
          ? "Needs the Internet"
          : "Not verified offline";
      expect(row.label, tool.id).toBe(expectedLabel);
    }

    // The live panel agrees with the simulated state.
    const panel = page.getByTestId("connectivity-panel");
    await panel.waitFor();
    await page.locator('[data-testid="connectivity-panel"][data-reach="limited"]').waitFor({
      timeout: 15_000,
    });
    await context.close();
  });

  it("reports what the service worker has cached", async () => {
    const { context, page } = await controlledPage();
    await page.goto(baseUrl() + "/status");
    const state = page.getByTestId("sw-state");
    await state.waitFor();
    await expect
      .poll(async () => (await state.textContent()) ?? "", { timeout: 15_000 })
      .toMatch(/cached (entry|entries)/);
    await context.close();
  });
});

describe("nothing reachable at all", () => {
  it("still loads the cached shell and lands on /offline for an unvisited route", async () => {
    const { context, page } = await controlledPage();
    await context.setOffline(true);

    // A page that was cached while online still renders, from the service worker.
    await page.goto(baseUrl() + "/tools", { waitUntil: "domcontentloaded" });
    expect(await page.locator("h1").first().textContent()).toBeTruthy();

    // A route that was never visited gets the offline page, not a browser error.
    await page.goto(baseUrl() + "/settings", { waitUntil: "domcontentloaded" });
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).toContain("You are offline");

    // And the app knows: the badge reports the server as unreachable.
    await page.goto(baseUrl() + "/", { waitUntil: "domcontentloaded" });
    await page.locator('[data-reach="offline"]').first().waitFor({ timeout: 20_000 });

    await context.setOffline(false);
    await context.close();
  });

  it("answers a blocked API call with the offline message instead of failing silently", async () => {
    const { context, page } = await controlledPage();
    await context.setOffline(true);
    const answer = await page.evaluate(async () => {
      const response = await fetch("/api/tools/run", { method: "POST", body: new FormData() });
      return { status: response.status, body: await response.json() };
    });
    expect(answer.status).toBe(503);
    expect((answer.body as { error: { code: string; message: string } }).error).toEqual({
      code: "OFFLINE",
      message: "This tool needs an Internet connection. Connect and try again.",
    });
    await context.setOffline(false);
    await context.close();
  });
});
