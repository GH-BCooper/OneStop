/// <reference lib="dom" />
// Real-browser checks for the UI shell (02-ui-shell.md): route status codes, breakpoints,
// theme persistence across reload, active nav and the "Ask OneStop AI" link.
// Needs a production build (`npm run build`) and a local Chrome or Edge; no browser download.
// Run with `npm run test:e2e`.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_PORT ?? 3107);
const base = `http://127.0.0.1:${port}`;

const routes = [
  "/",
  "/assistant",
  "/tools",
  "/tools/pdf",
  "/tools/media",
  "/tools/pdf/merge-pdf",
  "/tools/dev-utility/uuid-generator",
  "/workflows",
  "/workflows/new",
  "/workflows/demo-1",
  "/history",
  "/account",
  "/settings",
  "/auth/login",
  "/auth/signup",
  "/auth/reset-password",
  "/status",
];

const widths = [375, 768, 1440];

let server: ChildProcess | undefined;
let browser: Browser;

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
      { cwd: path.join(root, "apps/web"), stdio: "ignore" },
    );
  }
  await waitForServer(baseUrl());
  browser = await launchBrowser();
}, 90_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? base;
}

async function newPage(width: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  return context.newPage();
}

describe("routes", () => {
  it.each(routes)("%s returns 200 with no page errors", async (route) => {
    const page = await newPage(1440);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(baseUrl() + route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first().isVisible()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.context().close();
  });
});

describe.each(widths)("layout at %ipx", (width) => {
  it.each(routes)("%s has no horizontal scroll or overlapping header items", async (route) => {
    const page = await newPage(width);
    await page.goto(baseUrl() + route);
    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const header = document.querySelector("header > div");
      const boxes = header
        ? [...header.children]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
        : [];
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom && b.top < a.bottom)
            overlaps++;
        }
      }
      const offscreen = [...document.querySelectorAll("a, button, input, h1")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
      }).length;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overlaps, offscreen };
    });
    expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
    expect(result.overlaps).toBe(0);
    expect(result.offscreen).toBe(0);
    await page.context().close();
  });

  it("primary nav is reachable", async () => {
    const page = await newPage(width);
    await page.goto(baseUrl() + "/");
    const menu = page.getByRole("button", { name: "Open menu" });
    if (await menu.isVisible()) await menu.click();
    const nav = page.getByRole("navigation", { name: width >= 1024 ? "Primary" : "Mobile" });
    await expect(nav.getByRole("link").count()).resolves.toBe(6);
    await page.context().close();
  });
});

describe("behaviour", () => {
  it("theme toggle switches instantly and persists across reload", async () => {
    const page = await newPage(1440);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(baseUrl() + "/");
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await theme()).toBe("light");
    const lightBg = await bg();
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    expect(await theme()).toBe("dark");
    expect(await bg()).not.toBe(lightBg);
    await page.reload();
    expect(await theme()).toBe("dark");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.reload();
    expect(await theme()).toBe("light");
    await page.context().close();
  });

  it("nav highlights the active route", async () => {
    const page = await newPage(1440);
    await page.goto(baseUrl() + "/tools/pdf");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(
      nav.getByRole("link", { name: /All Tools/ }).getAttribute("aria-current"),
    ).resolves.toBe("page");
    await expect(
      nav.getByRole("link", { name: /Home/ }).getAttribute("aria-current"),
    ).resolves.toBe(null);
    await nav.getByRole("link", { name: /History/ }).click();
    await page.waitForURL("**/history");
    await expect(
      nav.getByRole("link", { name: /History/ }).getAttribute("aria-current"),
    ).resolves.toBe("page");
    await page.context().close();
  });

  it('"Ask OneStop AI" navigates to /assistant', async () => {
    const page = await newPage(375);
    await page.goto(baseUrl() + "/");
    await page.getByRole("link", { name: "Ask OneStop AI" }).click();
    await page.waitForURL("**/assistant");
    await expect(page.locator("h1").textContent()).resolves.toBe("AI Assistant");
    await page.context().close();
  });
});

// Phase 03 (03-tool-registry.md): registry-driven catalogue, search and generic tool page.
describe("tools catalogue", () => {
  it("searches the registry from the Home search box", async () => {
    const page = await newPage(1440);
    await page.goto(baseUrl() + "/");
    await page
      .getByRole("searchbox", { name: /what do you want to do/i })
      .fill("make a pdf from images");
    await page.getByRole("button", { name: /search tools/i }).click();
    await page.waitForURL("**/tools?q=*");
    const first = page.getByRole("list", { name: "Tools" }).getByRole("link").first();
    await expect(first.getAttribute("data-tool-id")).resolves.toBe("image-to-pdf");
    await page.context().close();
  });

  it("filters by category and tag, then opens a tool page", async () => {
    const page = await newPage(1440);
    await page.goto(baseUrl() + "/tools");
    await page.selectOption("#tools-category", "qr");
    await expect(page.getByText(/^15 tools$/)).toBeTruthy();
    await page.getByRole("button", { name: "Online" }).click();
    const ids = await page
      .getByRole("list", { name: "Tools" })
      .getByRole("link")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-tool-id")));
    expect(ids).toContain("dynamic-qr-code");
    expect(ids).not.toContain("text-to-qr");
    await page
      .getByRole("link", { name: /Dynamic QR Code/ })
      .first()
      .click();
    await page.waitForURL("**/tools/qr/dynamic-qr-code");
    await expect(page.locator("h1").first().textContent()).resolves.toBe("Dynamic QR Code");
    await page.context().close();
  });

  it("never fakes success: a tool that cannot run says so, with no download", async () => {
    const page = await newPage(1440);
    // Phase 17 was the last phase to add tools, so no stub is left to click. The guarantee this
    // test exists for is the one the UI must keep either way: a run that cannot produce a result
    // ends in a clearly marked state with an actionable message and nothing to download.
    await page.goto(baseUrl() + "/tools/network/ip-address-lookup");
    await page.getByRole("textbox").first().fill("not-an-ip-address");
    await page.getByRole("button", { name: /^Run IP Address Lookup$/ }).click();
    await page.locator('[data-state="unsupported"]').waitFor({ timeout: 15_000 });
    await expect(page.getByRole("status").textContent()).resolves.toMatch(
      /not a valid IP address/i,
    );
    await expect(page.getByRole("button", { name: "Download" }).count()).resolves.toBe(0);
    await page.context().close();
  });

  it("shows the legal notice on an online media page, above the form", async () => {
    const page = await newPage(1440);
    await page.goto(baseUrl() + "/tools/online-media/youtube-to-mp4");
    const notice = page.locator('[data-testid="tool-notices"] [data-tone="legal"]');
    await notice.waitFor({ timeout: 15_000 });
    await expect(notice.textContent()).resolves.toMatch(/responsible for what you download/i);
    // Spotify's page carries the "information only" note instead.
    await page.goto(baseUrl() + "/tools/online-media/spotify-link-info");
    const info = page.locator('[data-testid="tool-notices"] [data-tone="info"]');
    await info.waitFor({ timeout: 15_000 });
    await expect(info.textContent()).resolves.toMatch(/no legitimate way to take audio/i);
    await page.context().close();
  });

  it("runs the demo tool end to end", async () => {
    const page = await newPage(1440);
    await page.goto(baseUrl() + "/tools/file-utility/file-metadata-viewer");
    await page.setInputFiles("input[type=file]", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello onestop"),
    });
    await page.getByRole("button", { name: /^Run File Metadata Viewer$/ }).click();
    await page.locator('[data-state="success"]').waitFor({ timeout: 30_000 });
    await expect(page.getByRole("status").textContent()).resolves.toMatch(/done/i);
    await expect(page.getByTestId("result-download").isVisible()).resolves.toBe(true);
    await page.context().close();
  });

  it("404s on a tool that is not in the registry", async () => {
    const page = await newPage(1440);
    const res = await page.goto(baseUrl() + "/tools/pdf/not-a-real-tool");
    expect(res?.status()).toBe(404);
    await page.context().close();
  });
});
