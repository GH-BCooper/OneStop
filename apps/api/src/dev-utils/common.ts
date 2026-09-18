// Shared plumbing for the developer & file utilities (12-dev-utility-tools.md).
//
// These tools are deliberately small: the shared parts are the error contract (identical to
// phases 05-11 — every user-actionable failure is a `PdfToolError`, and `runUtilTool` turns each
// throw into the pipeline's `ExecResult`, so no stack trace reaches the UI), reading an input
// that may be a file *or* pasted text, and writing a text result out as a downloadable file.
import type { ExecErrorCode, ExecResult, ExecContext, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { baseName, decodeText, extOf } from "../documents/common.ts";

export { baseName, decodeText, extOf };
export { optBool, optEnum, optNumber, optString, plural } from "../documents/common.ts";
export { PdfToolError as UtilToolError } from "../pdf/errors.ts";

export const MIME = {
  txt: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  zip: "application/zip",
  bin: "application/octet-stream",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export async function runUtilTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[dev-utils:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (err instanceof RangeError && /memory|Invalid (string|array) length/i.test(err.message)) {
      console.error(`[dev-utils:${toolId}] too large`, err);
      return {
        ok: false,
        code: "FAILED",
        message: "This file is too large to process in one go. Split it into smaller parts first.",
      };
    }
    console.error(`[dev-utils:${toolId}] unexpected failure`, err);
    return { ok: false, code: "FAILED", message: "This could not be processed. Please try again." };
  }
}

// ---- inputs -----------------------------------------------------------------------------------

export interface UtilFile {
  ref: FileRef;
  bytes: Uint8Array;
  /** Lower-case extension (phase 04 already checked it against the content). */
  ext: string;
  /** File name without its extension. */
  name: string;
}

export async function readFiles(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  { min = 1, what = "file" }: { min?: number; what?: string } = {},
): Promise<UtilFile[]> {
  if (!ctx)
    throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} ${what}s.` : `Choose a ${what} first.`);
  }
  const out: UtilFile[] = [];
  for (const ref of input) {
    out.push({
      ref,
      bytes: await ctx.readFile(ref),
      ext: extOf(ref.name),
      name: baseName(ref.name),
    });
  }
  return out;
}

export async function readOneFile(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  what = "file",
): Promise<UtilFile> {
  const [file] = await readFiles(input, ctx, { what });
  return file!;
}

export interface TextSource {
  text: string;
  /** Output stem: the uploaded file's name, or a generic one for pasted text. */
  name: string;
  pasted: boolean;
  ext: string;
}

/** Tools that take a file *or* pasted text (most of the formatters and encoders). */
export async function readTextSource(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  what: string,
  { stem = "input" }: { stem?: string } = {},
): Promise<TextSource> {
  if (typeof input === "string") {
    if (input.trim() === "") throw unsupported(`Paste some ${what} or choose a file first.`);
    return { text: input, name: stem, pasted: true, ext: "" };
  }
  const file = await readOneFile(input, ctx, `${what} file`);
  const text = decodeText(file.bytes);
  if (text.trim() === "") throw unsupported(`This ${what} file is empty.`);
  return { text, name: file.name, pasted: false, ext: file.ext };
}

/** Typed text only (Regex Tester's sample, Timestamp Converter's value). */
export function requireText(input: FileRef[] | string | null, what: string): string {
  if (typeof input === "string" && input.trim() !== "") return input;
  throw unsupported(`Enter ${what} first.`);
}

// ---- outputs ----------------------------------------------------------------------------------

export function textFile(name: string, mimeType: string, text: string): OutputFile {
  return { name, mimeType, bytes: new TextEncoder().encode(text) };
}

/** A safe download name: the user's stem, stripped of anything a path could hide in. */
export function safeStem(stem: string, fallback = "file"): string {
  const cleaned = stem
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/^[-.\s]+|[-\s]+$/g, "");
  return cleaned === "" ? fallback : cleaned.slice(0, 80);
}

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
