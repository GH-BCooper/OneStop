// Built-in PDF → Word / Excel / PowerPoint converters (06-pdf-tools-advanced.md).
//
// Pure JavaScript, fully local: `docx`, `exceljs` and `pptxgenjs` write the files; the text, its
// positions, sizes and weights come from pdf.js via `pdf/layout.ts`. Perfect fidelity is not the
// goal — editable, correctly ordered text with headings, table columns and page structure is.
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import {
  bodyFontSize,
  layoutFromDocument,
  toBlocks,
  toTable,
  type PageLayout,
} from "../../pdf/layout.ts";
import { renderPage, withPdfJs, type PdfJsDocument } from "../../pdf/render.ts";
import { parsePageSelection, throwIfAborted } from "../../pdf/document.ts";

export interface FromPdfOptions {
  pages?: string;
  /** "editable" rebuilds text; "exact" places each page as a picture (Word/PowerPoint only). */
  layout?: "editable" | "exact";
  /** Excel only: one worksheet per page, or everything on one sheet. */
  sheets?: "per-page" | "single";
  title?: string;
  signal?: AbortSignal;
}

export interface FromPdfResult {
  bytes: Uint8Array;
  pages: number;
  /** Number of text lines, rows or slides carried over — zero means "nothing to convert". */
  units: number;
}

async function withLayout<T>(
  bytes: Uint8Array,
  options: FromPdfOptions,
  body: (pdf: PdfJsDocument, pages: PageLayout[]) => Promise<T>,
): Promise<T> {
  return withPdfJs(bytes, async (pdf) => {
    const selected = parsePageSelection(options.pages, pdf.numPages);
    const pages = await layoutFromDocument(pdf, selected, options.signal);
    return body(pdf, pages);
  });
}

// ---- Word -------------------------------------------------------------------------------------

const HEADINGS = {
  heading1: HeadingLevel.HEADING_1,
  heading2: HeadingLevel.HEADING_2,
  heading3: HeadingLevel.HEADING_3,
} as const;

/** Twips (1/20 pt) for page sizes; EMU-free pixel sizes for pictures (docx uses 96 dpi px). */
const TWIPS = 20;

export async function pdfToDocx(
  bytes: Uint8Array,
  options: FromPdfOptions = {},
): Promise<FromPdfResult> {
  return withLayout(bytes, options, async (pdf, pages) => {
    const first = pages[0];
    const pageWidth = first?.width ?? 595;
    const pageHeight = first?.height ?? 842;
    const margin = 54;
    const children: Paragraph[] = [];
    let units = 0;

    if (options.layout === "exact") {
      for (const [i, page] of pages.entries()) {
        throwIfAborted(options.signal);
        const rendered = await renderPage(pdf, page.pageNumber, { dpi: 150, format: "png" });
        const maxW = ((pageWidth - margin * 2) / 72) * 96;
        const w = maxW;
        const h = (w * rendered.height) / rendered.width;
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            ...(i > 0 ? { pageBreakBefore: true } : {}),
            children: [
              new ImageRun({
                type: "png",
                data: rendered.bytes,
                transformation: { width: w, height: h },
              }),
            ],
          }),
        );
        units += 1;
      }
    } else {
      const body = bodyFontSize(pages);
      pages.forEach((page, i) => {
        const blocks = toBlocks(page, body);
        if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
        for (const block of blocks) {
          units += block.lines.length;
          // Headings take their weight and size from the Word heading style.
          const run =
            block.kind === "paragraph"
              ? new TextRun({
                  text: block.text,
                  bold: block.bold || undefined,
                  italics: block.italic || undefined,
                  size: Math.round(Math.min(Math.max(block.fontSize, 8), 28) * 2),
                })
              : new TextRun({ text: block.text, italics: block.italic || undefined });
          children.push(
            block.kind === "paragraph"
              ? new Paragraph({ children: [run], spacing: { after: 120 } })
              : new Paragraph({ heading: HEADINGS[block.kind], children: [run] }),
          );
        }
      });
    }

    const doc = new Document({
      creator: "OneStop",
      title: options.title ?? "Converted from PDF",
      sections: [
        {
          properties: {
            page: {
              size: {
                width: Math.round(pageWidth * TWIPS),
                height: Math.round(pageHeight * TWIPS),
              },
              margin: {
                top: margin * TWIPS,
                bottom: margin * TWIPS,
                left: margin * TWIPS,
                right: margin * TWIPS,
              },
            },
          },
          children: children.length ? children : [new Paragraph("")],
        },
      ],
    });
    return { bytes: new Uint8Array(await Packer.toBuffer(doc)), pages: pages.length, units };
  });
}

// ---- Excel ------------------------------------------------------------------------------------

const NUMBER_RE = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** "1,234.50" → 1234.5, "12%" → 0.12; anything else stays text. */
export function cellValue(text: string): string | number {
  const t = text.trim();
  const unwrapped = /^\((.+)\)$/.exec(t)?.[1];
  const candidate = (unwrapped ?? t).replace(/^[$€£¥]/, "");
  if (!NUMBER_RE.test(candidate)) return t;
  const n = Number(candidate.replace(/,/g, "").replace(/%$/, ""));
  if (!Number.isFinite(n)) return t;
  const value = candidate.endsWith("%") ? n / 100 : n;
  return unwrapped ? -value : value;
}

export async function pdfToXlsx(
  bytes: Uint8Array,
  options: FromPdfOptions = {},
): Promise<FromPdfResult> {
  return withLayout(bytes, options, async (_pdf, pages) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OneStop";
    workbook.title = options.title ?? "Converted from PDF";
    let units = 0;
    let single: ExcelJS.Worksheet | null = null;

    for (const page of pages) {
      const rows = toTable(page);
      if (rows.length === 0 && options.sheets !== "single") continue;
      const sheet =
        options.sheets === "single"
          ? (single ??= workbook.addWorksheet("PDF"))
          : workbook.addWorksheet(`Page ${page.pageNumber}`);
      for (const row of rows) {
        sheet.addRow(row.map(cellValue));
        units += 1;
      }
      if (options.sheets === "single" && rows.length) sheet.addRow([]);
    }
    for (const sheet of workbook.worksheets) {
      sheet.columns.forEach((column) => {
        let width = 8;
        column.eachCell?.({ includeEmpty: false }, (cell) => {
          width = Math.max(width, Math.min(60, String(cell.value ?? "").length + 2));
        });
        column.width = width;
      });
    }
    if (workbook.worksheets.length === 0) workbook.addWorksheet("PDF");
    return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), pages: pages.length, units };
  });
}

// ---- PowerPoint -------------------------------------------------------------------------------

export async function pdfToPptx(
  bytes: Uint8Array,
  options: FromPdfOptions = {},
): Promise<FromPdfResult> {
  return withLayout(bytes, options, async (pdf, pages) => {
    const pres = new PptxGenJS();
    const first = pages[0];
    const inches = (pt: number) => pt / 72;
    const W = inches(first?.width ?? 960);
    const H = inches(first?.height ?? 540);
    pres.defineLayout({ name: "PDF", width: W, height: H });
    pres.layout = "PDF";
    pres.author = "OneStop";
    pres.title = options.title ?? "Converted from PDF";

    for (const page of pages) {
      throwIfAborted(options.signal);
      const slide = pres.addSlide();
      // Pages of another size are scaled into the slide.
      const sx = W / inches(page.width);
      const sy = H / inches(page.height);
      const text = page.lines.map((l) => l.text).join("\n");
      if (options.layout === "editable") {
        for (const line of page.lines) {
          slide.addText(line.text, {
            x: inches(line.x) * sx,
            y: inches(line.y) * sy,
            w: Math.max(inches(line.width) * sx * 1.08, 0.3),
            h: inches(line.fontSize * 1.3) * sy,
            fontSize: Math.max(6, line.fontSize * Math.min(sx, sy)),
            fontFace: "Arial",
            bold: line.bold,
            italic: line.italic,
            margin: 0,
            valign: "top",
            fit: "none",
            wrap: false,
          });
        }
      } else {
        const rendered = await renderPage(pdf, page.pageNumber, { dpi: 150, format: "png" });
        slide.addImage({
          data: `image/png;base64,${Buffer.from(rendered.bytes).toString("base64")}`,
          x: 0,
          y: 0,
          w: W,
          h: H,
        });
      }
      if (text) slide.addNotes(text);
    }
    const out = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
    return { bytes: new Uint8Array(out), pages: pages.length, units: pages.length };
  });
}
