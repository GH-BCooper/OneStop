// Volume Normalizer (Features 7.12).
//
// Two ways to even out loudness, both entirely local:
//  • Loudness (default) — EBU R128 two-pass `loudnorm`: measure the file, then apply a linear gain
//    so it lands on the target LUFS with no true-peak clipping. This is what streaming services do.
//  • Peak — measure the highest sample with `volumedetect` and lift it to the chosen ceiling.
import type { Executor } from "@onestop/tool-registry";
import { encodeAudio } from "./convertAudio.ts";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  eachMedia,
  input,
  optEnum,
  optNumber,
  outFile,
  outName,
  sameAudioFormat,
  unsupported,
  type MediaInput,
} from "./common.ts";

export interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** Pulls loudnorm's JSON report out of FFmpeg's stderr. */
export function parseLoudnorm(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasurement>;
    return parsed.input_i ? (parsed as LoudnormMeasurement) : null;
  } catch {
    return null;
  }
}

export function parseVolumeDetect(
  stderr: string,
): { maxVolume: number; meanVolume: number } | null {
  const max = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
  const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
  return max ? { maxVolume: Number(max[1]), meanVolume: mean ? Number(mean[1]) : NaN } : null;
}

const TARGETS = ["streaming", "podcast", "broadcast", "custom"] as const;
const TARGET_LUFS: Record<string, number> = { streaming: -14, podcast: -16, broadcast: -23 };

/** Measures `m` and returns the loudnorm filter that puts it on target. */
export async function loudnormFilter(
  m: MediaInput,
  dir: string,
  targetLufs: number,
  truePeak: number,
  signal?: AbortSignal,
): Promise<{ filter: string; measured: LoudnormMeasurement | null }> {
  const base = `I=${targetLufs}:TP=${truePeak}:LRA=11`;
  const stderr = await runFfmpeg(
    [
      ...input(m.path),
      "-map",
      `0:${m.audio!.index}`,
      "-vn",
      "-af",
      `loudnorm=${base}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    { cwd: dir, signal },
  );
  const measured = parseLoudnorm(stderr);
  if (!measured || !Number.isFinite(Number(measured.input_i)))
    return { filter: `loudnorm=${base}`, measured: null };
  return {
    filter: `loudnorm=${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`,
    measured,
  };
}

export const volumeNormalizerExecutor: Executor = eachMedia(
  "volume-normalizer",
  async (m, options, ctx) => {
    if (!m.audio) throw unsupported(`"${m.ref.name}" has no audio track.`);
    const mode = optEnum(options, "mode", ["loudness", "peak"], "loudness");
    const format = sameAudioFormat(m);
    const bitrate =
      m.audio.bitRate > 0 ? Math.min(320, Math.max(128, Math.round(m.audio.bitRate / 1000))) : 192;
    if (mode === "peak") {
      const ceiling = optNumber(options, "peakDb", -1, { min: -20, max: 0 });
      const stderr = await runFfmpeg(
        [
          ...input(m.path),
          "-map",
          `0:${m.audio.index}`,
          "-vn",
          "-af",
          "volumedetect",
          "-f",
          "null",
          "-",
        ],
        { cwd: ctx.dir, signal: ctx.signal },
      );
      const measured = parseVolumeDetect(stderr);
      if (!measured) throw unsupported(`The loudness of "${m.ref.name}" could not be measured.`);
      const gain = ceiling - measured.maxVolume;
      const bytes = await encodeAudio(
        m,
        ctx.dir,
        format,
        { filters: [`volume=${gain.toFixed(2)}dB`], bitrate, signal: ctx.signal },
        `out-${ctx.index}`,
      );
      return {
        file: outFile(outName(m, "normalized", format), format, bytes),
        note: `Peak ${measured.maxVolume.toFixed(1)} dB → ${ceiling} dB (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB).`,
        info: { mode, gainDb: Number(gain.toFixed(2)), peakDbBefore: measured.maxVolume },
      };
    }
    const target = optEnum(options, "target", TARGETS, "streaming");
    const lufs =
      target === "custom"
        ? optNumber(options, "lufs", -16, { min: -40, max: -5 })
        : TARGET_LUFS[target]!;
    const truePeak = optNumber(options, "truePeak", -1, { min: -9, max: 0 });
    const { filter, measured } = await loudnormFilter(m, ctx.dir, lufs, truePeak, ctx.signal);
    const bytes = await encodeAudio(
      m,
      ctx.dir,
      format,
      { filters: [filter], bitrate, signal: ctx.signal },
      `out-${ctx.index}`,
    );
    return {
      file: outFile(outName(m, "normalized", format), format, bytes),
      note: measured
        ? `Loudness ${Number(measured.input_i).toFixed(1)} LUFS → ${lufs} LUFS, true peak kept under ${truePeak} dBTP.`
        : `Normalised to ${lufs} LUFS.`,
      info: { mode, targetLufs: lufs, measuredLufs: measured ? Number(measured.input_i) : null },
    };
  },
  { verb: "Normalised", need: "audio", zipStem: "normalized-audio", max: 20 },
);
