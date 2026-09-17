// PDF → Images (Features 1.4 / 6.2) — export pages as PNG or JPG.
//
// Phase 06's PDF → PowerPoint and PDF → HTML are meant to call `renderPdfPages` rather than
// re-implement rasterisation (see the phase-05 build file's closing note).
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  baseName,
  optEnum,
  optNumber,
  optString,
  parsePageSelection,
  readSinglePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";
import { renderPage, withPdfJs, type ImageFormat, type RenderedPage } from "./render.ts";
import { createZip, ZIP_MIME } from "./zip.ts";

export const PDF_TO_IMAGES_TOOL_ID = "pdf-to-images";

const FORMATS = ["png", "jpg"] as const;
const PACKAGING = ["zip", "files"] as const;

export interface RenderPdfPagesOptions {
  pages?: string;
  format?: ImageFormat;
  dpi?: number;
  quality?: number;
  grayscale?: boolean;
  signal?: AbortSignal;
}

/** Renders the selected pages of a PDF. Shared with phase 06. */
export async function renderPdfPages(
  bytes: Uint8Array,
  {
    pages,
    format = "png",
    dpi = 150,
    quality = 0.85,
    grayscale = false,
    signal,
  }: RenderPdfPagesOptions = {},
): Promise<RenderedPage[]> {
  return withPdfJs(bytes, async (doc) => {
    const selected = parsePageSelection(pages, doc.numPages);
    const rendered: RenderedPage[] = [];
    for (const pageNumber of selected) {
      throwIfAborted(signal);
      rendered.push(await renderPage(doc, pageNumber, { dpi, format, quality, grayscale }));
    }
    return rendered;
  });
}

export const pdfToImagesExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(PDF_TO_IMAGES_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const format = optEnum(options, "format", FORMATS, "png");
    const dpi = optNumber(options, "dpi", 150, { min: 36, max: 600 });
    const quality = optNumber(options, "quality", 85, { min: 10, max: 100 }) / 100;

    const rendered = await renderPdfPages(file.bytes, {
      pages: optString(options, "pages"),
      format,
      dpi,
      quality,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });

    const stem = baseName(file.ref.name);
    const width = String(rendered.length).length;
    const images: OutputFile[] = rendered.map((page) => ({
      name: `${stem}-page-${String(page.pageNumber).padStart(Math.max(2, width), "0")}.${format}`,
      mimeType: format === "png" ? "image/png" : "image/jpeg",
      bytes: page.bytes,
    }));

    const packaging = optEnum(options, "packaging", PACKAGING, "zip");
    const files =
      packaging === "zip" && images.length > 1
        ? [
            {
              name: `${stem}-images.zip`,
              mimeType: ZIP_MIME,
              bytes: createZip(images.map((i) => ({ name: i.name, bytes: i.bytes }))),
            },
          ]
        : images;

    return {
      ok: true,
      output: {
        format,
        dpi,
        pageCount: rendered.length,
        pages: rendered.map((p) => ({
          page: p.pageNumber,
          width: p.width,
          height: p.height,
          bytes: p.bytes.length,
        })),
      },
      summary: `Exported ${rendered.length} page${rendered.length === 1 ? "" : "s"} as ${format.toUpperCase()} at ${dpi} DPI.`,
      files,
    };
  });
