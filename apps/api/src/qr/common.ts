// Shared plumbing for the QR tools (11-qr-tools.md): the error contract, reading the shared style
// options off a tool call, and turning a rendered code into the pipeline's output shape.
import type { ExecErrorCode, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { optEnum, optNumber, optString } from "../documents/common.ts";
import {
  QR_MIME,
  renderQr,
  type Ecc,
  type EyeShape,
  type ModuleShape,
  type QrFormat,
  type QrStyle,
  type RenderedQr,
} from "./generate.ts";
import { parsePayload } from "./formats.ts";

export { optBool, optEnum, optNumber, optString } from "../documents/common.ts";
export { unsupported } from "./formats.ts";

/** Every QR tool funnels its throws through here, so no stack trace ever reaches the UI. */
export async function runQrTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[qr:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    console.error(`[qr:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "The QR code could not be created. Please try again.",
    };
  }
}

export function requestedFormat(options: Record<string, unknown>): QrFormat {
  return optEnum<QrFormat>(options, "format", ["png", "svg"], "png");
}

/** Reads the shared style controls. Unknown or out-of-range values fall back to the default. */
export function styleFromOptions(options: Record<string, unknown>): Partial<QrStyle> {
  const style: Partial<QrStyle> = {
    size: optNumber(options, "size", 512, { min: 64, max: 4096 }),
    margin: optNumber(options, "margin", 4, { min: 0, max: 16 }),
    ecc: optEnum<Ecc>(options, "ecc", ["L", "M", "Q", "H"], "M"),
    dark: optString(options, "dark", "#000000"),
    light: optString(options, "light", "#ffffff"),
    moduleShape: optEnum<ModuleShape>(
      options,
      "moduleShape",
      ["square", "rounded", "dot"],
      "square",
    ),
    eyeShape: optEnum<EyeShape>(options, "eyeShape", ["square", "rounded", "circle"], "square"),
    eyeColor: optString(options, "eyeColor", ""),
    logo: optString(options, "logo", ""),
    logoScale: optNumber(options, "logoScale", 20, { min: 5, max: 30 }) / 100,
  };
  return style;
}

/** A safe file stem: the payload never contributes to the name of a file on disk. */
export function qrFileName(stem: string, format: QrFormat): string {
  const safe = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "qr-code";
  return `${safe.slice(0, 60)}.${format}`;
}

export function qrOutputFile(rendered: RenderedQr, stem: string): OutputFile {
  return {
    name: qrFileName(stem, rendered.format),
    mimeType: QR_MIME[rendered.format],
    bytes: rendered.bytes,
  };
}

export interface QrToolResultExtras {
  /** Extra fields merged into the tool's JSON output. */
  output?: Record<string, unknown>;
  /** Extra sentence appended to the summary. */
  note?: string;
}

/**
 * The shape every "make me a QR code" tool returns: the image to download, plus what the code
 * actually holds, so the user can check it without scanning and phases 15/16 can chain on it.
 */
export async function qrResult(
  text: string,
  options: Record<string, unknown>,
  stem: string,
  extras: QrToolResultExtras = {},
): Promise<ExecResult> {
  const format = requestedFormat(options);
  const rendered = await renderQr(text, styleFromOptions(options), format);
  const parsed = parsePayload(text);
  const file = qrOutputFile(rendered, stem);
  return {
    ok: true,
    output: {
      content: text,
      kind: parsed.kind,
      describes: parsed.label,
      version: rendered.matrix.version,
      modules: rendered.matrix.size,
      errorCorrection: rendered.matrix.ecc,
      format,
      ...extras.output,
    },
    summary: [
      `Made a ${rendered.style.size} px ${format.toUpperCase()} QR code (version ${rendered.matrix.version}, ${rendered.matrix.size}x${rendered.matrix.size} modules, error correction ${rendered.matrix.ecc}).`,
      extras.note,
    ]
      .filter(Boolean)
      .join(" "),
    files: [file],
  };
}

/** Pulls the typed text off a tool call; QR tools are text-first, so this is the common path. */
export function textInput(input: FileRef[] | string | null, what: string): string {
  if (typeof input === "string" && input.trim() !== "") return input;
  throw new PdfToolError("UNSUPPORTED_INPUT", `Enter ${what} first.`);
}

/** The single uploaded file for the file-based QR tools. */
export function oneFile(input: FileRef[] | string | null): FileRef {
  if (!Array.isArray(input) || input.length === 0) {
    throw new PdfToolError("UNSUPPORTED_INPUT", "Choose a file first.");
  }
  return input[0]!;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function mimeForName(name: string, fallback = "application/octet-stream"): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? fallback;
}

export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}
