// Extract Frames (Features 8.11).
//
// Four ways to pick frames: N evenly spaced, one every N seconds, at listed times, or a single
// frame. Each frame is an accurate seek (`-ss` before `-i` decodes up to the exact time), written as
// PNG or JPG, optionally scaled down. Several frames come back as one ZIP. At most 300 frames.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  baseName,
  clock,
  input,
  optEnum,
  optNumber,
  optString,
  outFile,
  packageFiles,
  parseTime,
  plural,
  readMedia,
  readOutput,
  runMediaTool,
  throwIfAborted,
  unsupported,
  withWorkdir,
  type MediaInput,
} from "./common.ts";

export const MAX_FRAMES = 300;

/** The timestamps (seconds) to grab, from the options. */
export function frameTimes(m: MediaInput, options: Record<string, unknown>): number[] {
  const mode = optEnum(options, "mode", ["count", "interval", "times", "single"], "count");
  const total = m.duration;
  // Stay a little before the very end: the last timestamp often has no decodable frame.
  const last = Math.max(0, total - Math.min(0.1, total / 10));
  if (mode === "single") {
    const t = parseTime(optString(options, "time"), "Time") ?? 0;
    if (total > 0 && t > total)
      throw unsupported(`${clock(t)} is past the end of the video (${clock(total)}).`);
    return [Math.min(t, last)];
  }
  if (mode === "times") {
    const raw = optString(options, "times")
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (raw.length === 0) throw unsupported("List the times to grab, e.g. 0:05, 0:30, 1:10.");
    const times = raw.map((t) => parseTime(t, "Times")!);
    const past = times.filter((t) => total > 0 && t > total);
    if (past.length)
      throw unsupported(`${clock(past[0]!)} is past the end of the video (${clock(total)}).`);
    if (times.length > MAX_FRAMES) throw unsupported(`Choose at most ${MAX_FRAMES} frames.`);
    return times.map((t) => Math.min(t, last));
  }
  if (!(total > 0)) throw unsupported('This video\'s length is unknown. Use "At a time" instead.');
  if (mode === "interval") {
    const every = Math.max(0.1, Number(optString(options, "interval", "1").replace(",", ".")) || 1);
    const n = Math.floor(total / every) + 1;
    if (n > MAX_FRAMES) {
      throw unsupported(
        `That would be ${n} frames. Choose a longer interval (at least ${Math.ceil((total / (MAX_FRAMES - 1)) * 10) / 10} s) or fewer frames.`,
      );
    }
    return Array.from({ length: n }, (_, i) => Math.min(i * every, last));
  }
  const count = optNumber(options, "count", 10, { min: 1, max: MAX_FRAMES });
  if (count === 1) return [total / 2];
  return Array.from({ length: count }, (_, i) => (last * i) / (count - 1));
}

async function grab(
  m: MediaInput,
  dir: string,
  t: number,
  format: "png" | "jpg",
  width: number,
  name: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await runFfmpeg(
    [
      "-ss",
      t.toFixed(3),
      ...input(m.path),
      "-map",
      `0:${m.video!.index}`,
      "-frames:v",
      "1",
      ...(width > 0 ? ["-vf", `scale='min(${width},iw)':-2`] : []),
      ...(format === "jpg"
        ? ["-q:v", "2", "-f", "image2", "-c:v", "mjpeg"]
        : ["-f", "image2", "-c:v", "png"]),
      "-update",
      "1",
      name,
    ],
    { cwd: dir, signal },
  );
  return readOutput(dir, name);
}

function stamp(t: number): string {
  return clock(t).replace(/[:.]/g, "-");
}

export const extractFramesExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("extract-frames", () =>
    withWorkdir(async (dir) => {
      const [m] = await readMedia(input_, ctx, dir, { max: 1, need: "video" });
      const format = optEnum(options, "format", ["png", "jpg"], "png");
      const width = optNumber(options, "width", 0, { min: 0, max: 7680 });
      const times = frameTimes(m!, options);
      const files: OutputFile[] = [];
      for (const [i, t] of times.entries()) {
        throwIfAborted(ctx!.signal);
        const bytes = await grab(m!, dir, t, format, width, `frame-${i}.${format}`, ctx!.signal);
        files.push(
          outFile(
            `${baseName(m!.ref.name)}-${String(i + 1).padStart(3, "0")}-${stamp(t)}.${format}`,
            format,
            bytes,
          ),
        );
      }
      return {
        ok: true,
        output: { frames: times.map((t, i) => ({ time: t, name: files[i]!.name })) },
        summary: `Saved ${plural(files.length, "frame")} as ${format.toUpperCase()}${files.length > 1 ? ` from ${clock(times[0]!)} to ${clock(times[times.length - 1]!)}` : ` at ${clock(times[0]!)}`}.`,
        files: packageFiles(files, options, `${baseName(m!.ref.name)}-frames`),
      };
    }),
  );
