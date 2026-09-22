// Shared plumbing for the audio/video tools (10-audio-video-tools.md): a private scratch directory
// per run, reading + probing inputs, the encoder settings for every output format, and the error
// contract (a `PdfToolError` is the shared "tool error" type — the name is historical).
//
// FFmpeg needs real files, so each run gets a fresh `onestop-media-*` directory. Inputs are written
// there as `in-<n>.<ext>` — the uploaded name never becomes part of a path or an argument — and the
// directory is always removed, so phase 04's "temp files are deleted" guarantee still holds.
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecContext, ExecErrorCode, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { packageFiles } from "../images/common.ts";
import { baseName, extOf, plural } from "../documents/common.ts";
import { FfmpegRunError, requireFfmpeg, runFfprobe } from "./ffmpegCheck.ts";

export {
  baseName,
  extOf,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
} from "../documents/common.ts";
export { formatBytes, packageFiles } from "../images/common.ts";

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PdfToolError("FAILED", "Cancelled.");
}

/** Maps FFmpeg's stderr onto a short, actionable message. The full text goes to the server log. */
function ffmpegFailure(err: FfmpegRunError): { code: ExecErrorCode; message: string } {
  const text = err.stderr;
  if (
    /Invalid data found|could not find codec parameters|moov atom not found|EBML header parsing failed|Invalid argument/i.test(
      text,
    )
  ) {
    return {
      code: "UNSUPPORTED_INPUT",
      message: "This file could not be read. It may be damaged or not really an audio/video file.",
    };
  }
  if (/Unknown encoder|Encoder not found|encoder .* not found/i.test(text)) {
    return {
      code: "FAILED",
      message:
        "Your FFmpeg build is missing an encoder this format needs. Install a full FFmpeg build (see setup instructions).",
    };
  }
  if (/No space left/i.test(text)) {
    return {
      code: "FAILED",
      message: "The server ran out of disk space while processing this file.",
    };
  }
  return {
    code: "FAILED",
    message: "FFmpeg could not process this file. Please try another file or setting.",
  };
}

export async function runMediaTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[media:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (err instanceof FfmpegRunError) {
      console.error(`[media:${toolId}] ffmpeg failed`, err.stderr.slice(-2000));
      return { ok: false, ...ffmpegFailure(err) };
    }
    console.error(`[media:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This file could not be processed. Please try again.",
    };
  }
}

/** A private scratch directory for one run, always removed afterwards. */
export async function withWorkdir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "onestop-media-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

// ---- probing ----------------------------------------------------------------------------------

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
  side_data_list?: { rotation?: number }[];
}

export interface Probe {
  format: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
  streams: ProbeStream[];
}

/** Demuxers that read *other* files or URLs. An upload must never be opened as one of these. */
const REFERENCING_FORMATS =
  /(^|,)(hls|applehttp|concat|ffconcat|dash|sdp|rtsp|rtp|image2|tee|lavfi)(,|$)/;

export async function probe(file: string, dir: string, signal?: AbortSignal): Promise<Probe> {
  let json: string;
  try {
    json = await runFfprobe(
      [
        "-protocol_whitelist",
        "file",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file,
      ],
      { cwd: dir, signal, timeoutMs: 60_000 },
    );
  } catch (err) {
    if (err instanceof FfmpegRunError) {
      throw unsupported(
        "This file could not be read. It may be damaged or not really an audio/video file.",
        err.stderr.slice(-1000),
      );
    }
    throw err;
  }
  const parsed = JSON.parse(json || "{}") as Partial<Probe>;
  const result: Probe = { format: parsed.format ?? {}, streams: parsed.streams ?? [] };
  if (REFERENCING_FORMATS.test(result.format.format_name ?? "")) {
    throw unsupported("This file type is not supported.", result.format.format_name);
  }
  return result;
}

export function num(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rate(text: string | undefined): number {
  if (!text) return 0;
  const [a, b] = text.split("/").map(Number);
  if (!a || !b) return 0;
  return a / b;
}

export interface MediaInput {
  ref: FileRef;
  /** File name inside the scratch directory (FFmpeg runs with that directory as its cwd). */
  path: string;
  ext: string;
  size: number;
  probe: Probe;
  duration: number;
  video?: {
    index: number;
    codec: string;
    width: number;
    height: number;
    fps: number;
    rotation: number;
  };
  audio?: { index: number; codec: string; sampleRate: number; channels: number; bitRate: number };
  subtitles: ProbeStream[];
}

/** Attached pictures (cover art) are "video" streams too; they don't make a file a video. */
function isRealVideo(s: ProbeStream): boolean {
  return s.codec_type === "video" && !s.disposition?.attached_pic;
}

export function describe(ref: FileRef, file: string, size: number, p: Probe): MediaInput {
  const v = p.streams.find(isRealVideo);
  const a = p.streams.find((s) => s.codec_type === "audio");
  const rotation = num(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation);
  const durations = [p.format.duration, v?.duration, a?.duration].map(num).filter((d) => d > 0);
  return {
    ref,
    path: file,
    ext: extOf(ref.name),
    size,
    probe: p,
    duration: durations[0] ?? 0,
    video: v
      ? {
          index: v.index,
          codec: v.codec_name ?? "",
          width: num(v.width),
          height: num(v.height),
          fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 25,
          rotation,
        }
      : undefined,
    audio: a
      ? {
          index: a.index,
          codec: a.codec_name ?? "",
          sampleRate: num(a.sample_rate),
          channels: num(a.channels),
          bitRate: num(a.bit_rate) || num(p.format.bit_rate),
        }
      : undefined,
    subtitles: p.streams.filter((s) => s.codec_type === "subtitle"),
  };
}

/** Displayed size (a phone video stored 1920×1080 with a 90° rotation plays as 1080×1920). */
export function displaySize(m: MediaInput): { width: number; height: number } {
  const v = m.video!;
  return Math.abs(v.rotation) % 180 === 90
    ? { width: v.height, height: v.width }
    : { width: v.width, height: v.height };
}

const SAFE_EXT = /^[a-z0-9]{1,5}$/;
/** Text playlists that would make FFmpeg read other files. Refused before FFmpeg sees them. */
const PLAYLIST_HEAD = /^(\uFEFF)?\s*(#EXTM3U|ffconcat|\[playlist\]|<\?xml[^>]*>\s*<MPD)/i;

export type Need = "audio" | "video" | "any";

/** Writes each input into `dir`, probes it and checks it has the streams the tool needs. */
export async function readMedia(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  dir: string,
  { min = 1, max = 50, need = "any" }: { min?: number; max?: number; need?: Need } = {},
): Promise<MediaInput[]> {
  requireFfmpeg();
  if (!ctx)
    throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
  const noun = need === "video" ? "video" : need === "audio" ? "audio file" : "file";
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} ${noun}s.` : `Choose a ${noun} first.`);
  }
  if (input.length > max) throw unsupported(`Choose at most ${max} ${noun}s.`);
  const out: MediaInput[] = [];
  for (const [i, ref] of input.entries()) {
    throwIfAborted(ctx.signal);
    const bytes = await ctx.readFile(ref);
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 256));
    if (PLAYLIST_HEAD.test(head)) throw unsupported("This file type is not supported.");
    const ext = extOf(ref.name);
    const file = `in-${i}.${SAFE_EXT.test(ext) ? ext : "bin"}`;
    await writeFile(path.join(dir, file), bytes);
    const media = describe(ref, file, bytes.length, await probe(file, dir, ctx.signal));
    const label = input.length > 1 ? `"${ref.name}"` : "This file";
    if (need === "video" && !media.video) {
      throw unsupported(`${label} has no video track. Choose a video file.`);
    }
    if (need === "audio" && !media.audio) {
      throw unsupported(`${label} has no audio track.`);
    }
    if (need === "any" && !media.audio && !media.video) {
      throw unsupported(`${label} has no audio or video in it.`);
    }
    out.push(media);
  }
  return out;
}

/** Reads a file FFmpeg wrote into the scratch directory. */
export async function readOutput(dir: string, name: string): Promise<Uint8Array> {
  const file = path.join(dir, name);
  const info = await stat(file).catch(() => null);
  if (!info || info.size === 0) {
    throw new PdfToolError("FAILED", "FFmpeg produced an empty result for this file.", name);
  }
  return new Uint8Array(await readFile(file));
}

/** `-i <name>` restricted to local files, so a crafted input can never make FFmpeg fetch a URL. */
export function input(name: string, before: string[] = []): string[] {
  return [...before, "-protocol_whitelist", "file", "-i", name];
}

// ---- times ------------------------------------------------------------------------------------

/**
 * Parses "90", "1:30", "01:02:03.5", "1m30s" or "2.5s" into seconds. Blank → null.
 * Throws a user-facing error for anything else, naming the field.
 */
export function parseTime(text: unknown, field: string): number | null {
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
  if (typeof text !== "string" || text.trim() === "") return null;
  const t = text.trim().replace(",", ".");
  let seconds = NaN;
  if (/^\d+(\.\d+)?$/.test(t)) seconds = Number(t);
  else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(t)) {
    seconds = t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  } else {
    const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i.exec(t);
    if (m && (m[1] || m[2] || m[3])) seconds = num(m[1]) * 3600 + num(m[2]) * 60 + num(m[3]);
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw unsupported(
      `${field}: "${text}" is not a time. Use seconds (90) or minutes:seconds (1:30).`,
    );
  }
  return seconds;
}

export function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const t = tenths % 600;
  const secText = String(Math.floor(t / 10)).padStart(2, "0") + (t % 10 ? `.${t % 10}` : "");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${secText}` : `${m}:${secText}`;
}

// ---- output formats ---------------------------------------------------------------------------

export const AUDIO_FORMATS = ["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "wma"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
export const VIDEO_FORMATS = ["mp4", "webm", "mov", "mkv", "avi", "m4v"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const MEDIA_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wma: "audio/x-ms-wma",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  json: "application/json",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
};

export const LOSSLESS_AUDIO: readonly string[] = ["wav", "flac"];

export function isAudioFormat(ext: string): ext is AudioFormat {
  return (AUDIO_FORMATS as readonly string[]).includes(ext);
}
export function isVideoFormat(ext: string): ext is VideoFormat {
  return (VIDEO_FORMATS as readonly string[]).includes(ext);
}

/** The audio format a "same as input" result is written in. */
export function sameAudioFormat(m: MediaInput): AudioFormat {
  return isAudioFormat(m.ext) ? m.ext : "mp3";
}

/** The container a "same as input" video result is written in. */
export function sameVideoFormat(m: MediaInput): VideoFormat {
  return isVideoFormat(m.ext) ? m.ext : "mp4";
}

export interface AudioEncodeOptions {
  /** kbps for lossy formats; ignored for WAV/FLAC. */
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
}

/** Encoder arguments for an audio-only output of `format` (including the muxer). */
export function audioEncodeArgs(format: AudioFormat, o: AudioEncodeOptions = {}): string[] {
  const br = (fallback: number) => ["-b:a", `${o.bitrate ?? fallback}k`];
  const common = [
    ...(o.sampleRate ? ["-ar", String(o.sampleRate)] : []),
    ...(o.channels ? ["-ac", String(o.channels)] : []),
  ];
  switch (format) {
    case "mp3":
      return ["-c:a", "libmp3lame", ...br(192), ...common, "-id3v2_version", "3", "-f", "mp3"];
    case "wav":
      return ["-c:a", "pcm_s16le", ...common, "-f", "wav"];
    case "flac":
      return ["-c:a", "flac", "-compression_level", "5", ...common, "-f", "flac"];
    case "aac":
      return ["-c:a", "aac", ...br(192), ...common, "-f", "adts"];
    case "m4a":
      return ["-c:a", "aac", ...br(192), ...common, "-movflags", "+faststart", "-f", "ipod"];
    case "ogg":
      return ["-c:a", "libvorbis", ...br(192), ...common, "-f", "ogg"];
    case "opus": {
      // Opus only runs at 48 kHz (FFmpeg resamples) and caps at 256 kbps per channel pair.
      return [
        "-c:a",
        "libopus",
        ...br(128),
        ...(o.channels ? ["-ac", String(o.channels)] : []),
        "-f",
        "ogg",
      ];
    }
    case "wma":
      return ["-c:a", "wmav2", ...br(192), ...common, "-f", "asf"];
  }
}

export type QualityLevel = "high" | "good" | "medium" | "low";

/** x264 CRF per quality level; VP9 uses its own scale. */
const H264_CRF: Record<QualityLevel, number> = { high: 18, good: 23, medium: 28, low: 33 };
const VP9_CRF: Record<QualityLevel, number> = { high: 24, good: 32, medium: 38, low: 45 };

export interface VideoEncodeOptions {
  quality?: QualityLevel;
  /** Overrides quality with an explicit CRF (x264 scale). */
  crf?: number;
  /** Target video bitrate in kbps (compress-to-size). */
  videoKbps?: number;
  audioKbps?: number;
  /** Drop the audio track. */
  mute?: boolean;
  hasAudio: boolean;
}

/** Encoder arguments for a video output in `format`, including the muxer. */
export function videoEncodeArgs(format: VideoFormat, o: VideoEncodeOptions): string[] {
  const quality = o.quality ?? "good";
  const audio = !o.hasAudio || o.mute ? ["-an"] : null;
  const aKbps = `${o.audioKbps ?? 128}k`;
  const rateArgs = (crf: number) =>
    o.videoKbps
      ? [
          "-b:v",
          `${o.videoKbps}k`,
          "-maxrate",
          `${Math.round(o.videoKbps * 1.5)}k`,
          "-bufsize",
          `${o.videoKbps * 2}k`,
        ]
      : ["-crf", String(crf)];
  const x264 = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    ...rateArgs(o.crf ?? H264_CRF[quality]),
    "-pix_fmt",
    "yuv420p",
  ];
  switch (format) {
    case "mp4":
    case "m4v":
    case "mov":
      return [
        ...x264,
        ...(audio ?? ["-c:a", "aac", "-b:a", aKbps]),
        "-movflags",
        "+faststart",
        "-f",
        format === "mov" ? "mov" : "mp4",
      ];
    case "mkv":
      return [...x264, ...(audio ?? ["-c:a", "aac", "-b:a", aKbps]), "-f", "matroska"];
    case "webm":
      return [
        "-c:v",
        "libvpx-vp9",
        ...(o.videoKbps
          ? ["-b:v", `${o.videoKbps}k`]
          : [
              "-crf",
              String(o.crf !== undefined ? Math.min(63, o.crf + 9) : VP9_CRF[quality]),
              "-b:v",
              "0",
            ]),
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-pix_fmt",
        "yuv420p",
        ...(audio ?? ["-c:a", "libopus", "-b:a", aKbps]),
        "-f",
        "webm",
      ];
    case "avi":
      return [
        "-c:v",
        "mpeg4",
        ...(o.videoKbps
          ? ["-b:v", `${o.videoKbps}k`]
          : ["-q:v", String({ high: 2, good: 4, medium: 7, low: 12 }[quality])]),
        "-tag:v",
        "XVID",
        ...(audio ?? ["-c:a", "libmp3lame", "-b:a", aKbps]),
        "-f",
        "avi",
      ];
  }
}

/** Keeps dimensions even (required by yuv420p encoders) after whatever filter came before. */
export const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export function outName(m: MediaInput, suffix: string, ext: string): string {
  return `${baseName(m.ref.name)}${suffix ? `-${suffix}` : ""}.${ext}`;
}

export function outFile(name: string, ext: string, bytes: Uint8Array): OutputFile {
  return { name, mimeType: MEDIA_MIME[ext] ?? "application/octet-stream", bytes };
}

export interface MediaResult {
  file: OutputFile;
  note?: string;
  info?: Record<string, unknown>;
}

/**
 * Scales one file's own 0-1 FFmpeg progress into its slice of the whole job (file `index` of
 * `total`), and forwards it to `ctx.reportProgress`. A no-op when nothing is polling for progress.
 */
export function scaledProgress(
  ctx: ExecContext & { index: number; total: number },
): ((fraction: number) => void) | undefined {
  if (!ctx.reportProgress) return undefined;
  return (fraction) => ctx.reportProgress!((ctx.index + Math.max(0, Math.min(1, fraction))) / ctx.total);
}

/**
 * The "one file in → one file out, ZIP when several" executor shape shared by most media tools.
 * `perFile` is also what workflows (phase 15) can call in isolation.
 */
export function eachMedia(
  toolId: string,
  perFile: (
    media: MediaInput,
    options: Record<string, unknown>,
    ctx: ExecContext & { dir: string; index: number; total: number },
  ) => Promise<MediaResult>,
  {
    verb,
    need = "any",
    zipStem = toolId,
    max = 20,
  }: {
    verb: string | ((options: Record<string, unknown>) => string);
    need?: Need;
    zipStem?: string;
    max?: number;
  },
): (
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx?: ExecContext,
) => Promise<ExecResult> {
  return (input, options, ctx) =>
    runMediaTool(toolId, () =>
      withWorkdir(async (dir) => {
        const inputs = await readMedia(input, ctx, dir, { need, max });
        const results: MediaResult[] = [];
        for (const [index, media] of inputs.entries()) {
          throwIfAborted(ctx!.signal);
          results.push(await perFile(media, options, { ...ctx!, dir, index, total: inputs.length }));
        }
        const notes = [
          ...new Set(results.map((r) => r.note).filter((n): n is string => Boolean(n))),
        ];
        const noun = need === "video" ? "video" : need === "audio" ? "audio file" : "file";
        return {
          ok: true,
          output: {
            files: results.map((r) => ({
              name: r.file.name,
              size: r.file.bytes.length,
              ...r.info,
            })),
          },
          summary: [
            `${typeof verb === "function" ? verb(options) : verb} ${plural(results.length, noun)}.`,
            ...notes.slice(0, 3),
          ].join(" "),
          files: packageFiles(
            results.map((r) => r.file),
            options,
            zipStem,
          ),
        };
      }),
    );
}
