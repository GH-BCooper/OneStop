// Detection and spawning for the two optional local speech binaries (21-roadmap-expansion.md,
// roadmap §1.5 and §4): **whisper.cpp** for speech-to-text and **Piper** for text-to-speech.
//
// Both are MIT-licensed, run entirely on this machine, and are *optional* in exactly the way
// LibreOffice already is: when one is missing the tool that needs it fails with a clear, actionable
// message, `/status` reports it, and nothing else in the app is affected. No hosted API is ever used
// as a substitute, so neither tool can quietly send audio off the device.
//
// Spawning follows the same rules as FFmpeg (`CLAUDE.md` §2.6): `shell: false`, fixed argument
// arrays, paths only from the caller's own scratch directory, a timeout, and kill on cancellation.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PdfToolError } from "../pdf/errors.ts";

export const WHISPER_MISSING_MESSAGE =
  "Speech-to-text needs whisper.cpp, a free local program — nothing is sent to any server. Install it (macOS: brew install whisper-cpp · Linux/Windows: build from github.com/ggml-org/whisper.cpp), download a model (e.g. ggml-base.en.bin), then set WHISPER_PATH and WHISPER_MODEL and restart OneStop.";

export const PIPER_MISSING_MESSAGE =
  "Text-to-speech needs Piper, a free local voice engine — nothing is sent to any server. Install it from github.com/rhasspy/piper, download a voice (a .onnx file plus its .onnx.json), then set PIPER_PATH and PIPER_VOICE and restart OneStop.";

export interface SpeechBinary {
  /** Absolute path to the executable. */
  bin: string;
  /** Absolute path to the model/voice file, when one is configured. */
  model: string | null;
}

export type SpeechLocator = (kind: SpeechKind) => SpeechBinary | null;
export type SpeechKind = "whisper" | "piper";

/** Names the binaries ship under, newest first — whisper.cpp renamed its CLI from `main`. */
const BINARY_NAMES: Record<SpeechKind, string[]> = {
  whisper: ["whisper-cli", "whisper-cpp", "whisper", "main"],
  piper: ["piper", "piper-tts"],
};

const MODEL_ENV: Record<SpeechKind, string> = { whisper: "WHISPER_MODEL", piper: "PIPER_VOICE" };
const BIN_ENV: Record<SpeechKind, string> = { whisper: "WHISPER_PATH", piper: "PIPER_PATH" };
const MODEL_EXT: Record<SpeechKind, string> = { whisper: ".bin", piper: ".onnx" };

const EXTRA_DIRS: Record<string, string[]> = {
  win32: [
    "C:\\whisper",
    "C:\\whisper.cpp",
    "C:\\piper",
    "C:\\Program Files\\whisper",
    "C:\\Program Files\\piper",
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.USERPROFILE ?? "", "scoop", "shims"),
  ],
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"],
  linux: ["/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/whisper.cpp", "/opt/piper"],
};

/** Where a model file is looked for when the env var names a directory, or names nothing at all. */
const MODEL_DIRS: Record<SpeechKind, string[]> = {
  whisper: ["models", "whisper-models", path.join("models", "whisper")],
  piper: ["voices", "piper-voices", path.join("models", "piper")],
};

function exe(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function onPath(name: string): string | null {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), ...(EXTRA_DIRS[process.platform] ?? [])];
  for (const dir of dirs) {
    if (dir.trim() === "") continue;
    const candidate = path.join(dir, exe(name));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** First file with the right extension in one of the usual model folders. */
function findModel(kind: SpeechKind, binDir: string | null): string | null {
  const configured = process.env[MODEL_ENV[kind]]?.trim();
  if (configured) {
    if (!existsSync(configured)) return null;
    if (statSync(configured).isDirectory()) {
      const found = readdirSync(configured).find((f) => f.toLowerCase().endsWith(MODEL_EXT[kind]));
      return found ? path.join(configured, found) : null;
    }
    return configured;
  }
  const roots = [process.cwd(), ...(binDir ? [binDir, path.dirname(binDir)] : [])];
  for (const root of roots) {
    for (const sub of MODEL_DIRS[kind]) {
      const dir = path.join(root, sub);
      if (!existsSync(dir)) continue;
      try {
        const found = readdirSync(dir)
          .filter((f) => f.toLowerCase().endsWith(MODEL_EXT[kind]))
          .sort();
        if (found.length > 0) return path.join(dir, found[0]!);
      } catch {
        // An unreadable directory is the same as no directory here.
      }
    }
  }
  return null;
}

const cache = new Map<SpeechKind, SpeechBinary | null>();
let locator: SpeechLocator | null = null;

/** Test seam, mirroring `setFfmpegLocator`. */
export function setSpeechLocator(next: SpeechLocator | null): void {
  locator = next;
  cache.clear();
}

export function findSpeech(kind: SpeechKind): SpeechBinary | null {
  if (locator) return locator(kind);
  if (cache.has(kind)) return cache.get(kind)!;
  const configured = process.env[BIN_ENV[kind]]?.trim();
  let bin: string | null = null;
  if (configured && existsSync(configured)) {
    bin = statSync(configured).isDirectory()
      ? (BINARY_NAMES[kind].map((n) => path.join(configured, exe(n))).find((p) => existsSync(p)) ?? null)
      : configured;
  }
  if (!bin) {
    for (const name of BINARY_NAMES[kind]) {
      bin = onPath(name);
      if (bin) break;
    }
  }
  const result = bin ? { bin, model: findModel(kind, path.dirname(bin)) } : null;
  cache.set(kind, result);
  return result;
}

export class SpeechMissingError extends PdfToolError {
  constructor(kind: SpeechKind, detail?: unknown) {
    super("FAILED", kind === "whisper" ? WHISPER_MISSING_MESSAGE : PIPER_MISSING_MESSAGE, detail);
    this.name = "SpeechMissingError";
  }
}

export function requireSpeech(kind: SpeechKind): SpeechBinary & { model: string } {
  const found = findSpeech(kind);
  if (!found) throw new SpeechMissingError(kind);
  if (!found.model) {
    throw new PdfToolError(
      "FAILED",
      kind === "whisper"
        ? "whisper.cpp is installed, but no model was found. Download one (e.g. ggml-base.en.bin) and point WHISPER_MODEL at it."
        : "Piper is installed, but no voice was found. Download a voice (a .onnx file and its .onnx.json) and point PIPER_VOICE at it.",
    );
  }
  return { ...found, model: found.model };
}

export function speechVersion(kind: SpeechKind): string | null {
  const found = findSpeech(kind);
  if (!found) return null;
  try {
    const result = spawnSync(found.bin, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true, shell: false });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const match = /\bv?\d+\.\d+(\.\d+)?\b/.exec(text);
    if (match) return match[0];
    const firstLine = (text.trim().split(/\r?\n/)[0] ?? "").slice(0, 60);
    return firstLine === "" ? "installed" : firstLine;
  } catch {
    return "installed";
  }
}

export interface SpeechStatus {
  installed: boolean;
  path: string | null;
  model: string | null;
  modelName: string | null;
  version: string | null;
  message: string | null;
}

/** What `/status` shows for each engine (18-pwa-offline.md's platform panel). */
export function speechStatus(kind: SpeechKind): SpeechStatus {
  const found = findSpeech(kind);
  return {
    installed: Boolean(found),
    path: found?.bin ?? null,
    model: found?.model ?? null,
    modelName: found?.model ? path.basename(found.model) : null,
    version: found ? speechVersion(kind) : null,
    message: found
      ? found.model
        ? null
        : kind === "whisper"
          ? "Installed, but no model file was found."
          : "Installed, but no voice file was found."
      : kind === "whisper"
        ? WHISPER_MISSING_MESSAGE
        : PIPER_MISSING_MESSAGE,
  };
}

export class SpeechRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "SpeechRunError";
  }
}

export interface SpeechRunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Text piped to stdin (Piper reads the sentence to speak this way). */
  stdin?: string;
  onOutput?: (chunk: string) => void;
}

/** Spawns one of the speech binaries under the same rules FFmpeg runs under. */
export function runSpeech(
  bin: string,
  args: string[],
  { cwd, signal, timeoutMs = 30 * 60_000, stdin, onOutput }: SpeechRunOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PdfToolError("FAILED", "Cancelled."));
      return;
    }
    const child = spawn(bin, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (out.length < 32 * 1024 * 1024) out += text;
      onOutput?.(text);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      err = (err + text).slice(-64_000);
      onOutput?.(text);
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
      finish(() => reject(new PdfToolError("FAILED", "This took too long to process. Try a shorter file, or a smaller model.")));
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new PdfToolError("FAILED", "Cancelled.")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => finish(() => reject(new PdfToolError("FAILED", "That local speech program could not be started.", e))));
    child.on("close", (code) =>
      finish(() => {
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new SpeechRunError(`exit ${code}`, err));
      }),
    );
    if (stdin !== undefined) {
      child.stdin!.end(stdin);
    }
  });
}
