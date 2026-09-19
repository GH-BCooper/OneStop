// The yt-dlp wrapper (17-online-media-network-tools.md).
//
// yt-dlp is free, open source and runs locally, which is why the build file names it. It is found
// the same way FFmpeg is (env var, then PATH, then the usual install folders) and, when it is
// missing, every tool that needs it fails with one install message instead of hanging.
//
// Spawning rules, identical to `media/ffmpegCheck.ts` and CLAUDE.md §6:
//   * `shell: false` and a fixed argument array — the URL is one argv element, never a string the
//     shell could reinterpret, and it is validated before it gets here.
//   * output into a fresh scratch directory with a template yt-dlp controls, so a crafted title
//     can never escape it.
//   * `--no-exec`, `--no-playlist` and a download cap, so one link cannot become a thousand files.
//   * a timeout and kill-on-cancel.
//
// Nothing downloaded is ever executed; it is handed to the pipeline as bytes, exactly like an
// upload.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PdfToolError } from "../pdf/errors.ts";
import { findFfmpeg } from "../media/ffmpegCheck.ts";

export const YTDLP_MISSING_MESSAGE =
  "yt-dlp is required for the online media tools. Install it free (pip install -U yt-dlp, or: macOS brew install yt-dlp · Windows winget install yt-dlp.yt-dlp · Ubuntu/Debian sudo apt install yt-dlp), then restart OneStop.";

const EXTRA_DIRS: Record<string, string[]> = {
  win32: [
    "C:\\yt-dlp",
    "C:\\Program Files\\yt-dlp",
    "C:\\ProgramData\\chocolatey\\bin",
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.USERPROFILE ?? "", "scoop", "shims"),
    path.join(process.env.APPDATA ?? "", "Python", "Scripts"),
  ],
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"],
  linux: [
    "/usr/bin",
    "/usr/local/bin",
    "/snap/bin",
    path.join(process.env.HOME ?? "", ".local", "bin"),
  ],
};

function exe(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export type YtdlpLocator = () => string | null;

function defaultLocator(): string | null {
  const configured = process.env.YTDLP_PATH;
  if (configured) return existsSync(configured) ? configured : null;
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(EXTRA_DIRS[process.platform] ?? []),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, exe("yt-dlp"));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let locator: YtdlpLocator = defaultLocator;
let cached: { value: string | null } | null = null;
let versionCache: { value: string | null } | null = null;

/** Tests use this to simulate yt-dlp being missing (or somewhere else). Pass null to restore. */
export function setYtdlpLocator(next: YtdlpLocator | null): void {
  locator = next ?? defaultLocator;
  cached = null;
  versionCache = null;
}

export function findYtdlp(): string | null {
  if (!cached) {
    let value: string | null;
    try {
      value = locator();
    } catch {
      value = null;
    }
    cached = { value };
  }
  return cached.value;
}

export class YtdlpMissingError extends PdfToolError {
  constructor() {
    super("FAILED", YTDLP_MISSING_MESSAGE);
    this.name = "YtdlpMissingError";
  }
}

export function requireYtdlp(): string {
  const found = findYtdlp();
  if (!found) throw new YtdlpMissingError();
  return found;
}

export function ytdlpVersion(): string | null {
  if (versionCache) return versionCache.value;
  const found = findYtdlp();
  let value: string | null = null;
  if (found) {
    const out = spawnSync(found, ["--version"], {
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      encoding: "utf8",
    });
    value = (out.stdout ?? "").trim() || null;
  }
  versionCache = { value };
  return value;
}

export function ytdlpStatus(): { available: boolean; version: string | null; path: string | null } {
  const found = findYtdlp();
  return { available: Boolean(found), version: found ? ytdlpVersion() : null, path: found };
}

// ---- running -----------------------------------------------------------------------------------

export class YtdlpRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "YtdlpRunError";
  }
}

export interface RunYtdlpOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Test seam: replace the process layer entirely without a network or a binary. */
export type YtdlpRunner = (args: string[], options: RunYtdlpOptions) => Promise<string>;

let runner: YtdlpRunner | null = null;

export function setYtdlpRunner(next: YtdlpRunner | null): void {
  runner = next;
}

/** Flags every invocation carries, whether it is listing formats or downloading. */
export function baseArgs(): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-continue",
    "--no-part",
    "--no-call-home",
    "--no-exec",
    "--no-config",
    "--ignore-config",
    "--max-downloads",
    "1",
    "--retries",
    "2",
    "--socket-timeout",
    "20",
    "--restrict-filenames",
  ];
  // yt-dlp merges and converts with FFmpeg; when OneStop already found one, point at it rather
  // than relying on it also being on yt-dlp's PATH.
  const ffmpeg = findFfmpeg();
  if (ffmpeg) args.push("--ffmpeg-location", path.dirname(ffmpeg.ffmpeg));
  if (process.env.YTDLP_COOKIES_FILE) args.push("--cookies", process.env.YTDLP_COOKIES_FILE);
  if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);
  return args;
}

export async function runYtdlp(args: string[], options: RunYtdlpOptions): Promise<string> {
  if (runner) return runner(args, options);
  const binary = requireYtdlp();
  const { cwd, signal, timeoutMs = 10 * 60_000 } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PdfToolError("FAILED", "Cancelled."));
      return;
    }
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      if (out.length < 32 * 1024 * 1024) out += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-64_000);
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
      finish(() =>
        reject(
          new PdfToolError(
            "FAILED",
            "This download took too long and was stopped. Try a shorter video or a lower quality.",
          ),
        ),
      );
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new PdfToolError("FAILED", "Cancelled.")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", () => finish(() => reject(new YtdlpMissingError())));
    child.on("close", (code) =>
      finish(() => {
        // 101 is "--max-downloads reached", which for a single link means it worked.
        if (code === 0 || code === 101) resolve(out);
        else reject(new YtdlpRunError(`exit ${code}`, err, code));
      }),
    );
  });
}

// ---- metadata ----------------------------------------------------------------------------------

export interface MediaFormat {
  id: string;
  ext: string;
  /** "1080p", "720p", "audio only". */
  label: string;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  filesizeBytes: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  note: string | null;
}

export interface MediaInfo {
  id: string;
  title: string;
  uploader: string | null;
  channel: string | null;
  durationSeconds: number | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  description: string | null;
  thumbnail: string | null;
  webpageUrl: string;
  extractor: string;
  isLive: boolean;
  ageLimit: number;
  formats: MediaFormat[];
  /** The heights the user can actually pick, highest first. */
  heights: number[];
}

interface RawFormat {
  format_id?: string;
  ext?: string;
  height?: number | null;
  fps?: number | null;
  vcodec?: string;
  acodec?: string;
  tbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  format_note?: string | null;
  protocol?: string;
}

interface RawInfo {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  view_count?: number;
  like_count?: number;
  description?: string;
  thumbnail?: string;
  webpage_url?: string;
  extractor_key?: string;
  extractor?: string;
  is_live?: boolean;
  age_limit?: number;
  formats?: RawFormat[];
  _type?: string;
  entries?: RawInfo[];
}

function toFormat(raw: RawFormat): MediaFormat {
  const hasVideo = Boolean(raw.vcodec && raw.vcodec !== "none");
  const hasAudio = Boolean(raw.acodec && raw.acodec !== "none");
  const height = raw.height ?? null;
  return {
    id: raw.format_id ?? "",
    ext: raw.ext ?? "",
    label: hasVideo ? (height ? `${height}p` : "video") : "audio only",
    height,
    fps: raw.fps ?? null,
    videoCodec: hasVideo ? (raw.vcodec ?? null) : null,
    audioCodec: hasAudio ? (raw.acodec ?? null) : null,
    bitrateKbps: raw.tbr ?? raw.abr ?? null,
    filesizeBytes: raw.filesize ?? raw.filesize_approx ?? null,
    hasVideo,
    hasAudio,
    note: raw.format_note ?? null,
  };
}

export function parseInfo(json: string): MediaInfo {
  let raw: RawInfo;
  try {
    raw = JSON.parse(json.trim().split("\n")[0] ?? "{}") as RawInfo;
  } catch (err) {
    throw new PdfToolError(
      "FAILED",
      "The video details could not be read. Try the link again.",
      err,
    );
  }
  // A link that turns out to be a playlist: take the first entry, since `--no-playlist` asked for
  // exactly one item.
  if (raw._type === "playlist" && raw.entries?.[0]) raw = raw.entries[0];

  const formats = (raw.formats ?? [])
    .filter((f) => f.protocol !== "mhtml" && f.format_id !== undefined)
    .map(toFormat);
  const heights = [
    ...new Set(formats.filter((f) => f.hasVideo && f.height).map((f) => f.height!)),
  ].sort((a, b) => b - a);

  return {
    id: raw.id ?? "",
    title: raw.title ?? "Untitled",
    uploader: raw.uploader ?? null,
    channel: raw.channel ?? null,
    durationSeconds: typeof raw.duration === "number" ? Math.round(raw.duration) : null,
    uploadDate: raw.upload_date
      ? `${raw.upload_date.slice(0, 4)}-${raw.upload_date.slice(4, 6)}-${raw.upload_date.slice(6, 8)}`
      : null,
    viewCount: raw.view_count ?? null,
    likeCount: raw.like_count ?? null,
    description: raw.description ? raw.description.slice(0, 2000) : null,
    thumbnail: raw.thumbnail ?? null,
    webpageUrl: raw.webpage_url ?? "",
    extractor: raw.extractor_key ?? raw.extractor ?? "unknown",
    isLive: Boolean(raw.is_live),
    ageLimit: raw.age_limit ?? 0,
    formats,
    heights,
  };
}

/** Asks yt-dlp what a link is, without downloading anything. */
export async function fetchInfo(url: string, options: RunYtdlpOptions): Promise<MediaInfo> {
  const json = await runYtdlp([...baseArgs(), "--dump-single-json", "--skip-download", url], {
    ...options,
    timeoutMs: options.timeoutMs ?? 90_000,
  });
  return parseInfo(json);
}

// ---- downloading -------------------------------------------------------------------------------

export interface DownloadRequest {
  url: string;
  /** "video" merges the best video+audio; "audio" extracts the soundtrack. */
  kind: "video" | "audio";
  /** Highest picture height to accept, or "best". */
  maxHeight?: number | "best";
  /** Container to end up in: mp4/webm for video, mp3/m4a/opus/wav/flac for audio. */
  container: string;
  /** Audio bitrate in kbps for the lossy audio formats. */
  audioBitrate?: number;
  /** An exact yt-dlp format id, from the Quality Selector. Overrides `maxHeight`. */
  formatId?: string;
}

export interface DownloadedFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  vorbis: "audio/ogg",
};
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

export function mimeFor(extension: string): string {
  const ext = extension.replace(/^\./, "").toLowerCase();
  return AUDIO_MIME[ext] ?? VIDEO_MIME[ext] ?? "application/octet-stream";
}

/** The `-f` selector for a request. Kept pure so tests can assert it without a process. */
export function formatSelector(request: DownloadRequest): string {
  if (request.formatId) {
    // A video-only format still needs a soundtrack merged in; "+bestaudio/…" is yt-dlp's way of
    // saying "and the best audio, but do not fail if this format already has some".
    return request.kind === "audio"
      ? request.formatId
      : `${request.formatId}+bestaudio/${request.formatId}`;
  }
  if (request.kind === "audio") return "bestaudio/best";
  const cap = request.maxHeight;
  if (cap === undefined || cap === "best") return "bestvideo*+bestaudio/best";
  return `bestvideo[height<=${cap}]+bestaudio/best[height<=${cap}]/best`;
}

/** The full argument list for a download. Also pure, for the same reason. */
export function downloadArgs(request: DownloadRequest, template: string): string[] {
  const args = [...baseArgs(), "-f", formatSelector(request), "-o", template];
  if (request.kind === "audio") {
    args.push("--extract-audio", "--audio-format", request.container);
    if (request.audioBitrate) args.push("--audio-quality", `${request.audioBitrate}K`);
  } else if (
    request.container === "mp4" ||
    request.container === "webm" ||
    request.container === "mkv"
  ) {
    args.push("--merge-output-format", request.container);
    // Only re-encode when the merged file genuinely is not the container asked for.
    args.push("--remux-video", request.container);
  }
  args.push("--print", "after_move:filepath", request.url);
  return args;
}

export const MAX_DOWNLOAD_BYTES = Number(process.env.MAX_DOWNLOAD_MB ?? 512) * 1024 * 1024;

/**
 * Downloads one item into a private scratch directory and returns its bytes. The directory is
 * always removed, so phase 04's "temporary files are deleted" guarantee still holds for anything
 * that arrives from the Internet too.
 */
export async function download(
  request: DownloadRequest,
  options: Omit<RunYtdlpOptions, "cwd"> & { cwd?: string } = {},
): Promise<DownloadedFile> {
  const dir = options.cwd ?? (await mkdtemp(path.join(os.tmpdir(), "onestop-online-")));
  try {
    // yt-dlp owns the file name: `--restrict-filenames` plus a fixed template means a crafted
    // title can contain nothing but ASCII, and the path is always inside `dir`.
    const template = path.join(dir, "media.%(ext)s");
    const runOptions: RunYtdlpOptions = {
      cwd: dir,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    };
    await runYtdlp(downloadArgs(request, template), runOptions);

    const entries = (await readdir(dir)).filter((name) => name.startsWith("media."));
    if (entries.length === 0) {
      throw new PdfToolError("FAILED", "Nothing was downloaded. The link may no longer work.");
    }
    // If a merge left the intermediate parts behind, the largest file is the finished one.
    let best = { name: entries[0]!, size: 0 };
    for (const name of entries) {
      const size = (await stat(path.join(dir, name))).size;
      if (size > best.size) best = { name, size };
    }
    if (best.size > MAX_DOWNLOAD_BYTES) {
      throw new PdfToolError(
        "UNSUPPORTED_INPUT",
        `That download is ${Math.round(best.size / 1024 / 1024)} MB, which is over this instance's ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)} MB limit. Choose a lower quality.`,
      );
    }
    return {
      name: best.name,
      bytes: new Uint8Array(await readFile(path.join(dir, best.name))),
      mimeType: mimeFor(path.extname(best.name)),
    };
  } finally {
    if (!options.cwd)
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}
