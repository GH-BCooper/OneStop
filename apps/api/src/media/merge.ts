// Audio Merger (Features 7.5) and Video Merger (8.7).
//
// Both use FFmpeg's concat *filter* (not the concat demuxer, which reads a list of paths), so each
// clip is decoded and normalised first: audio to 48 kHz stereo; video to the first clip's size
// (letterboxed, never stretched) and frame rate. A clip without sound gets matching silence so
// sound and picture stay in sync. Clips are joined in upload order.
import type { Executor } from "@onestop/tool-registry";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  AUDIO_FORMATS,
  audioEncodeArgs,
  clock,
  displaySize,
  input,
  optEnum,
  optNumber,
  outFile,
  plural,
  readMedia,
  readOutput,
  runMediaTool,
  sameAudioFormat,
  sameVideoFormat,
  unsupported,
  videoEncodeArgs,
  withWorkdir,
  type AudioFormat,
  type MediaInput,
  type VideoFormat,
} from "./common.ts";

const AUDIO_NORM = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
const MAX_CLIPS = 20;

function totalDuration(inputs: MediaInput[], gap = 0): number {
  return inputs.reduce((sum, m) => sum + m.duration, 0) + gap * (inputs.length - 1);
}

export const audioMergerExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("audio-merger", () =>
    withWorkdir(async (dir) => {
      const clips = await readMedia(input_, ctx, dir, { min: 2, max: MAX_CLIPS, need: "audio" });
      const choice = optEnum(options, "format", ["same", ...AUDIO_FORMATS], "same");
      const format: AudioFormat = choice === "same" ? sameAudioFormat(clips[0]!) : choice;
      const gap = optNumber(options, "gap", 0, { min: 0, max: 10 });
      const parts = clips.map(
        (m, i) =>
          `[${i}:${m.audio!.index}]${AUDIO_NORM}${gap > 0 && i < clips.length - 1 ? `,apad=pad_dur=${gap}` : ""}[a${i}]`,
      );
      const graph = `${parts.join(";")};${clips.map((_, i) => `[a${i}]`).join("")}concat=n=${clips.length}:v=0:a=1[out]`;
      const out = `merged.${format}`;
      await runFfmpeg(
        [
          ...clips.flatMap((m) => input(m.path)),
          "-filter_complex",
          graph,
          "-map",
          "[out]",
          "-map_metadata",
          "-1",
          ...audioEncodeArgs(format, { bitrate: 192 }),
          out,
        ],
        { cwd: dir, signal: ctx!.signal },
      );
      const bytes = await readOutput(dir, out);
      const total = totalDuration(clips, gap);
      return {
        ok: true,
        output: {
          clips: clips.map((m) => ({ name: m.ref.name, duration: m.duration })),
          duration: total,
        },
        summary: `Joined ${plural(clips.length, "audio file")} into one ${format.toUpperCase()} (${clock(total)}).`,
        files: [outFile(`merged-audio.${format}`, format, bytes)],
      };
    }),
  );

const MERGE_FORMATS = ["same", "mp4", "webm", "mkv", "mov"] as const;

export const videoMergerExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("video-merger", () =>
    withWorkdir(async (dir) => {
      const clips = await readMedia(input_, ctx, dir, { min: 2, max: MAX_CLIPS, need: "video" });
      const first = clips[0]!;
      const choice = optEnum(options, "format", MERGE_FORMATS, "same");
      const format: VideoFormat = choice === "same" ? sameVideoFormat(first) : choice;
      const sizeChoice = optEnum(options, "size", ["first", "largest"], "first");
      const sized =
        sizeChoice === "largest"
          ? clips.reduce((a, b) =>
              displaySize(b).width * displaySize(b).height >
              displaySize(a).width * displaySize(a).height
                ? b
                : a,
            )
          : first;
      const { width, height } = displaySize(sized);
      const W = Math.max(2, Math.round(width / 2) * 2);
      const H = Math.max(2, Math.round(height / 2) * 2);
      if (W * H > 7680 * 4320) throw unsupported("These videos are too large to merge.");
      const fps = Math.min(60, Math.round((first.video!.fps || 25) * 1000) / 1000);
      const withSound = clips.some((m) => m.audio);
      const parts: string[] = [];
      clips.forEach((m, i) => {
        parts.push(
          `[${i}:${m.video!.index}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
        );
        if (withSound) {
          parts.push(
            m.audio
              ? `[${i}:${m.audio.index}]${AUDIO_NORM},apad,atrim=duration=${m.duration.toFixed(3)}[a${i}]`
              : `anullsrc=r=48000:cl=stereo,atrim=duration=${m.duration.toFixed(3)}[a${i}]`,
          );
        }
      });
      const labels = clips.map((_, i) => (withSound ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
      const graph = `${parts.join(";")};${labels}concat=n=${clips.length}:v=1:a=${withSound ? 1 : 0}[v]${withSound ? "[a]" : ""}`;
      const out = `merged.${format}`;
      await runFfmpeg(
        [
          ...clips.flatMap((m) => input(m.path)),
          "-filter_complex",
          graph,
          "-map",
          "[v]",
          ...(withSound ? ["-map", "[a]"] : []),
          "-map_metadata",
          "-1",
          ...videoEncodeArgs(format, { quality: "good", hasAudio: withSound }),
          out,
        ],
        { cwd: dir, signal: ctx!.signal },
      );
      const bytes = await readOutput(dir, out);
      const total = totalDuration(clips);
      const resized = clips.some((m) => {
        const s = displaySize(m);
        return s.width !== W || s.height !== H;
      });
      return {
        ok: true,
        output: {
          clips: clips.map((m) => ({ name: m.ref.name, duration: m.duration })),
          duration: total,
          width: W,
          height: H,
        },
        summary: [
          `Joined ${plural(clips.length, "video")} into one ${format.toUpperCase()} (${clock(total)}, ${W} × ${H}).`,
          resized ? "Clips of a different size were fitted with black bars." : "",
        ]
          .filter(Boolean)
          .join(" "),
        files: [outFile(`merged-video.${format}`, format, bytes)],
      };
    }),
  );
