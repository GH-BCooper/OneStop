// Shared PDF primitives: reading input bytes, opening documents with pdf-lib, page selection and
// option parsing (05-pdf-tools-core.md).
//
// Phase 06's PDF↔Office conversions are meant to build on these rather than re-implement page
// handling, so everything here works on bytes and page indexes only — never on paths.
import { PDFDocument } from "@cantoo/pdf-lib";
import type { ExecContext, FileRef } from "@onestop/types";
import {
  damagedPdfError,
  isEncryptionError,
  PdfToolError,
  protectedPdfError,
  unsupported,
  wrongPasswordError,
} from "./errors.ts";

export const PDF_MIME = "application/pdf";

/** `%PDF` — every readable PDF starts with it (Repair PDF is the one tool that looks past it). */
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46];

export interface PdfInput {
  ref: FileRef;
  bytes: Uint8Array;
}

function requireContext(ctx: ExecContext | undefined): ExecContext {
  if (!ctx) {
    throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
  }
  return ctx;
}

/** Reads every uploaded file's validated bytes, in the order the user chose them. */
export async function readPdfInputs(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  { min = 1 }: { min?: number } = {},
): Promise<PdfInput[]> {
  const context = requireContext(ctx);
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} PDF files.` : "Choose a PDF file first.");
  }
  const files: PdfInput[] = [];
  for (const ref of input) {
    files.push({ ref, bytes: await context.readFile(ref) });
  }
  return files;
}

export async function readSinglePdf(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
): Promise<PdfInput> {
  const [file] = await readPdfInputs(input, ctx);
  if (!file) throw unsupported("Choose a PDF file first.");
  return file;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return PDF_HEADER.every((b, i) => bytes[i] === b);
}

/** Byte offset of the `%PDF` header, or -1. Used by Repair PDF to skip leading junk. */
export function findPdfHeader(bytes: Uint8Array, searchLimit = 4096): number {
  const limit = Math.min(bytes.length - PDF_HEADER.length, searchLimit);
  for (let i = 0; i <= limit; i += 1) {
    if (PDF_HEADER.every((b, j) => bytes[i + j] === b)) return i;
  }
  return -1;
}

export interface LoadPdfOptions {
  /** Keep a document pdf-lib considers structurally odd, rather than refusing it. */
  tolerant?: boolean;
  /**
   * The document's existing password. With it, an encrypted file is decrypted on load and saves
   * unencrypted (06-pdf-tools-advanced.md); without it, an encrypted file is refused.
   */
  password?: string;
}

/**
 * Opens a document with pdf-lib, turning its user-facing failure modes into clear messages:
 * an encrypted file, a wrong password and a damaged file. Never throws a raw pdf-lib error.
 */
export async function loadPdf(
  bytes: Uint8Array,
  { tolerant = false, password }: LoadPdfOptions = {},
): Promise<PDFDocument> {
  if (!looksLikePdf(bytes)) throw damagedPdfError("missing %PDF header");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: !tolerant,
      ...(password !== undefined ? { password } : {}),
    });
  } catch (err) {
    if (isEncryptionError(err)) {
      throw password !== undefined ? wrongPasswordError() : protectedPdfError();
    }
    throw damagedPdfError(err);
  }
  if (doc.isEncrypted) throw password !== undefined ? wrongPasswordError() : protectedPdfError();
  // A file can parse and still have an unusable catalogue; asking for the pages is what proves it.
  let pageCount: number;
  try {
    pageCount = doc.getPageCount();
  } catch (err) {
    throw damagedPdfError(err);
  }
  if (pageCount === 0) throw unsupported("This PDF has no pages.");
  return doc;
}

/** Strips a trailing extension so outputs can be named after their input. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem.trim() === "" ? "document" : stem;
}

export function outputName(fileName: string, suffix: string, extension = "pdf"): string {
  return `${baseName(fileName)}-${suffix}.${extension}`;
}

// ---- page selection ---------------------------------------------------------------------------

/**
 * Parses a page selection such as `1-3, 5, 9-` (1-based, inclusive) into sorted unique page
 * numbers. Also accepts `all`, `odd`, `even`, `first`, `last` and a bare `-` range end.
 * An empty selection means "every page". Out-of-range numbers raise an actionable error.
 */
export function parsePageSelection(spec: string | undefined, pageCount: number): number[] {
  const raw = (spec ?? "").trim().toLowerCase();
  const all = () => Array.from({ length: pageCount }, (_, i) => i + 1);
  if (raw === "" || raw === "all") return all();
  if (raw === "odd") return all().filter((n) => n % 2 === 1);
  if (raw === "even") return all().filter((n) => n % 2 === 0);

  const pages = new Set<number>();
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    if (part === "first") {
      pages.add(1);
      continue;
    }
    if (part === "last") {
      pages.add(pageCount);
      continue;
    }
    const range = /^(\d+)?\s*-\s*(\d+)?$/.exec(part);
    if (range) {
      const from = range[1] ? Number(range[1]) : 1;
      const to = range[2] ? Number(range[2]) : pageCount;
      assertInRange(from, pageCount);
      assertInRange(to, pageCount);
      if (from > to) throw unsupported(`"${part}" is not a valid page range.`);
      for (let n = from; n <= to; n += 1) pages.add(n);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw unsupported(`"${part}" is not a page number. Use something like 1-3, 5.`);
    }
    const n = Number(part);
    assertInRange(n, pageCount);
    pages.add(n);
  }
  if (pages.size === 0) throw unsupported("Choose at least one page.");
  return [...pages].sort((a, b) => a - b);
}

function assertInRange(n: number, pageCount: number): void {
  if (!Number.isInteger(n) || n < 1 || n > pageCount) {
    throw unsupported(
      pageCount === 1
        ? `This PDF has only 1 page, so page ${n} does not exist.`
        : `This PDF has ${pageCount} pages, so page ${n} does not exist.`,
    );
  }
}

/**
 * Parses an explicit page *order* (duplicates allowed, order preserved) — what Reorder PDF Pages
 * needs. Any page left out keeps its relative position at the end.
 */
export function parsePageOrder(spec: string | undefined, pageCount: number): number[] {
  const raw = (spec ?? "").trim().toLowerCase();
  if (raw === "" || raw === "reverse") {
    const order = Array.from({ length: pageCount }, (_, i) => i + 1);
    return raw === "reverse" ? order.reverse() : order;
  }
  const order: number[] = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      assertInRange(from, pageCount);
      assertInRange(to, pageCount);
      const step = from <= to ? 1 : -1;
      for (let n = from; step > 0 ? n <= to : n >= to; n += step) order.push(n);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw unsupported(`"${part}" is not a page number. Use something like 3,1,2.`);
    }
    const n = Number(part);
    assertInRange(n, pageCount);
    order.push(n);
  }
  if (order.length === 0) throw unsupported("Enter the page order, for example 3,1,2.");
  const missing = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (n) => !order.includes(n),
  );
  return [...order, ...missing];
}

// ---- option readers ---------------------------------------------------------------------------

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
  return Math.min(max, Math.max(min, value));
}

export function optBool(options: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = options[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Saves a document, always with object streams (smaller output, no behaviour change). */
export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Cancellation check for the long loops (rasterising, page-by-page copying). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PdfToolError("FAILED", "This took too long and was stopped.");
}
