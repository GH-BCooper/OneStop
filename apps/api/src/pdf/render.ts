// pdf.js + @napi-rs/canvas: the read/rasterise half of the PDF tools (05-pdf-tools-core.md).
//
// pdf-lib can rearrange pages but cannot read their content; pdf.js can read and draw them.
// Everything here is local — the standard fonts and CMaps are loaded from `node_modules`, and
// pdf.js is configured so it never evaluates PDF-supplied code and never fetches a URL.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PdfToolError, isEncryptionError } from "./errors.ts";
import { damagedPdfError } from "./errors.ts";

export type ImageFormat = "png" | "jpg";

export interface RenderOptions {
  /** Dots per inch. PDF user space is 72 dpi, so scale = dpi / 72. */
  dpi?: number;
  format?: ImageFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality?: number;
  grayscale?: boolean;
  /** Hard ceiling on either dimension, so a poster-sized page cannot exhaust memory. */
  maxPixels?: number;
}

export interface RenderedPage {
  pageNumber: number;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Page size in PDF points, for rebuilding a document at the original dimensions. */
  pointWidth: number;
  pointHeight: number;
}

/** Minimal structural view of the pdf.js API we use, so this file needs no `any`. */
interface PdfJsTextItem {
  str?: string;
  hasEOL?: boolean;
}
interface PdfJsViewport {
  width: number;
  height: number;
}
interface PdfJsPage {
  getViewport(params: { scale: number }): PdfJsViewport;
  getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
  render(params: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
}
export interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
}
interface PdfJsModule {
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfJsDocument>;
    destroy(): Promise<void>;
  };
  GlobalWorkerOptions: { workerSrc: string };
}

let modulePromise: Promise<PdfJsModule> | null = null;

let pdfJsRoot: string | null = null;

/**
 * Locates the installed `pdfjs-dist` directory by walking up from this module and from the
 * working directory. `require.resolve` is deliberately not used: once Next bundles this module
 * the bundler's `require` returns a module id, not a path.
 */
function findPdfJsRoot(): string {
  if (pdfJsRoot) return pdfJsRoot;
  const starts = [process.cwd()];
  try {
    starts.unshift(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // A bundled module may have no file URL; the working directory still resolves it.
  }
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const candidate = path.join(dir, "node_modules", "pdfjs-dist");
      if (existsSync(path.join(candidate, "standard_fonts"))) {
        pdfJsRoot = candidate;
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new PdfToolError(
    "FAILED",
    "PDF rendering is not available on this server. Please try again later.",
    "pdfjs-dist assets not found next to any parent node_modules",
  );
}

/** Absolute, forward-slashed path to a pdfjs-dist asset directory (pdf.js insists on a slash). */
function assetDir(name: string): string {
  return `${path.join(findPdfJsRoot(), name).split(path.sep).join("/")}/`;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  modulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<PdfJsModule>;
  return modulePromise;
}

export interface OpenPdfJsOptions {
  /** Repair PDF asks pdf.js to keep going on a broken cross-reference table. */
  tolerant?: boolean;
}

/**
 * Opens a document with pdf.js, runs `body`, and always releases the worker afterwards.
 * Password-protected and unreadable files come back as actionable `PdfToolError`s.
 */
export async function withPdfJs<T>(
  bytes: Uint8Array,
  body: (doc: PdfJsDocument) => Promise<T>,
  { tolerant = false }: OpenPdfJsOptions = {},
): Promise<T> {
  const pdfjs = await loadPdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy the caller still owns.
  const data = new Uint8Array(bytes);
  const task = pdfjs.getDocument({
    data,
    // Security: no eval of PDF-supplied function objects, no remote fetches, no scripting.
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    useSystemFonts: false,
    stopAtErrors: !tolerant,
    standardFontDataUrl: assetDir("standard_fonts"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    wasmUrl: assetDir("wasm"),
    iccUrl: assetDir("iccs"),
  });
  let doc: PdfJsDocument;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => undefined);
    if (isEncryptionError(err)) {
      throw new PdfToolError(
        "UNSUPPORTED_INPUT",
        "This PDF is password protected. Remove its password first, then try again.",
      );
    }
    throw damagedPdfError(err);
  }
  try {
    return await body(doc);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Plain text of one page, with pdf.js's end-of-line hints turned into real line breaks. */
export async function pageText(doc: PdfJsDocument, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    return text.replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    page.cleanup();
  }
}

export async function renderPage(
  doc: PdfJsDocument,
  pageNumber: number,
  {
    dpi = 150,
    format = "png",
    quality = 0.82,
    grayscale = false,
    maxPixels = 10000,
  }: RenderOptions = {},
): Promise<RenderedPage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    let scale = dpi / 72;
    const longest = Math.max(base.width, base.height) * scale;
    if (longest > maxPixels) scale *= maxPixels / longest;

    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    // JPEG has no alpha, so pages need an explicit white background or they come out black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({ canvasContext: context, viewport, canvas, background: "#ffffff" }).promise;

    if (grayscale) {
      const image = context.getImageData(0, 0, width, height);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
      }
      context.putImageData(image, 0, 0);
    }

    const buffer =
      format === "jpg"
        ? canvas.toBuffer("image/jpeg", Math.round(Math.min(1, Math.max(0.1, quality)) * 100))
        : canvas.toBuffer("image/png");

    return {
      pageNumber,
      bytes: new Uint8Array(buffer),
      width,
      height,
      pointWidth: base.width,
      pointHeight: base.height,
    };
  } finally {
    page.cleanup();
  }
}
