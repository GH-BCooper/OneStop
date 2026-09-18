// Audio Metadata Viewer/Editor (Features 7.11).
//
// "View" reports what ffprobe found (format, duration, codec, tags, cover art) as a summary plus a
// JSON file. "Edit" rewrites the tags with `-c copy`, so the audio itself is never re-encoded: the
// result is bit-identical audio with new tags. Formats that cannot carry tags (raw ADTS .aac) say so
// instead of silently dropping them.
import type { Executor } from "@onestop/tool-registry";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  clock,
  eachMedia,
  formatBytes,
  input,
  num,
  optBool,
  optEnum,
  optString,
  outFile,
  outName,
  readOutput,
  unsupported,
  type MediaInput,
} from "./common.ts";

/** The tags OneStop offers, mapped to FFmpeg's metadata keys. */
export const TAG_FIELDS = [
  ["title", "title"],
  ["artist", "artist"],
  ["album", "album"],
  ["albumArtist", "album_artist"],
  ["genre", "genre"],
  ["year", "date"],
  ["track", "track"],
  ["composer", "composer"],
  ["comment", "comment"],
] as const;

/** Containers whose muxer stores tags. Raw ADTS/PCM-only formats cannot. */
const TAGGABLE = new Set(["mp3", "m4a", "mp4", "m4b", "flac", "ogg", "opus", "wav", "wma", "mkv", "mka"]);

export interface AudioTags {
  [key: string]: string;
}

export function readTags(m: MediaInput): AudioTags {
  const audioStream = m.probe.streams.find((s) => s.codec_type === "audio");
  const tags: AudioTags = {};
  for (const [key, value] of Object.entries({ ...audioStream?.tags, ...m.probe.format.tags })) {
    if (typeof value === "string" && value.trim() !== "") tags[key.toLowerCase()] = value;
  }
  return tags;
}

export function describeAudio(m: MediaInput): Record<string, unknown> {
  const a = m.audio;
  return {
    file: m.ref.name,
    size: m.size,
    format: m.probe.format.format_long_name ?? m.probe.format.format_name ?? null,
    duration: m.duration,
    durationText: clock(m.duration),
    bitrate: num(m.probe.format.bit_rate) || (a?.bitRate ?? 0),
    codec: a?.codec ?? null,
    sampleRate: a?.sampleRate ?? null,
    channels: a?.channels ?? null,
    channelLayout: m.probe.streams.find((s) => s.codec_type === "audio")?.channel_layout ?? null,
    hasCoverArt: m.probe.streams.some((s) => s.disposition?.attached_pic),
    tags: readTags(m),
  };
}

export const audioMetadataExecutor: Executor = eachMedia(
  "audio-metadata-editor",
  async (m, options, ctx) => {
    const mode = optEnum(options, "mode", ["view", "edit"], "view");
    const info = describeAudio(m);
    if (mode === "view") {
      const tags = info.tags as AudioTags;
      const named = ["title", "artist", "album", "date", "genre"]
        .map((k) => (tags[k] ? `${k[0]!.toUpperCase()}${k.slice(1)}: ${tags[k]}` : ""))
        .filter(Boolean)
        .join(" · ");
      return {
        file: outFile(outName(m, "metadata", "json"), "json", new TextEncoder().encode(JSON.stringify(info, null, 2))),
        note: [
          `${String(info.codec ?? "audio").toUpperCase()}, ${clock(m.duration)}, ${Math.round(num(info.bitrate as number) / 1000)} kbps, ${info.sampleRate} Hz, ${info.channels === 1 ? "mono" : `${info.channels} channels`} (${formatBytes(m.size)}).`,
          named || "No tags are set on this file.",
          info.hasCoverArt ? "It has cover art." : "",
        ]
          .filter(Boolean)
          .join(" "),
        info,
      };
    }
    if (!TAGGABLE.has(m.ext)) {
      throw unsupported(
        `A .${m.ext} file can't store tags. Convert it to MP3, M4A or FLAC first (Audio Converter), then edit its tags.`,
      );
    }
    const clear = optBool(options, "clear", false);
    const values: string[] = [];
    const changed: string[] = [];
    for (const [id, key] of TAG_FIELDS) {
      const value = optString(options, id).trim();
      if (value === "") continue;
      values.push("-metadata", `${key}=${value.slice(0, 500)}`);
      changed.push(key);
    }
    if (!clear && changed.length === 0) {
      throw unsupported("Fill in at least one tag to change, or tick \"Remove all existing tags\".");
    }
    const out = `out-${ctx.index}.${m.ext}`;
    const muxer = { mp3: "mp3", m4a: "ipod", flac: "flac", ogg: "ogg", opus: "ogg", wav: "wav", wma: "asf", mkv: "matroska", mka: "matroska", mp4: "mp4", m4b: "ipod" }[m.ext] ?? m.ext;
    await runFfmpeg(
      [
        ...input(m.path),
        "-map",
        "0",
        "-c",
        "copy",
        ...(clear ? ["-map_metadata", "-1"] : ["-map_metadata", "0"]),
        ...values,
        ...(m.ext === "mp3" ? ["-id3v2_version", "3", "-write_id3v1", "1"] : []),
        "-f",
        muxer,
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal },
    );
    const bytes = await readOutput(ctx.dir, out);
    return {
      file: outFile(outName(m, "tagged", m.ext), m.ext, bytes),
      note: clear
        ? changed.length
          ? `Removed the old tags and set ${changed.join(", ")}. The audio itself was copied unchanged.`
          : "Removed every tag. The audio itself was copied unchanged."
        : `Set ${changed.join(", ")}. The audio itself was copied unchanged.`,
      info: { changed, cleared: clear },
    };
  },
  {
    verb: (options) => (optEnum(options, "mode", ["view", "edit"], "view") === "edit" ? "Updated the tags of" : "Read the details of"),
    need: "audio",
    zipStem: "audio-metadata",
    max: 20,
  },
);
