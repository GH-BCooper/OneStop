/// <reference lib="dom" />
// Real-server, real-browser checks for the audio & video tools (10-audio-video-tools.md): the
// production build must find and spawn FFmpeg outside the bundle, the generic tool page must drive
// the media options, and uploads of real audio/video must pass phase 04's MIME/magic validation.
// Needs `npm run build`, a local Chrome or Edge, and FFmpeg on PATH.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findFfmpeg } from "@onestop/api";
import { makeAudio, makeVideo } from "../../apps/api/src/media/fixtures.ts";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_MEDIA_PORT ?? 3110);

let server: ChildProcess | undefined;
let browser: Browser;
let workDir: string;
let mp3Path: string;
let clip: Uint8Array;

const baseUrl = () => process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const HAS_FFMPEG = Boolean(findFfmpeg());

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
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-e2e-media-"));
  if (HAS_FFMPEG) {
    const mp3 = await makeAudio("mp3", { seconds: 3 });
    mp3Path = path.join(workDir, "tone.mp3");
    await fs.writeFile(mp3Path, mp3);
    clip = await makeVideo("mp4", { seconds: 2 });
  }
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
    '[data-state="success"], [data-state="failed"], [data-state="unsupported"]',
  );
  await panel.waitFor({ timeout: 120_000 });
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

const suite = HAS_FFMPEG ? describe : describe.skip;

suite("audio & video tools, end to end", () => {
  it("converts an MP3 to WAV through the tool page and downloads it", async () => {
    const page = await newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${baseUrl()}/tools/audio/audio-to-wav`);
    await page.setInputFiles("input[type=file]", mp3Path);
    const text = await runInBrowser(page, /^Run Audio . WAV$/);
    expect(text).toContain("Converted 1 audio file");
    const bytes = await download(page, "tone.wav");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(errors).toEqual([]);
    await page.context().close();
  }, 120_000);

  it("drives the waveform options from the page and renders a PNG of that exact size", async () => {
    const page = await newPage();
    await page.goto(`${baseUrl()}/tools/audio/audio-waveform-generator`);
    await page.setInputFiles("input[type=file]", mp3Path);
    await page.getByLabel(/^Width/).fill("500");
    await page.getByLabel(/^Height/).fill("120");
    await page.getByLabel(/^Style$/).selectOption("filled");
    const text = await runInBrowser(page, /run audio waveform generator/i);
    expect(text).toMatch(/columns/);
    const bytes = await download(page, "wave.png");
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 500, 120]);
    await page.context().close();
  }, 120_000);

  it("spawns FFmpeg from the production server for video work", async () => {
    const trimmed = await api("video-trimmer", [{ name: "clip.mp4", bytes: clip }], {
      start: "0.5",
      end: "1.5",
    });
    expect(trimmed.ok, trimmed.error?.message).toBe(true);
    expect(trimmed.summary).toContain("Kept 0:00.5 – 0:01.5");
    expect((await fetchFile(trimmed.files[0]!.url)).length).toBeGreaterThan(1000);

    const gif = await api("video-to-gif", [{ name: "clip.mp4", bytes: clip }], {
      duration: "1",
      fps: 6,
      width: 120,
    });
    expect(gif.ok, gif.error?.message).toBe(true);
    const meta = await sharp(await fetchFile(gif.files[0]!.url), { animated: true }).metadata();
    expect([meta.format, meta.width]).toEqual(["gif", 120]);
  }, 180_000);

  it("validates uploads: a real MP3 passes, a renamed text file does not", async () => {
    const good = await api("audio-to-mp3", [
      { name: "tone.mp3", bytes: await fs.readFile(mp3Path) },
    ]);
    expect(good.ok, good.error?.message).toBe(true);
    const bad = await api("audio-to-mp3", [
      { name: "fake.mp3", bytes: new TextEncoder().encode("not audio at all") },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toBeTruthy();
  }, 120_000);
});
