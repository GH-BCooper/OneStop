/// <reference lib="dom" />
// Real-server, real-browser proof of phase 15 (15-workflows.md):
//
//   * the builder refuses an incompatible chain while you are still building it;
//   * a guest builds "Image → PDF → Compress PDF", saves it on the device, reloads the page and
//     the workflow is still there and editable;
//   * running it really produces a downloadable PDF, with every step reported;
//   * batch mode runs N files separately and one deliberately broken file fails on its own while
//     the others finish;
//   * a signed-in user's workflow persists to Postgres and is there in a brand-new session.
//
// Needs `npm run build` and a local Chrome or Edge. The signed-in half also needs a database
// (TEST_DATABASE_URL/DATABASE_URL) and skips itself without one — the guest half never does,
// because a workflow needs no account.
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

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_WORKFLOWS_PORT ?? 3116);
const SCHEMA = "test_workflows_e2e";

let server: ChildProcess | undefined;
let browser: Browser;
let prisma: PrismaClient | undefined;

const baseUrl = () => process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const hasDb = hasTestDatabase();

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

/** A tiny but real PNG, built in the page so the upload is a genuine file. */
const MAKE_PNG = (name: string, broken = false) => `
  (async () => {
    const dt = new DataTransfer();
    if (${broken}) {
      dt.items.add(new File([new TextEncoder().encode("not a png at all")], "${name}", { type: "image/png" }));
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = "#0b1f5c"; ctx.fillRect(20, 60, 200, 40);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      dt.items.add(new File([blob], "${name}", { type: "image/png" }));
    }
    return dt;
  })()
`;

async function attach(page: Page, names: { name: string; broken?: boolean }[]): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  const handles = [];
  for (const file of names) {
    handles.push(await page.evaluateHandle(MAKE_PNG(file.name, file.broken === true)));
  }
  // One DataTransfer holding every file, so the change event looks like a real multi-select.
  await page.evaluate(
    ([element, transfers]) => {
      const merged = new DataTransfer();
      for (const transfer of transfers as DataTransfer[]) {
        for (const file of Array.from(transfer.files)) merged.items.add(file);
      }
      (element as HTMLInputElement).files = merged.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [await input.elementHandle(), handles] as const,
  );
}

/** Puts the two-step "Image → PDF → Compress PDF" chain into the builder. */
async function buildImagesToPdf(page: Page, name: string): Promise<void> {
  await page.getByLabel("Name").fill(name);
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
}

describe("workflows in a real browser", () => {
  beforeAll(async () => {
    if (!existsSync(path.join(root, "apps/web/.next/BUILD_ID"))) {
      throw new Error("Run `npm run build` before `npm run test:e2e`.");
    }
    if (hasDb) prisma = await createIsolatedTestPrisma(SCHEMA);
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
          ...(hasDb ? { DATABASE_URL: urlForSchema(testDatabaseUrl() as string, SCHEMA) } : {}),
          NEXTAUTH_URL: `http://127.0.0.1:${port}`,
          APP_URL: `http://127.0.0.1:${port}`,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-only-secret-value-not-for-real-use",
          MAIL_TRANSPORT: "console",
        },
      },
    );
    await waitForServer(baseUrl());
    browser = await launchBrowser();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    if (prisma) {
      await prisma.$disconnect();
      await dropTestSchema(SCHEMA);
    }
  });

  async function newPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    return context.newPage();
  }

  it("refuses an incompatible chain in the builder, before anything is uploaded", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/workflows/new`);
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page
      .getByTestId("workflow-step-0")
      .getByLabel("Tool", { exact: true })
      .selectOption("background-removal");
    await page.getByRole("button", { name: "+ Add step" }).click();

    const second = page.getByTestId("workflow-step-1");
    await second.getByRole("checkbox").check();
    await second.getByLabel("Tool", { exact: true }).selectOption("audio-converter");

    const issues = page.getByTestId("workflow-step-1-issues");
    await issues.waitFor({ timeout: 15_000 });
    expect(await issues.textContent()).toMatch(/Background Removal/);
    expect(await issues.textContent()).toMatch(/Audio Converter/);
    expect(await page.getByRole("button", { name: "Save workflow" }).isDisabled()).toBe(true);
    await page.context().close();
  });

  it("a guest saves a workflow on the device, finds it after a reload and runs it", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/workflows/new`);
    await buildImagesToPdf(page, "Photos to a small PDF");
    await page.getByRole("button", { name: "Save workflow" }).click();

    // Saved and navigated to its own page; a reload still finds it, filled in and editable.
    await page.waitForURL(
      (url) => /\/workflows\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
      {
        timeout: 30_000,
      },
    );
    const url = page.url();
    await page.reload();
    const nameField = page.getByLabel("Name");
    await nameField.waitFor({ timeout: 30_000 });
    await expect
      .poll(async () => nameField.inputValue(), { timeout: 30_000 })
      .toBe("Photos to a small PDF");
    await page.getByTestId("workflow-step-1").waitFor();

    // And it is listed on /workflows as a device workflow.
    await page.goto(`${baseUrl()}/workflows`);
    const list = page.getByTestId("workflow-list");
    await list.waitFor({ timeout: 30_000 });
    expect(await list.textContent()).toMatch(/Photos to a small PDF/);
    expect(await list.textContent()).toMatch(/Image → PDF → Compress PDF/);
    expect(await list.textContent()).toMatch(/This device/);

    // Run it on two real images: one PDF comes out, with both steps reported.
    await page.goto(url);
    await page.getByTestId("workflow-runner").waitFor({ timeout: 30_000 });
    await attach(page, [{ name: "one.png" }, { name: "two.png" }]);
    await page.getByRole("button", { name: "Run workflow" }).click();

    const result = page.getByTestId("workflow-run-result");
    await result.waitFor({ timeout: 180_000 });
    const text = (await result.textContent()) ?? "";
    expect(text).toMatch(/Finished/);
    expect(text).toMatch(/Image → PDF/);
    expect(text).toMatch(/Compress PDF/);

    // The result link really serves a PDF.
    const href = await result.getByRole("link").first().getAttribute("href");
    const response = await page.request.get(`${baseUrl()}${href}`);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    await page.context().close();
  }, 300_000);

  it("batch mode finishes the good files and fails only the broken one", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/workflows/new`);
    await buildImagesToPdf(page, "Batch of photos");
    await page.getByTestId("workflow-runner").waitFor({ timeout: 30_000 });
    await page.getByRole("radio", { name: /each file separately/i }).check();
    await attach(page, [
      { name: "a.png" },
      { name: "b.png" },
      { name: "broken.png", broken: true },
      { name: "d.png" },
    ]);
    await page.getByRole("button", { name: "Run workflow" }).click();

    const result = page.getByTestId("workflow-batch-result");
    await result.waitFor({ timeout: 240_000 });
    const text = (await result.textContent()) ?? "";
    expect(text).toMatch(/3 of 4 finished/);
    expect(text).toMatch(/1 failed/);
    expect(text).toMatch(/broken\.png/);
    await page.context().close();
  }, 300_000);

  (hasDb ? it : it.skip)(
    "a signed-in user's workflow persists and is there in a brand-new session",
    async () => {
      const email = `e2e-workflows-${Date.now()}@example.com`;
      const password = "a-very-good-password";

      const sessionA = await newPage();
      await sessionA.goto(`${baseUrl()}/auth/signup`);
      await sessionA.getByLabel("Name").fill("Workflow Tester");
      await sessionA.getByLabel("Email").fill(email);
      await sessionA.getByLabel("Password", { exact: true }).fill(password);
      await sessionA.getByLabel("Confirm password").fill(password);
      await sessionA.getByRole("button", { name: "Create account" }).click();
      await sessionA.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });

      await sessionA.goto(`${baseUrl()}/workflows/new`);
      await buildImagesToPdf(sessionA, "Account workflow");
      await sessionA.getByRole("button", { name: "Save workflow" }).click();
      await sessionA.waitForURL(
        (url) => /\/workflows\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
        { timeout: 30_000 },
      );

      const user = await prisma!.user.findUniqueOrThrow({ where: { email } });
      expect(await prisma!.workflow.count({ where: { userId: user.id } })).toBe(1);
      await sessionA.context().close();

      // Session B: a different context, so a different cookie jar and empty localStorage.
      const sessionB = await newPage();
      await sessionB.goto(`${baseUrl()}/auth/login`);
      await sessionB.getByLabel("Email").fill(email);
      await sessionB.getByLabel("Password").fill(password);
      await sessionB.getByRole("button", { name: "Sign in" }).click();
      await sessionB.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });

      await sessionB.goto(`${baseUrl()}/workflows`);
      const list = sessionB.getByTestId("workflow-list");
      await list.waitFor({ timeout: 30_000 });
      expect(await list.textContent()).toMatch(/Account workflow/);
      expect(await list.textContent()).toMatch(/Account/);
      await sessionB.context().close();
    },
    300_000,
  );
});
