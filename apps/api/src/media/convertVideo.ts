// Video conversion (Features 8.1–8.5, 8.8, 8.9, 8.14, 8.15): Video Converter, Video Compressor,
// Video → MP4/WebM/GIF, Video Resizer, Video Rotation, Change Video Resolution and Quality.
//
// One engine, `encodeVideo`: optional trim, a `-vf` chain, then either a lossless remux (when the
// streams already suit the target container) or a re-encode with the per-format settings in
// `common.ts`. Every video filter chain ends in `EVEN`, because yuv420p needs even dimensions.
import type { Executor } from "@onestop/tool-registry";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  displaySize,
  eachMedia,
  EVEN,
  formatBytes,
  input,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  parseTime,
  outName,
  readOutput,
  sameVideoFormat,
  unsupported,
  VIDEO_FORMATS,
  videoEncodeArgs,
  type MediaInput,
  type QualityLevel,
  type VideoEncodeOptions,
  type VideoFormat,
} from "./common.ts";

const QUALITIES = ["high", "good", "medium", "low"] as const;
const MAX_SIDE = 7680;

/** Codecs each container can take as-is (a remux is instant and lossless). */
const REMUX: Record<VideoFormat, { video: string[]; audio: string[] }> = {
  mp4: { video: ["h264", "hevc", "mpeg4", "av1"], audio: ["aac", "mp3", "ac3", "eac3", "alac", "opus"] },
  m4v: { video: ["h264", "hevc", "mpeg4"], audio: ["aac", "ac3", "alac"] },
  mov: { video: ["h264", "hevc", "mpeg4", "prores", "mjpeg"], audio: ["aac", "mp3", "alac", "pcm_s16le", "pcm_s24le"] },
  mkv: { video: ["*"], audio: ["*"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
  avi: { video: ["mpeg4", "h264", "mjpeg", "msmpeg4v3"], audio: ["mp3", "ac3", "pcm_s16le"] },
};

export function canRemux(m: MediaInput, format: VideoFormat): boolean {
  const rules = REMUX[format];
  const ok = (list: string[], codec: string) => list.includes("*") || list.includes(codec);
  if (!m.video || !ok(rules.video, m.video.codec)) return false;
  const audio = m.probe.streams.filter((s) => s.codec_type === "audio");
  return audio.every((a) => ok(rules.audio, a.codec_name ?? ""));
}

export interface EncodeVideoOptions extends Omit<VideoEncodeOptions, "hasAudio"> {
  /** `-vf` filters, applied in order (EVEN is appended automatically). */
  filters?: string[];
  start?: number;
  duration?: number;
  /** Try a lossless stream copy first (only when there are no filters and no trim). */
  remux?: boolean;
  signal?: AbortSignal;
}

/** Encodes `m` into `format`; returns the bytes and whether it was a lossless remux. */
export async function encodeVideo(
  m: MediaInput,
  dir: string,
  format: VideoFormat,
  o: EncodeVideoOptions = {},
  outBase = "out",
): Promise<{ bytes: Uint8Array; remuxed: boolean }> {
  if (!m.video) throw unsupported(`"${m.ref.name}" has no video track.`);
  const out = `${outBase}.${format}`;
  const trim = [
    ...(o.start ? ["-ss", String(o.start)] : []),
    ...(o.duration !== undefined ? ["-t", String(o.duration)] : []),
  ];
  const maps = ["-map", `0:${m.video.index}`, ...(o.mute ? [] : ["-map", "0:a?"]), "-sn", "-dn", "-map_metadata", "0"];
  if (o.remux && !o.filters?.length && !trim.length && canRemux(m, format)) {
    const muxer = { mp4: "mp4", m4v: "mp4", mov: "mov", mkv: "matroska", webm: "webm", avi: "avi" }[format];
    await runFfmpeg(
      [...input(m.path), ...maps, "-c", "copy", ...(format === "mp4" || format === "mov" || format === "m4v" ? ["-movflags", "+faststart"] : []), "-f", muxer, out],
      { cwd: dir, signal: o.signal },
    );
    return { bytes: await readOutput(dir, out), remuxed: true };
  }
  await runFfmpeg(
    [
      ...trim,
      ...input(m.path),
      ...maps,
      "-vf",
      [...(o.filters ?? []), EVEN].join(","),
      ...videoEncodeArgs(format, { ...o, hasAudio: Boolean(m.audio) }),
      out,
    ],
    { cwd: dir, signal: o.signal },
  );
  return { bytes: await readOutput(dir, out), remuxed: false };
}

function quality(options: Record<string, unknown>, fallback: QualityLevel = "good"): QualityLevel {
  return optEnum(options, "quality", QUALITIES, fallback);
}

function sizeNote(m: MediaInput, bytes: Uint8Array): string {
  return `${formatBytes(m.size)} → ${formatBytes(bytes.length)}.`;
}

// ---- converters -------------------------------------------------------------------------------

function converter(toolId: string, fixed: VideoFormat | null, zipStem: string): Executor {
  return eachMedia(
    toolId,
    async (m, options, ctx) => {
      const format = fixed ?? optEnum(options, "format", VIDEO_FORMATS, "mp4");
      const mode = optEnum(options, "mode", ["auto", "reencode"], "auto");
      const { bytes, remuxed } = await encodeVideo(
        m,
        ctx.dir,
        format,
        { remux: mode === "auto", quality: quality(options), signal: ctx.signal },
        `out-${ctx.index}`,
      );
      return {
        file: outFile(outName(m, "", format), format, bytes),
        note: remuxed
          ? "The streams already suited the new format, so they were copied without re-encoding (no quality loss)."
          : undefined,
      };
    },
    { verb: "Converted", need: "video", zipStem, max: 10 },
  );
}

export const videoConverterExecutor = converter("video-converter", null, "converted-videos");
export const videoToMp4Executor = converter("video-to-mp4", "mp4", "mp4-videos");
export const videoToWebmExecutor = converter("video-to-webm", "webm", "webm-videos");

// ---- compressor -------------------------------------------------------------------------------

const MAX_HEIGHTS = ["keep", "1080", "720", "480", "360"] as const;

/** A scale filter that caps the *short* side at `limit` (so portrait videos work too), never upscaling. */
export function capShortSide(m: MediaInput, limit: number): string | null {
  const { width, height } = displaySize(m);
  if (Math.min(width, height) <= limit) return null;
  return width >= height ? `scale=-2:${limit}` : `scale=${limit}:-2`;
}

/**
 * Video bitrate (kbps) that lands a `duration`-second video on `targetMb`, or an error when the
 * target is too small to be worth attempting. 3% is left for container overhead.
 */
export function targetBitrate(duration: number, targetMb: number, audioKbps: number, hasAudio: boolean): number {
  if (!(duration > 0)) {
    throw unsupported("This video's length is unknown, so a target size can't be worked out. Choose a compression level instead.");
  }
  const videoKbps = Math.floor(((targetMb * 8192) / duration) * 0.97 - (hasAudio ? audioKbps : 0));
  if (videoKbps < 64) {
    throw unsupported(
      `${targetMb} MB is too small for a ${Math.round(duration)} s video. Try at least ${Math.ceil(((64 + audioKbps) * duration) / 8192 / 0.97)} MB.`,
    );
  }
  return videoKbps;
}

export const videoCompressorExecutor: Executor = eachMedia(
  "video-compressor",
  async (m, options, ctx) => {
    const level = optEnum(options, "level", ["light", "balanced", "strong", "size"], "balanced");
    const heightChoice = optEnum(options, "maxHeight", MAX_HEIGHTS, "keep");
    const limit = heightChoice !== "keep" ? Number(heightChoice) : level === "strong" ? 720 : null;
    const scale = limit ? capShortSide(m, limit) : null;
    const audioKbps = level === "strong" ? 64 : 96;
    const encode: EncodeVideoOptions = { audioKbps, filters: scale ? [scale] : [], signal: ctx.signal };
    if (level === "size") {
      const targetMb = optNumber(options, "targetMb", 10, { min: 1, max: 4000 });
      encode.videoKbps = targetBitrate(m.duration, targetMb, audioKbps, Boolean(m.audio));
    } else {
      encode.crf = { light: 25, balanced: 28, strong: 32 }[level];
    }
    const { bytes } = await encodeVideo(m, ctx.dir, "mp4", encode, `out-${ctx.index}`);
    if (bytes.length >= m.size) {
      return {
        file: outFile(m.ref.name, m.ext, await ctx.readFile(m.ref)),
        note: `"${m.ref.name}" is already well compressed; this setting would not make it smaller, so the original was kept.`,
      };
    }
    return {
      file: outFile(outName(m, "compressed", "mp4"), "mp4", bytes),
      note: `${sizeNote(m, bytes)} (${Math.round((1 - bytes.length / m.size) * 100)}% smaller)${scale ? ` Resolution capped at ${limit}p.` : ""}`,
    };
  },
  { verb: "Compressed", need: "video", zipStem: "compressed-videos", max: 10 },
);

// ---- GIF --------------------------------------------------------------------------------------

export const MAX_GIF_SECONDS = 60;

export const videoToGifExecutor: Executor = eachMedia(
  "video-to-gif",
  async (m, options, ctx) => {
    const start = parseTime(optString(options, "start"), "Start") ?? 0;
    if (m.duration > 0 && start >= m.duration) {
      throw unsupported(`The start time is past the end of the video (${m.duration.toFixed(1)} s).`);
    }
    const remaining = m.duration > 0 ? m.duration - start : MAX_GIF_SECONDS;
    const asked = parseTime(optString(options, "duration"), "Length");
    const duration = Math.min(asked ?? Math.min(remaining, 10), remaining, MAX_GIF_SECONDS);
    const fps = optNumber(options, "fps", 10, { min: 1, max: 30 });
    const width = optNumber(options, "width", 480, { min: 0, max: 1280 });
    const loop = optBool(options, "loop", true);
    const scale = width > 0 ? `scale=${width}:-1:flags=lanczos` : "scale=iw:ih";
    const out = `out-${ctx.index}.gif`;
    await runFfmpeg(
      [
        ...(start ? ["-ss", String(start)] : []),
        "-t",
        String(duration),
        ...input(m.path),
        "-filter_complex",
        `[0:${m.video!.index}]fps=${fps},${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        "-loop",
        loop ? "0" : "-1",
        "-f",
        "gif",
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal },
    );
    const bytes = await readOutput(ctx.dir, out);
    const capped = asked !== null && asked > MAX_GIF_SECONDS ? ` GIFs are limited to ${MAX_GIF_SECONDS} s.` : "";
    return {
      file: outFile(outName(m, "", "gif"), "gif", bytes),
      note: `${duration.toFixed(1)} s at ${fps} fps${width ? `, ${width} px wide` : ""} (${formatBytes(bytes.length)}).${capped}`,
    };
  },
  { verb: "Made a GIF from", need: "video", zipStem: "gifs", max: 5 },
);

// ---- resize / resolution / quality / rotate ---------------------------------------------------

const RESIZE_PRESETS: Record<string, [number, number]> = {
  "1920x1080": [1920, 1080],
  "1280x720": [1280, 720],
  "1080x1920": [1080, 1920],
  "1080x1080": [1080, 1080],
  "1080x1350": [1080, 1350],
  "854x480": [854, 480],
};

const NAMED_COLOURS: Record<string, string> = {
  black: "000000",
  white: "ffffff",
  gray: "808080",
  grey: "808080",
  red: "ff0000",
  green: "00ff00",
  blue: "0000ff",
};

/** A colour safe to put inside a filter string: 6 hex digits, or a name from a fixed list. */
export function padColour(text: string): string {
  const t = text.trim().toLowerCase();
  if (NAMED_COLOURS[t]) return `0x${NAMED_COLOURS[t]}`;
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t)?.[1];
  if (!hex) return "0x000000";
  return `0x${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function resizeFilters(
  m: MediaInput,
  width: number,
  height: number,
  mode: "fit" | "pad" | "crop" | "stretch",
  colour: string,
): { filters: string[]; size: string } {
  if (width > MAX_SIDE || height > MAX_SIDE) throw unsupported(`Keep width and height under ${MAX_SIDE} pixels.`);
  if (!width && !height) throw unsupported("Enter a width, a height, or both.");
  const src = displaySize(m);
  if (!width || !height) {
    const w = width || even((src.width * height) / src.height);
    const h = height || even((src.height * width) / src.width);
    return { filters: [`scale=${even(w)}:${even(h)}`, "setsar=1"], size: `${even(w)} × ${even(h)}` };
  }
  const W = even(width);
  const H = even(height);
  switch (mode) {
    case "stretch":
      return { filters: [`scale=${W}:${H}`, "setsar=1"], size: `${W} × ${H}` };
    case "crop":
      return { filters: [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, "setsar=1"], size: `${W} × ${H}` };
    case "pad":
      return {
        filters: [`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${padColour(colour)}`, "setsar=1"],
        size: `${W} × ${H}`,
      };
    case "fit": {
      const s = Math.min(W / src.width, H / src.height);
      return { filters: [`scale=${even(src.width * s)}:${even(src.height * s)}`, "setsar=1"], size: `${even(src.width * s)} × ${even(src.height * s)}` };
    }
  }
}

export const videoResizerExecutor: Executor = eachMedia(
  "video-resizer",
  async (m, options, ctx) => {
    const preset = optString(options, "preset", "custom");
    const [pw, ph] = RESIZE_PRESETS[preset] ?? [
      optNumber(options, "width", 1280, { min: 0, max: MAX_SIDE }),
      optNumber(options, "height", 0, { min: 0, max: MAX_SIDE }),
    ];
    const mode = optEnum(options, "mode", ["fit", "pad", "crop", "stretch"], "pad");
    const { filters, size } = resizeFilters(m, pw, ph, mode, optString(options, "background", "black"));
    const format = sameVideoFormat(m);
    const { bytes } = await encodeVideo(m, ctx.dir, format, { filters, quality: quality(options), signal: ctx.signal }, `out-${ctx.index}`);
    return { file: outFile(outName(m, "resized", format), format, bytes), note: `New size ${size}.` };
  },
  { verb: "Resized", need: "video", zipStem: "resized-videos", max: 10 },
);

export const RESOLUTIONS = ["2160", "1440", "1080", "720", "480", "360", "240"] as const;

export const changeResolutionExecutor: Executor = eachMedia(
  "change-video-resolution",
  async (m, options, ctx) => {
    const target = Number(optEnum(options, "resolution", RESOLUTIONS, "720"));
    const allowUpscale = optBool(options, "upscale", false);
    const src = displaySize(m);
    const short = Math.min(src.width, src.height);
    if (short === target || (short < target && !allowUpscale)) {
      return {
        file: outFile(m.ref.name, m.ext, await ctx.readFile(m.ref)),
        note: `"${m.ref.name}" is already ${short}p${short < target ? " (smaller than the target; upscaling is off)" : ""}, so it was left unchanged.`,
      };
    }
    const filter = src.width >= src.height ? `scale=-2:${target}:flags=lanczos` : `scale=${target}:-2:flags=lanczos`;
    const format = sameVideoFormat(m);
    const { bytes } = await encodeVideo(m, ctx.dir, format, { filters: [filter, "setsar=1"], quality: quality(options), signal: ctx.signal }, `out-${ctx.index}`);
    return { file: outFile(outName(m, `${target}p`, format), format, bytes), note: `${short}p → ${target}p.` };
  },
  { verb: "Changed the resolution of", need: "video", zipStem: "videos", max: 10 },
);

export const changeQualityExecutor: Executor = eachMedia(
  "change-video-quality",
  async (m, options, ctx) => {
    const level = quality(options, "medium");
    const audioKbps = optNumber(options, "audioBitrate", 128, { min: 32, max: 320 });
    const format = sameVideoFormat(m);
    const { bytes } = await encodeVideo(m, ctx.dir, format, { quality: level, audioKbps, signal: ctx.signal }, `out-${ctx.index}`);
    return { file: outFile(outName(m, level, format), format, bytes), note: `Quality "${level}": ${sizeNote(m, bytes)}` };
  },
  { verb: "Re-encoded", need: "video", zipStem: "videos", max: 10 },
);

export function rotationFilters(angle: number, flip: string): string[] {
  const filters: string[] = [];
  if (angle === 90) filters.push("transpose=clock");
  else if (angle === 180) filters.push("hflip", "vflip");
  else if (angle === 270) filters.push("transpose=cclock");
  if (flip === "horizontal" || flip === "both") filters.push("hflip");
  if (flip === "vertical" || flip === "both") filters.push("vflip");
  return filters;
}

export const rotateVideoExecutor: Executor = eachMedia(
  "rotate-video",
  async (m, options, ctx) => {
    const angle = Number(optEnum(options, "angle", ["0", "90", "180", "270"], "90"));
    const flip = optEnum(options, "flip", ["none", "horizontal", "vertical", "both"], "none");
    const filters = rotationFilters(angle, flip);
    if (!filters.length) throw unsupported("Choose an angle or a flip.");
    const format = sameVideoFormat(m);
    const { bytes } = await encodeVideo(m, ctx.dir, format, { filters, quality: quality(options, "high"), signal: ctx.signal }, `out-${ctx.index}`);
    const what = [angle ? `rotated ${angle}° clockwise` : "", flip !== "none" ? `flipped ${flip === "both" ? "both ways" : flip}` : ""].filter(Boolean).join(" and ");
    return { file: outFile(outName(m, "rotated", format), format, bytes), note: `Video ${what}.` };
  },
  { verb: "Rotated", need: "video", zipStem: "rotated-videos", max: 10 },
);
