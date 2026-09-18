// Audio conversion (Features 7.1–7.3, 7.6–7.9): Video → MP3, Audio Converter, Audio Compressor and
// the four "Audio → X" tools. One engine, `encodeAudio`, which trims/filters/encodes the first audio
// track of any input (audio or video) into any of the eight output formats.
import type { Executor } from "@onestop/tool-registry";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  AUDIO_FORMATS,
  audioEncodeArgs,
  eachMedia,
  formatBytes,
  input,
  LOSSLESS_AUDIO,
  optEnum,
  optNumber,
  outFile,
  outName,
  readOutput,
  sameAudioFormat,
  unsupported,
  type AudioEncodeOptions,
  type AudioFormat,
  type MediaInput,
} from "./common.ts";

export interface EncodeAudioOptions extends AudioEncodeOptions {
  /** Seconds. */
  start?: number;
  duration?: number;
  /** Extra `-af` filters, applied in order. */
  filters?: string[];
  /** Keep the tags (and MP3/M4A cover art) of the input. Default true. */
  keepTags?: boolean;
  signal?: AbortSignal;
}

/** Encodes the first audio track of `m` into `format`; returns the output bytes. */
export async function encodeAudio(
  m: MediaInput,
  dir: string,
  format: AudioFormat,
  o: EncodeAudioOptions = {},
  outBase = "out",
): Promise<Uint8Array> {
  if (!m.audio) throw unsupported(`"${m.ref.name}" has no audio track.`);
  const out = `${outBase}.${format}`;
  const cover =
    o.keepTags !== false &&
    (format === "mp3" || format === "m4a") &&
    m.probe.streams.some((s) => s.disposition?.attached_pic);
  const coverIndex = m.probe.streams.find((s) => s.disposition?.attached_pic)?.index;
  await runFfmpeg(
    [
      ...(o.start ? ["-ss", String(o.start)] : []),
      ...(o.duration !== undefined ? ["-t", String(o.duration)] : []),
      ...input(m.path),
      "-map",
      `0:${m.audio.index}`,
      ...(cover
        ? ["-map", `0:${coverIndex}`, "-c:v", "copy", "-disposition:v", "attached_pic"]
        : ["-vn"]),
      "-sn",
      "-dn",
      ...(o.keepTags === false ? ["-map_metadata", "-1"] : ["-map_metadata", "0"]),
      ...(o.filters?.length ? ["-af", o.filters.join(",")] : []),
      ...audioEncodeArgs(format, o),
      out,
    ],
    { cwd: dir, signal: o.signal },
  );
  return readOutput(dir, out);
}

const BITRATES = [32, 48, 64, 96, 128, 160, 192, 256, 320];

function bitrateOption(options: Record<string, unknown>, fallback: number): number {
  const n = optNumber(options, "bitrate", fallback, { min: 32, max: 320 });
  return BITRATES.reduce(
    (best, b) => (Math.abs(b - n) < Math.abs(best - n) ? b : best),
    BITRATES[0]!,
  );
}

function sampleRateOption(options: Record<string, unknown>): number | undefined {
  const value = optEnum(
    options,
    "sampleRate",
    ["keep", "22050", "32000", "44100", "48000"],
    "keep",
  );
  return value === "keep" ? undefined : Number(value);
}

function channelsOption(options: Record<string, unknown>): number | undefined {
  const value = optEnum(options, "channels", ["keep", "1", "2"], "keep");
  return value === "keep" ? undefined : Number(value);
}

/** The encoder settings every format-converting tool shares. */
function encodeOptions(options: Record<string, unknown>, fallbackKbps: number): AudioEncodeOptions {
  return {
    bitrate: bitrateOption(options, fallbackKbps),
    sampleRate: sampleRateOption(options),
    channels: channelsOption(options),
  };
}

function lengthNote(m: MediaInput): string {
  return m.duration > 0 ? `${m.duration.toFixed(1)} s of audio.` : "";
}

/** A converter into a fixed format (Audio → WAV/MP3/AAC/FLAC, Video → MP3). */
function fixedFormat(toolId: string, format: AudioFormat, verb: string, need: "audio" | "video") {
  return eachMedia(
    toolId,
    async (m, options, ctx) => {
      const bytes = await encodeAudio(
        m,
        ctx.dir,
        format,
        { ...encodeOptions(options, 192), signal: ctx.signal },
        `out-${ctx.index}`,
      );
      return {
        file: outFile(outName(m, "", format), format, bytes),
        note: LOSSLESS_AUDIO.includes(format)
          ? undefined
          : `Bitrate ${bitrateOption(options, 192)} kbps.`,
        info: { duration: m.duration },
      };
    },
    { verb, need, zipStem: `${format}-files` },
  );
}

export const videoToMp3Executor: Executor = fixedFormat(
  "video-to-mp3",
  "mp3",
  "Saved the soundtrack of",
  "video",
);
export const audioToWavExecutor: Executor = fixedFormat(
  "audio-to-wav",
  "wav",
  "Converted",
  "audio",
);
export const audioToMp3Executor: Executor = fixedFormat(
  "audio-to-mp3",
  "mp3",
  "Converted",
  "audio",
);
export const audioToAacExecutor: Executor = fixedFormat(
  "audio-to-aac",
  "aac",
  "Converted",
  "audio",
);
export const audioToFlacExecutor: Executor = fixedFormat(
  "audio-to-flac",
  "flac",
  "Converted",
  "audio",
);

export const audioConverterExecutor: Executor = eachMedia(
  "audio-converter",
  async (m, options, ctx) => {
    const format = optEnum(options, "format", AUDIO_FORMATS, "mp3");
    const bytes = await encodeAudio(
      m,
      ctx.dir,
      format,
      { ...encodeOptions(options, 192), signal: ctx.signal },
      `out-${ctx.index}`,
    );
    return { file: outFile(outName(m, "", format), format, bytes), note: lengthNote(m) };
  },
  { verb: "Converted", need: "audio", zipStem: "converted-audio" },
);

/**
 * Audio Compressor: re-encode at a lower bitrate (optionally mono / lower sample rate). Lossless
 * inputs become MP3 unless a format is chosen. Never hands back something bigger than the input.
 */
export const audioCompressorExecutor: Executor = eachMedia(
  "audio-compressor",
  async (m, options, ctx) => {
    const choice = optEnum(options, "format", ["same", ...AUDIO_FORMATS], "same");
    let format: AudioFormat = choice === "same" ? sameAudioFormat(m) : choice;
    if (LOSSLESS_AUDIO.includes(format)) format = "mp3";
    const level = optEnum(options, "level", ["light", "balanced", "strong", "custom"], "balanced");
    const kbps =
      level === "custom"
        ? bitrateOption(options, 96)
        : { light: 128, balanced: 96, strong: 64 }[level];
    const bytes = await encodeAudio(
      m,
      ctx.dir,
      format,
      {
        bitrate: kbps,
        sampleRate: sampleRateOption(options) ?? (level === "strong" ? 32000 : undefined),
        channels: channelsOption(options) ?? (level === "strong" ? 1 : undefined),
        signal: ctx.signal,
      },
      `out-${ctx.index}`,
    );
    if (bytes.length >= m.size) {
      return {
        file: outFile(m.ref.name, m.ext, await ctx.readFile(m.ref)),
        note: `"${m.ref.name}" is already smaller than this setting would make it, so the original was kept.`,
      };
    }
    const saved =
      m.size > bytes.length ? ` (${Math.round((1 - bytes.length / m.size) * 100)}% smaller)` : "";
    return {
      file: outFile(outName(m, "compressed", format), format, bytes),
      note: `${formatBytes(m.size)} → ${formatBytes(bytes.length)}${saved} at ${kbps} kbps.`,
    };
  },
  { verb: "Compressed", need: "audio", zipStem: "compressed-audio" },
);
