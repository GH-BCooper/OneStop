// FFmpeg detection and the one place FFmpeg/ffprobe are spawned (10-audio-video-tools.md).
//
// FFmpeg is a *required* local dependency for the audio/video tools (unlike LibreOffice, there is
// no built-in fallback worth having). It is found once per process: `FFMPEG_PATH` / `FFPROBE_PATH`,
// then PATH, then the usual install folders. When it is missing every media tool fails with the
// same `FFMPEG_MISSING_MESSAGE` instead of crashing or hanging.
//
// Spawning rules (CLAUDE.md §2.6): `shell: false`, fixed argument arrays, inputs only ever by the
// scratch-directory paths `common.ts` chose, a protocol whitelist of `file` (so a crafted playlist
// cannot make FFmpeg fetch URLs), a timeout, and kill on cancellation. Uploaded files are data
// FFmpeg decodes, never something it runs.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PdfToolError } from "../pdf/errors.ts";

export const FFMPEG_MISSING_MESSAGE =
  "FFmpeg is required for audio/video tools — see setup instructions. Install it free (macOS: brew install ffmpeg · Ubuntu/Debian: sudo apt install ffmpeg · Windows: winget install Gyan.FFmpeg), then restart OneStop.";

export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
}

export type FfmpegLocator = () => FfmpegBinaries | null;

const EXTRA_DIRS: Record<string, string[]> = {
  win32: [
    "C:\\ffmpeg\\bin",
    "C:\\Program Files\\ffmpeg\\bin",
    "C:\\ProgramData\\chocolatey\\bin",
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.USERPROFILE ?? "", "scoop", "shims"),
  ],
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"],
  linux: ["/usr/bin", "/usr/local/bin", "/snap/bin"],
};

function exe(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function findBinary(name: string, envVar: string, preferDir?: string): string | null {
  const configured = process.env[envVar];
  if (configured) return existsSync(configured) ? configured : null;
  const dirs = [
    ...(preferDir ? [preferDir] : []),
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(EXTRA_DIRS[process.platform] ?? []),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, exe(name));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A project-local FFmpeg, from `npm run fetch:ffmpeg` (which unpacks into `.tools/`).
 *
 * That script is the answer the README gives anyone who cannot install FFmpeg system-wide, and
 * until phase 20 only the *test* setup looked in `.tools/` - so `npm run fetch:ffmpeg && npm run
 * dev` produced an app that still said "FFmpeg is required". The app looks there itself now.
 *
 * `.tools/` is found by walking up from the working directory, because `next start` runs with its
 * cwd in `apps/web` while `.tools/` sits at the repository root. The archive names its own folder,
 * so the search is a bounded walk rather than a fixed path.
 */
function projectLocalFfmpeg(): FfmpegBinaries | null {
  let dir = process.cwd();
  for (let up = 0; up < 5; up += 1) {
    const tools = path.join(dir, ".tools");
    if (existsSync(tools)) {
      const found = new Map<string, string>();
      const walk = (current: string, depth: number): void => {
        if (depth > 4) return;
        let entries;
        try {
          entries = readdirSync(current, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (!found.has(entry.name)) found.set(entry.name, full);
        }
      };
      walk(tools, 0);
      const ffmpeg = found.get(exe("ffmpeg"));
      const ffprobe = found.get(exe("ffprobe"));
      if (ffmpeg && ffprobe) return { ffmpeg, ffprobe };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function defaultLocator(): FfmpegBinaries | null {
  const ffmpeg = findBinary("ffmpeg", "FFMPEG_PATH");
  // A system install always wins; `.tools/` is the fallback, never an override.
  if (!ffmpeg) return projectLocalFfmpeg();
  // ffprobe ships next to ffmpeg in every distribution; look there first.
  const ffprobe = findBinary("ffprobe", "FFPROBE_PATH", path.dirname(ffmpeg));
  return ffprobe ? { ffmpeg, ffprobe } : projectLocalFfmpeg();
}

let locator: FfmpegLocator = defaultLocator;
let cached: { value: FfmpegBinaries | null } | null = null;

/** Tests use this to simulate FFmpeg being missing (or somewhere else). Pass null to restore. */
export function setFfmpegLocator(next: FfmpegLocator | null): void {
  locator = next ?? defaultLocator;
  cached = null;
  versionCache = null;
}

export function findFfmpeg(): FfmpegBinaries | null {
  if (!cached) {
    let value: FfmpegBinaries | null;
    try {
      value = locator();
    } catch {
      value = null;
    }
    cached = { value };
  }
  return cached.value;
}

/** Thrown by every media tool when FFmpeg is not installed; mapped to FFMPEG_MISSING_MESSAGE. */
export class FfmpegMissingError extends PdfToolError {
  constructor() {
    super("FAILED", FFMPEG_MISSING_MESSAGE);
    this.name = "FfmpegMissingError";
  }
}

export function requireFfmpeg(): FfmpegBinaries {
  const found = findFfmpeg();
  if (!found) throw new FfmpegMissingError();
  return found;
}

let versionCache: { value: string | null } | null = null;

/** "9.0-full_build-www.gyan.dev", or null when FFmpeg is missing or will not start. */
export function ffmpegVersion(): string | null {
  if (versionCache) return versionCache.value;
  const found = findFfmpeg();
  let value: string | null = null;
  if (found) {
    const out = spawnSync(found.ffmpeg, ["-hide_banner", "-version"], {
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
    });
    value = /ffmpeg version (\S+)/.exec(out.stdout ?? "")?.[1] ?? null;
  }
  versionCache = { value };
  return value;
}

/** For a status page / startup log: is the media stack usable, and which FFmpeg is it. */
export function ffmpegStatus(): {
  available: boolean;
  version: string | null;
  path: string | null;
} {
  const found = findFfmpeg();
  return {
    available: Boolean(found),
    version: found ? ffmpegVersion() : null,
    path: found?.ffmpeg ?? null,
  };
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Hard stop even without a signal (default 15 minutes). */
  timeoutMs?: number;
  /** Collect stdout (ffprobe's JSON). FFmpeg output always goes to files instead. */
  stdout?: boolean;
}

export class FfmpegRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegRunError";
  }
}

function run(
  binary: string,
  args: string[],
  { cwd, signal, timeoutMs = 15 * 60_000, stdout = false }: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PdfToolError("FAILED", "Cancelled."));
      return;
    }
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", stdout ? "pipe" : "ignore", "pipe"],
    });
    let err = "";
    let out = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      // Keep the tail: that is where FFmpeg prints the reason it failed and loudnorm's JSON.
      err = (err + chunk.toString()).slice(-64_000);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (out.length < 16 * 1024 * 1024) out += chunk.toString();
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new PdfToolError("FAILED", "This file took too long to process.")));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new PdfToolError("FAILED", "Cancelled.")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) =>
      finish(() => reject(new PdfToolError("FAILED", FFMPEG_MISSING_MESSAGE, e))),
    );
    child.on("close", (code) =>
      finish(() => {
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new FfmpegRunError(`exit ${code}`, err));
      }),
    );
  });
}

/** Runs FFmpeg with the safe global flags prepended. Resolves with stderr (for loudnorm etc.). */
export async function runFfmpeg(args: string[], options: RunOptions): Promise<string> {
  const { ffmpeg } = requireFfmpeg();
  const { stderr } = await run(
    ffmpeg,
    ["-hide_banner", "-nostdin", "-y", "-loglevel", "info", ...args],
    options,
  );
  return stderr;
}

export async function runFfprobe(args: string[], options: RunOptions): Promise<string> {
  const { ffprobe } = requireFfmpeg();
  const { stdout } = await run(ffprobe, ["-hide_banner", "-v", "error", ...args], {
    ...options,
    stdout: true,
  });
  return stdout;
}
