// Test-only fixtures for the media tools: short clips of known duration, size and codec, generated
// with FFmpeg's own synthetic sources so nothing binary has to live in the repo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "./ffmpegCheck.ts";
import { withWorkdir } from "./common.ts";

export interface MakeAudioOptions {
  seconds?: number;
  frequency?: number;
  /** Loudness of the tone, 0–1 (used to make a quiet file for the normalizer test). */
  volume?: number;
  channels?: number;
  extraArgs?: string[];
}

/** A sine tone in `format` (by extension), e.g. tone("mp3", { seconds: 3 }). */
export async function makeAudio(format: string, o: MakeAudioOptions = {}): Promise<Uint8Array> {
  const { seconds = 2, frequency = 440, volume = 0.8, channels = 2, extraArgs = [] } = o;
  return withWorkdir(async (dir) => {
    const out = `tone.${format}`;
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        // aevalsrc (not sine) because the amplitude is explicit, so a fixture's loudness is exact.
        "-i",
        `aevalsrc=${volume}*sin(2*PI*${frequency}*t):s=44100:d=${seconds}`,
        "-ac",
        String(channels),
        ...extraArgs,
        out,
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
    return new Uint8Array(await readFile(path.join(dir, out)));
  });
}

export interface MakeVideoOptions {
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  audio?: boolean;
  /** "testsrc" (colour bars with a counter) or "smptebars". */
  source?: string;
  extraArgs?: string[];
}

export async function makeVideo(format = "mp4", o: MakeVideoOptions = {}): Promise<Uint8Array> {
  const {
    seconds = 2,
    width = 320,
    height = 240,
    fps = 15,
    audio = true,
    source = "testsrc",
    extraArgs = [],
  } = o;
  return withWorkdir(async (dir) => {
    const out = `clip.${format}`;
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        `${source}=size=${width}x${height}:rate=${fps}:duration=${seconds}`,
        ...(audio
          ? ["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}:sample_rate=44100`]
          : []),
        "-c:v",
        format === "webm" ? "libvpx-vp9" : "libx264",
        ...(format === "webm"
          ? ["-b:v", "300k", "-deadline", "realtime", "-cpu-used", "8"]
          : ["-preset", "ultrafast", "-crf", "30"]),
        "-pix_fmt",
        "yuv420p",
        ...(audio ? ["-c:a", format === "webm" ? "libopus" : "aac", "-b:a", "96k"] : ["-an"]),
        ...extraArgs,
        out,
      ],
      { cwd: dir, timeoutMs: 180_000 },
    );
    return new Uint8Array(await readFile(path.join(dir, out)));
  });
}

/** An MKV carrying the given SRT text as a real subtitle track. */
export async function makeVideoWithSubtitles(
  srt: string,
  o: MakeVideoOptions = {},
): Promise<Uint8Array> {
  const video = await makeVideo("mp4", o);
  return withWorkdir(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "in.mp4"), video);
    await writeFile(path.join(dir, "subs.srt"), srt, "utf8");
    await runFfmpeg(
      [
        "-i",
        "in.mp4",
        "-i",
        "subs.srt",
        "-map",
        "0",
        "-map",
        "1",
        "-c",
        "copy",
        "-c:s",
        "srt",
        "-f",
        "matroska",
        "out.mkv",
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
    return new Uint8Array(await readFile(path.join(dir, "out.mkv")));
  });
}

export const SAMPLE_SRT = `1
00:00:00,500 --> 00:00:02,000
Hello there.
This is <i>line two</i>.

2
00:00:02,500 --> 00:00:04,250
Second cue & special <characters>.
`;
