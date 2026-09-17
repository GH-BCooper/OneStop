/// <reference lib="dom" />
// Real-browser proof of the phase-04 pipeline (04-file-core.md): pick a file in the UI, run it,
// and download the result — the "one real tool works fully through the UI" acceptance criterion.
// Needs a production build (`npm run build`) and a local Chrome or Edge; no browser download.
// Run with `npm run test:e2e`.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_FILE_PORT ?? 3108);
const DEMO_ROUTE = "/tools/file-utility/file-metadata-viewer";
const CONTENT = "hello world";
const SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

let server: ChildProcess | undefined;
let browser: Browser;
let workDir: string;

function baseUrl(): string {
  return process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
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
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-e2e-files-"));
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
  await fs.rm(workDir, { recursive: true, force: true });
});

async function newPage(): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  return context.newPage();
}

async function writeFixture(name: string, content: string): Promise<string> {
  const file = path.join(workDir, name);
  await fs.writeFile(file, content);
  return file;
}

describe("file core, end to end in a browser", () => {
  it("uploads a file, processes it and downloads the result", async () => {
    const page = await newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseUrl() + DEMO_ROUTE);

    await page.setInputFiles("input[type=file]", await writeFixture("notes.txt", CONTENT));
    await expect(page.getByText("notes.txt").first().isVisible()).resolves.toBe(true);

    await page.getByRole("button", { name: /run file metadata viewer/i }).click();

    const panel = page.locator('[data-state="success"]');
    await panel.waitFor({ timeout: 30_000 });
    // Real bytes were hashed server-side, not just echoed metadata.
    await expect(panel.textContent()).resolves.toContain(SHA256);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("result-download").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("notes.txt.metadata.json");

    const saved = path.join(workDir, "result.json");
    await download.saveAs(saved);
    const report = JSON.parse(await fs.readFile(saved, "utf8")) as {
      fileCount: number;
      files: { name: string; size: number; sha256: string }[];
    };
    expect(report.fileCount).toBe(1);
    expect(report.files[0]).toMatchObject({
      name: "notes.txt",
      size: CONTENT.length,
      sha256: SHA256,
    });

    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("shows the exact unsupported-type message and never uploads the file", async () => {
    const page = await newPage();
    let uploaded = false;
    page.on("request", (r) => {
      if (r.url().includes("/api/tools/run")) uploaded = true;
    });
    await page.goto(`${baseUrl()}/tools/pdf/merge-pdf`);
    await page.setInputFiles(
      "input[type=file]",
      await writeFixture("song.mp3", "not really audio"),
    );

    const panel = page.locator('[data-state="unsupported"]');
    await panel.waitFor({ timeout: 15_000 });
    await expect(panel.textContent()).resolves.toContain("This file type is not supported.");
    expect(uploaded).toBe(false);
    await page.context().close();
  });

  it("rejects a path-traversal name server-side and still returns a safe result name", async () => {
    const response = await fetch(`${baseUrl()}/api/tools/run`, {
      method: "POST",
      body: (() => {
        const form = new FormData();
        form.set("toolId", "file-metadata-viewer");
        form.append("files", new File([CONTENT], "../../etc/passwd.txt", { type: "text/plain" }));
        return form;
      })(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; files: { name: string; url: string }[] };
    expect(body.ok).toBe(true);
    expect(body.files[0]?.name).toBe("passwd.txt.metadata.json");

    // The download endpoint only accepts ids it issued.
    const traversal = await fetch(`${baseUrl()}/api/files/..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.status).toBe(404);
  });

  it("asks for a file when a file tool is run without one", async () => {
    // The size guard is covered in the unit tests (sending >100 MB here would only be slow);
    // this asserts the endpoint's own shape checks.
    const form = new FormData();
    form.set("toolId", "file-metadata-viewer");
    form.set("text", "");
    const response = await fetch(`${baseUrl()}/api/tools/run`, { method: "POST", body: form });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/choose a file/i);
  });
});
