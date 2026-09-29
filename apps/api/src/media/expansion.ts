// Audio/video additions from 21-roadmap-expansion.md (roadmap §1.5): the Silence Trimmer, the
// Podcast Chapter Marker, the Waveform Video Generator, the Text-to-Speech Reader, the Auto-Subtitle
// Generator, the Video Stabilizer, the Video Contact Sheet and the Subtitle Burner.
//
// Six of the eight are new FFmpeg filter graphs over the phase-10 plumbing — no new binary at all.
// The other two use the optional local engines in `./speechCheck.ts`, which degrade to a clear
// message when they are not installed and never fall back to a hosted service.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { encodeAudio } from "./convertAudio.ts";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  EVEN,
  MEDIA_MIME,
  audioEncodeArgs,
  baseName,
  clock,
  eachMedia,
  input,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  outName,
  parseTime,
  plural,
  readMedia,
  readOutput,
  runMediaTool,
  sameAudioFormat,
  sameVideoFormat,
  scaledProgress,
  throwIfAborted,
  unsupported,
  videoEncodeArgs,
  withWorkdir,
  type MediaInput,
} from "./common.ts";
import { requireSpeech, runSpeech, SpeechRunError } from "./speechCheck.ts";

// ---- silence trimmer ---------------------------------------------------------------------------

export interface SilenceRange {
  start: number;
  end: number;
}

/** Reads FFmpeg's `silencedetect` report out of stderr. */
export function parseSilenceDetect(stderr: string): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const begin = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (begin) {
      start = Number(begin[1]);
      continue;
    }
    const finish = /silence_end:\s*([\d.]+)/.exec(line);
    if (finish && start !== null) {
      ranges.push({ start: Math.max(0, start), end: Number(finish[1]) });
      start = null;
    }
  }
  return ranges;
}

export const silenceTrimmerExecutor: Executor = eachMedia(
  "silence-trimmer",
  async (media, options, ctx) => {
    if (!media.audio) throw unsupported(`"${media.ref.name}" has no audio track.`);
    const thresholdDb = optNumber(options, "thresholdDb", -35, { min: -70, max: -10 });
    const minSilence = optNumber(options, "minSilence", 0.6, { min: 0.1, max: 10 });
    const keep = optNumber(options, "keep", 0.2, { min: 0, max: 5 });
    const mode = optEnum(options, "mode", ["all", "edges"] as const, "all");

    // Measure first, so the summary can say what was actually cut rather than guessing.
    const report = await runFfmpeg(
      [...input(media.path), "-map", `0:${media.audio.index}`, "-af", `silencedetect=noise=${thresholdDb}dB:d=${minSilence}`, "-f", "null", "-"],
      { cwd: ctx.dir, signal: ctx.signal },
    );
    const silences = parseSilenceDetect(report);
    const totalSilence = silences.reduce((sum, s) => sum + (s.end - s.start), 0);

    const filter =
      mode === "edges"
        ? // `areverse` twice is the standard trick for trimming the tail as well as the head.
          `silenceremove=start_periods=1:start_silence=${keep}:start_threshold=${thresholdDb}dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=${keep}:start_threshold=${thresholdDb}dB:detection=peak,areverse`
        : `silenceremove=stop_periods=-1:stop_duration=${Math.max(keep, 0.05)}:stop_threshold=${thresholdDb}dB:detection=peak`;

    const format = sameAudioFormat(media);
    const bytes = await encodeAudio(
      media,
      ctx.dir,
      format,
      { filters: [filter, "aresample=async=1:first_pts=0"], bitrate: 192, signal: ctx.signal, onProgress: scaledProgress(ctx) },
      `out-${ctx.index}`,
    );
    return {
      file: outFile(outName(media, "trimmed", format), format, bytes),
      note:
        silences.length === 0
          ? `No silence over ${minSilence}s was found at ${thresholdDb} dB — nothing was cut. Raise the threshold if the quiet parts are not quiet enough.`
          : `Removed ${plural(silences.length, "silent gap")} totalling ${clock(totalSilence)} of ${clock(media.duration)}.`,
      info: { silences: silences.length, silenceSeconds: Math.round(totalSilence * 100) / 100, mode },
    };
  },
  { verb: "Trimmed", need: "audio", zipStem: "trimmed-audio", max: 20 },
);

// ---- podcast chapter marker --------------------------------------------------------------------

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

/** "00:00 Intro" or "1:23:45 - Part two", one per line — the format podcast show notes already use. */
export function parseChapterList(text: string, duration: number): Chapter[] {
  const rows: { start: number; title: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = /^\(?((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)\)?\s*[-–—|:]?\s*(.*)$/.exec(trimmed);
    if (!match) throw unsupported(`"${trimmed}" is not a chapter. Use a timestamp then a title, like "12:30 The interview".`);
    const start = parseTime(match[1]!, "Chapter time") ?? 0;
    if (duration > 0 && start > duration + 1) {
      throw unsupported(`"${trimmed}" starts at ${clock(start)}, past the end of this file (${clock(duration)}).`);
    }
    rows.push({ start, title: (match[2] ?? "").trim() || `Chapter ${rows.length + 1}` });
  }
  if (rows.length === 0) throw unsupported('List the chapters, one per line, like "00:00 Introduction".');
  rows.sort((a, b) => a.start - b.start);
  return rows.map((row, i) => ({
    start: row.start,
    end: i + 1 < rows.length ? rows[i + 1]!.start : duration || row.start + 1,
    title: row.title,
  }));
}

/** FFmpeg's metadata format. Times are in milliseconds, with `TIMEBASE=1/1000`. */
export function chaptersToFfmetadata(chapters: Chapter[], existing: Record<string, string> = {}): string {
  const escape = (value: string) => value.replace(/([=;#\\\n])/g, "\\$1");
  const lines = [";FFMETADATA1"];
  for (const [key, value] of Object.entries(existing)) {
    if (value) lines.push(`${key}=${escape(value)}`);
  }
  for (const chapter of chapters) {
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.round(chapter.start * 1000)}`,
      `END=${Math.round(Math.max(chapter.start + 0.001, chapter.end) * 1000)}`,
      `title=${escape(chapter.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}

export const chapterMarkerExecutor: Executor = eachMedia(
  "podcast-chapter-marker",
  async (media, options, ctx) => {
    const chapters = parseChapterList(optString(options, "chapters", ""), media.duration);
    const existing: Record<string, string> = {};
    for (const key of ["title", "artist", "album", "date", "genre", "comment"]) {
      const value = optString(options, key, "").trim();
      if (value !== "") existing[key] = value;
    }
    const metadataFile = `chapters-${ctx.index}.txt`;
    await writeFile(path.join(ctx.dir, metadataFile), chaptersToFfmetadata(chapters, existing), "utf8");

    const ext = media.video ? sameVideoFormat(media) : sameAudioFormat(media);
    const out = `out-${ctx.index}.${ext}`;
    // Stream-copy: only the container's metadata changes, so nothing is re-encoded and no quality
    // is lost. That is the whole point of doing chapters this way.
    await runFfmpeg(
      [
        ...input(media.path),
        "-i",
        metadataFile,
        "-map_metadata",
        "1",
        "-map_chapters",
        "1",
        "-map",
        "0",
        "-c",
        "copy",
        ...(ext === "mp3" ? ["-id3v2_version", "3", "-write_id3v1", "1"] : []),
        ...(ext === "mp4" || ext === "m4a" || ext === "m4v" ? ["-movflags", "+faststart"] : []),
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal },
    );
    const bytes = await readOutput(ctx.dir, out);
    return {
      file: outFile(outName(media, "chapters", ext), ext, bytes),
      note: `Embedded ${plural(chapters.length, "chapter")}: ${chapters.slice(0, 3).map((c) => `${clock(c.start)} ${c.title}`).join(", ")}${chapters.length > 3 ? "…" : ""}. Nothing was re-encoded.`,
      info: { chapters },
    };
  },
  { verb: "Marked up", need: "any", zipStem: "chaptered", max: 10 },
);

// ---- waveform video ----------------------------------------------------------------------------

export const WAVEFORM_STYLES = ["bars", "line", "point", "cline", "spectrum"] as const;

export const waveformVideoExecutor: Executor = eachMedia(
  "waveform-video-generator",
  async (media, options, ctx) => {
    if (!media.audio) throw unsupported(`"${media.ref.name}" has no audio track.`);
    const width = optNumber(options, "width", 1280, { min: 320, max: 3840 });
    const height = optNumber(options, "height", 720, { min: 180, max: 2160 });
    const fps = optNumber(options, "fps", 25, { min: 10, max: 60 });
    const style = optEnum(options, "style", WAVEFORM_STYLES, "bars");
    const foreground = (optString(options, "color", "#8fa2b4") || "#8fa2b4").replace("#", "0x");
    const background = (optString(options, "background", "#111417") || "#111417").replace("#", "0x");

    const visual =
      style === "spectrum"
        ? `showspectrum=s=${width}x${height}:mode=combined:color=intensity:scale=cbrt:fscale=log`
        : `showwaves=s=${width}x${height}:mode=${style === "bars" ? "cline" : style}:rate=${fps}:colors=${foreground}${style === "bars" ? ":draw=full" : ""}`;
    // The waveform is drawn on a transparent surface and laid over a solid colour, which is what
    // makes the background configurable — `showwaves` has no background colour of its own.
    const filter = `[0:${media.audio.index}]${visual},format=rgba[wave];color=c=${background}:s=${width}x${height}:r=${fps}[bg];[bg][wave]overlay=shortest=1,${EVEN}[v]`;
    const out = `out-${ctx.index}.mp4`;
    await runFfmpeg(
      [
        ...input(media.path),
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        `0:${media.audio.index}`,
        ...videoEncodeArgs("mp4", { hasAudio: true, quality: "good", audioKbps: 192 }),
        "-r",
        String(fps),
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal, durationSec: media.duration, onProgress: scaledProgress(ctx) },
    );
    const bytes = await readOutput(ctx.dir, out);
    return {
      file: outFile(outName(media, "waveform", "mp4"), "mp4", bytes),
      note: `${width} × ${height} at ${fps} fps, ${clock(media.duration)} long — ready to upload anywhere that wants a video rather than an audio file.`,
      info: { style, width, height, fps },
    };
  },
  { verb: "Rendered", need: "audio", zipStem: "waveform-videos", max: 5 },
);

// ---- video stabilizer --------------------------------------------------------------------------

export const videoStabilizerExecutor: Executor = eachMedia(
  "video-stabilizer",
  async (media, options, ctx) => {
    const shakiness = optNumber(options, "shakiness", 5, { min: 1, max: 10 });
    const smoothing = optNumber(options, "smoothing", 15, { min: 1, max: 100 });
    const zoom = optNumber(options, "zoom", 0, { min: -20, max: 20 });
    const crop = optEnum(options, "crop", ["black", "keep"] as const, "black");
    const transforms = `transforms-${ctx.index}.trf`;

    // vidstab is a two-pass filter: detect the motion, then apply the correction.
    try {
      await runFfmpeg(
        [
          ...input(media.path),
          "-vf",
          `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=${transforms}`,
          "-f",
          "null",
          "-",
        ],
        { cwd: ctx.dir, signal: ctx.signal, durationSec: media.duration },
      );
    } catch (err) {
      if (err instanceof Error && /Unknown filter|No such filter/i.test(String((err as { stderr?: string }).stderr ?? err.message))) {
        throw unsupported(
          "Your FFmpeg build does not include the vidstab filters. Install a full build (the 'gpl' builds from gyan.dev or BtbN include them) and try again.",
        );
      }
      throw err;
    }

    const format = sameVideoFormat(media);
    const out = `out-${ctx.index}.${format}`;
    await runFfmpeg(
      [
        ...input(media.path),
        "-vf",
        `vidstabtransform=input=${transforms}:smoothing=${smoothing}:zoom=${zoom}:optzoom=${zoom === 0 ? 1 : 0}:crop=${crop}:interpol=linear,unsharp=5:5:0.8:3:3:0.4,${EVEN}`,
        ...videoEncodeArgs(format, { hasAudio: Boolean(media.audio), quality: optEnum(options, "quality", ["high", "good", "medium", "low"] as const, "good") }),
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal, durationSec: media.duration, onProgress: scaledProgress(ctx) },
    );
    const bytes = await readOutput(ctx.dir, out);
    return {
      file: outFile(outName(media, "stabilised", format), format, bytes),
      note: `Two-pass stabilisation, smoothing over ${smoothing} frames${crop === "black" ? ". Edges that moved out of frame are filled black — raise the zoom to crop them away instead" : ""}.`,
      info: { shakiness, smoothing, zoom, crop },
    };
  },
  { verb: "Stabilised", need: "video", zipStem: "stabilised-videos", max: 5 },
);

// ---- video contact sheet ------------------------------------------------------------------------

export const contactSheetExecutor: Executor = eachMedia(
  "video-contact-sheet",
  async (media, options, ctx) => {
    const columns = optNumber(options, "columns", 4, { min: 1, max: 12 });
    const rows = optNumber(options, "rows", 4, { min: 1, max: 12 });
    const tileWidth = optNumber(options, "tileWidth", 320, { min: 80, max: 960 });
    const format = optEnum(options, "format", ["png", "jpg"] as const, "jpg");
    const timestamps = optBool(options, "timestamps", true);
    const count = columns * rows;
    if (media.duration <= 0) throw unsupported(`The length of "${media.ref.name}" could not be read, so frames cannot be sampled evenly across it.`);

    // Sample at an even interval rather than with `thumbnail`, so the grid really does span the
    // whole video — and skip the first and last 1% where fades and black frames live.
    const usable = Math.max(media.duration * 0.98, 0.5);
    const interval = usable / count;
    const drawText = timestamps
      ? `,drawtext=text='%{pts\\:hms}':x=6:y=h-th-5:fontsize=${Math.max(11, Math.round(tileWidth / 22))}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=3`
      : "";
    const out = `sheet-${ctx.index}.${format}`;
    await runFfmpeg(
      [
        ...input(media.path),
        "-vf",
        `fps=1/${interval.toFixed(4)},scale=${tileWidth}:-2${drawText},tile=${columns}x${rows}:padding=4:margin=6:color=0x111417`,
        "-frames:v",
        "1",
        "-an",
        ...(format === "jpg" ? ["-q:v", "3"] : []),
        out,
      ],
      { cwd: ctx.dir, signal: ctx.signal, durationSec: media.duration, onProgress: scaledProgress(ctx) },
    );
    const bytes = await readOutput(ctx.dir, out);
    return {
      file: outFile(outName(media, "contact-sheet", format), format, bytes),
      note: `${columns} × ${rows} frames sampled every ${clock(interval)} across ${clock(media.duration)}${timestamps ? ", each stamped with its time" : ""}.`,
      info: { columns, rows, frames: count, intervalSeconds: Math.round(interval * 100) / 100 },
    };
  },
  { verb: "Sampled", need: "video", zipStem: "contact-sheets", max: 10 },
);

// ---- subtitle burner ---------------------------------------------------------------------------

const SUBTITLE_EXTS = ["srt", "vtt", "ass", "ssa", "sub"];

/** A colour as ASS's `&HBBGGRR` — the reverse byte order catches everyone out once. */
export function assColor(hex: string): string {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return `&H00${clean.slice(4, 6)}${clean.slice(2, 4)}${clean.slice(0, 2)}`.toUpperCase();
}

export const subtitleBurnerExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("subtitle-burner", () =>
    withWorkdir(async (dir) => {
      if (!Array.isArray(input_) || input_.length === 0) throw unsupported("Choose a video and a subtitle file.");
      // The subtitle file is not a media file, so it is read here rather than through `readMedia`.
      const subtitleRefs = input_.filter((ref) => SUBTITLE_EXTS.includes((ref.name.split(".").pop() ?? "").toLowerCase()));
      const videoRefs = input_.filter((ref) => !subtitleRefs.includes(ref));
      if (videoRefs.length === 0) throw unsupported("Choose a video file as well as the subtitles.");
      if (videoRefs.length > 1) throw unsupported("Burn subtitles into one video at a time.");
      if (subtitleRefs.length === 0) {
        throw unsupported("Choose a subtitle file too (.srt, .vtt or .ass). To keep subtitles switchable instead, use Subtitle Conversion.");
      }
      if (!ctx) throw unsupported("This tool could not read your files. Please try again.");

      const [media] = await readMedia(videoRefs, ctx, dir, { need: "video", max: 1 });
      const subtitleRef = subtitleRefs[0]!;
      const subtitleExt = (subtitleRef.name.split(".").pop() ?? "srt").toLowerCase();
      const subtitleFile = `subs.${subtitleExt === "ssa" ? "ass" : subtitleExt}`;
      await writeFile(path.join(dir, subtitleFile), await ctx.readFile(subtitleRef));

      const fontSize = optNumber(options, "fontSize", 24, { min: 10, max: 96 });
      const marginV = optNumber(options, "marginBottom", 28, { min: 0, max: 400 });
      const primary = assColor(optString(options, "color", "#ffffff") || "#ffffff");
      const outline = assColor(optString(options, "outlineColor", "#000000") || "#000000");
      const outlineWidth = optNumber(options, "outlineWidth", 2, { min: 0, max: 6 });
      const bold = optBool(options, "bold", false);
      const box = optBool(options, "box", false);

      // ASS files carry their own styling; only a plain SRT/VTT gets ours applied.
      const isAss = subtitleFile.endsWith(".ass");
      const style = [
        `FontSize=${fontSize}`,
        `PrimaryColour=${primary}`,
        `OutlineColour=${outline}`,
        `Outline=${outlineWidth}`,
        `BorderStyle=${box ? 3 : 1}`,
        `Bold=${bold ? -1 : 0}`,
        `MarginV=${marginV}`,
        "Alignment=2",
      ].join(",");
      const filter = isAss
        ? `ass=${subtitleFile}`
        : `subtitles=${subtitleFile}:force_style='${style}'`;

      const format = sameVideoFormat(media!);
      const out = `out.${format}`;
      try {
        await runFfmpeg(
          [
            ...input(media!.path),
            "-vf",
            `${filter},${EVEN}`,
            ...videoEncodeArgs(format, {
              hasAudio: Boolean(media!.audio),
              quality: optEnum(options, "quality", ["high", "good", "medium", "low"] as const, "good"),
            }),
            out,
          ],
          { cwd: dir, signal: ctx.signal, durationSec: media!.duration, onProgress: ctx.reportProgress },
        );
      } catch (err) {
        const stderr = String((err as { stderr?: string }).stderr ?? "");
        if (/No such filter|Unknown filter|libass/i.test(stderr)) {
          throw unsupported(
            "Your FFmpeg build does not include subtitle rendering (libass). Install a full build and try again — or use Subtitle Conversion to attach the subtitles as a switchable track instead.",
          );
        }
        throw err;
      }
      const bytes = await readOutput(dir, out);
      return {
        ok: true,
        output: { subtitleFile: subtitleRef.name, styled: !isAss, result: outName(media!, "subtitled", format) },
        summary: `Burned "${subtitleRef.name}" permanently into the picture${isAss ? " using the styling in the .ass file itself" : ` at ${fontSize}px`}. The subtitles can no longer be switched off — keep the original if you need that.`,
        files: [outFile(outName(media!, "subtitled", format), format, bytes)],
      };
    }),
  );

// ---- auto-subtitle generator (whisper.cpp) ------------------------------------------------------

export interface TranscriptCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** whisper.cpp's SRT output, back into cues we can re-emit in any format. */
export function parseSrt(text: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const time = (value: string) => {
    const match = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(value);
    if (!match) return 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(String(match[4]).padEnd(3, "0")) / 1000;
  };
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\n+/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [from = "", to = ""] = timing.split("-->");
    const body = lines.slice(lines.indexOf(timing) + 1).join("\n").trim();
    if (body === "") continue;
    cues.push({ index: cues.length + 1, start: time(from), end: time(to), text: body });
  }
  return cues;
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export function cuesToSrt(cues: TranscriptCue[]): string {
  return cues.map((c) => `${c.index}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export function cuesToVtt(cues: TranscriptCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${srtTime(c.start).replace(",", ".")} --> ${srtTime(c.end).replace(",", ".")}\n${c.text}\n`).join("\n")}`;
}

export const WHISPER_LANGUAGES = ["auto", "en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "tr", "uk", "hi", "ar", "zh", "ja", "ko"] as const;

export const autoSubtitleExecutor: Executor = eachMedia(
  "auto-subtitle-generator",
  async (media, options, ctx) => {
    if (!media.audio) throw unsupported(`"${media.ref.name}" has no audio track to transcribe.`);
    const whisper = requireSpeech("whisper");
    const language = optEnum(options, "language", WHISPER_LANGUAGES, "auto");
    const translate = optBool(options, "translate", false);
    const maxLineLength = optNumber(options, "maxLineLength", 42, { min: 20, max: 120 });
    const threads = optNumber(options, "threads", 0, { min: 0, max: 32 });

    // whisper.cpp only reads 16 kHz mono WAV, so the audio is converted first — which is also the
    // step that lets this work on any container FFmpeg can open.
    const wav = `speech-${ctx.index}.wav`;
    await runFfmpeg(
      [...input(media.path), "-map", `0:${media.audio.index}`, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", wav],
      { cwd: ctx.dir, signal: ctx.signal, durationSec: media.duration },
    );

    const stem = `transcript-${ctx.index}`;
    try {
      await runSpeech(
        whisper.bin,
        [
          "-m",
          whisper.model,
          "-f",
          wav,
          "--output-srt",
          "--output-file",
          stem,
          "--max-len",
          String(maxLineLength),
          ...(language === "auto" ? [] : ["-l", language]),
          ...(translate ? ["--translate"] : []),
          ...(threads > 0 ? ["-t", String(threads)] : []),
        ],
        {
          cwd: ctx.dir,
          signal: ctx.signal,
          // whisper prints `[00:01:23.000 --> …]` as it goes, which is enough for real progress.
          onOutput: (chunk) => {
            if (!ctx.reportProgress || media.duration <= 0) return;
            const match = /\[(\d+):(\d{2}):(\d{2})\.\d+\s*-->/g;
            let last: RegExpExecArray | null = null;
            let found: RegExpExecArray | null;
            while ((found = match.exec(chunk))) last = found;
            if (!last) return;
            const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
            scaledProgress(ctx)?.(seconds / media.duration);
          },
        },
      );
    } catch (err) {
      if (err instanceof SpeechRunError) {
        if (/failed to initialize|invalid model|not a ggml/i.test(err.stderr)) {
          throw unsupported("That whisper model file could not be loaded. Check WHISPER_MODEL points at a valid ggml .bin model.");
        }
        throw unsupported("whisper.cpp could not transcribe this file. Try a shorter clip, or a different model.", err.stderr.slice(-1500));
      }
      throw err;
    }

    const srtBytes = await readOutput(ctx.dir, `${stem}.srt`).catch(() => null);
    if (!srtBytes) throw unsupported("whisper.cpp produced no subtitles. The audio may be silent, or too short to transcribe.");
    const cues = parseSrt(new TextDecoder().decode(srtBytes));
    if (cues.length === 0) throw unsupported("No speech was recognised in this file.");

    const format = optEnum(options, "format", ["srt", "vtt", "txt"] as const, "srt");
    const text =
      format === "vtt" ? cuesToVtt(cues) : format === "txt" ? cues.map((c) => c.text).join("\n") : cuesToSrt(cues);
    const words = cues.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0);
    return {
      file: {
        name: `${baseName(media.ref.name)}.${format}`,
        mimeType: MEDIA_MIME[format] ?? "text/plain; charset=utf-8",
        bytes: new TextEncoder().encode(text),
      },
      note: `${plural(cues.length, "caption")}, about ${words} words, covering ${clock(cues[cues.length - 1]!.end)}. Transcribed by whisper.cpp on this machine — the audio never left it.${translate ? " Translated into English as well." : ""}`,
      info: { cues: cues.length, words, language, model: path.basename(whisper.model) },
    };
  },
  { verb: "Transcribed", need: "any", zipStem: "subtitles", max: 5 },
);

// ---- text-to-speech reader (Piper) -------------------------------------------------------------

/** Splits text into chunks Piper handles well: sentence boundaries, never mid-word. */
export function chunkForSpeech(text: string, maxChars = 800): string[] {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current !== "" && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim() !== "") chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

export const textToSpeechExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("text-to-speech-reader", () =>
    withWorkdir(async (dir) => {
      let text: string;
      if (typeof input_ === "string" && input_.trim() !== "") text = input_;
      else if (Array.isArray(input_) && input_.length > 0 && ctx) {
        text = new TextDecoder("utf-8", { fatal: false }).decode(await ctx.readFile(input_[0]!));
      } else throw unsupported("Paste some text, or choose a text file to read aloud.");
      if (text.trim() === "") throw unsupported("There is no text to read.");
      const limit = optNumber(options, "maxCharacters", 20_000, { min: 100, max: 200_000 });
      if (text.length > limit) {
        throw unsupported(`That is ${text.length} characters, over the ${limit} limit. Split it into smaller pieces first.`);
      }

      const piper = requireSpeech("piper");
      const speed = optNumber(options, "speed", 100, { min: 50, max: 200 }) / 100;
      const chunks = chunkForSpeech(text);
      const parts: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        throwIfAborted(ctx?.signal);
        const wav = `part-${index}.wav`;
        try {
          await runSpeech(
            piper.bin,
            ["--model", piper.model, "--output_file", wav, "--length_scale", String(1 / speed)],
            { cwd: dir, signal: ctx?.signal, stdin: chunk },
          );
        } catch (err) {
          if (err instanceof SpeechRunError) {
            throw unsupported(
              /model|onnx/i.test(err.stderr)
                ? "That Piper voice could not be loaded. A voice is a .onnx file plus a matching .onnx.json next to it — check PIPER_VOICE."
                : "Piper could not read this text aloud.",
              err.stderr.slice(-1500),
            );
          }
          throw err;
        }
        parts.push(wav);
        ctx?.reportProgress?.((index + 1) / (chunks.length + 1));
      }

      const format = optEnum(options, "format", ["wav", "mp3"] as const, "mp3");
      const out = `speech.${format}`;
      if (parts.length === 1 && format === "wav") {
        const bytes = await readOutput(dir, parts[0]!);
        return {
          ok: true,
          output: { characters: text.length, chunks: parts.length, result: out },
          summary: `Read ${text.length} characters aloud with the local Piper voice "${path.basename(piper.model)}". Nothing was sent anywhere.`,
          files: [outFile("speech.wav", "wav", bytes)],
        };
      }
      // Concat the parts, then encode once — the concat demuxer needs a list file, which is written
      // here rather than passed as a filter so no user text ever reaches an FFmpeg argument.
      const listFile = "parts.txt";
      await writeFile(path.join(dir, listFile), parts.map((p) => `file '${p}'`).join("\n"), "utf8");
      await runFfmpeg(
        [
          "-protocol_whitelist",
          "file",
          "-f",
          "concat",
          "-safe",
          "1",
          "-i",
          listFile,
          ...audioEncodeArgs(format, { bitrate: optNumber(options, "bitrate", 128, { min: 64, max: 320 }) }),
          out,
        ],
        { cwd: dir, signal: ctx?.signal },
      );
      const bytes = await readOutput(dir, out);
      return {
        ok: true,
        output: { characters: text.length, chunks: parts.length, voice: path.basename(piper.model), result: out },
        summary: `Read ${text.length} characters aloud as ${plural(parts.length, "segment")} with the local Piper voice "${path.basename(piper.model)}". Nothing was sent anywhere.`,
        files: [outFile(`speech.${format}`, format, bytes)],
      };
    }),
  );

export type { MediaInput, OutputFile };
