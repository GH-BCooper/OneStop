/// <reference lib="dom" />
// Real-server, real-browser proof of phase 14 (14-history-favorites.md):
//
//   * a guest runs a tool and finds it on /history, with the history kept on the device;
//   * a signed-in user's run persists to Postgres and survives a new browser session;
//   * a favourite toggled in one session is there in the next, and shows up on the Home page;
//   * a theme set while signed in on session A appears on session B of the same account - the
//     build file's settings-sync acceptance criterion, which only a second browser context can
//     really show.
//
// Needs `npm run build`, a local Chrome or Edge, and a database (TEST_DATABASE_URL/DATABASE_URL);
// with no database the whole file skips, exactly as the app degrades.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  hasTestDatabase,
  testDatabaseUrl,
  urlForSchema,
} from "../../apps/api/src/db/testing.ts";
import type { PrismaClient } from "../../apps/api/src/db/client.ts";

const TOOL_NAME = "Text → QR";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_HISTORY_PORT ?? 3115);
const SCHEMA = "test_history_e2e";

let server: ChildProcess | undefined;
let browser: Browser;
let prisma: PrismaClient;

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

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("history, favourites and settings sync in a real browser", () => {
  const email = `e2e-history-${Date.now()}@example.com`;
  const password = "a-very-good-password";

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
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
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          DATABASE_URL: urlForSchema(testDatabaseUrl() as string, SCHEMA),
          NEXTAUTH_URL: `http://127.0.0.1:${port}`,
          APP_URL: `http://127.0.0.1:${port}`,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-only-secret-value-not-for-real-use",
          MAIL_TRANSPORT: "console",
        },
      },
    );
    await waitForServer(baseUrl());
    browser = await launchBrowser();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await prisma?.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  /** A fresh browser context - a different "session" with its own cookies and storage. */
  async function newPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    return context.newPage();
  }

  /** Runs a tool that needs no upload, so the flow is about history, not about files. */
  async function runTextToQr(page: Page, text: string): Promise<void> {
    await page.goto(`${baseUrl()}/tools/qr/text-to-qr`);
    await page.getByRole("textbox").first().fill(text);
    await page.getByRole("button", { name: /^Run / }).click();
    await page.getByRole("heading", { name: "Done" }).waitFor({ timeout: 60_000 });
  }

  async function signUp(page: Page): Promise<void> {
    await page.goto(`${baseUrl()}/auth/signup`);
    await page.getByLabel("Name").fill("History Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });
  }

  async function signIn(page: Page): Promise<void> {
    await page.goto(`${baseUrl()}/auth/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });
  }

  it("a guest's run lands on /history, on the device, with no account", async () => {
    const page = await newPage();
    await runTextToQr(page, "guest run");

    await page.goto(`${baseUrl()}/history`);
    await page.getByText(/this device only/i).waitFor({ timeout: 30_000 });
    await page.getByRole("link", { name: /sign in to save your history/i }).waitFor();
    await page.getByRole("link", { name: TOOL_NAME }).first().waitFor({ timeout: 30_000 });

    // It really is in IndexedDB, and nothing was written to the account (there is none).
    const stored = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const request = indexedDB.open("onestop", 1);
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction("history", "readonly").objectStore("history").getAll();
            all.onsuccess = () => {
              resolve((all.result as unknown[]).length);
              db.close();
            };
            all.onerror = () => resolve(-1);
          };
          request.onerror = () => resolve(-1);
        }),
    );
    expect(stored).toBeGreaterThan(0);
    expect(await prisma.job.count({ where: { userId: { not: null } } })).toBe(0);

    // Clearing the browser's storage clears the history - the documented guest trade-off.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase("onestop");
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );
    await page.reload();
    await page.getByText(/nothing here yet/i).waitFor({ timeout: 30_000 });
    await page.context().close();
  });

  it("a signed-in run persists, and is still there in a brand-new session", async () => {
    const sessionA = await newPage();
    await signUp(sessionA);
    await runTextToQr(sessionA, "signed-in run");

    await sessionA.goto(`${baseUrl()}/history`);
    await sessionA.getByRole("link", { name: TOOL_NAME }).first().waitFor({ timeout: 30_000 });
    // It is a row in Postgres, attributed to the account.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.job.count({ where: { userId: user.id, toolId: "text-to-qr" } })).toBe(1);
    await sessionA.context().close();

    // Session B: a different browser context, so a different cookie jar and empty IndexedDB.
    const sessionB = await newPage();
    await signIn(sessionB);
    await sessionB.goto(`${baseUrl()}/history`);
    await sessionB.getByRole("link", { name: TOOL_NAME }).first().waitFor({ timeout: 30_000 });
    // ...and it is the synced copy, not a device one.
    expect(await sessionB.getByText("This device").count()).toBe(0);

    // Filtering narrows it, and a filter that excludes it empties the list.
    await sessionB.getByLabel("Category").selectOption("qr");
    await sessionB.getByRole("link", { name: TOOL_NAME }).first().waitFor({ timeout: 30_000 });
    await sessionB.getByLabel("Category").selectOption("pdf");
    await sessionB.getByText(/nothing matches those filters/i).waitFor({ timeout: 30_000 });
    await sessionB.context().close();
  });

  it("a favourite set in one session is there in the next, and on the Home page", async () => {
    const sessionA = await newPage();
    await signIn(sessionA);
    await sessionA.goto(`${baseUrl()}/tools/qr/text-to-qr`);
    await sessionA.getByRole("button", { name: `Add ${TOOL_NAME} to favourites` }).click();
    await sessionA
      .getByRole("button", { name: `Remove ${TOOL_NAME} from favourites` })
      .waitFor({ timeout: 30_000 });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await expect
      .poll(() => prisma.favorite.count({ where: { userId: user.id, toolId: "text-to-qr" } }), {
        timeout: 15_000,
      })
      .toBe(1);
    await sessionA.context().close();

    const sessionB = await newPage();
    await signIn(sessionB);
    await sessionB.goto(`${baseUrl()}/`);
    await sessionB.getByRole("heading", { name: /your favourites/i }).waitFor({ timeout: 30_000 });
    await sessionB.getByText(/synced to your account/i).waitFor();
    await sessionB.context().close();
  });

  it("a theme set while signed in on session A shows up on session B", async () => {
    const sessionA = await newPage();
    await signIn(sessionA);
    await sessionA.goto(`${baseUrl()}/settings`);
    await sessionA.getByRole("button", { name: "Dark", exact: true }).click();
    await sessionA.getByText(/saved to your account/i).waitFor({ timeout: 30_000 });
    await expect
      .poll(() => sessionA.evaluate(() => document.documentElement.dataset.theme), {
        timeout: 15_000,
      })
      .toBe("dark");
    await sessionA.context().close();

    // Session B starts light (a fresh profile, and the OS default in headless Chrome), and the
    // account's setting is applied once the Settings page reads it.
    const sessionB = await newPage();
    await signIn(sessionB);
    await sessionB.goto(`${baseUrl()}/settings`);
    await expect
      .poll(() => sessionB.evaluate(() => document.documentElement.dataset.theme), {
        timeout: 30_000,
      })
      .toBe("dark");
    await expect(
      sessionB.getByRole("button", { name: "Dark", exact: true }).getAttribute("aria-pressed"),
    ).resolves.toBe("true");
    await sessionB.context().close();
  });

  it("a dynamic QR code made while signed in is owned by that account in Postgres", async () => {
    const page = await newPage();
    await signIn(page);
    await page.goto(`${baseUrl()}/tools/qr/dynamic-qr-code`);
    await page.getByRole("textbox").first().fill("https://example.com/e2e-target");
    await page.getByRole("button", { name: /^Run / }).click();
    await page.getByRole("heading", { name: "Done" }).waitFor({ timeout: 60_000 });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const links = await prisma.qrLink.findMany({ where: { userId: user.id } });
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("https://example.com/e2e-target");

    // The printed short URL resolves, and the scan is counted in the qr_scans table.
    const id = links[0]!.id;
    const visitor = await newPage();
    await visitor.goto(`${baseUrl()}/q/${id}`);
    await visitor.waitForURL(/example\.com/, { timeout: 30_000 }).catch(() => {
      // example.com may be unreachable offline; the redirect itself is what is being tested.
    });
    await expect
      .poll(() => prisma.qrScan.count({ where: { linkId: id } }), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await visitor.context().close();
    await page.context().close();
  });
});
