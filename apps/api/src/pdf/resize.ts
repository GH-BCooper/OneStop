// Resize PDF (Features 1.15) — put the content of every page onto a new page size.
//
// The content is embedded as a form XObject and scaled, so text stays text (nothing is
// rasterised) and the aspect ratio is preserved unless the user asks for a stretch.
import { PDFDocument } from "pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optEnum,
  outputName,
  PDF_MIME,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";

export const RESIZE_PDF_TOOL_ID = "resize-pdf";

/** Page sizes in PDF points (1/72 inch), portrait. */
export const PAGE_SIZES = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

const SIZE_NAMES = Object.keys(PAGE_SIZES) as PageSizeName[];
const ORIENTATIONS = ["auto", "portrait", "landscape"] as const;
const MODES = ["fit", "stretch"] as const;

export function targetSize(
  size: PageSizeName,
  orientation: (typeof ORIENTATIONS)[number],
  source: { width: number; height: number },
): [number, number] {
  const [w, h] = PAGE_SIZES[size];
  const landscape =
    orientation === "landscape" || (orientation === "auto" && source.width > source.height);
  return landscape ? [h, w] : [w, h];
}

export const resizePdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(RESIZE_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const size = optEnum(options, "size", SIZE_NAMES, "a4");
    const orientation = optEnum(options, "orientation", ORIENTATIONS, "auto");
    const mode = optEnum(options, "mode", MODES, "fit");

    const out = await PDFDocument.create();
    const pages = doc.getPages();
    for (const [index, sourcePage] of pages.entries()) {
      throwIfAborted(ctx?.signal);
      const { width: sw, height: sh } = sourcePage.getSize();
      const [tw, th] = targetSize(size, orientation, { width: sw, height: sh });
      const embedded = await out.embedPage(doc.getPage(index));

      const page = out.addPage([tw, th]);
      if (mode === "stretch") {
        page.drawPage(embedded, { x: 0, y: 0, width: tw, height: th });
      } else {
        const scale = Math.min(tw / sw, th / sh);
        page.drawPage(embedded, {
          x: (tw - sw * scale) / 2,
          y: (th - sh * scale) / 2,
          width: sw * scale,
          height: sh * scale,
        });
      }
    }
    out.setProducer("OneStop");
    out.setCreationDate(new Date());

    const bytes = await savePdf(out);
    const [w, h] = targetSize(size, orientation, pages[0]!.getSize());
    return {
      ok: true,
      output: {
        size,
        orientation,
        mode,
        pageCount: out.getPageCount(),
        points: { width: Math.round(w), height: Math.round(h) },
      },
      summary: `Resized ${out.getPageCount()} page${out.getPageCount() === 1 ? "" : "s"} to ${size.toUpperCase()}.`,
      files: [{ name: outputName(file.ref.name, size), mimeType: PDF_MIME, bytes }],
    };
  });
