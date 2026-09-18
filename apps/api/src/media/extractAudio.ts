// Extract Audio from Video (Features 7.10 / 8.10).
//
// "Original" copies the audio track out untouched (no quality loss) into the container that fits
// its codec; any other choice re-encodes through `encodeAudio`.
import type { Executor } from "@onestop/tool-registry";
import { encodeAudio } from "./convertAudio.ts";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  AUDIO_FORMATS,
  eachMedia,
  input,
  optEnum,
  outFile,
  outName,
  readOutput,
  unsupported,
  type AudioFormat,
} from "./common.ts";

/** Container (and muxer) that holds each codec without re-encoding. */
const COPY_CONTAINER: Record<string, [ext: string, muxer: string]> = {
  aac: ["m4a", "ipod"],
  mp3: ["mp3", "mp3"],
  opus: ["opus", "ogg"],
  vorbis: ["ogg", "ogg"],
  flac: ["flac", "flac"],
  alac: ["m4a", "ipod"],
  pcm_s16le: ["wav", "wav"],
  pcm_s24le: ["wav", "wav"],
  pcm_f32le: ["wav", "wav"],
  ac3: ["ac3", "ac3"],
  eac3: ["eac3", "eac3"],
  wmav2: ["wma", "asf"],
};

export const extractAudioExecutor: Executor = eachMedia(
  "extract-audio",
  async (m, options, ctx) => {
    const choice = optEnum(options, "format", ["original", ...AUDIO_FORMATS], "original");
    if (!m.audio) throw unsupported(`"${m.ref.name}" has no audio track to extract.`);
    const codec = m.audio.codec;
    const copy = choice === "original" ? COPY_CONTAINER[codec] : undefined;
    if (copy) {
      const [ext, muxer] = copy;
      const out = `out-${ctx.index}.${ext}`;
      await runFfmpeg(
        [
          ...input(m.path),
          "-map",
          `0:${m.audio!.index}`,
          "-vn",
          "-sn",
          "-dn",
          "-c:a",
          "copy",
          "-f",
          muxer,
          out,
        ],
        { cwd: ctx.dir, signal: ctx.signal },
      );
      return {
        file: outFile(outName(m, "audio", ext), ext, await readOutput(ctx.dir, out)),
        note: `The ${codec.toUpperCase()} track was copied out without re-encoding.`,
      };
    }
    // An unusual codec with "original" chosen → M4A (AAC), which plays everywhere.
    const format: AudioFormat = choice === "original" ? "m4a" : choice;
    const bytes = await encodeAudio(
      m,
      ctx.dir,
      format,
      { bitrate: 192, signal: ctx.signal },
      `out-${ctx.index}`,
    );
    return {
      file: outFile(outName(m, "audio", format), format, bytes),
      note:
        choice === "original"
          ? `The ${codec} track was converted to M4A so it plays everywhere.`
          : undefined,
    };
  },
  { verb: "Extracted the audio from", need: "video", zipStem: "extracted-audio", max: 10 },
);
