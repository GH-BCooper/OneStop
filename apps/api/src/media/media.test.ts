// Tests for the audio & video tools (10-audio-video-tools.md): duration/codec/resolution assertions
// against fixtures of known length, a merge that must add up, an SRT → VTT → SRT round trip, the
// missing-FFmpeg path for a representative sample of tools, and an offline run of every tool.
//
// Fixtures are generated with FFmpeg's synthetic sources (see fixtures.ts), so the whole suite is
// self-contained. It is skipped with a clear message if FFmpeg is not installed.
import http from "node:http";
import https from "node:https";
import sharp from "sharp";
import { getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  clock,
  describe as describeMedia,
  parseTime,
  probe,
  withWorkdir,
  type Probe,
} from "./common.ts";
import {
  FFMPEG_MISSING_MESSAGE,
  ffmpegVersion,
  findFfmpeg,
  setFfmpegLocator,
} from "./ffmpegCheck.ts";
import { makeAudio, makeVideo, makeVideoWithSubtitles, SAMPLE_SRT } from "./fixtures.ts";
import { MEDIA_EXECUTORS } from "./index.ts";
import { frameTimes, MAX_FRAMES } from "./extractFrames.ts";
import {
  canRemux,
  padColour,
  resizeFilters,
  rotationFilters,
  targetBitrate,
} from "./convertVideo.ts";
import {
  convertSubtitles,
  decodeSubtitleBytes,
  detectSubtitleFormat,
  formatTimestamp,
  parseSubtitles,
  parseTimestamp,
  writeSubtitles,
} from "./subtitles.ts";
import { parseLoudnorm, parseVolumeDetect, loudnormFilter } from "./normalize.ts";
import { peaksFromPcm, svgColour } from "./waveform.ts";
import { trimRange } from "./trim.ts";
import { crc32 } from "../pdf/zip.ts";

const HAS_FFMPEG = Boolean(findFfmpeg());
const suite = HAS_FFMPEG ? describe : describe.skip;
if (!HAS_FFMPEG) {
  console.warn("[media.test] FFmpeg is not installed — the media tool tests were skipped.");
}

// ---- helpers ----------------------------------------------------------------------------------

type Fixture = { name: string; bytes: Uint8Array };
const f = (name: string, bytes: Uint8Array): Fixture => ({ name, bytes });
const tool = (id: string) => MEDIA_EXECUTORS.find(([k]) => k === id)![1];

async function run(
  id: string,
  input: Fixture[] | string | null,
  options: Record<string, unknown> = {},
) {
  const files = Array.isArray(input) ? input : [];
  const refs: FileRef[] | string | null = Array.isArray(input)
    ? input.map((x, i) => ({ name: x.name, size: x.bytes.length, type: "", tempId: `f-${i}` }))
    : input;
  const ctx: ExecContext = {
    jobId: "t",
    readFile: async (ref) => files[Number(ref.tempId!.slice(2))]!.bytes,
  };
  return tool(id)(refs, options, ctx);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}
function fail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error(`expected failure, got: ${result.summary}`);
  return result;
}
function out(result: ExecResult, index = 0): OutputFile {
  const file = (ok(result).files ?? [])[index];
  if (!file) throw new Error("no output file");
  return file;
}
function files(result: ExecResult): OutputFile[] {
  return ok(result).files ?? [];
}

/** ffprobe on bytes we produced. */
async function probeBytes(name: string, bytes: Uint8Array): Promise<Probe> {
  return withWorkdir(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${dir}/${name}`, bytes);
    return probe(name, dir);
  });
}

async function info(name: string, bytes: Uint8Array) {
  const p = await probeBytes(name, bytes);
  const m = describeMedia({ name, size: bytes.length, type: "" }, name, bytes.length, p);
  return m;
}

const near = (actual: number, expected: number, tolerance = 0.15) => {
  expect(
    Math.abs(actual - expected),
    `${actual} should be within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
};

// ---- fixtures ---------------------------------------------------------------------------------

let mp3: Uint8Array;
let wav: Uint8Array;
let shortTone: Uint8Array;
let quietTone: Uint8Array;
let clip: Uint8Array;
let clipBig: Uint8Array;
let silentClip: Uint8Array;
let subsMkv: Uint8Array;

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  [mp3, wav, shortTone, quietTone] = await Promise.all([
    makeAudio("mp3", { seconds: 3 }),
    makeAudio("wav", { seconds: 3, frequency: 660 }),
    makeAudio("mp3", { seconds: 2, frequency: 220 }),
    makeAudio("wav", { seconds: 2, volume: 0.05 }),
  ]);
  [clip, clipBig, silentClip, subsMkv] = await Promise.all([
    makeVideo("mp4", { seconds: 2 }),
    makeVideo("mp4", { seconds: 1, width: 640, height: 480, source: "smptebars" }),
    makeVideo("mp4", { seconds: 1, audio: false }),
    makeVideoWithSubtitles(SAMPLE_SRT, { seconds: 5 }),
  ]);
}, 300_000);

afterEach(() => setFfmpegLocator(null));

// ---- pure helpers (no FFmpeg needed) ----------------------------------------------------------

describe("time parsing", () => {
  it("accepts seconds, clock times and 1m30s", () => {
    expect(parseTime("90", "Start")).toBe(90);
    expect(parseTime("1:30", "Start")).toBe(90);
    expect(parseTime("01:02:03.5", "Start")).toBe(3723.5);
    expect(parseTime("2.5s", "Start")).toBe(2.5);
    expect(parseTime("1m30s", "Start")).toBe(90);
    expect(parseTime("", "Start")).toBeNull();
  });

  it("rejects nonsense with a message naming the field", () => {
    expect(() => parseTime("soon", "Start")).toThrow(/Start: "soon" is not a time/);
  });

  it("formats clock times", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.5)).toBe("1:05.5");
    expect(clock(3723)).toBe("1:02:03");
  });
});

describe("subtitles", () => {
  const cues = parseSubtitles(SAMPLE_SRT, "srt");

  it("parses SRT into cues with millisecond timing and kept markup", () => {
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start: 500,
      end: 2000,
      text: "Hello there.\nThis is <i>line two</i>.",
    });
    expect(cues[1]!.text).toContain("Second cue & special");
  });

  it("round-trips SRT → VTT → SRT with identical timing and text", () => {
    const vtt = convertSubtitles(SAMPLE_SRT, "srt", "vtt").text;
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.500 --> 00:00:02.000");
    const back = convertSubtitles(vtt, "vtt", "srt").text;
    expect(parseSubtitles(back, "srt")).toEqual(cues);
    expect(back.trim()).toBe(writeSubtitles(cues, "srt").trim());
  });

  it("round-trips through ASS, keeping italics and line breaks", () => {
    const ass = convertSubtitles(SAMPLE_SRT, "srt", "ass").text;
    expect(ass).toContain("[Events]");
    expect(ass).toContain("{\\i1}line two{\\i0}");
    expect(ass).toContain("\\N");
    const back = parseSubtitles(convertSubtitles(ass, "ass", "srt").text, "srt");
    expect(back.map((c) => c.text)).toEqual(cues.map((c) => c.text));
    // ASS stores centiseconds, so timings come back rounded to 10 ms.
    back.forEach((c, i) => near(c.start, cues[i]!.start, 10));
  });

  it("reads VTT extras (NOTE/STYLE blocks, cue ids, settings, classes) and drops them", () => {
    const vtt = `WEBVTT - Title

NOTE this is a comment

STYLE
::cue { color: red }

intro
00:01.000 --> 00:03.000 line:0 position:50%
<v Narrator><c.loud>Hi</c> there

2
00:04.000 --> 00:05.000
Bye
`;
    const parsed = parseSubtitles(vtt, "vtt");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ start: 1000, end: 3000, text: "Hi there" });
    expect(parsed[1]!.text).toBe("Bye");
  });

  it("shifts timing and refuses a file with no cues", () => {
    const shifted = parseSubtitles(
      convertSubtitles(SAMPLE_SRT, "srt", "srt", { offsetMs: 1500 }).text,
      "srt",
    );
    expect(shifted[0]!.start).toBe(2000);
    expect(() => convertSubtitles("not a subtitle file", "srt", "vtt")).toThrow(
      /No subtitles were found/,
    );
  });

  it("detects the format from the content, not just the name", () => {
    expect(detectSubtitleFormat(SAMPLE_SRT, "x.txt")).toBe("srt");
    expect(detectSubtitleFormat("WEBVTT\n\n00:01.000 --> 00:02.000\nhi", "x.srt")).toBe("vtt");
    expect(detectSubtitleFormat("[Script Info]\nScriptType: v4.00+", "x.ass")).toBe("ass");
    expect(detectSubtitleFormat("hello", "x.doc")).toBeNull();
  });

  it("decodes UTF-8 BOM, UTF-16 and Windows-1252 subtitle files", () => {
    const enc = new TextEncoder();
    expect(decodeSubtitleBytes(enc.encode("﻿hé"))).toBe("hé");
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00]);
    expect(decodeSubtitleBytes(utf16)).toBe("hé");
    expect(decodeSubtitleBytes(new Uint8Array([0x68, 0xe9]))).toBe("hé");
  });

  it("formats timestamps per target format", () => {
    expect(formatTimestamp(3_723_456, "srt")).toBe("01:02:03,456");
    expect(formatTimestamp(3_723_456, "vtt")).toBe("01:02:03.456");
    expect(formatTimestamp(3_723_456, "ass")).toBe("1:02:03.45");
    expect(parseTimestamp("1:02:03.45")).toBe(3_723_450);
  });
});

describe("pure video helpers", () => {
  const fake = (width: number, height: number, codec = "h264", audioCodec = "aac") =>
    describeMedia({ name: "a.mp4", size: 1, type: "" }, "in-0.mp4", 1, {
      format: { format_name: "mov,mp4", duration: "10" },
      streams: [
        { index: 0, codec_type: "video", codec_name: codec, width, height, avg_frame_rate: "30/1" },
        {
          index: 1,
          codec_type: "audio",
          codec_name: audioCodec,
          sample_rate: "44100",
          channels: 2,
        },
      ],
    });

  it("only remuxes when the container accepts both codecs", () => {
    expect(canRemux(fake(640, 480), "mp4")).toBe(true);
    expect(canRemux(fake(640, 480), "webm")).toBe(false);
    expect(canRemux(fake(640, 480, "vp9", "opus"), "webm")).toBe(true);
    expect(canRemux(fake(640, 480, "vp9", "opus"), "mkv")).toBe(true);
  });

  it("builds fit/pad/crop/stretch filters with even dimensions", () => {
    const m = fake(640, 480);
    expect(resizeFilters(m, 300, 300, "stretch", "black").filters[0]).toBe("scale=300:300");
    expect(resizeFilters(m, 300, 300, "pad", "black").filters[1]).toContain("pad=300:300");
    expect(resizeFilters(m, 300, 300, "crop", "black").filters[1]).toBe("crop=300:300");
    expect(resizeFilters(m, 300, 300, "fit", "black").size).toBe("300 × 226");
    expect(resizeFilters(m, 321, 0, "fit", "black").size).toBe("322 × 240");
    expect(() => resizeFilters(m, 0, 0, "fit", "black")).toThrow(/Enter a width/);
  });

  it("whitelists colours before they reach a filter or SVG", () => {
    expect(padColour("#ff8800")).toBe("0xff8800");
    expect(padColour("white")).toBe("0xffffff");
    expect(padColour("red; drop table")).toBe("0x000000");
    expect(svgColour("blue", "#000")).toBe("#3b82f6");
    expect(svgColour("</svg><script>", "#000")).toBe("#000");
  });

  it("maps rotations and flips onto filters", () => {
    expect(rotationFilters(90, "none")).toEqual(["transpose=clock"]);
    expect(rotationFilters(180, "none")).toEqual(["hflip", "vflip"]);
    expect(rotationFilters(270, "horizontal")).toEqual(["transpose=cclock", "hflip"]);
    expect(rotationFilters(0, "none")).toEqual([]);
  });

  it("picks frame times per mode and refuses impossible ones", () => {
    const m = fake(320, 240);
    expect(frameTimes(m, { mode: "count", count: 5 })).toHaveLength(5);
    expect(frameTimes(m, { mode: "interval", interval: "2" })).toHaveLength(6);
    expect(frameTimes(m, { mode: "times", times: "0:01, 2, 3.5" })).toEqual([1, 2, 3.5]);
    expect(frameTimes(m, { mode: "single", time: "4" })).toEqual([4]);
    expect(() => frameTimes({ ...m, duration: 3600 }, { mode: "interval", interval: "1" })).toThrow(
      /longer interval/,
    );
    expect(() => frameTimes(m, { mode: "single", time: "30" })).toThrow(/past the end/);
    expect(MAX_FRAMES).toBe(300);
  });

  it("works out a trim range, clamped, with clear errors", () => {
    const m = fake(320, 240);
    expect(trimRange(m, { start: "2", end: "5" })).toEqual({ start: 2, end: 5 });
    expect(trimRange(m, { start: "2", duration: "3" })).toEqual({ start: 2, end: 5 });
    expect(trimRange(m, { start: "5" })).toEqual({ start: 5, end: 10 });
    expect(trimRange(m, { start: "2", end: "99" })).toEqual({ start: 2, end: 10 });
    expect(() => trimRange(m, { start: "5", end: "3" })).toThrow(/end must be after/);
    expect(() => trimRange(m, { start: "20" })).toThrow(/past the end/);
    expect(() => trimRange(m, {})).toThrow(/keeps the whole file/);
  });

  it("reduces PCM to min/max peaks", () => {
    const pcm = Int16Array.from([0, 16384, -16384, 0, 32767, -32768, 100, -100]);
    const peaks = peaksFromPcm(pcm, 4);
    expect(peaks).toHaveLength(4);
    near(peaks[0]!.max, 0.5, 0.01);
    near(peaks[1]!.min, -0.5, 0.01);
    expect(peaks[2]!.max).toBeCloseTo(1, 2);
    expect(peaks[3]!.max).toBeLessThan(0.01);
  });

  it("parses FFmpeg's loudness reports", () => {
    expect(
      parseLoudnorm(
        'junk\n{"input_i":"-23.5","input_tp":"-2.0","input_lra":"3.0","input_thresh":"-33","target_offset":"0.5"}',
      ),
    ).toMatchObject({ input_i: "-23.5" });
    expect(parseLoudnorm("no json here")).toBeNull();
    expect(
      parseVolumeDetect("[Parsed_volumedetect_0 @ x] max_volume: -6.5 dB\nmean_volume: -20.1 dB"),
    ).toEqual({ maxVolume: -6.5, meanVolume: -20.1 });
  });
});

// ---- registry ---------------------------------------------------------------------------------

describe("registry", () => {
  it("registers all 27 phase-10 tools as available, local and offline-verified", () => {
    expect(MEDIA_EXECUTORS).toHaveLength(27);
    for (const [id] of MEDIA_EXECUTORS) {
      const meta = getTool(id);
      expect(meta, `missing registry entry for ${id}`).toBeDefined();
      expect(meta!.phase).toBe("10");
      expect(meta!.status).toBe("available");
      expect(meta!.execution).toBe("local");
      expect(meta!.offline, `${id} passed the offline test below`).toBe(true);
    }
  });
});

// ---- FFmpeg-backed tools ----------------------------------------------------------------------

suite("audio tools", () => {
  it("converts MP3 → WAV keeping the duration, and reports the codec", async () => {
    const result = await run("audio-to-wav", [f("tone.mp3", mp3)]);
    const file = out(result);
    expect(file.name).toBe("tone.wav");
    const m = await info(file.name, file.bytes);
    near(m.duration, 3, 0.1);
    expect(m.audio!.codec).toBe("pcm_s16le");
  });

  it("converts to every offered format with the right codec", async () => {
    for (const [format, codec] of [
      ["mp3", "mp3"],
      ["m4a", "aac"],
      ["flac", "flac"],
      ["ogg", "vorbis"],
      ["opus", "opus"],
    ] as const) {
      const file = out(await run("audio-converter", [f("tone.wav", wav)], { format }));
      expect(file.name).toBe(`tone.${format}`);
      const m = await info(file.name, file.bytes);
      expect(m.audio!.codec, `${format} should hold ${codec}`).toBe(codec);
      near(m.duration, 3, 0.2);
    }
  }, 120_000);

  it("takes the soundtrack out of a video as MP3", async () => {
    const file = out(await run("video-to-mp3", [f("clip.mp4", clip)], { bitrate: 128 }));
    const m = await info(file.name, file.bytes);
    expect(m.audio!.codec).toBe("mp3");
    near(m.duration, 2, 0.2);
  });

  it("copies the audio track out untouched when asked for original quality", async () => {
    const result = await run("extract-audio", [f("clip.mp4", clip)]);
    const file = out(result);
    expect(file.name).toBe("clip-audio.m4a");
    expect(ok(result).summary).toContain("without re-encoding");
    expect((await info(file.name, file.bytes)).audio!.codec).toBe("aac");
  });

  it("refuses to extract audio from a silent video", async () => {
    expect(fail(await run("extract-audio", [f("silent.mp4", silentClip)])).message).toMatch(
      /no audio track/i,
    );
  });

  it("compresses audio to a smaller file, or keeps the original when it cannot", async () => {
    const smaller = await run("audio-compressor", [f("tone.wav", wav)], { level: "strong" });
    const file = out(smaller);
    expect(file.bytes.length).toBeLessThan(wav.length);
    expect(file.name).toBe("tone-compressed.mp3");
    const already = await run("audio-compressor", [f("tone.mp3", shortTone)], {
      level: "light",
      bitrate: 320,
    });
    expect(ok(already).summary).toMatch(/original was kept|smaller/);
  });

  it("trims audio to the requested length, with fades", async () => {
    const file = out(
      await run("audio-trimmer", [f("tone.wav", wav)], {
        start: "0:01",
        end: "2.5",
        fadeIn: 0.2,
        fadeOut: 0.2,
      }),
    );
    const m = await info(file.name, file.bytes);
    near(m.duration, 1.5, 0.15);
    expect(file.name).toBe("tone-trimmed.wav");
  });

  it("merges audio into one file whose duration is the sum", async () => {
    const result = await run("audio-merger", [f("a.mp3", mp3), f("b.mp3", shortTone)], {
      format: "wav",
    });
    const file = out(result);
    const m = await info(file.name, file.bytes);
    near(m.duration, 5, 0.3);
    expect(ok(result).summary).toContain("Joined 2 audio files");
  });

  it("asks for at least two files to merge", async () => {
    expect(fail(await run("audio-merger", [f("a.mp3", mp3)])).message).toMatch(/at least 2/);
  });

  it("normalises loudness to the chosen target", async () => {
    const file = out(
      await run("volume-normalizer", [f("quiet.wav", quietTone)], { target: "podcast" }),
    );
    const measured = await withWorkdir(async (dir) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${dir}/${file.name}`, file.bytes);
      const m = describeMedia(
        { name: file.name, size: file.bytes.length, type: "" },
        file.name,
        file.bytes.length,
        await probe(file.name, dir),
      );
      return (await loudnormFilter(m, dir, -16, -1)).measured;
    });
    near(Number(measured!.input_i), -16, 1.5);
  }, 120_000);

  it("normalises by peak too", async () => {
    const result = await run("volume-normalizer", [f("quiet.wav", quietTone)], {
      mode: "peak",
      peakDb: -1,
    });
    expect(ok(result).summary).toMatch(/Peak .* dB → -1 dB/);
  });

  it("views and edits audio tags without re-encoding", async () => {
    const view = await run("audio-metadata-editor", [f("tone.mp3", mp3)]);
    expect(out(view).name).toBe("tone-metadata.json");
    expect(ok(view).summary).toMatch(/MP3, 0:0?3/);
    const edited = out(
      await run("audio-metadata-editor", [f("tone.mp3", mp3)], {
        mode: "edit",
        title: "Test Tone",
        artist: "OneStop",
      }),
    );
    const m = await info(edited.name, edited.bytes);
    expect({ ...m.probe.format.tags }).toMatchObject({ title: "Test Tone", artist: "OneStop" });
    expect(m.audio!.codec).toBe("mp3");
  });

  it("says plainly when a format cannot hold tags", async () => {
    const aac = await makeAudio("aac", { seconds: 1 });
    expect(
      fail(await run("audio-metadata-editor", [f("t.aac", aac)], { mode: "edit", title: "x" }))
        .message,
    ).toMatch(/can't store tags/);
  });

  it("draws a waveform as PNG and SVG, and returns the peaks as data", async () => {
    const png = await run("audio-waveform-generator", [f("tone.mp3", mp3)], {
      width: 600,
      height: 200,
    });
    const file = out(png);
    const meta = await sharp(Buffer.from(file.bytes)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 600, 200]);
    const peaks = (ok(png).output as { files: { peaks: number[][] }[] }).files[0]!.peaks;
    expect(peaks.length).toBeGreaterThan(50);
    expect(Math.max(...peaks.map((p) => p[1]!))).toBeGreaterThan(0.5);
    const svg = out(
      await run("audio-waveform-generator", [f("tone.mp3", mp3)], {
        output: "svg",
        style: "filled",
      }),
    );
    expect(new TextDecoder().decode(svg.bytes)).toMatch(/^<svg[^>]*><rect[^>]*\/><polygon/);
  });
});

suite("video tools", () => {
  it("converts to MP4 by copying the streams when it can", async () => {
    const result = await run("video-to-mp4", [f("clip.mp4", clip)]);
    expect(ok(result).summary).toContain("without re-encoding");
    near((await info("out.mp4", out(result).bytes)).duration, 2, 0.2);
  });

  it("re-encodes to WebM (VP9 + Opus)", async () => {
    const file = out(await run("video-to-webm", [f("clip.mp4", clip)], { quality: "low" }));
    const m = await info(file.name, file.bytes);
    expect(m.video!.codec).toBe("vp9");
    expect(m.audio!.codec).toBe("opus");
    near(m.duration, 2, 0.3);
  }, 120_000);

  it("compresses a video and never returns something bigger", async () => {
    const big = await makeVideo("mp4", {
      seconds: 2,
      width: 640,
      height: 480,
      extraArgs: ["-crf", "12"],
    });
    const result = await run("video-compressor", [f("big.mp4", big)], { level: "strong" });
    const file = out(result);
    expect(file.bytes.length).toBeLessThan(big.length);
    const m = await info(file.name, file.bytes);
    expect(Math.min(m.video!.width, m.video!.height)).toBeLessThanOrEqual(720);
    const tiny = await run("video-compressor", [f("clip.mp4", clip)], {
      level: "size",
      targetMb: 0.02,
    });
    expect(ok(tiny).summary).toMatch(/smaller|original was kept/);
  }, 180_000);

  it("works out a bitrate for a target size, and refuses an impossible one", () => {
    expect(targetBitrate(60, 10, 96, true)).toBe(1228);
    expect(() => targetBitrate(600, 1, 96, true)).toThrow(/too small for a 600 s video/);
    expect(() => targetBitrate(0, 10, 96, true)).toThrow(/length is unknown/);
  });

  it("trims video precisely and fast", async () => {
    const precise = out(
      await run("video-trimmer", [f("clip.mp4", clip)], { start: "0.5", end: "1.5" }),
    );
    near((await info(precise.name, precise.bytes)).duration, 1, 0.15);
    const fast = out(
      await run("video-trimmer", [f("clip.mp4", clip)], { start: "0.5", end: "1.5", mode: "fast" }),
    );
    const m = await info(fast.name, fast.bytes);
    expect(m.duration).toBeGreaterThan(0.3);
    expect(m.duration).toBeLessThan(1.6);
  }, 60_000);

  it("merges clips of different sizes into one of the first clip's size", async () => {
    const result = await run("video-merger", [f("a.mp4", clip), f("b.mp4", clipBig)]);
    const file = out(result);
    const m = await info(file.name, file.bytes);
    near(m.duration, 3, 0.4);
    expect([m.video!.width, m.video!.height]).toEqual([320, 240]);
    expect(ok(result).summary).toContain("black bars");
  }, 120_000);

  it("merges a clip that has no sound by adding silence", async () => {
    const result = await run("video-merger", [f("a.mp4", clip), f("silent.mp4", silentClip)]);
    const m = await info("merged.mp4", out(result).bytes);
    near(m.duration, 3, 0.4);
    expect(m.audio).toBeDefined();
  }, 120_000);

  it("resizes with padding, cropping and stretching", async () => {
    const padded = out(
      await run("video-resizer", [f("clip.mp4", clip)], { preset: "1080x1080", quality: "low" }),
    );
    const m = await info(padded.name, padded.bytes);
    expect([m.video!.width, m.video!.height]).toEqual([1080, 1080]);
    const cropped = out(
      await run("video-resizer", [f("clip.mp4", clip)], {
        width: 200,
        height: 200,
        mode: "crop",
        quality: "low",
      }),
    );
    const c = await info(cropped.name, cropped.bytes);
    expect([c.video!.width, c.video!.height]).toEqual([200, 200]);
  }, 120_000);

  it("rotates a video, swapping its dimensions", async () => {
    const file = out(
      await run("rotate-video", [f("clip.mp4", clip)], { angle: "90", quality: "low" }),
    );
    const m = await info(file.name, file.bytes);
    expect([m.video!.width, m.video!.height]).toEqual([240, 320]);
  }, 60_000);

  it("changes resolution, and leaves a smaller video alone", async () => {
    const down = await run("change-video-resolution", [f("big.mp4", clipBig)], {
      resolution: "240",
      quality: "low",
    });
    const m = await info("out.mp4", out(down).bytes);
    expect(m.video!.height).toBe(240);
    const already = await run("change-video-resolution", [f("clip.mp4", clip)], {
      resolution: "1080",
    });
    expect(ok(already).summary).toMatch(/left unchanged/);
  }, 60_000);

  it("changes quality in the same container", async () => {
    const file = out(await run("change-video-quality", [f("clip.mp4", clip)], { quality: "low" }));
    expect(file.name).toBe("clip-low.mp4");
    expect((await info(file.name, file.bytes)).video!.codec).toBe("h264");
  }, 60_000);

  it("makes an animated GIF from a clip", async () => {
    const file = out(
      await run("video-to-gif", [f("clip.mp4", clip)], {
        start: "0.5",
        duration: "1",
        fps: 8,
        width: 160,
      }),
    );
    expect(file.name).toBe("clip.gif");
    expect([...file.bytes.subarray(0, 3)]).toEqual([0x47, 0x49, 0x46]);
    const meta = await sharp(Buffer.from(file.bytes), { animated: true }).metadata();
    expect(meta.width).toBe(160);
    expect(meta.pages).toBeGreaterThan(4);
  }, 60_000);

  it("extracts evenly spaced frames as images", async () => {
    const result = await run("extract-frames", [f("clip.mp4", clip)], {
      mode: "count",
      count: 4,
      packaging: "files",
      width: 160,
    });
    const frames = files(result);
    expect(frames).toHaveLength(4);
    expect(frames[0]!.name).toMatch(/^clip-001-0-00\.png$/);
    const meta = await sharp(Buffer.from(frames[2]!.bytes)).metadata();
    expect([meta.format, meta.width]).toEqual(["png", 160]);
    // Different moments of a moving test pattern must not be identical.
    expect(crc32(frames[0]!.bytes)).not.toBe(crc32(frames[3]!.bytes));
  }, 60_000);

  it("packs several frames into one ZIP by default and grabs a single frame as JPG", async () => {
    const zipped = files(
      await run("extract-frames", [f("clip.mp4", clip)], { mode: "interval", interval: "1" }),
    );
    expect(zipped).toHaveLength(1);
    expect(zipped[0]!.name).toBe("clip-frames.zip");
    const single = out(
      await run("extract-frames", [f("clip.mp4", clip)], {
        mode: "single",
        time: "1",
        format: "jpg",
      }),
    );
    expect(single.mimeType).toBe("image/jpeg");
  }, 60_000);

  it("extracts an embedded subtitle track and converts it", async () => {
    const result = await run("subtitle-extraction", [f("movie.mkv", subsMkv)], { format: "vtt" });
    const file = out(result);
    const text = new TextDecoder().decode(file.bytes);
    expect(text.startsWith("WEBVTT")).toBe(true);
    expect(text).toContain("Hello there.");
    expect(parseSubtitles(text, "vtt")).toHaveLength(2);
    expect(ok(result).summary).toContain("2 cues");
  }, 60_000);

  it("says so when a video has no subtitle tracks", async () => {
    expect(fail(await run("subtitle-extraction", [f("clip.mp4", clip)])).message).toMatch(
      /no embedded subtitle tracks/,
    );
  });

  it("converts subtitle files without needing FFmpeg at all", async () => {
    setFfmpegLocator(() => null);
    const result = await run(
      "subtitle-conversion",
      [f("movie.srt", new TextEncoder().encode(SAMPLE_SRT))],
      { format: "vtt", packaging: "files" },
    );
    expect(new TextDecoder().decode(out(result).bytes).startsWith("WEBVTT")).toBe(true);
    expect(out(result).name).toBe("movie.vtt");
  });
});

suite("safety and failure paths", () => {
  it("refuses a playlist pretending to be a video (it would make FFmpeg read other files)", async () => {
    const playlist = new TextEncoder().encode(
      "#EXTM3U\n#EXT-X-TARGETDURATION:10\nfile:///etc/passwd\n",
    );
    expect(fail(await run("video-converter", [f("evil.mp4", playlist)])).message).toBe(
      "This file type is not supported.",
    );
  });

  it("reports a damaged file instead of crashing", async () => {
    const junk = new Uint8Array(2048).fill(0x41);
    expect(fail(await run("audio-converter", [f("broken.mp3", junk)])).message).toMatch(
      /could not be read/,
    );
  });

  it("asks for a file when none was given", async () => {
    expect(fail(await run("video-converter", [])).message).toMatch(/Choose a video/);
  });

  it("refuses an audio-only file to a video tool and vice versa", async () => {
    expect(fail(await run("video-converter", [f("tone.mp3", mp3)])).message).toMatch(
      /no video track/,
    );
    expect(fail(await run("audio-converter", [f("silent.mp4", silentClip)])).message).toMatch(
      /no audio track/,
    );
  });

  it("cancels when the pipeline aborts", async () => {
    const controller = new AbortController();
    const refs: FileRef[] = [{ name: "clip.mp4", size: clip.length, type: "", tempId: "f-0" }];
    const ctx: ExecContext = { jobId: "t", readFile: async () => clip, signal: controller.signal };
    controller.abort();
    const result = await tool("video-compressor")(refs, {}, ctx);
    expect(result.ok).toBe(false);
  });
});

describe("missing FFmpeg", () => {
  const cases: [string, Fixture[], Record<string, unknown>?][] = [
    ["audio-converter", [{ name: "a.mp3", bytes: new Uint8Array([1]) }]],
    ["video-compressor", [{ name: "a.mp4", bytes: new Uint8Array([1]) }]],
    ["video-to-gif", [{ name: "a.mp4", bytes: new Uint8Array([1]) }]],
    ["extract-frames", [{ name: "a.mp4", bytes: new Uint8Array([1]) }]],
    ["audio-waveform-generator", [{ name: "a.mp3", bytes: new Uint8Array([1]) }]],
    ["volume-normalizer", [{ name: "a.mp3", bytes: new Uint8Array([1]) }]],
    [
      "audio-merger",
      [
        { name: "a.mp3", bytes: new Uint8Array([1]) },
        { name: "b.mp3", bytes: new Uint8Array([1]) },
      ],
    ],
    [
      "video-merger",
      [
        { name: "a.mp4", bytes: new Uint8Array([1]) },
        { name: "b.mp4", bytes: new Uint8Array([1]) },
      ],
    ],
    ["subtitle-extraction", [{ name: "a.mkv", bytes: new Uint8Array([1]) }]],
    ["audio-metadata-editor", [{ name: "a.mp3", bytes: new Uint8Array([1]) }]],
    ["video-trimmer", [{ name: "a.mp4", bytes: new Uint8Array([1]) }]],
  ];

  it("shows one consistent message for every tool that needs it", async () => {
    setFfmpegLocator(() => null);
    for (const [id, input, options] of cases) {
      const result = fail(await run(id, input, options ?? {}));
      expect(result.message, `${id} should report the FFmpeg setup message`).toBe(
        FFMPEG_MISSING_MESSAGE,
      );
      expect(result.message).toContain(
        "FFmpeg is required for audio/video tools — see setup instructions",
      );
    }
  });

  it("names the FFmpeg version it found when it is installed", () => {
    if (!HAS_FFMPEG) return;
    expect(ffmpegVersion()).toBeTruthy();
  });
});

suite("offline", () => {
  it("runs every phase-10 tool with the network trapped", async () => {
    const trap = () => {
      throw new Error("network access attempted");
    };
    const saved = {
      fetch: globalThis.fetch,
      hg: http.get,
      hr: http.request,
      sg: https.get,
      sr: https.request,
    };
    globalThis.fetch = trap as typeof fetch;
    http.get = trap as typeof http.get;
    http.request = trap as typeof http.request;
    https.get = trap as typeof https.get;
    https.request = trap as typeof https.request;
    try {
      const a = f("tone.mp3", shortTone);
      const w = f("tone.wav", quietTone);
      const v = f("clip.mp4", clip);
      const cases: Record<string, [Fixture[], Record<string, unknown>?]> = {
        "video-to-mp3": [[v]],
        "audio-converter": [[a], { format: "wav" }],
        "audio-compressor": [[w], { level: "strong" }],
        "audio-trimmer": [[a], { start: "0.5", end: "1" }],
        "audio-merger": [[a, a], { format: "wav" }],
        "audio-to-wav": [[a]],
        "audio-to-mp3": [[w]],
        "audio-to-aac": [[a]],
        "audio-to-flac": [[a]],
        "extract-audio": [[v]],
        "audio-metadata-editor": [[a]],
        "volume-normalizer": [[w], { mode: "peak" }],
        "audio-waveform-generator": [[a], { width: 300, height: 100 }],
        "video-converter": [[v], { format: "mkv" }],
        "video-compressor": [[v], { level: "light" }],
        "video-to-mp4": [[v]],
        "video-to-webm": [[v], { quality: "low" }],
        "video-to-gif": [[v], { duration: "0.5", fps: 5, width: 80 }],
        "video-trimmer": [[v], { start: "0.2", end: "0.8", mode: "fast" }],
        "video-merger": [[v, v]],
        "video-resizer": [[v], { width: 160, height: 120, quality: "low" }],
        "rotate-video": [[v], { angle: "180", quality: "low" }],
        "extract-frames": [[v], { mode: "single", time: "0.5" }],
        "subtitle-extraction": [[f("movie.mkv", subsMkv)]],
        "subtitle-conversion": [[f("s.srt", new TextEncoder().encode(SAMPLE_SRT))]],
        "change-video-resolution": [[v], { resolution: "240", quality: "low" }],
        "change-video-quality": [[v], { quality: "low" }],
      };
      expect(Object.keys(cases).sort()).toEqual(MEDIA_EXECUTORS.map(([id]) => id).sort());
      for (const [id, [input, options]] of Object.entries(cases)) {
        const result = await run(id, input, options ?? {});
        expect(result.ok, `${id} failed offline: ${result.ok ? "" : result.message}`).toBe(true);
      }
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }
  }, 600_000);
});
