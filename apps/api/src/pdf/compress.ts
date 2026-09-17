// Compress PDF (Features 1.14).
//
// Two strategies, because PDFs get big for two different reasons:
//
//   "light"    — structural only. Rebuild the document so unreferenced objects are dropped, pack
//                everything into object streams, strip metadata. Lossless; text stays text.
//   "balanced" / "strong"
//              — the page is re-rendered at a chosen DPI and stored as a JPEG. This is what
//                actually shrinks a scan-heavy or image-heavy PDF, at the cost of selectable text.
//
// Whatever happens, the result is only offered if it is genuinely smaller than the input.
import { PDFDocument } from "pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  formatBytes,
  loadPdf,
  optBool,
  optEnum,
  outputName,
  PDF_MIME,
  readPdfInputs,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";
import { renderPage, withPdfJs } from "./render.ts";

export const COMPRESS_PDF_TOOL_ID = "compress-pdf";

const LEVELS = ["light", "balanced", "strong"] as const;
export type CompressionLevel = (typeof LEVELS)[number];

/** Rasterisation settings per level. `light` never rasterises. */
const RASTER: Record<Exclude<CompressionLevel, "light">, { dpi: number; quality: number }> = {
  balanced: { dpi: 120, quality: 0.7 },
  strong: { dpi: 80, quality: 0.45 },
};

/** Lossless pass: copy every page into a fresh document and drop the metadata. */
export async function repackPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, source.getPageIndices());
  for (const page of pages) out.addPage(page);
  out.setProducer("OneStop");
  out.setCreationDate(new Date());
  return savePdf(out);
}

/** Lossy pass: every page becomes a JPEG at its original point size. */
async function rasterisePdf(
  bytes: Uint8Array,
  level: Exclude<CompressionLevel, "light">,
  grayscale: boolean,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const { dpi, quality } = RASTER[level];
  return withPdfJs(bytes, async (doc) => {
    const out = await PDFDocument.create();
    for (let n = 1; n <= doc.numPages; n += 1) {
      throwIfAborted(signal);
      const rendered = await renderPage(doc, n, { dpi, format: "jpg", quality, grayscale });
      const image = await out.embedJpg(rendered.bytes);
      const page = out.addPage([rendered.pointWidth, rendered.pointHeight]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: rendered.pointWidth,
        height: rendered.pointHeight,
      });
    }
    out.setProducer("OneStop");
    out.setCreationDate(new Date());
    return savePdf(out);
  });
}

export interface CompressionResult {
  name: string;
  original: number;
  compressed: number;
  percent: number;
  method: "structural" | "rasterised" | "none";
}

/** Compresses one document's bytes. Exported so phase 06 can reuse it after its own edits. */
export async function compressPdfBytes(
  bytes: Uint8Array,
  level: CompressionLevel,
  grayscale: boolean,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; method: CompressionResult["method"] }> {
  const original = bytes.length;
  // The lossless pass is cheap and sometimes wins outright, so it always runs.
  let best = await repackPdf(bytes);
  let method: CompressionResult["method"] = best.length < original ? "structural" : "none";

  if (level !== "light") {
    const rasterised = await rasterisePdf(bytes, level, grayscale, signal);
    if (rasterised.length < best.length) {
      best = rasterised;
      method = "rasterised";
    }
  }
  if (best.length >= original) return { bytes, method: "none" };
  return { bytes: best, method };
}

export const compressPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(COMPRESS_PDF_TOOL_ID, async () => {
    const inputs = await readPdfInputs(input, ctx);
    const level = optEnum(options, "level", LEVELS, "balanced");
    const grayscale = optBool(options, "grayscale", false);

    const results: CompressionResult[] = [];
    const files = [];
    for (const file of inputs) {
      throwIfAborted(ctx?.signal);
      const original = file.bytes.length;
      const { bytes, method } = await compressPdfBytes(file.bytes, level, grayscale, ctx?.signal);
      results.push({
        name: file.ref.name,
        original,
        compressed: bytes.length,
        percent: original === 0 ? 0 : Math.round(((original - bytes.length) / original) * 100),
        method,
      });
      files.push({
        name: outputName(file.ref.name, "compressed"),
        mimeType: PDF_MIME,
        bytes,
      });
    }

    const totalBefore = results.reduce((sum, r) => sum + r.original, 0);
    const totalAfter = results.reduce((sum, r) => sum + r.compressed, 0);
    const percent =
      totalBefore === 0 ? 0 : Math.round(((totalBefore - totalAfter) / totalBefore) * 100);
    const rasterised = results.some((r) => r.method === "rasterised");

    return {
      ok: true,
      output: { level, grayscale, results, totalBefore, totalAfter, percent },
      summary:
        percent <= 0
          ? `Already compact (${formatBytes(totalBefore)}); nothing worth removing was found.`
          : `${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (${percent}% smaller)${
              rasterised ? ". Pages were re-rendered, so text is no longer selectable." : "."
            }`,
      files,
    };
  });
