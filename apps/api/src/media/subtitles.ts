// Subtitle Extraction (Features 8.12) and Subtitle Conversion (8.13).
//
// Conversion is OneStop's own SRT / WebVTT / ASS (SSA) reader and writer — pure TypeScript, so it
// works even without FFmpeg. Every format is read into one cue model (start/end in milliseconds,
// text with <i>/<b>/<u> kept), which is what makes SRT → VTT → SRT lossless for timing and text.
// Extraction uses FFmpeg to pull text subtitle tracks out of a video; image-based tracks (Blu-ray
// PGS, DVD VobSub) cannot become text without OCR and are refused with that explanation.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  baseName,
  extOf,
  input,
  optEnum,
  optNumber,
  optString,
  packageFiles,
  plural,
  readMedia,
  readOutput,
  runMediaTool,
  throwIfAborted,
  unsupported,
  withWorkdir,
  type ProbeStream,
} from "./common.ts";
import { PdfToolError } from "../pdf/errors.ts";

export const SUBTITLE_FORMATS = ["srt", "vtt", "ass"] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

export interface Cue {
  start: number;
  end: number;
  /** Lines joined by "\n"; may contain <i>, <b>, <u>. */
  text: string;
}

// ---- decoding ---------------------------------------------------------------------------------

/** UTF-8 (with or without BOM), UTF-16 LE/BE with BOM, else Windows-1252. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function detectSubtitleFormat(text: string, name = ""): SubtitleFormat | null {
  const head = text.trimStart().slice(0, 2000);
  if (/^WEBVTT/.test(head)) return "vtt";
  if (/^\[Script Info\]/im.test(head) || /^\s*Dialogue:/m.test(text)) return "ass";
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(head)) {
    return extOf(name) === "vtt" ? "vtt" : "srt";
  }
  const ext = extOf(name);
  return ext === "srt" || ext === "vtt" || ext === "ass" ? ext : ext === "ssa" ? "ass" : null;
}

// ---- timestamps -------------------------------------------------------------------------------

/** "01:02:03,456", "01:02:03.456", "02:03.456" (VTT) or "1:02:03.45" (ASS) → milliseconds. */
export function parseTimestamp(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function formatTimestamp(ms: number, format: SubtitleFormat): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  if (format === "ass") return `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor(f / 10))}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}${format === "srt" ? "," : "."}${pad(f, 3)}`;
}

// ---- text markup ------------------------------------------------------------------------------

/** Keeps <i>, <b>, <u>; drops every other tag (fonts, VTT classes/voices, inline timestamps). */
function cleanTags(text: string): string {
  return text
    .replace(/<v(?:\.[^\s>]*)?\s+([^>]*)>/gi, "")
    .replace(
      /<(\/?)([ibu])(?:\.[^>]*)?>/gi,
      (_, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`,
    )
    .replace(/<(?!\/?[ibu]>)[^>]*>/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function assToText(text: string): string {
  let out = "";
  const open = { i: false, b: false, u: false };
  for (const part of text.split(/(\{[^}]*\})/)) {
    if (part.startsWith("{") && part.endsWith("}")) {
      for (const [, tag, on] of part.matchAll(/\\([ibu])(\d)/g)) {
        const key = tag as "i" | "b" | "u";
        const want = on !== "0";
        if (want !== open[key]) {
          out += want ? `<${key}>` : `</${key}>`;
          open[key] = want;
        }
      }
      continue;
    }
    out += part.replace(/\\N/g, "\n").replace(/\\n/g, "\n").replace(/\\h/g, " ");
  }
  for (const key of ["u", "b", "i"] as const) if (open[key]) out += `</${key}>`;
  return out;
}

function textToAss(text: string): string {
  return text
    .replace(/\r?\n/g, "\\N")
    .replace(/[{}]/g, "")
    .replace(/<([ibu])>/g, "{\\$11}")
    .replace(/<\/([ibu])>/g, "{\\$10}");
}

function escapeVtt(text: string): string {
  // Only markup we produce survives; a literal "<" or "&" must be escaped in WebVTT.
  return text
    .replace(/&/g, "&amp;")
    .replace(/<(?!\/?[ibu]>)/g, "&lt;")
    .replace(/-->/g, "--&gt;");
}

// ---- parsers ----------------------------------------------------------------------------------

function parseBlocks(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? "")) continue;
    const [left, rightRaw] = lines[at]!.split("-->");
    const right = (rightRaw ?? "").trim().split(/\s+/)[0] ?? "";
    const start = parseTimestamp(left ?? "");
    const end = parseTimestamp(right);
    if (start === null || end === null) continue;
    const body = cleanTags(lines.slice(at + 1).join("\n")).replace(/^\n+|\n+$/g, "");
    if (body.trim() === "") continue;
    cues.push({ start, end: Math.max(end, start), text: body });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let fields: string[] = [];
  let inEvents = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[Events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      fields = line
        .slice(7)
        .split(",")
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const order = fields.length
      ? fields
      : [
          "layer",
          "start",
          "end",
          "style",
          "name",
          "marginl",
          "marginr",
          "marginv",
          "effect",
          "text",
        ];
    const values = line.slice(9).trimStart().split(",");
    const textIndex = order.indexOf("text");
    const head = values.slice(0, textIndex);
    const body = values.slice(textIndex).join(",");
    const start = parseTimestamp(head[order.indexOf("start")] ?? "");
    const end = parseTimestamp(head[order.indexOf("end")] ?? "");
    if (start === null || end === null) continue;
    const cueText = assToText(body).trim();
    if (cueText) cues.push({ start, end: Math.max(start, end), text: cueText });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, format: SubtitleFormat): Cue[] {
  return format === "ass" ? parseAss(text) : parseBlocks(text);
}

// ---- writers ----------------------------------------------------------------------------------

const ASS_HEADER = `[Script Info]
; Converted by OneStop
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

export function writeSubtitles(cues: Cue[], format: SubtitleFormat): string {
  if (format === "ass") {
    return (
      ASS_HEADER +
      cues
        .map(
          (c) =>
            `Dialogue: 0,${formatTimestamp(c.start, "ass")},${formatTimestamp(c.end, "ass")},Default,,0,0,0,,${textToAss(c.text)}`,
        )
        .join("\n") +
      "\n"
    );
  }
  const body = cues
    .map((c, i) => {
      const time = `${formatTimestamp(c.start, format)} --> ${formatTimestamp(c.end, format)}`;
      const text = format === "vtt" ? escapeVtt(c.text) : c.text;
      return `${i + 1}\n${time}\n${text}`;
    })
    .join("\n\n");
  return format === "vtt" ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}

export function convertSubtitles(
  text: string,
  from: SubtitleFormat,
  to: SubtitleFormat,
  { offsetMs = 0 }: { offsetMs?: number } = {},
): { text: string; cues: number } {
  const cues = parseSubtitles(text, from)
    .map((c) => ({ ...c, start: c.start + offsetMs, end: c.end + offsetMs }))
    .filter((c) => c.end > 0)
    .map((c) => ({ ...c, start: Math.max(0, c.start) }));
  if (cues.length === 0)
    throw unsupported(
      "No subtitles were found in this file. Check that it is a valid SRT, VTT or ASS file.",
    );
  return { text: writeSubtitles(cues, to), cues: cues.length };
}

const SUB_MIME: Record<SubtitleFormat, string> = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
};

export const subtitleConversionExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("subtitle-conversion", async () => {
    if (!ctx)
      throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
    if (!Array.isArray(input_) || input_.length === 0)
      throw unsupported("Choose a subtitle file first.");
    if (input_.length > 50) throw unsupported("Choose at most 50 subtitle files.");
    const to = optEnum(options, "format", SUBTITLE_FORMATS, "vtt");
    const offsetMs = optNumber(options, "offsetMs", 0, { min: -3_600_000, max: 3_600_000 });
    const files: OutputFile[] = [];
    let total = 0;
    for (const ref of input_) {
      throwIfAborted(ctx.signal);
      const text = decodeSubtitleBytes(await ctx.readFile(ref));
      const from = detectSubtitleFormat(text, ref.name);
      if (!from)
        throw unsupported(`"${ref.name}" doesn't look like an SRT, VTT or ASS subtitle file.`);
      const result = convertSubtitles(text, from, to, { offsetMs });
      total += result.cues;
      files.push({
        name: `${baseName(ref.name)}.${to}`,
        mimeType: SUB_MIME[to],
        bytes: new TextEncoder().encode(result.text),
      });
    }
    return {
      ok: true,
      output: { files: files.map((f) => ({ name: f.name })), cues: total },
      summary: `Converted ${plural(files.length, "subtitle file")} to ${to.toUpperCase()} (${plural(total, "cue")})${offsetMs ? `, shifted by ${offsetMs > 0 ? "+" : ""}${offsetMs} ms` : ""}.`,
      files: packageFiles(files, options, "subtitles"),
    };
  });

// ---- extraction -------------------------------------------------------------------------------

const TEXT_CODECS = [
  "subrip",
  "srt",
  "ass",
  "ssa",
  "webvtt",
  "mov_text",
  "text",
  "microdvd",
  "subviewer",
  "realtext",
  "sami",
  "stl",
  "jacosub",
  "mpl2",
  "pjs",
  "vplayer",
];
const IMAGE_CODECS = ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub", "dvb_teletext"];

function trackLabel(s: ProbeStream, n: number): string {
  const lang = s.tags?.language && s.tags.language !== "und" ? s.tags.language : "";
  const title = s.tags?.title ?? "";
  return [`track ${n}`, lang, title].filter(Boolean).join(" · ");
}

export const subtitleExtractionExecutor: Executor = (input_, options, ctx) =>
  runMediaTool("subtitle-extraction", () =>
    withWorkdir(async (dir) => {
      const [m] = await readMedia(input_, ctx, dir, { max: 1, need: "any" });
      const video = m!;
      if (video.subtitles.length === 0) {
        throw unsupported(
          "This video has no embedded subtitle tracks. (Burned-in subtitles are part of the picture and can't be extracted.)",
        );
      }
      const format = optEnum(options, "format", SUBTITLE_FORMATS, "srt");
      const which = optString(options, "track", "all").trim().toLowerCase() || "all";
      let tracks = video.subtitles.map((s, i) => ({ s, n: i + 1 }));
      if (which !== "all") {
        const n = Number(which);
        if (!Number.isInteger(n) || n < 1 || n > tracks.length) {
          throw unsupported(
            `This video has ${plural(tracks.length, "subtitle track")}; choose 1–${tracks.length} or "all".`,
          );
        }
        tracks = [tracks[n - 1]!];
      }
      const text = tracks.filter(({ s }) => TEXT_CODECS.includes(s.codec_name ?? ""));
      const images = tracks.filter(
        ({ s }) =>
          IMAGE_CODECS.includes(s.codec_name ?? "") || !TEXT_CODECS.includes(s.codec_name ?? ""),
      );
      if (text.length === 0) {
        throw unsupported(
          "This video's subtitles are stored as images (e.g. Blu-ray/DVD subtitles), so they can't be turned into text without OCR.",
        );
      }
      const files: OutputFile[] = [];
      let cues = 0;
      for (const { s, n } of text) {
        throwIfAborted(ctx!.signal);
        const out = `sub-${n}.srt`;
        // FFmpeg normalises every text codec to SRT; OneStop's own writer produces the final format,
        // so styling rules and timestamps are identical to Subtitle Conversion's.
        await runFfmpeg(
          [...input(video.path), "-map", `0:${s.index}`, "-c:s", "srt", "-f", "srt", out],
          {
            cwd: dir,
            signal: ctx!.signal,
          },
        );
        const srt = decodeSubtitleBytes(await readOutput(dir, out));
        const parsed = parseSubtitles(srt, "srt");
        if (parsed.length === 0) continue;
        cues += parsed.length;
        const lang =
          s.tags?.language && s.tags.language !== "und"
            ? `-${s.tags.language.replace(/[^a-z0-9-]/gi, "")}`
            : "";
        const name = `${baseName(video.ref.name)}${text.length > 1 || tracks.length > 1 ? `-track${n}` : ""}${lang}.${format}`;
        files.push({
          name,
          mimeType: SUB_MIME[format],
          bytes: new TextEncoder().encode(writeSubtitles(parsed, format)),
        });
      }
      if (files.length === 0) throw unsupported("The subtitle tracks in this video are empty.");
      const skipped = images.length
        ? ` Skipped ${plural(images.length, "image-based track")} (${images.map(({ s, n }) => trackLabel(s, n)).join(", ")}), which would need OCR.`
        : "";
      return {
        ok: true,
        output: {
          tracks: text.map(({ s, n }) => ({
            track: n,
            codec: s.codec_name,
            language: s.tags?.language ?? null,
          })),
          cues,
        },
        summary: `Extracted ${plural(files.length, "subtitle track")} as ${format.toUpperCase()} (${plural(cues, "cue")}).${skipped}`,
        files: packageFiles(files, options, `${baseName(video.ref.name)}-subtitles`),
      };
    }),
  );
