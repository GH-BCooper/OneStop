/// <reference lib="dom" />
// Real-server, real-browser checks for the image tools (09-image-tools.md): the production build
// must load sharp, the bundled fonts and the HEIC decoder outside the bundle, and the generic tool
// page must drive the image options. Needs `npm run build` and a local Chrome or Edge.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_IMAGE_PORT ?? 3109);

let server: ChildProcess | undefined;
let browser: Browser;
let workDir: string;
let photoPath: string;
let photo: Buffer;

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
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-e2e-images-"));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <rect width="400" height="300" fill="#4a90d9"/><circle cx="200" cy="150" r="80" fill="#2e7d32"/></svg>`;
  photo = await sharp(Buffer.from(svg))
    .withExif({ IFD0: { Make: "E2ECam", Model: "Browser" } })
    .jpeg()
    .toBuffer();
  photoPath = path.join(workDir, "holiday.jpg");
  await fs.writeFile(photoPath, photo);
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

async function runInBrowser(page: Page, name: RegExp): Promise<string> {
  await page.getByRole("button", { name }).click();
  const panel = page.locator(
    '[data-state="success"], [data-state="failed"], [data-state="unsupported"]',
  );
  await panel.waitFor({ timeout: 60_000 });
  return (await panel.textContent()) ?? "";
}

async function download(page: Page, file: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByTestId("result-download").first().click();
  const d = await pending;
  const saved = path.join(workDir, file);
  await d.saveAs(saved);
  return fs.readFile(saved);
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

async function fetchFile(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetch(new URL(url, baseUrl()))).arrayBuffer());
}

describe("image tools, end to end", () => {
  it("resizes through the tool page and downloads the exact size", async () => {
    const page = await newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${baseUrl()}/tools/images/image-resizer`);
    await page.setInputFiles("input[type=file]", photoPath);
    await page.getByLabel(/^Width/).fill("100");
    const text = await runInBrowser(page, /run image resizer/i);
    expect(text).toContain("400 × 300 → 100 × 75 px");
    const bytes = await download(page, "resized.jpg");
    const m = await sharp(bytes).metadata();
    expect([m.width, m.height, m.format]).toEqual([100, 75, "jpeg"]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("fits to a circle with a blurred background from the page", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/images/fit-image-to-circle`);
    await page.setInputFiles("input[type=file]", photoPath);
    await page.getByLabel(/^Fit$/).selectOption("blur");
    const text = await runInBrowser(page, /run fit image to circle/i);
    expect(text).toContain("over a blurred background");
    const bytes = await download(page, "circle.png");
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([400, 400]);
    expect(data[3]).toBe(0); // top-left corner is outside the circle
    await page.context().close();
  });

  it("shows the exact 'needs a local AI model' message on the page", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/images/background-removal`);
    await expect(page.getByText("AI optional").first().isVisible()).resolves.toBe(true);
    await page.setInputFiles("input[type=file]", photoPath);
    await page.getByLabel(/^Method$/).selectOption("ai");
    const text = await runInBrowser(page, /run background removal/i);
    expect(text).toContain("This feature needs a local AI model. Enable one in Settings.");
    await page.context().close();
  });

  it("text, meme and watermark render with the bundled fonts in the production server", async () => {
    for (const [toolId, options] of [
      ["add-text-to-image", { text: "Hello from the server" }],
      ["meme-generator", { top: "top", bottom: "bottom" }],
      ["image-watermark", { text: "© OneStop", position: "tile" }],
    ] as const) {
      const r = await api(toolId, [{ name: "holiday.jpg", bytes: photo }], options);
      expect(r.ok, `${toolId}: ${r.error?.message}`).toBe(true);
      const out = await fetchFile(r.files[0]!.url);
      const [a, b] = await Promise.all([
        sharp(out).raw().toBuffer(),
        sharp(photo).raw().toBuffer(),
      ]);
      let changed = 0;
      for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i]! - b[i]!) > 40) changed += 1;
      expect(changed, toolId).toBeGreaterThan(200);
    }
  });

  it("reads and strips EXIF, converts formats and builds a PDF through the API", async () => {
    const viewer = await api("image-metadata-viewer", [{ name: "holiday.jpg", bytes: photo }]);
    expect(viewer.summary).toContain("E2ECam Browser");
    const clean = await api("remove-image-metadata", [{ name: "holiday.jpg", bytes: photo }]);
    expect((await sharp(await fetchFile(clean.files[0]!.url)).metadata()).exif).toBeUndefined();

    const webp = await api("image-format-converter", [{ name: "holiday.jpg", bytes: photo }], {
      format: "webp",
    });
    expect(webp.files[0]!.name).toBe("holiday.webp");
    expect((await sharp(await fetchFile(webp.files[0]!.url)).metadata()).format).toBe("webp");

    const pdf = await api("image-to-pdf", [
      { name: "a.jpg", bytes: photo },
      { name: "b.jpg", bytes: photo },
    ]);
    expect((await PDFDocument.load(await fetchFile(pdf.files[0]!.url))).getPageCount()).toBe(2);

    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(40),
    ]);
    const bad = await api("image-format-converter", [{ name: "phone.heic", bytes: heic }], {
      format: "jpg",
    });
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toMatch(/HEIC photo could not be read|not supported/);
  });
});
