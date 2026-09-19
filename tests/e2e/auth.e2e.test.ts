/// <reference lib="dom" />
// Real-server, real-browser proof of the account flows (13-auth-database.md): sign up, sign out,
// sign in, reset a forgotten password, and use a tool as a guest throughout. The unit tests drive
// the services and the route handlers; this one proves the cookie, the session and the pages work
// in the production bundle.
//
// Needs `npm run build`, a local Chrome or Edge, and a database (TEST_DATABASE_URL/DATABASE_URL);
// with no database the whole file skips, exactly as the app degrades.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  createTestPrisma,
  dropTestSchema,
  hasTestDatabase,
  testDatabaseUrl,
  urlForSchema,
} from "../../apps/api/src/db/testing.ts";
import type { PrismaClient } from "../../apps/api/src/db/client.ts";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_AUTH_PORT ?? 3114);
// With `npm run test:e2e:shared` one server serves every file, so the schema it was started
// with (E2E_SCHEMA) is the only one these assertions may look in. On its own, the file keeps
// its private schema and drops it afterwards.
const SCHEMA = process.env.E2E_SCHEMA ?? "test_auth_e2e";
const OWNS_SCHEMA = !process.env.E2E_SCHEMA;

let server: ChildProcess | undefined;
let browser: Browser;
let prisma: PrismaClient;
let serverLog = "";

/**
 * The server's console. When this file spawned the server it is captured in memory; under
 * `npm run test:e2e:shared` the runner owns the server and writes its console to E2E_SERVER_LOG,
 * so the reset link is readable either way.
 */
function consoleOutput(): string {
  const file = process.env.E2E_SERVER_LOG;
  if (!file) return serverLog;
  try {
    return readFileSync(file, "utf8").slice(consoleMark);
  } catch {
    return "";
  }
}

/** Where the shared log had got to when the current test started reading. */
let consoleMark = 0;

function markConsole(): void {
  serverLog = "";
  const file = process.env.E2E_SERVER_LOG;
  if (!file) return;
  try {
    consoleMark = readFileSync(file, "utf8").length;
  } catch {
    consoleMark = 0;
  }
}

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

describeDb("accounts in a real browser", () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = "a-very-good-password";
  const newPassword = "an-even-better-password";

  beforeAll(async () => {
    prisma = OWNS_SCHEMA ? await createIsolatedTestPrisma(SCHEMA) : createTestPrisma(SCHEMA);
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
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // The server gets this file's own schema, and a secret in case the checkout has none.
          DATABASE_URL: urlForSchema(testDatabaseUrl() as string, SCHEMA),
          // Auth.js builds its redirects from these; the checkout's own values point elsewhere.
          NEXTAUTH_URL: `http://127.0.0.1:${port}`,
          APP_URL: `http://127.0.0.1:${port}`,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "e2e-only-secret-value-not-for-real-use",
          MAIL_TRANSPORT: "console",
        },
      },
    );
    // The reset link is written to the console by design when no mail provider is set; capture it.
    server.stdout?.on("data", (chunk: Buffer) => (serverLog += chunk.toString()));
    server.stderr?.on("data", (chunk: Buffer) => (serverLog += chunk.toString()));
    await waitForServer(baseUrl());
    browser = await launchBrowser();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await prisma?.$disconnect();
    if (OWNS_SCHEMA) await dropTestSchema(SCHEMA);
  });

  async function newPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    return context.newPage();
  }

  it("signs up, lands on the account page, and signs out again", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/auth/signup`);
    await page.getByLabel("Name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Account" }).isVisible(),
    ).resolves.toBe(true);
    await expect(page.getByText(email).first().isVisible()).resolves.toBe(true);

    // The password is stored as a bcrypt hash and nothing else.
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain(password);

    await page.getByRole("button", { name: "Sign out" }).click();
    // Auth.js builds the post-sign-out URL from its own host setting, which may spell the same
    // server as "localhost" rather than "127.0.0.1" - either is the home page.
    // The port is whichever server this run is against: its own, or the shared one.
    const livePort = new URL(baseUrl()).port;
    await page.waitForURL(new RegExp(`^https?://(localhost|127[.]0[.]0[.]1):${livePort}/$`), {
      timeout: 30_000,
    });
    await page.goto(`${baseUrl()}/account`);
    await page.waitForURL(/\/auth\/login/, { timeout: 30_000 });
    await page.context().close();
  });

  it("refuses a wrong password and accepts the right one", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/auth/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("That email or password is incorrect.").waitFor({ timeout: 30_000 });

    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });
    await page.context().close();
  });

  it("resets a forgotten password through the emailed link", async () => {
    const page = await newPage();
    markConsole();
    await page.goto(`${baseUrl()}/auth/reset-password`);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.getByText(/on its way/i).waitFor({ timeout: 30_000 });

    // The console transport is the free default; read the link the way the email would carry it.
    const deadline = Date.now() + 15_000;
    let link: string | undefined;
    while (Date.now() < deadline && !link) {
      link = /https?:\/\/\S*\/auth\/reset-password\?token=[\w-]+/.exec(consoleOutput())?.[0];
      if (!link) await new Promise((r) => setTimeout(r, 250));
    }
    expect(link, "the reset link should reach the server console").toBeTruthy();
    const token = new URL(link as string).searchParams.get("token") as string;

    await page.goto(`${baseUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await page.getByText(/has been changed/i).waitFor({ timeout: 30_000 });

    // The old password no longer works; the new one does.
    await page.goto(`${baseUrl()}/auth/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText(/incorrect/i).waitFor({ timeout: 30_000 });

    await page.getByLabel("Password").fill(newPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl()}/account`, { timeout: 30_000 });
    await page.context().close();
  });

  it("lets a guest run a tool and remembers the job across a restart", async () => {
    // Guest: no cookie at all.
    const run = await fetch(`${baseUrl()}/api/tools/run`, {
      method: "POST",
      body: (() => {
        const form = new FormData();
        form.set("toolId", "password-generator");
        form.set("options", JSON.stringify({ length: 16 }));
        return form;
      })(),
    });
    expect(run.status).toBe(200);
    const body = (await run.json()) as { ok: boolean; job: { id: string; userId: string | null } };
    expect(body.ok).toBe(true);
    expect(body.job.userId).toBeNull();

    // The job is a row, not a memory entry: a different process can read it back.
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: body.job.id } });
    expect(stored.toolId).toBe("password-generator");
    expect(stored.status).toBe("success");

    const reread = await fetch(`${baseUrl()}/api/jobs/${body.job.id}`);
    expect(reread.status).toBe(200);
  });
});
