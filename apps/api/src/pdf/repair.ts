// Repair PDF (Features 1.25) — try to recover a damaged or corrupt PDF.
//
// Four strategies, cheapest first. Each one is a real attempt, and the first that yields a
// document pdf-lib can re-save wins:
//
//   1. strict     — the file may simply be unusual rather than broken; re-saving normalises it.
//   2. tolerant   — pdf-lib, told not to throw on an invalid object.
//   3. salvage    — trim leading junk before `%PDF` and anything after the last `%%EOF`, retry.
//   4. rasterise  — pdf.js is far more forgiving than pdf-lib about broken cross-reference
//                   tables. If it can draw the pages, rebuild a readable PDF from them. Lossy
//                   (the text layer is gone), so the summary says so plainly.
import { PDFDocument } from "pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  findPdfHeader,
  formatBytes,
  loadPdf,
  outputName,
  PDF_MIME,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { PdfToolError, isEncryptionError, runPdfTool } from "./errors.ts";
import { renderPage, withPdfJs } from "./render.ts";

export const REPAIR_PDF_TOOL_ID = "repair-pdf";

export type RepairMethod = "already-valid" | "tolerant" | "salvaged" | "rasterised";

const EOF_MARKER = [0x25, 0x25, 0x45, 0x4f, 0x46]; // "%%EOF"

/** Trims anything before the `%PDF` header and after the final `%%EOF`. */
export function salvageBytes(bytes: Uint8Array): Uint8Array | null {
  const start = findPdfHeader(bytes);
  if (start < 0) return null;
  let end = -1;
  for (let i = bytes.length - EOF_MARKER.length; i >= start; i -= 1) {
    if (EOF_MARKER.every((b, j) => bytes[i + j] === b)) {
      end = i + EOF_MARKER.length;
      break;
    }
  }
  const sliced = bytes.subarray(start, end > start ? end : bytes.length);
  if (start === 0 && sliced.length === bytes.length) return null;
  return sliced;
}

async function tryLoad(bytes: Uint8Array, tolerant: boolean): Promise<PDFDocument | null> {
  try {
    return await loadPdf(bytes, { tolerant });
  } catch (err) {
    // A protected file is not a damaged one: say so instead of pretending to repair it.
    if (isEncryptionError(err)) throw err;
    return null;
  }
}

/** Last resort: redraw every page pdf.js can read into a fresh document. */
async function rasteriseRecovery(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<{ bytes: Uint8Array; pageCount: number; skipped: number[] } | null> {
  try {
    return await withPdfJs(
      bytes,
      async (doc) => {
        const out = await PDFDocument.create();
        const skipped: number[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          throwIfAborted(signal);
          try {
            const page = await renderPage(doc, n, { dpi: 150, format: "jpg", quality: 0.85 });
            const image = await out.embedJpg(page.bytes);
            const target = out.addPage([page.pointWidth, page.pointHeight]);
            target.drawImage(image, {
              x: 0,
              y: 0,
              width: page.pointWidth,
              height: page.pointHeight,
            });
          } catch {
            skipped.push(n);
          }
        }
        if (out.getPageCount() === 0) return null;
        out.setProducer("OneStop");
        out.setCreationDate(new Date());
        return { bytes: await savePdf(out), pageCount: out.getPageCount(), skipped };
      },
      { tolerant: true },
    );
  } catch (err) {
    if (isEncryptionError(err)) throw err;
    return null;
  }
}

export const repairPdfExecutor: Executor = async (input, _options, ctx) =>
  runPdfTool(REPAIR_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);

    const attempts: { method: RepairMethod; doc: PDFDocument | null }[] = [];
    attempts.push({ method: "already-valid", doc: await tryLoad(file.bytes, false) });
    if (!attempts[0]!.doc) {
      attempts.push({ method: "tolerant", doc: await tryLoad(file.bytes, true) });
    }
    if (!attempts.at(-1)!.doc) {
      const salvaged = salvageBytes(file.bytes);
      attempts.push({
        method: "salvaged",
        doc: salvaged ? await tryLoad(salvaged, true) : null,
      });
    }

    const winner = attempts.find((a) => a.doc);
    if (winner?.doc) {
      const bytes = await savePdf(winner.doc);
      const pageCount = winner.doc.getPageCount();
      return {
        ok: true,
        output: {
          method: winner.method,
          pageCount,
          originalBytes: file.bytes.length,
          repairedBytes: bytes.length,
        },
        summary:
          winner.method === "already-valid"
            ? `This PDF was already readable — it has been rewritten cleanly (${pageCount} page${pageCount === 1 ? "" : "s"}, ${formatBytes(bytes.length)}).`
            : `Repaired ${pageCount} page${pageCount === 1 ? "" : "s"} (${formatBytes(bytes.length)}). Check the result before deleting the original.`,
        files: [{ name: outputName(file.ref.name, "repaired"), mimeType: PDF_MIME, bytes }],
      };
    }

    const rasterised = await rasteriseRecovery(file.bytes, ctx?.signal);
    if (rasterised) {
      return {
        ok: true,
        output: {
          method: "rasterised" satisfies RepairMethod,
          pageCount: rasterised.pageCount,
          skippedPages: rasterised.skipped,
          originalBytes: file.bytes.length,
          repairedBytes: rasterised.bytes.length,
        },
        summary: `Recovered ${rasterised.pageCount} page${rasterised.pageCount === 1 ? "" : "s"} as images${
          rasterised.skipped.length > 0 ? `, ${rasterised.skipped.length} could not be read` : ""
        }. Text is no longer selectable.`,
        files: [
          {
            name: outputName(file.ref.name, "repaired"),
            mimeType: PDF_MIME,
            bytes: rasterised.bytes,
          },
        ],
      };
    }

    throw new PdfToolError(
      "UNSUPPORTED_INPUT",
      "This PDF is too damaged to recover. Try the original source file.",
    );
  });
