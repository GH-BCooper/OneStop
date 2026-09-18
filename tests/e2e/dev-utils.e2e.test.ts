/// <reference lib="dom" />
// Real-server, real-browser checks for the developer & file utilities (12-dev-utility-tools.md).
//
// The unit tests call the executors directly; these prove the parts only a running app has:
//   - a tool with no input at all (Password Generator) runs straight from the page;
//   - the `client` option type really is filled in by the browser — the User-Agent Viewer
//     recognises Chrome without the server being told anything;
//   - a typed-text tool drives its options through the generic page (Regex Tester);
//   - a ZIP made through the API downloads intact and extracts back to the same bytes, in the
//     production bundle where Prettier and JSZip have to be resolvable outside the dev server.
// Needs `npm run build` and a local Chrome or Edge.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readZip } from "../../apps/api/src/dev-utils/zip.ts";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_DEVUTILS_PORT ?? 3112);

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
  if (process.env.E2E_BROWSER_PATH)
    return chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH });
  let last: unknown;
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`No Chrome/Edge found; set E2E_BROWSER_PATH. ${String(last)}`);
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-e2e-devutils-"));
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
}, 180_000);

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

async function runInBrowser(page: Page, name: RegExp): Promise<string> {
  await page.getByRole("button", { name }).click();
  const panel = page.locator(
    '[data-state="success"], [data-state="failed"], [data-state="unsupported"], [data-state="unavailable"]',
  );
  await panel.waitFor({ timeout: 60_000 });
  return (await panel.textContent()) ?? "";
}

type ApiResult = {
  ok: boolean;
  summary: string | null;
  output: unknown;
  files: { name: string; url: string }[];
  error: { message: string } | null;
};

async function api(
  toolId: string,
  files: { name: string; bytes: Uint8Array }[],
  options: Record<string, unknown> = {},
): Promise<ApiResult> {
  const form = new FormData();
  form.set("toolId", toolId);
  form.set("options", JSON.stringify(options));
  for (const f of files) form.append("files", new File([Buffer.from(f.bytes)], f.name));
  const res = await fetch(`${baseUrl()}/api/tools/run`, { method: "POST", body: form });
  return (await res.json()) as ApiResult;
}

async function apiText(
  toolId: string,
  text: string,
  options: Record<string, unknown> = {},
): Promise<ApiResult> {
  const form = new FormData();
  form.set("toolId", toolId);
  form.set("text", text);
  form.set("options", JSON.stringify(options));
  const res = await fetch(`${baseUrl()}/api/tools/run`, { method: "POST", body: form });
  return (await res.json()) as ApiResult;
}

async function fetchFile(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetch(new URL(url, baseUrl()))).arrayBuffer());
}

describe("developer & file utilities in a real browser", () => {
  it("runs a tool that needs no input at all", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/dev-utility/password-generator`);
    const text = await runInBrowser(page, /^Run Password Generator$/);
    expect(text).toMatch(/bits of entropy/);
    expect(text).toMatch(/Download/);
    await page.context().close();
  }, 90_000);

  it("fills the user-agent in from the browser itself", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/dev-utility/user-agent-viewer`);
    const shown = page.getByTestId("client-option-userAgent");
    await shown.waitFor({ timeout: 30_000 });
    expect(await shown.textContent()).toMatch(/Mozilla\/5\.0/);
    const text = await runInBrowser(page, /^Run User-Agent Viewer$/);
    // Chrome or Edge, recognised from the string the page supplied — the server was told nothing.
    expect(text).toMatch(/Chrome|Microsoft Edge/);
    await page.context().close();
  }, 90_000);

  it("drives the Regex Tester's options from the generic tool page", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/dev-utility/regex-tester`);
    await page.getByRole("textbox", { name: /Sample text/i }).fill("ada@example.com");
    await page.getByLabel(/Regular expression/i).fill("(\\w+)@([\\w.]+)");
    const text = await runInBrowser(page, /^Run Regex Tester$/);
    expect(text).toMatch(/1 match/);
    expect(text).toMatch(/capture group/);
    await page.context().close();
  }, 90_000);

  it("formats CSS through the production bundle, where Prettier has to be resolvable", async () => {
    const result = await apiText("css-formatter", "a{color:red}", { mode: "format", indent: 2 });
    expect(result.ok, result.error?.message).toBe(true);
    expect(Buffer.from(await fetchFile(result.files[0]!.url)).toString()).toBe(
      "a {\n  color: red;\n}\n",
    );
  }, 60_000);

  it("zips real uploads and downloads an archive that extracts back to the same bytes", async () => {
    const files = [
      { name: "notes.txt", bytes: new TextEncoder().encode("hello from e2e") },
      { name: "data.json", bytes: new TextEncoder().encode('{"a":1}') },
    ];
    const result = await api("zip-creator", files, { level: "maximum" });
    expect(result.ok, result.error?.message).toBe(true);
    const archive = await fetchFile(result.files[0]!.url);
    const entries = await readZip(new Uint8Array(archive));
    expect(entries.map((e) => e.name).sort()).toEqual(["data.json", "notes.txt"]);
    for (const original of files) {
      const found = entries.find((e) => e.name === original.name)!;
      expect([...found.bytes]).toEqual([...original.bytes]);
    }
  }, 90_000);

  it("routes a File Type Converter request to the phase that owns the format", async () => {
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const result = await api("file-type-converter", [{ name: "pixel.png", bytes: png }], {
      target: "jpg",
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect(result.summary).toMatch(/Image/);
    const jpeg = await fetchFile(result.files[0]!.url);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  }, 90_000);
});
