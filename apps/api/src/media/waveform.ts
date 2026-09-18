// Audio Waveform Generator (Features 7.13).
//
// FFmpeg decodes the track to raw mono 16-bit PCM at a low sample rate (enough for a picture, small
// enough to hold in memory), which is reduced to one min/max pair per column. That array is returned
// in `output.peaks` so a frontend can draw its own waveform, and is also rendered here as an SVG and
// (via sharp) a PNG.
import sharp from "sharp";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { runFfmpeg } from "./ffmpegCheck.ts";
import {
  clock,
  eachMedia,
  input,
  optBool,
  optEnum,
  optNumber,
  optString,
  outFile,
  outName,
  readOutput,
  unsupported,
  type MediaInput,
} from "./common.ts";

/** Never decode more than this many samples (about 40 minutes at 8 kHz). */
const MAX_SAMPLES = 20_000_000;

export interface Peak {
  min: number;
  max: number;
}

/** Reduces PCM samples to `columns` min/max pairs in -1…1. */
export function peaksFromPcm(pcm: Int16Array, columns: number): Peak[] {
  const peaks: Peak[] = [];
  const per = pcm.length / columns;
  for (let c = 0; c < columns; c += 1) {
    const from = Math.floor(c * per);
    const to = Math.max(from + 1, Math.floor((c + 1) * per));
    let min = 0;
    let max = 0;
    for (let i = from; i < to && i < pcm.length; i += 1) {
      const v = pcm[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push({ min: Math.max(-1, min / 32768), max: Math.min(1, max / 32768) });
  }
  return peaks;
}

export interface WaveformStyle {
  width: number;
  height: number;
  colour: string;
  background: string;
  style: "bars" | "line" | "filled";
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  grey: "#808080",
  gray: "#808080",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffcc00",
  green: "#30a46c",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  transparent: "none",
};

/** Colours are whitelisted before they go into SVG markup (09-image-tools.md's rule). */
export function svgColour(text: string, fallback: string): string {
  const t = text.trim().toLowerCase();
  if (NAMED[t]) return NAMED[t]!;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t)?.[1];
  return hex ? `#${hex}` : fallback;
}

export function waveformSvg(peaks: Peak[], s: WaveformStyle): string {
  const { width, height } = s;
  const mid = height / 2;
  const scale = (v: number) => mid - v * (mid - 1);
  let shape: string;
  if (s.style === "bars") {
    const step = width / peaks.length;
    const barWidth = Math.max(0.6, step * 0.7);
    shape = peaks
      .map((p, i) => {
        const top = scale(Math.max(p.max, 0.004));
        const bottom = scale(Math.min(p.min, -0.004));
        return `<rect x="${(i * step + (step - barWidth) / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(1, bottom - top).toFixed(2)}" rx="${(barWidth / 2).toFixed(2)}"/>`;
      })
      .join("");
    shape = `<g fill="${s.colour}">${shape}</g>`;
  } else {
    const top = peaks.map(
      (p, i) => `${((i * width) / (peaks.length - 1 || 1)).toFixed(2)},${scale(p.max).toFixed(2)}`,
    );
    const bottom = peaks
      .map(
        (p, i) =>
          `${((i * width) / (peaks.length - 1 || 1)).toFixed(2)},${scale(p.min).toFixed(2)}`,
      )
      .reverse();
    shape =
      s.style === "filled"
        ? `<polygon points="${[...top, ...bottom].join(" ")}" fill="${s.colour}"/>`
        : `<polyline points="${top.join(" ")}" fill="none" stroke="${s.colour}" stroke-width="1.5" stroke-linejoin="round"/><polyline points="${bottom.join(" ")}" fill="none" stroke="${s.colour}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  const bg =
    s.background === "none"
      ? ""
      : `<rect width="${width}" height="${height}" fill="${s.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${shape}</svg>`;
}

/** Decodes the audio of `m` to mono PCM at a rate chosen to stay under MAX_SAMPLES. */
export async function decodePcm(
  m: MediaInput,
  dir: string,
  signal?: AbortSignal,
): Promise<{ pcm: Int16Array; sampleRate: number }> {
  const duration = m.duration > 0 ? m.duration : 600;
  const sampleRate = Math.max(200, Math.min(8000, Math.floor(MAX_SAMPLES / duration)));
  const out = "wave.pcm";
  await runFfmpeg(
    [
      ...input(m.path),
      "-map",
      `0:${m.audio!.index}`,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      out,
    ],
    { cwd: dir, signal },
  );
  const bytes = await readOutput(dir, out);
  const aligned = bytes.byteLength - (bytes.byteLength % 2);
  return {
    pcm: new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + aligned)),
    sampleRate,
  };
}

export const waveformExecutor: Executor = eachMedia(
  "audio-waveform-generator",
  async (m, options, ctx) => {
    if (!m.audio) throw unsupported(`"${m.ref.name}" has no audio track.`);
    const format = optEnum(options, "output", ["png", "svg"], "png");
    const style: WaveformStyle = {
      width: optNumber(options, "width", 1200, { min: 200, max: 4000 }),
      height: optNumber(options, "height", 300, { min: 60, max: 2000 }),
      colour: svgColour(optString(options, "colour", "#3b82f6"), "#3b82f6"),
      background: optBool(options, "transparent", false)
        ? "none"
        : svgColour(optString(options, "background", "#ffffff"), "#ffffff"),
      style: optEnum(options, "style", ["bars", "line", "filled"], "bars"),
    };
    const { pcm, sampleRate } = await decodePcm(m, ctx.dir, ctx.signal);
    if (pcm.length === 0) throw unsupported(`"${m.ref.name}" contains no audible audio.`);
    const columns = Math.min(
      style.style === "bars" ? Math.floor(style.width / 3) : style.width,
      pcm.length,
    );
    const peaks = peaksFromPcm(pcm, Math.max(2, columns));
    const svg = waveformSvg(peaks, style);
    let file: OutputFile;
    if (format === "svg") {
      file = outFile(outName(m, "waveform", "svg"), "svg", new TextEncoder().encode(svg));
    } else {
      const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
      file = outFile(outName(m, "waveform", "png"), "png", new Uint8Array(png));
    }
    const loudest = peaks.reduce((best, p) => Math.max(best, p.max, -p.min), 0);
    return {
      file,
      note: `${clock(m.duration)} of audio, ${peaks.length} columns, peak ${(20 * Math.log10(Math.max(loudest, 1e-6))).toFixed(1)} dBFS.`,
      info: {
        duration: m.duration,
        sampleRate,
        // The data structure a frontend can draw itself.
        peaks: peaks.map((p) => [Number(p.min.toFixed(4)), Number(p.max.toFixed(4))]),
      },
    };
  },
  { verb: "Drew a waveform for", need: "audio", zipStem: "waveforms", max: 10 },
);
