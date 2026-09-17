// Split PDF (Features 1.9) — break one PDF into several.
//
// Three modes, because "split" means different things: one file per page, fixed-size chunks, or
// explicit ranges. More than one result is packed into a ZIP by default so the user gets a single
// download instead of forty links.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  baseName,
  loadPdf,
  optEnum,
  optNumber,
  optString,
  parsePageSelection,
  PDF_MIME,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { copySelectedPages } from "./extractPages.ts";
import { createZip, ZIP_MIME } from "./zip.ts";

export const SPLIT_PDF_TOOL_ID = "split-pdf";

const MODES = ["each-page", "every-n", "ranges"] as const;
const PACKAGING = ["zip", "files"] as const;

/** The page groups a split produces, as 1-based page numbers. */
export function splitGroups(
  mode: (typeof MODES)[number],
  pageCount: number,
  { size, ranges }: { size: number; ranges: string },
): number[][] {
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  if (mode === "each-page") return all.map((n) => [n]);
  if (mode === "every-n") {
    const step = Math.max(1, Math.floor(size));
    const groups: number[][] = [];
    for (let i = 0; i < all.length; i += step) groups.push(all.slice(i, i + step));
    return groups;
  }
  const specs = ranges
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (specs.length === 0) {
    throw unsupported("Enter the ranges to split into, for example 1-3, 4-8.");
  }
  return specs.map((spec) => parsePageSelection(spec, pageCount));
}

export const splitPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(SPLIT_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pageCount = doc.getPageCount();

    const mode = optEnum(options, "mode", MODES, "each-page");
    const groups = splitGroups(mode, pageCount, {
      size: optNumber(options, "size", 1, { min: 1, max: 5000 }),
      ranges: optString(options, "ranges"),
    });

    if (groups.length === 1 && pageCount === 1) {
      const bytes = await savePdf(doc);
      return {
        ok: true,
        output: { parts: 1, pageCount },
        summary: "This PDF has a single page, so there was nothing to split.",
        files: [{ name: `${baseName(file.ref.name)}-part-1.pdf`, mimeType: PDF_MIME, bytes }],
      };
    }

    const stem = baseName(file.ref.name);
    const width = String(groups.length).length;
    const parts: OutputFile[] = [];
    for (const [index, pages] of groups.entries()) {
      throwIfAborted(ctx?.signal);
      const part = await copySelectedPages(doc, pages);
      parts.push({
        name: `${stem}-part-${String(index + 1).padStart(width, "0")}.pdf`,
        mimeType: PDF_MIME,
        bytes: await savePdf(part),
      });
    }

    const packaging = optEnum(options, "packaging", PACKAGING, "zip");
    const files =
      packaging === "zip" && parts.length > 1
        ? [
            {
              name: `${stem}-split.zip`,
              mimeType: ZIP_MIME,
              bytes: createZip(parts.map((p) => ({ name: p.name, bytes: p.bytes }))),
            },
          ]
        : parts;

    return {
      ok: true,
      output: {
        parts: parts.length,
        pageCount,
        groups: groups.map((g) => g.join(",")),
        packaging: files.length === 1 && packaging === "zip" && parts.length > 1 ? "zip" : "files",
      },
      summary: `Split ${pageCount} pages into ${parts.length} PDF${parts.length === 1 ? "" : "s"}.`,
      files,
    };
  });
