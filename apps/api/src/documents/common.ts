// Shared plumbing for the Word & PowerPoint tools (07-word-ppt-tools.md): reading inputs, telling
// formats apart, the LibreOffice-only legacy formats, selections and the error contract.
//
// Error handling mirrors the PDF tools: anything the user can act on is a `PdfToolError` (the
// shared "tool error" type — the name is historical), and `runDocTool` turns every throw into the
// pipeline's `ExecResult`, so no stack trace reaches the UI (CLAUDE.md §7).
import type { ExecErrorCode, ExecResult } from "@onestop/types";
import type { ExecContext, FileRef, OutputFile } from "@onestop/types";
import mammoth from "mammoth";
import { PdfToolError } from "../pdf/errors.ts";
import { extractPdfText } from "../pdf/toText.ts";
import { looksLikePdf } from "../pdf/document.ts";
import { convertWithLibreOffice, findLibreOffice } from "../shared/libreoffice.ts";
import { OfficeConvertError } from "../shared/office-convert.ts";
import { rtfToText } from "../shared/office/rtf.ts";
import { odtToText } from "../shared/office/odt.ts";

export { PdfToolError as DocToolError } from "../pdf/errors.ts";

export const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
} as const;

/** Shown wherever a result comes from a local, non-AI method that phase 16 can upgrade. */
export const AI_UPGRADE_NOTE =
  "Quality will improve once the AI Assistant is set up — this result uses OneStop's built-in offline method.";

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export async function runDocTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[documents:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (err instanceof OfficeConvertError) {
      if (err.detail !== undefined) console.error(`[documents:${toolId}]`, err.message, err.detail);
      return { ok: false, code: "UNSUPPORTED_INPUT", message: err.message };
    }
    console.error(`[documents:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This document could not be processed. Please try again.",
    };
  }
}

// ---- inputs -----------------------------------------------------------------------------------

export interface DocInput {
  ref: FileRef;
  bytes: Uint8Array;
  /** Lower-case extension, trusted because phase 04 checked it against the magic bytes. */
  ext: string;
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.trim() === "" ? "document" : stem;
}

export async function readDocInputs(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  { min = 1, what = "document" }: { min?: number; what?: string } = {},
): Promise<DocInput[]> {
  if (!ctx)
    throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} ${what}s.` : `Choose a ${what} first.`);
  }
  const out: DocInput[] = [];
  for (const ref of input) out.push({ ref, bytes: await ctx.readFile(ref), ext: extOf(ref.name) });
  return out;
}

export async function readSingleDoc(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  what = "document",
): Promise<DocInput> {
  const [file] = await readDocInputs(input, ctx, { what });
  return file!;
}

/** Tools that take typed text *or* a file (Grammar Checker, Text Formatter): the text either way. */
export async function readTextInput(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  signal?: AbortSignal,
): Promise<{ text: string; name: string; source: string }> {
  if (typeof input === "string") {
    if (input.trim() === "") throw unsupported("Enter some text first.");
    return { text: input, name: "text", source: "text" };
  }
  const file = await readSingleDoc(input, ctx);
  return {
    text: await documentText(file, signal),
    name: baseName(file.ref.name),
    source: file.ext,
  };
}

// ---- legacy formats ---------------------------------------------------------------------------

const LEGACY_LABEL: Record<string, string> = {
  doc: "Word 97-2003 (.doc)",
  odt: "OpenDocument (.odt)",
  rtf: "RTF",
  ppt: "PowerPoint 97-2003 (.ppt)",
  odp: "OpenDocument (.odp)",
};

/**
 * The file as .docx / .pptx. Legacy and OpenDocument formats go through LibreOffice when it is
 * installed; without it the user gets an actionable message instead of a crash.
 */
export async function ensureOoxml(
  file: DocInput,
  to: "docx" | "pptx",
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; converted: boolean }> {
  if (file.ext === to) return { bytes: file.bytes, converted: false };
  const label = LEGACY_LABEL[file.ext] ?? `.${file.ext}`;
  if (!findLibreOffice()) {
    throw unsupported(
      `Working with ${label} files needs LibreOffice, which isn't installed. Install it free from libreoffice.org, or save the file as .${to} and try again.`,
    );
  }
  try {
    const bytes = await convertWithLibreOffice(file.bytes, file.ext, to, signal ? { signal } : {});
    return { bytes, converted: true };
  } catch (err) {
    throw unsupported(
      `This ${label} file could not be opened. It may be damaged or password protected.`,
      err,
    );
  }
}

/** Plain text of any document the text tools accept. */
export async function documentText(file: DocInput, signal?: AbortSignal): Promise<string> {
  switch (file.ext) {
    case "txt":
    case "text":
    case "md":
      return decodeText(file.bytes);
    case "rtf":
      return rtfToText(file.bytes);
    case "odt":
      return odtToText(file.bytes);
    case "pdf": {
      if (!looksLikePdf(file.bytes)) throw unsupported("This PDF could not be read.");
      const pages = await extractPdfText(file.bytes, signal ? { signal } : {});
      const text = pages.map((p) => p.text).join("\n\n");
      if (text.trim() === "") {
        throw unsupported("No text was found — this PDF looks like a scan. Run OCR PDF first.");
      }
      return text;
    }
    default: {
      const { bytes } = await ensureOoxml(file, "docx", signal);
      return docxText(bytes);
    }
  }
}

export async function docxText(bytes: Uint8Array): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (err) {
    throw unsupported("This Word document could not be read. It may be damaged.", err);
  }
}

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8;
}

// ---- options & selections ---------------------------------------------------------------------

export function optString(options: Record<string, unknown>, key: string, fallback = ""): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

export function optEnum<T extends string>(
  options: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = options[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function optNumber(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const raw = options[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function optBool(options: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = options[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function assertSlide(n: number, count: number, noun: string): void {
  if (!Number.isInteger(n) || n < 1 || n > count) {
    throw unsupported(
      count === 1
        ? `This file has only 1 ${noun}, so ${noun} ${n} does not exist.`
        : `This file has ${count} ${noun}s, so ${noun} ${n} does not exist.`,
    );
  }
}

/** `1-3, 5, 9-`, `odd`, `even`, `first`, `last` → sorted unique 1-based numbers. */
export function parseSelection(spec: string, count: number, noun = "slide"): number[] {
  const raw = spec.trim().toLowerCase();
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if (raw === "" || raw === "all") return all;
  if (raw === "odd") return all.filter((n) => n % 2 === 1);
  if (raw === "even") return all.filter((n) => n % 2 === 0);
  const picked = new Set<number>();
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    if (part === "first" || part === "last") {
      picked.add(part === "first" ? 1 : count);
      continue;
    }
    const range = /^(\d+)?-(\d+)?$/.exec(part);
    if (range && (range[1] || range[2])) {
      const from = range[1] ? Number(range[1]) : 1;
      const to = range[2] ? Number(range[2]) : count;
      assertSlide(from, count, noun);
      assertSlide(to, count, noun);
      if (from > to) throw unsupported(`"${part}" is not a valid ${noun} range.`);
      for (let n = from; n <= to; n += 1) picked.add(n);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw unsupported(`"${part}" is not a ${noun} number. Use something like 1-3, 5.`);
    }
    assertSlide(Number(part), count, noun);
    picked.add(Number(part));
  }
  if (picked.size === 0) throw unsupported(`Choose at least one ${noun}.`);
  return [...picked].sort((a, b) => a - b);
}

/** An explicit order (`3,1,2`, `5-1`, `reverse`); anything left out keeps its place at the end. */
export function parseOrder(spec: string, count: number, noun = "slide"): number[] {
  const raw = spec.trim().toLowerCase();
  const natural = Array.from({ length: count }, (_, i) => i + 1);
  if (raw === "reverse") return natural.reverse();
  if (raw === "") throw unsupported(`Enter the new ${noun} order, for example 3,1,2.`);
  const order: number[] = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      assertSlide(from, count, noun);
      assertSlide(to, count, noun);
      const step = from <= to ? 1 : -1;
      for (let n = from; step > 0 ? n <= to : n >= to; n += step) order.push(n);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw unsupported(`"${part}" is not a ${noun} number. Use something like 3,1,2.`);
    }
    assertSlide(Number(part), count, noun);
    order.push(Number(part));
  }
  const seen = new Set<number>();
  for (const n of order) {
    if (seen.has(n))
      throw unsupported(`${noun[0]!.toUpperCase()}${noun.slice(1)} ${n} is listed twice.`);
    seen.add(n);
  }
  return [...order, ...natural.filter((n) => !seen.has(n))];
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function slugPart(text: string, max = 40): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "part"
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textFile(name: string, text: string): OutputFile {
  return { name, mimeType: MIME.txt, bytes: new TextEncoder().encode(text) };
}
