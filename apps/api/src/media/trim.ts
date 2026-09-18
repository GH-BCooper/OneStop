// Audio Trimmer (Features 7.4) and Video Trimmer (8.6).
//
// Start/end accept seconds or m:ss. Audio is always cut exactly (re-encoding audio is cheap) and
// can fade in/out. Video defaults to an exact cut (re-encode); "Fast" copies the streams without
// re-encoding, which is instant and lossless but can only start on a keyframe.
import type { Executor } from "@onestop/tool-registry";
import { encodeAudio } from "./convertAudio.ts";
import { encodeVideo } from "./convertVideo.ts";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  clock,
  eachMedia,
  input,
  optEnum,
  optNumber,
  optString,
  outFile,
  outName,
  parseTime,
  readOutput,
  sameAudioFormat,
  sameVideoFormat,
  unsupported,
  type MediaInput,
} from "./common.ts";

export interface TrimRange {
  start: number;
  end: number;
}

/** Works out [start, end) from the options, clamped to the file, with user-facing errors. */
export function trimRange(m: MediaInput, options: Record<string, unknown>): TrimRange {
  const start = parseTime(optString(options, "start"), "Start") ?? 0;
  const end = parseTime(optString(options, "end"), "End");
  const length = parseTime(optString(options, "duration"), "Length");
  const total = m.duration;
  if (total > 0 && start >= total) {
    throw unsupported(
      `The start (${clock(start)}) is at or past the end of the file (${clock(total)}).`,
    );
  }
  let stop = end ?? (length !== null ? start + length : total);
  if (!(stop > 0)) throw unsupported("Enter an end time or a length.");
  if (total > 0) stop = Math.min(stop, total);
  if (stop <= start) throw unsupported("The end must be after the start.");
  if (start === 0 && total > 0 && stop >= total) {
    throw unsupported("That keeps the whole file. Enter a start or end time to cut.");
  }
  return { start, end: stop };
}

export const audioTrimmerExecutor: Executor = eachMedia(
  "audio-trimmer",
  async (m, options, ctx) => {
    const { start, end } = trimRange(m, options);
    const length = end - start;
    const fadeIn = Math.min(optNumber(options, "fadeIn", 0, { min: 0, max: 30 }), length / 2);
    const fadeOut = Math.min(optNumber(options, "fadeOut", 0, { min: 0, max: 30 }), length / 2);
    const filters = [
      ...(fadeIn > 0 ? [`afade=t=in:st=0:d=${fadeIn}`] : []),
      ...(fadeOut > 0 ? [`afade=t=out:st=${(length - fadeOut).toFixed(3)}:d=${fadeOut}`] : []),
    ];
    const format = sameAudioFormat(m);
    const bytes = await encodeAudio(
      m,
      ctx.dir,
      format,
      {
        start,
        duration: length,
        filters,
        bitrate:
          m.audio && m.audio.bitRate > 0
            ? Math.min(320, Math.max(96, Math.round(m.audio.bitRate / 1000)))
            : 192,
        signal: ctx.signal,
      },
      `out-${ctx.index}`,
    );
    return {
      file: outFile(outName(m, "trimmed", format), format, bytes),
      note: `Kept ${clock(start)} – ${clock(end)} (${length.toFixed(1)} s).`,
      info: { start, end, duration: length },
    };
  },
  { verb: "Trimmed", need: "audio", zipStem: "trimmed-audio", max: 1 },
);

export const videoTrimmerExecutor: Executor = eachMedia(
  "video-trimmer",
  async (m, options, ctx) => {
    const { start, end } = trimRange(m, options);
    const length = end - start;
    const mode = optEnum(options, "mode", ["precise", "fast"], "precise");
    const format = sameVideoFormat(m);
    let bytes: Uint8Array;
    if (mode === "fast") {
      const out = `out-${ctx.index}.${format}`;
      const muxer = {
        mp4: "mp4",
        m4v: "mp4",
        mov: "mov",
        mkv: "matroska",
        webm: "webm",
        avi: "avi",
      }[format];
      await runFfmpeg(
        [
          "-ss",
          String(start),
          "-t",
          String(length),
          ...input(m.path),
          "-map",
          `0:${m.video!.index}`,
          "-map",
          "0:a?",
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          "-f",
          muxer,
          out,
        ],
        { cwd: ctx.dir, signal: ctx.signal },
      );
      bytes = await readOutput(ctx.dir, out);
    } else {
      ({ bytes } = await encodeVideo(
        m,
        ctx.dir,
        format,
        { start, duration: length, quality: "high", signal: ctx.signal },
        `out-${ctx.index}`,
      ));
    }
    return {
      file: outFile(outName(m, "trimmed", format), format, bytes),
      note: `Kept ${clock(start)} – ${clock(end)} (${length.toFixed(1)} s)${mode === "fast" ? "; fast mode cuts at the nearest keyframe, so the start may be slightly earlier" : ""}.`,
      info: { start, end, duration: length },
    };
  },
  { verb: "Trimmed", need: "video", zipStem: "trimmed-videos", max: 1 },
);
