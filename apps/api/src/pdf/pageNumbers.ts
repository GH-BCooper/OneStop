// Add Page Numbers (Features 1.17).
//
// Numbers the selected pages in reading order, starting from any value, in one of four formats
// and nine positions. Drawn upright as the reader sees the page, even when it has a /Rotate.
import { rgb } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optBool,
  optEnum,
  optNumber,
  optString,
  outputName,
  parsePageSelection,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";
import { embedUnicodeFont } from "./fonts.ts";
import { plural } from "./inputs.ts";
import { anchorPoint, ANCHORS, drawTextCentered, visualFrame, type Anchor } from "./placement.ts";

export const ADD_PAGE_NUMBERS_TOOL_ID = "add-page-numbers-to-pdf";

export const PAGE_NUMBER_FORMATS = {
  number: "{n}",
  page: "Page {n}",
  "page-of": "Page {n} of {total}",
  slash: "{n} / {total}",
} as const;

export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replaceAll("{n}", String(n)).replaceAll("{total}", String(total));
}

export const addPageNumbersExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(ADD_PAGE_NUMBERS_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const formatKey = optEnum(
      options,
      "format",
      Object.keys(PAGE_NUMBER_FORMATS) as (keyof typeof PAGE_NUMBER_FORMATS)[],
      "number",
    );
    const position = optEnum(options, "position", ANCHORS, "bottom-center") as Anchor;
    const start = Math.round(optNumber(options, "start", 1, { min: 0, max: 100000 }));
    const size = optNumber(options, "fontSize", 11, { min: 6, max: 72 });
    const margin = optNumber(options, "margin", 28, { min: 0, max: 200 });
    const skipFirst = optBool(options, "skipFirst", false);

    const doc = await loadPdf(file.bytes);
    let selected = parsePageSelection(optString(options, "pages"), doc.getPageCount());
    if (skipFirst) selected = selected.filter((n) => n !== 1);
    const font = await embedUnicodeFont(doc);
    const total = start + selected.length - 1;
    const color = rgb(0.15, 0.15, 0.15);

    selected.forEach((pageNumber, index) => {
      const page = doc.getPage(pageNumber - 1);
      const frame = visualFrame(page);
      const label = formatPageNumber(PAGE_NUMBER_FORMATS[formatKey], start + index, total);
      const w = font.widthOfTextAtSize(label, size);
      const h = font.heightAtSize(size, { descender: false });
      const { cx, cy } = anchorPoint(frame, position, w, h, margin);
      drawTextCentered(page, frame, label, { cx, cy, font, size, color });
    });

    return {
      ok: true,
      output: {
        numbered: selected,
        first: start,
        last: total,
        format: PAGE_NUMBER_FORMATS[formatKey],
        position,
      },
      summary: `Numbered ${plural(selected.length, "page")} (${start}–${total}).`,
      files: [
        {
          name: outputName(file.ref.name, "numbered"),
          mimeType: PDF_MIME,
          bytes: await savePdf(doc),
        },
      ],
    };
  });
