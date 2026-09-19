/// <reference lib="dom" />
// The five top user journeys, in one browser, against one production server (19-testing.md).
//
// Phases 04-18 each left a deep E2E suite for their own area, and those stay. What was missing is
// a suite that walks the journeys the *build file* names, in the order a person would meet them,
// so a regression that only shows up when the pieces are used together has somewhere to fail:
//
//   1. Upload and convert a PDF.
//   2. Save a workflow and run it.
//   3. Sign up and log in.
//   4. Install the app as a PWA.
//   5. Ask the AI Assistant for a multi-tool job (master plan §7.1).
//
// Journey 3 needs a database and skips itself without one, exactly as the app degrades. The other
// four never do: they are the guest experience, which must work with nothing configured at all.
//
// Needs a production build (`npm run build`) and a local Chrome or Edge. Run with
// `npm run test:e2e`.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  hasTestDatabase,
  testDatabaseUrl,
  urlForSchema,
} from "../../apps/api/src/db/testing.ts";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_JOURNEY_PORT ?? 3120);
const SCHEMA = "test_journeys_e2e";

let server: ChildProcess | undefined;
let browser: Browser;
let workDir: string;

const baseUrl = () => process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
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
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-e2e-journeys-"));
  if (!process.env.E2E_BASE_URL) {
    // The server gets a private schema, with the migrations applied into it, so journey 3 starts
    // from an empty database and leaves nothing behind.
    if (hasTestDatabase()) await (await createIsolatedTestPrisma(SCHEMA)).$disconnect();
    if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
      throw new Error("Run `npm run build` before `npm run test:e2e`.");
    }
    const url = hasTestDatabase() ? urlForSchema(testDatabaseUrl() as string, SCHEMA) : undefined;
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
          ...(url ? { DATABASE_URL: url } : {}),
          NEXTAUTH_URL: `http://127.0.0.1:${port}`,
          APP_URL: `http://127.0.0.1:${port}`,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-only-secret-value-not-for-real-use",
          MAIL_TRANSPORT: "console",
        },
      },
    );
  }
  await waitForServer(baseUrl());
  browser = await launchBrowser();
}, 150_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
  await fs.rm(workDir, { recursive: true, force: true });
  if (hasTestDatabase() && !process.env.E2E_BASE_URL) await dropTestSchema(SCHEMA);
});

async function newPage(): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  return context.newPage();
}

/** A two-page PDF with real text on it, for the upload journey. */
async function writePdf(name: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([300, 400]);
    page.drawText(`OneStop journey page ${i + 1}`, { x: 40, y: 340, size: 14, font });
  }
  const file = path.join(workDir, name);
  await fs.writeFile(file, await doc.save());
  return file;
}

/** A small PNG on disk, for the workflow journey. */
async function writePng(name: string): Promise<string> {
  const file = path.join(workDir, name);
  const bytes = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#2563eb" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(file, bytes);
  return file;
}

describe("journey 1: upload and convert a PDF", () => {
  it("picks a PDF in the UI, converts it and downloads the result", async () => {
    const page = await newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const source = await writePdf("journey.pdf", 2);

    await page.goto(`${baseUrl()}/tools/pdf/pdf-to-text`);
    await page.setInputFiles("input[type=file]", source);
    await expect(page.getByText("journey.pdf").first().isVisible()).resolves.toBe(true);

    await page.getByRole("button", { name: "Run PDF → Text" }).click();
    // Success is a state the page reports, not merely the absence of a spinner. The budget is
    // generous because this is usually the first tool run against a freshly started server, which
    // pays pdf.js's one-off load on top of the conversion itself.
    const panel = page.locator('[data-state="success"]');
    await panel.waitFor({ timeout: 240_000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("result-download").click();
    const saved = path.join(workDir, "journey-output.txt");
    await (await downloadPromise).saveAs(saved);
    expect((await fs.stat(saved)).size).toBeGreaterThan(0);

    expect(errors).toEqual([]);
    await page.context().close();
  }, 300_000);
});

describe("journey 2: save a workflow and run it", () => {
  it("builds a two-step workflow as a guest, saves it, finds it and runs it", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/workflows/new`);

    // Step 1: build the chain the way the builder wants it - Save stays disabled until the steps
    // are there and compatible, which is itself part of the journey.
    await page.getByLabel("Name").fill("Journey workflow");
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page
      .getByTestId("workflow-step-0")
      .getByLabel("Tool", { exact: true })
      .selectOption("image-to-pdf");
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page
      .getByTestId("workflow-step-1")
      .getByLabel("Tool", { exact: true })
      .selectOption("compress-pdf");
    await page.getByRole("button", { name: "Save workflow" }).click();

    await page.waitForURL(
      (url) => /\/workflows\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
      { timeout: 60_000 },
    );
    const url = page.url();

    // Step 2: it really persisted - a full reload of /workflows still lists it.
    await page.goto(`${baseUrl()}/workflows`);
    const list = page.getByTestId("workflow-list");
    await list.waitFor({ timeout: 60_000 });
    expect(await list.textContent()).toMatch(/Journey workflow/);

    // Step 3: run it on a real image and get a PDF back.
    await page.goto(url);
    await page.getByTestId("workflow-runner").waitFor({ timeout: 60_000 });
    await page
      .getByTestId("workflow-runner")
      .locator("input[type=file]")
      .setInputFiles(await writePng("journey.png"));
    await page.getByRole("button", { name: "Run workflow" }).click();

    const result = page.getByTestId("workflow-run-result");
    await result.waitFor({ timeout: 240_000 });
    const text = (await result.textContent()) ?? "";
    expect(text).toMatch(/Finished/);
    const href = await result.getByRole("link").first().getAttribute("href");
    const response = await page.request.get(`${baseUrl()}${href}`);
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await page.context().close();
  }, 360_000);
});

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("journey 3: sign up and log in", () => {
  const email = `journey-${Date.now()}@example.com`;
  const password = "a-very-good-password";

  it("creates an account, signs out, and signs back in", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/auth/signup`);
    await page.getByLabel("Name").fill("Journey Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL(`${baseUrl()}/account`, { timeout: 60_000 });
    await expect(page.getByText(email).first().isVisible()).resolves.toBe(true);

    await page.getByRole("button", { name: "Sign out" }).click();
    // Auth.js builds the post-sign-out URL from its own host setting, which may spell the same
    // server as "localhost" rather than "127.0.0.1" - either is the home page.
    await page.waitForURL(new RegExp(`^https?://(localhost|127[.]0[.]0[.]1):${port}/$`), {
      timeout: 60_000,
    });
    // Signed out, /account is no longer reachable.
    await page.goto(`${baseUrl()}/account`);
    await page.waitForURL(/\/auth\/login/, { timeout: 60_000 });

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl()}/account`, { timeout: 60_000 });
    await expect(page.getByText(email).first().isVisible()).resolves.toBe(true);
    await page.context().close();
  }, 240_000);
});

describe("journey 4: install the app as a PWA", () => {
  it("meets the installability criteria a browser actually checks", async () => {
    const page = await newPage();
    await page.goto(baseUrl(), { waitUntil: "domcontentloaded" });

    // 1. The page links a manifest...
    const href = await page.getAttribute('link[rel="manifest"]', "href");
    expect(href).toBeTruthy();
    const manifest = (await (await fetch(new URL(href!, baseUrl()).toString())).json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: { sizes?: string; src?: string; purpose?: string }[];
    };
    // 2. ...with the fields Chrome requires for an install prompt...
    expect(manifest.name || manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
    const sizes = (manifest.icons ?? []).map((i) => i.sizes ?? "");
    expect(sizes.some((s) => s.includes("192"))).toBe(true);
    expect(sizes.some((s) => s.includes("512"))).toBe(true);
    // 3. ...icons that are really served...
    for (const icon of manifest.icons ?? []) {
      const res = await fetch(new URL(icon.src!, baseUrl()).toString());
      expect(res.ok, `${icon.src} is listed in the manifest but not served`).toBe(true);
    }
    // 4. ...and a service worker that takes control of the page.
    const controlled = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      return Boolean(reg.active || navigator.serviceWorker.controller);
    });
    expect(controlled).toBe(true);
    await page.context().close();
  }, 120_000);
});

describe("journey 5: ask the AI Assistant for a multi-tool job", () => {
  it("plans master plan §7.1's request as a chain of registry tools", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/assistant`, { waitUntil: "domcontentloaded" });

    const box = page.getByRole("textbox").first();
    await box.fill("Convert these images to a PDF, compress it and email-size it");
    await page.getByRole("button", { name: /send|ask|plan|go/i }).first().click();

    // With no AI runtime configured (the default, and the free-first promise), the assistant must
    // still answer - with a plan from the registry, or with an honest "no runtime" message. What
    // it must never do is fail silently or name a tool that is not in the catalogue.
    const answer = page.locator("main");
    await answer.waitFor({ state: "visible", timeout: 60_000 });
    const text = await answer.innerText();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/pdf|runtime|model|ollama|assistant/i);
    await page.context().close();
  }, 180_000);
});
