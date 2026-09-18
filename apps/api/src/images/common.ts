// Shared plumbing for the image tools (09-image-tools.md): decoding every accepted format into
// `sharp`, encoding results back, colours, packaging and the error contract.
//
// Error handling follows phases 05–08: anything the user can act on is a `PdfToolError` (the
// shared "tool error" type — the name is historical) and `runImageTool` turns every throw into the
// pipeline's `ExecResult`, so no stack trace ever reaches the UI (CLAUDE.md §7).
import { createRequire } from "node:module";
import sharp, { type Metadata, type Sharp } from "sharp";
import type { ExecErrorCode, ExecResult } from "@onestop/types";
import type { ExecContext, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { createZip, ZIP_MIME } from "../pdf/zip.ts";
import { baseName, extOf, optEnum, plural } from "../documents/common.ts";
import { decodeBmp, encodeBmp } from "./bmp.ts";

export {
  baseName,
  extOf,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
} from "../documents/common.ts";
export { PdfToolError as ImageToolError } from "../pdf/errors.ts";

/**
 * Decompression-bomb guard: no input may decode to more than this many pixels (a 12 000 × 10 000
 * photo). Phase 04 already caps the upload size; this caps what a small, crafted file can expand to.
 */
export const MAX_INPUT_PIXELS = 120_000_000;
/** Largest image any tool may produce (Upscaler, Fit to Square, Image → PDF pages…). */
export const MAX_OUTPUT_PIXELS = 100_000_000;

export type ImageFormat = "jpg" | "png" | "webp" | "gif" | "tiff" | "avif" | "bmp";

export const MIME: Record<ImageFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  avif: "image/avif",
  bmp: "image/bmp",
};

/** Formats that can carry an alpha channel. */
export const ALPHA_FORMATS: readonly ImageFormat[] = ["png", "webp", "gif", "tiff", "avif"];
/** Formats that can carry more than one frame. */
const ANIMATED_FORMATS: readonly ImageFormat[] = ["gif", "webp"];

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export async function runImageTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[images:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    const text = err instanceof Error ? err.message : String(err);
    if (/pixel limit/i.test(text)) {
      return {
        ok: false,
        code: "UNSUPPORTED_INPUT",
        message: "This image is too large to process. Try a smaller image (under 120 megapixels).",
      };
    }
    if (/unsupported image format|corrupt|premature end|bad seek|input buffer|vips/i.test(text)) {
      console.error(`[images:${toolId}]`, err);
      return {
        ok: false,
        code: "UNSUPPORTED_INPUT",
        message:
          "This image could not be read. It may be damaged or in a format OneStop can't open.",
      };
    }
    console.error(`[images:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This image could not be processed. Please try again.",
    };
  }
}

// ---- inputs -----------------------------------------------------------------------------------

export interface ImageInput {
  ref: FileRef;
  bytes: Uint8Array;
  /** Normalised format of the file ("jpeg" → "jpg", "tif" → "tiff", "heic" stays "heic"). */
  format: ImageFormat | "heic";
  /** Canonical source for sharp: the original bytes, or raw RGBA for BMP/HEIC. */
  source: Buffer;
  raw?: { width: number; height: number; channels: 4 };
  /** More than one frame (animated GIF/WebP). */
  animated: boolean;
  /** Display size, EXIF orientation applied. */
  width: number;
  height: number;
  hasAlpha: boolean;
}

/** Sniffs the real format from magic bytes; the extension is only a fallback. */
export function sniffFormat(bytes: Uint8Array, name = ""): ImageFormat | "heic" | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)
  ) {
    return "tiff";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) {
      // mif1 is used by both; the extension breaks the tie.
      return brand === "mif1" && extOf(name) === "avif" ? "avif" : "heic";
    }
  }
  const ext = extOf(name);
  if (ext === "jpeg") return "jpg";
  if (ext === "tif") return "tiff";
  return null;
}

type HeicDecode = (opts: {
  buffer: Buffer;
}) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
let heicDecode: HeicDecode | null = null;

async function decodeHeic(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; data: Buffer }> {
  heicDecode ??= createRequire(import.meta.url)("heic-decode") as HeicDecode;
  try {
    const { width, height, data } = await heicDecode({ buffer: Buffer.from(bytes) });
    if (width * height > MAX_INPUT_PIXELS) throw new Error("Input image exceeds pixel limit");
    return { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
  } catch (err) {
    if (err instanceof Error && /pixel limit/.test(err.message)) throw err;
    throw unsupported("This HEIC photo could not be read. It may be damaged.", err);
  }
}

/** Reads, sniffs and measures one image. Nothing is decoded beyond the header except BMP/HEIC. */
export async function toImageInput(ref: FileRef, bytes: Uint8Array): Promise<ImageInput> {
  const format = sniffFormat(bytes, ref.name);
  if (!format) {
    throw unsupported(
      `"${ref.name}" is not an image OneStop can open. Use JPG, PNG, WebP, GIF, BMP, TIFF, AVIF or HEIC.`,
    );
  }
  if (format === "bmp" || format === "heic") {
    const decoded = format === "bmp" ? decodeBmp(bytes) : await decodeHeic(bytes);
    const raw = { width: decoded.width, height: decoded.height, channels: 4 as const };
    const hasAlpha = format === "bmp" && "hasAlpha" in decoded ? Boolean(decoded.hasAlpha) : false;
    return {
      ref,
      bytes,
      format,
      source: decoded.data,
      raw,
      animated: false,
      width: raw.width,
      height: raw.height,
      hasAlpha,
    };
  }
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let meta: Metadata;
  try {
    meta = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, animated: true }).metadata();
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      throw unsupported(
        "This image is too large to process. Try a smaller image (under 120 megapixels).",
      );
    }
    throw unsupported(`"${ref.name}" could not be read. It may be damaged.`, err);
  }
  const pages = meta.pages ?? 1;
  const frameHeight = pages > 1 ? (meta.pageHeight ?? meta.height ?? 0) : (meta.height ?? 0);
  const swap = (meta.orientation ?? 1) >= 5;
  const width = meta.width ?? 0;
  if (width * frameHeight > MAX_INPUT_PIXELS) {
    throw unsupported(
      "This image is too large to process. Try a smaller image (under 120 megapixels).",
    );
  }
  return {
    ref,
    bytes,
    format,
    source,
    animated: pages > 1 && ANIMATED_FORMATS.includes(format),
    width: swap ? frameHeight : width,
    height: swap ? width : frameHeight,
    hasAlpha: Boolean(meta.hasAlpha),
  };
}

export async function readImages(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  { min = 1, max = Infinity }: { min?: number; max?: number } = {},
): Promise<ImageInput[]> {
  if (!ctx)
    throw new PdfToolError("FAILED", "This tool could not read your image. Please try again.");
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} images.` : "Choose an image first.");
  }
  if (input.length > max) throw unsupported(`Choose at most ${max} images.`);
  const out: ImageInput[] = [];
  for (const ref of input) {
    throwIfAborted(ctx.signal);
    out.push(await toImageInput(ref, await ctx.readFile(ref)));
  }
  return out;
}

export async function readImage(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
): Promise<ImageInput> {
  const [first] = await readImages(input, ctx, { max: 1 });
  return first!;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PdfToolError("FAILED", "Cancelled.");
}

/**
 * A sharp pipeline for the image, upright (EXIF orientation applied). `animated` keeps every frame
 * of a GIF/WebP; tools that composite or reshape pass false and work on the first frame.
 */
export function open(image: ImageInput, { animated = false }: { animated?: boolean } = {}): Sharp {
  if (image.raw) return sharp(image.source, { raw: image.raw, limitInputPixels: MAX_INPUT_PIXELS });
  return sharp(image.source, {
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: animated && image.animated,
  }).autoOrient();
}

/** The upright first frame as RGBA pixels. */
export async function rgba(
  image: ImageInput | Sharp,
): Promise<{ data: Buffer; width: number; height: number }> {
  const pipeline = "clone" in image ? image : open(image);
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Wraps RGBA pixels back into sharp. */
export function fromRgba(data: Buffer, width: number, height: number): Sharp {
  return sharp(data, { raw: { width, height, channels: 4 }, limitInputPixels: MAX_INPUT_PIXELS });
}

// ---- outputs ----------------------------------------------------------------------------------

export interface EncodeOptions {
  /** 1–100. */
  quality?: number;
  /** Background for formats without alpha (JPG, BMP). */
  background?: Rgba;
  /** Frame delay for animated GIF/WebP, in ms. */
  delay?: number | number[];
  loop?: number;
  /** PNG: reduce to a palette (much smaller, slightly lossy). */
  palette?: boolean;
  /** Maximum encoder effort (slower, smaller). */
  effort?: "fast" | "max";
  /** Keep the ICC colour profile (Remove Metadata keeps it by default so colours don't shift). */
  keepIcc?: boolean;
}

/** Encodes a pipeline into a format. No metadata is carried over unless asked (privacy default). */
export async function encode(
  pipeline: Sharp,
  format: ImageFormat,
  opts: EncodeOptions = {},
): Promise<Buffer> {
  const quality = opts.quality ?? (format === "jpg" ? 88 : 90);
  const max = opts.effort === "max";
  let p = pipeline;
  if (opts.keepIcc) p = p.keepIccProfile();
  if (!ALPHA_FORMATS.includes(format))
    p = p.flatten({ background: rgbaObject(opts.background ?? WHITE) });
  const anim = {
    ...(opts.delay !== undefined ? { delay: opts.delay } : {}),
    ...(opts.loop !== undefined ? { loop: opts.loop } : {}),
  };
  switch (format) {
    case "jpg":
      return p.jpeg({ quality, mozjpeg: true }).toBuffer();
    case "png":
      return p
        .png(
          opts.palette
            ? { palette: true, quality, effort: max ? 10 : 7, compressionLevel: 9 }
            : { compressionLevel: max ? 9 : 6, adaptiveFiltering: max },
        )
        .toBuffer();
    case "webp":
      return p.webp({ quality, effort: max ? 6 : 4, alphaQuality: 100, ...anim }).toBuffer();
    case "gif":
      return p.gif({ effort: max ? 10 : 7, ...anim }).toBuffer();
    case "tiff":
      return p.tiff({ compression: "lzw" }).toBuffer();
    case "avif":
      return p.avif({ quality: Math.min(100, quality), effort: max ? 7 : 4 }).toBuffer();
    case "bmp": {
      const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return encodeBmp(data, info.width, info.height);
    }
  }
}

/**
 * The format a tool writes when it keeps "the same format". HEIC can't be written without a
 * patent-encumbered encoder, so it becomes JPG; anything that gained transparency and can't hold
 * it becomes PNG.
 */
export function sameFormat(
  image: ImageInput,
  { needsAlpha = false }: { needsAlpha?: boolean } = {},
): ImageFormat {
  const base: ImageFormat = image.format === "heic" ? "jpg" : image.format;
  if (needsAlpha && !ALPHA_FORMATS.includes(base)) return "png";
  return base;
}

export function outputName(image: ImageInput, suffix: string, format: ImageFormat): string {
  const stem = baseName(image.ref.name);
  return `${stem}${suffix ? `-${suffix}` : ""}.${format}`;
}

export function outFile(name: string, format: ImageFormat, bytes: Uint8Array): OutputFile {
  return { name, mimeType: MIME[format], bytes };
}

const PACKAGING = ["zip", "files"] as const;

/** One result as-is; several as one ZIP unless the user asked for separate downloads. */
export function packageFiles(
  files: OutputFile[],
  options: Record<string, unknown>,
  zipStem: string,
): OutputFile[] {
  if (files.length <= 1) return files;
  if (optEnum(options, "packaging", PACKAGING, "zip") === "files") return files;
  return [{ name: `${zipStem}.zip`, mimeType: ZIP_MIME, bytes: createZip(files) }];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function countLabel(files: number): string {
  return plural(files, "image");
}

export function assertOutputSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw unsupported("The result would be empty. Check the sizes you entered.");
  }
  if (width * height > MAX_OUTPUT_PIXELS) {
    throw unsupported(
      `The result would be ${Math.round(width)} × ${Math.round(height)} pixels, which is too large. Keep it under 100 megapixels.`,
    );
  }
}

// ---- colours ----------------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1. */
  alpha: number;
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, alpha: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, alpha: 1 };
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, alpha: 0 };

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  red: "#e53935",
  green: "#43a047",
  blue: "#1e88e5",
  yellow: "#fdd835",
  orange: "#fb8c00",
  purple: "#8e24aa",
  pink: "#d81b60",
  gray: "#808080",
  grey: "#808080",
};

/** "#abc", "#aabbcc", "#aabbccdd", a CSS colour name from a short list, or "transparent". */
export function parseColor(text: string, fallback: Rgba): Rgba {
  const raw = text.trim().toLowerCase();
  if (raw === "") return fallback;
  if (raw === "transparent" || raw === "none") return TRANSPARENT;
  const hex = (NAMED[raw] ?? raw).replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) {
    throw unsupported(
      `"${text}" is not a colour. Use a hex code like #ff8800 or a name like white.`,
    );
  }
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

export function rgbaObject(c: Rgba): { r: number; g: number; b: number; alpha: number } {
  return { r: c.r, g: c.g, b: c.b, alpha: c.alpha };
}

export function cssColor(c: Rgba): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.alpha})`;
}

/** Multiplies an image's alpha channel by `opacity` (0–1). */
export function withOpacity(pipeline: Sharp, opacity: number): Sharp {
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return pipeline.ensureAlpha().composite([
    {
      input: Buffer.from([255, 255, 255, a]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: "dest-in",
    },
  ]);
}

// ---- executors --------------------------------------------------------------------------------

export interface ImageResult {
  file: OutputFile;
  /** One short sentence about this image, collected into the summary. */
  note?: string;
}

/**
 * The shape shared by most tools: every input image in, one result image out each, packaged as
 * a ZIP when there are several. `perImage` is also what workflows (phase 15) call in isolation.
 */
export function eachImage(
  toolId: string,
  perImage: (
    image: ImageInput,
    options: Record<string, unknown>,
    ctx: ExecContext,
  ) => Promise<ImageResult>,
  { verb, zipStem = toolId, max = 50 }: { verb: string; zipStem?: string; max?: number },
): (
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx?: ExecContext,
) => Promise<ExecResult> {
  return (input, options, ctx) =>
    runImageTool(toolId, async () => {
      const images = await readImages(input, ctx, { max });
      const results: ImageResult[] = [];
      for (const image of images) {
        throwIfAborted(ctx!.signal);
        results.push(await perImage(image, options, ctx!));
      }
      const files = packageFiles(
        results.map((r) => r.file),
        options,
        zipStem,
      );
      const notes = [...new Set(results.map((r) => r.note).filter((n): n is string => Boolean(n)))];
      const head = `${verb} ${countLabel(results.length)}.`;
      return {
        ok: true,
        output: { images: results.map((r) => ({ name: r.file.name, size: r.file.bytes.length })) },
        summary: [head, ...(results.length === 1 ? notes : notes.slice(0, 3))].join(" "),
        files,
      };
    });
}

/** Output dimensions of an encoded image. */
export async function dimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  return { width: meta.width ?? 0, height: meta.pageHeight ?? meta.height ?? 0 };
}
