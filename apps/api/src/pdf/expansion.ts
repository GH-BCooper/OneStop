// PDF additions from 21-roadmap-expansion.md (roadmap §1.1): Redaction, the Bookmark Editor, the
// Chapter Splitter, Booklet Layout, the Table Extractor, the PDF/UA Accessibility Checker, Visual
// Diff and the Form Designer.
//
// Everything reuses what phases 05 and 06 already built — `pdf-lib` for structure, the pdf.js
// rasteriser for pixels, and the phase-06 table heuristic for tables — so nothing new is installed
// and every one of these stays fully offline.
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, rgb } from "@cantoo/pdf-lib";
import type { PDFDocument, PDFPage } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  PDF_MIME,
  baseName,
  formatBytes,
  loadPdf,
  optBool,
  optEnum,
  optNumber,
  optString,
  outputName,
  parsePageSelection,
  readPdfInputs,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { copySelectedPages } from "./extractPages.ts";
import { layoutFromDocument, toTable } from "./layout.ts";
import { plural } from "./inputs.ts";
import { withPdfJs } from "./render.ts";
import { renderPdfPages } from "./toImages.ts";
import { createZip, ZIP_MIME } from "./zip.ts";

// ---- shared: outline (bookmark) reading and writing --------------------------------------------

export interface Bookmark {
  title: string;
  /** 1-based page number, or null when the destination could not be resolved. */
  page: number | null;
  depth: number;
  children: Bookmark[];
}

function pageIndexOf(doc: PDFDocument, ref: unknown): number | null {
  if (!(ref instanceof PDFRef)) return null;
  const index = doc.getPages().findIndex((page) => page.ref === ref);
  return index < 0 ? null : index;
}

function destinationPage(doc: PDFDocument, dict: PDFDict): number | null {
  const dest = dict.get(PDFName.of("Dest"));
  const action = dict.get(PDFName.of("A"));
  const resolve = (value: unknown): number | null => {
    if (value instanceof PDFArray) {
      const index = pageIndexOf(doc, value.get(0));
      return index === null ? null : index + 1;
    }
    return null;
  };
  const direct = resolve(dest instanceof PDFRef ? doc.context.lookup(dest) : dest);
  if (direct !== null) return direct;
  const actionDict = action instanceof PDFRef ? doc.context.lookup(action) : action;
  if (actionDict instanceof PDFDict) {
    const d = actionDict.get(PDFName.of("D"));
    return resolve(d instanceof PDFRef ? doc.context.lookup(d) : d);
  }
  return null;
}

function decodeTitle(value: unknown): string {
  if (value instanceof PDFString) return value.decodeText();
  if (value instanceof PDFHexString) return value.decodeText();
  return "";
}

/** Reads the document outline as a tree. An absent or broken outline reads as an empty list. */
export function readOutline(doc: PDFDocument): Bookmark[] {
  const rootRef = doc.catalog.get(PDFName.of("Outlines"));
  const root = rootRef instanceof PDFRef ? doc.context.lookup(rootRef) : rootRef;
  if (!(root instanceof PDFDict)) return [];

  const walk = (firstRef: unknown, depth: number, seen: Set<string>): Bookmark[] => {
    const out: Bookmark[] = [];
    let ref = firstRef;
    // Outlines are a linked list; a malformed file can make it circular, so track what we have seen.
    for (let guard = 0; guard < 5000; guard += 1) {
      if (!(ref instanceof PDFRef)) break;
      const key = ref.toString();
      if (seen.has(key)) break;
      seen.add(key);
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) break;
      out.push({
        title: decodeTitle(dict.get(PDFName.of("Title"))) || "(untitled)",
        page: destinationPage(doc, dict),
        depth,
        children: walk(dict.get(PDFName.of("First")), depth + 1, seen),
      });
      ref = dict.get(PDFName.of("Next"));
    }
    return out;
  };
  return walk(root.get(PDFName.of("First")), 0, new Set());
}

export function flattenOutline(items: Bookmark[]): Bookmark[] {
  return items.flatMap((item) => [item, ...flattenOutline(item.children)]);
}

/**
 * Writes an outline tree onto the document, replacing whatever was there. Each entry gets a
 * `/Dest` pointing at `[page /XYZ null null null]`, which is the "go to the top of this page"
 * destination every reader understands.
 */
export function writeOutline(doc: PDFDocument, items: Bookmark[]): number {
  const pages = doc.getPages();
  const context = doc.context;
  const outlinesRef = context.nextRef();
  let count = 0;

  const build = (list: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef } | null => {
    const refs = list.map(() => context.nextRef());
    if (refs.length === 0) return null;
    list.forEach((item, index) => {
      count += 1;
      const pageIndex = item.page === null ? 0 : Math.min(pages.length - 1, Math.max(0, item.page - 1));
      const dest = context.obj([pages[pageIndex]!.ref, PDFName.of("XYZ"), null, null, null]);
      const dict = new Map<PDFName, unknown>();
      const entries: [string, unknown][] = [
        ["Title", PDFHexString.fromText(item.title.slice(0, 500))],
        ["Parent", parent],
        ["Dest", dest],
      ];
      if (index > 0) entries.push(["Prev", refs[index - 1]!]);
      if (index < refs.length - 1) entries.push(["Next", refs[index + 1]!]);
      void dict;
      const node = context.obj(Object.fromEntries(entries) as unknown as Record<string, never>);
      context.assign(refs[index]!, node);
      const children = build(item.children, refs[index]!);
      if (children) {
        (node as PDFDict).set(PDFName.of("First"), children.first);
        (node as PDFDict).set(PDFName.of("Last"), children.last);
        (node as PDFDict).set(PDFName.of("Count"), PDFNumber.of(item.children.length));
      }
    });
    return { first: refs[0]!, last: refs[refs.length - 1]! };
  };

  const top = build(items, outlinesRef);
  const outlines = context.obj({
    Type: PDFName.of("Outlines"),
    Count: PDFNumber.of(count),
    ...(top ? { First: top.first, Last: top.last } : {}),
  } as unknown as Record<string, never>);
  context.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  return count;
}

/** "Chapter one | 1", optionally indented with two spaces per level, one per line. */
export function parseBookmarkList(text: string, pageCount: number): Bookmark[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw unsupported('List the bookmarks you want, one per line, like "Introduction | 1".');
  const roots: Bookmark[] = [];
  const stack: Bookmark[] = [];
  for (const line of lines) {
    const indent = /^(\s*)/.exec(line)![1]!.replace(/\t/g, "  ").length;
    const depth = Math.floor(indent / 2);
    const [titlePart, pagePart] = line.trim().split(/\s*\|\s*/);
    const page = pagePart === undefined ? 1 : Number(pagePart);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw unsupported(`"${line.trim()}" points at page ${pagePart ?? "?"}, but this PDF has ${pageCount} pages.`);
    }
    const item: Bookmark = { title: titlePart!.trim() || "(untitled)", page, depth, children: [] };
    while (stack.length > depth) stack.pop();
    if (stack.length === 0) roots.push(item);
    else stack[stack.length - 1]!.children.push(item);
    stack.push(item);
  }
  return roots;
}

export const bookmarkEditorExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-bookmark-editor", async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const existing = readOutline(doc);
    const flat = flattenOutline(existing);
    const asText = flat.map((b) => `${"  ".repeat(b.depth)}${b.title} | ${b.page ?? 1}`).join("\n");
    const mode = optEnum(options, "mode", ["read", "replace", "clear", "from-headings"] as const, "read");

    if (mode === "read") {
      return {
        ok: true,
        output: { bookmarks: existing, count: flat.length, editable: asText, result: asText || "(this PDF has no bookmarks)" },
        summary:
          flat.length === 0
            ? "This PDF has no bookmarks. Switch to Replace and paste a list, or use From headings to build one from the text."
            : `${plural(flat.length, "bookmark")} found. Copy the list below, edit it, then run again with Replace.`,
        files: [
          {
            name: `${baseName(file.ref.name)}-bookmarks.json`,
            mimeType: "application/json; charset=utf-8",
            bytes: new TextEncoder().encode(JSON.stringify(existing, null, 2) + "\n"),
          },
        ],
      };
    }

    let wanted: Bookmark[] = [];
    if (mode === "replace") {
      wanted = parseBookmarkList(optString(options, "bookmarks", ""), doc.getPageCount());
    } else if (mode === "from-headings") {
      // Reuse phase 06's block classifier: its heading levels become the outline levels.
      const { toBlocks, bodyFontSize } = await import("./layout.ts");
      const pages = await withPdfJs(file.bytes, (pdf) =>
        layoutFromDocument(pdf, Array.from({ length: pdf.numPages }, (_, i) => i + 1), ctx?.signal),
      );
      const body = bodyFontSize(pages);
      const found: Bookmark[] = [];
      const stack: Bookmark[] = [];
      for (const page of pages) {
        for (const block of toBlocks(page, body)) {
          if (block.kind === "paragraph") continue;
          const depth = block.kind === "heading1" ? 0 : block.kind === "heading2" ? 1 : 2;
          const item: Bookmark = { title: block.text.slice(0, 200), page: page.pageNumber, depth, children: [] };
          while (stack.length > depth) stack.pop();
          if (stack.length === 0) found.push(item);
          else stack[stack.length - 1]!.children.push(item);
          stack.push(item);
        }
      }
      if (found.length === 0) {
        throw unsupported("No headings were detected in this PDF, so there is nothing to build an outline from. Paste a list instead.");
      }
      wanted = found;
    }

    const count = writeOutline(doc, wanted);
    doc.catalog.set(PDFName.of("PageMode"), PDFName.of(count > 0 && optBool(options, "showPanel", true) ? "UseOutlines" : "UseNone"));
    const bytes = await savePdf(doc);
    return {
      ok: true,
      output: { bookmarks: wanted, count, result: `${count} bookmarks` },
      summary:
        count === 0
          ? "Removed every bookmark from this PDF."
          : `Wrote ${plural(count, "bookmark")}${mode === "from-headings" ? " built from the document's own headings" : ""}. Most readers show the panel automatically.`,
      files: [{ name: outputName(file.ref.name, "bookmarks"), mimeType: PDF_MIME, bytes }],
    };
  });

// ---- chapter splitter -------------------------------------------------------------------------

export const chapterSplitterExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-chapter-splitter", async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pageCount = doc.getPageCount();
    const maxDepth = optNumber(options, "depth", 1, { min: 1, max: 4 }) - 1;
    const chapters = flattenOutline(readOutline(doc))
      .filter((b) => b.depth <= maxDepth && b.page !== null)
      .sort((a, b) => a.page! - b.page!);
    if (chapters.length === 0) {
      throw unsupported(
        "This PDF has no bookmarks at that level, so there are no chapters to split on. Use the Bookmark Editor to add an outline first, or Split PDF for page ranges.",
      );
    }

    const safeName = (title: string, index: number) => {
      const stem = title.replace(/[^A-Za-z0-9 _.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      return `${String(index + 1).padStart(String(chapters.length).length, "0")}-${stem || "chapter"}.pdf`;
    };
    const files: OutputFile[] = [];
    for (const [index, chapter] of chapters.entries()) {
      throwIfAborted(ctx?.signal);
      const from = chapter.page!;
      const to = index + 1 < chapters.length ? chapters[index + 1]!.page! - 1 : pageCount;
      if (to < from) continue; // two bookmarks on the same page: the later one owns no pages
      const part = await copySelectedPages(doc, Array.from({ length: to - from + 1 }, (_, i) => from + i));
      files.push({ name: safeName(chapter.title, index), mimeType: PDF_MIME, bytes: await savePdf(part) });
    }
    if (files.length === 0) throw unsupported("Every bookmark points at the same page, so no chapter has pages of its own.");
    const packaged =
      files.length === 1 || optEnum(options, "packaging", ["zip", "files"] as const, "zip") === "files"
        ? files
        : [{ name: `${baseName(file.ref.name)}-chapters.zip`, mimeType: ZIP_MIME, bytes: createZip(files) }];
    return {
      ok: true,
      output: { chapters: chapters.map((c) => ({ title: c.title, page: c.page })), files: files.map((f) => f.name), result: `${files.length} chapters` },
      summary: `Split into ${plural(files.length, "file")}, one per chapter: ${chapters.slice(0, 4).map((c) => c.title).join(", ")}${chapters.length > 4 ? "…" : ""}.`,
      files: packaged,
    };
  });

// ---- booklet / imposition ----------------------------------------------------------------------

/**
 * Saddle-stitch page order: fold a stack of sheets down the middle and the pages must be printed
 * outside-in — 4,1 then 2,3 for eight pages. Blanks are added so the count is a multiple of four,
 * which is what a folded booklet always needs.
 */
export function bookletOrder(pageCount: number): (number | null)[] {
  const total = Math.ceil(pageCount / 4) * 4;
  const order: (number | null)[] = [];
  let left = total;
  let right = 1;
  while (right < left) {
    order.push(left > pageCount ? null : left, right > pageCount ? null : right);
    right += 1;
    left -= 1;
    order.push(right > pageCount ? null : right, left > pageCount ? null : left);
    right += 1;
    left -= 1;
  }
  return order;
}

/** "2-up" imposition: pairs of pages side by side on a landscape sheet. */
export const bookletExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-booklet-layout", async () => {
    const file = await readSinglePdf(input, ctx);
    const source = await loadPdf(file.bytes);
    const pageCount = source.getPageCount();
    if (pageCount < 2) throw unsupported("A booklet needs at least two pages.");
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const out = await PDFDocument.create();

    const style = optEnum(options, "style", ["saddle-stitch", "sequential-2up"] as const, "saddle-stitch");
    const order = style === "saddle-stitch" ? bookletOrder(pageCount) : Array.from({ length: pageCount }, (_, i) => i + 1);
    const gutter = optNumber(options, "gutter", 0, { min: 0, max: 72 });
    const margin = optNumber(options, "margin", 0, { min: 0, max: 72 });

    const first = source.getPage(0);
    const { width: pw, height: ph } = first.getSize();
    const sheetWidth = ph;
    const sheetHeight = pw;
    // Landscape sheet, two portrait pages side by side; embedPage lets each one be placed and scaled.
    const embedded = await out.embedPages(source.getPages());

    for (let i = 0; i < order.length; i += 2) {
      throwIfAborted(ctx?.signal);
      const sheet = out.addPage([sheetWidth, sheetHeight]);
      const halfWidth = sheetWidth / 2 - gutter / 2 - margin;
      const usableHeight = sheetHeight - margin * 2;
      for (const [slot, pageNumber] of [order[i], order[i + 1]].entries()) {
        if (pageNumber === null || pageNumber === undefined) continue;
        const page = embedded[pageNumber - 1];
        if (!page) continue;
        const scale = Math.min(halfWidth / pw, usableHeight / ph);
        const x = margin + slot * (halfWidth + gutter) + (halfWidth - pw * scale) / 2;
        const y = margin + (usableHeight - ph * scale) / 2;
        sheet.drawPage(page, { x, y, xScale: scale, yScale: scale });
      }
    }
    const bytes = await savePdf(out);
    const sheets = Math.ceil(order.length / 2);
    return {
      ok: true,
      output: { sheets, style, order, result: `${sheets} sheets` },
      summary:
        style === "saddle-stitch"
          ? `Imposed ${plural(pageCount, "page")} onto ${plural(sheets, "landscape sheet")} in saddle-stitch order${order.filter((p) => p === null).length ? `, with ${order.filter((p) => p === null).length} blank page(s) added to reach a multiple of four` : ""}. Print double-sided, flip on the short edge, fold down the middle and staple.`
          : `Laid ${plural(pageCount, "page")} out two-up across ${plural(sheets, "sheet")}, in reading order.`,
      files: [{ name: outputName(file.ref.name, "booklet"), mimeType: PDF_MIME, bytes }],
    };
  });

// ---- redaction ---------------------------------------------------------------------------------

export interface RedactionBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** "1: 50,600,200,20" — page, then x,y,width,height in PDF points from the bottom-left. */
export function parseRedactionBoxes(text: string, pageCount: number): RedactionBox[] {
  const boxes: RedactionBox[] = [];
  for (const line of text.split(/[\n;]/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = /^(\d+)\s*[:\s]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)$/.exec(trimmed);
    if (!match) {
      throw unsupported(`"${trimmed}" is not a region. Use: page: x,y,width,height — for example 1: 50,600,200,20.`);
    }
    const page = Number(match[1]);
    if (page < 1 || page > pageCount) throw unsupported(`Page ${page} does not exist; this PDF has ${pageCount} pages.`);
    boxes.push({ page, x: Number(match[2]), y: Number(match[3]), width: Number(match[4]), height: Number(match[5]) });
  }
  return boxes;
}

export const redactionExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-redaction", async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const pageCount = doc.getPageCount();
    const mode = optEnum(options, "mode", ["text", "regions"] as const, "text");
    const boxes: RedactionBox[] = [];
    let matched = 0;

    if (mode === "regions") {
      boxes.push(...parseRedactionBoxes(optString(options, "regions", ""), pageCount));
      if (boxes.length === 0) throw unsupported('Add at least one region, like "1: 50,600,200,20".');
    } else {
      const terms = optString(options, "terms", "")
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (terms.length === 0) throw unsupported("List the words or phrases to redact, one per line.");
      const caseSensitive = optBool(options, "caseSensitive", false);
      const regex = optBool(options, "regex", false);
      const padding = optNumber(options, "padding", 1.5, { min: 0, max: 12 });
      const pages = await withPdfJs(file.bytes, (pdf) =>
        layoutFromDocument(pdf, Array.from({ length: pdf.numPages }, (_, i) => i + 1), ctx?.signal),
      );
      const matchers = terms.map((term) => {
        if (!regex) return { term, test: (text: string) => (caseSensitive ? text.includes(term) : text.toLowerCase().includes(term.toLowerCase())) };
        let compiled: RegExp;
        try {
          compiled = new RegExp(term, caseSensitive ? "" : "i");
        } catch {
          throw unsupported(`"${term}" is not a valid regular expression.`);
        }
        return { term, test: (text: string) => compiled.test(text) };
      });
      for (const page of pages) {
        for (const line of page.lines) {
          for (const run of line.runs) {
            if (!matchers.some((m) => m.test(run.text))) continue;
            matched += 1;
            // Layout coordinates come from pdf.js with y measured from the top; pdf-lib draws from
            // the bottom, so the box has to be flipped into the page's own space.
            boxes.push({
              page: page.pageNumber,
              x: run.x - padding,
              y: page.height - run.y - run.fontSize - padding,
              width: run.width + padding * 2,
              height: run.fontSize + padding * 2,
            });
          }
        }
      }
      if (boxes.length === 0) {
        throw unsupported(
          `None of those terms appear in this PDF's text. If the pages are scans, run OCR PDF first — there is no text layer to search yet.`,
        );
      }
    }

    // Rasterise every touched page, paint the boxes onto the raster, and rebuild the page from the
    // image. That is what makes the redaction permanent: the original text object is gone, not
    // merely covered, so it cannot be selected, searched or lifted back out.
    const touched = [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b);
    const dpi = optNumber(options, "dpi", 150, { min: 72, max
: 300 });
    const rendered = await renderPdfPages(file.bytes, { pages: touched.join(","), format: "png", dpi, signal: ctx?.signal });
    const fill = optEnum(options, "color", ["black", "white"] as const, "black") === "white" ? rgb(1, 1, 1) : rgb(0, 0, 0);
    const sharp = (await import("sharp")).default;

    for (const page of rendered) {
      throwIfAborted(ctx?.signal);
      const target = doc.getPage(page.pageNumber - 1);
      const { width: pointWidth, height: pointHeight } = target.getSize();
      const scale = page.width / pointWidth;
      const overlays = boxes
        .filter((b) => b.page === page.pageNumber)
        .map((b) => {
          const left = Math.max(0, Math.round(b.x * scale));
          const top = Math.max(0, Math.round((pointHeight - b.y - b.height) * scale));
          const width = Math.min(page.width - left, Math.max(1, Math.round(b.width * scale)));
          const height = Math.min(page.height - top, Math.max(1, Math.round(b.height * scale)));
          return { input: { create: { width, height, channels: 4 as const, background: fill === rgb(1, 1, 1) ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 1 } } }, left, top };
        })
        .filter((o) => o.input.create.width > 0 && o.input.create.height > 0);
      const flattened = await sharp(Buffer.from(page.bytes)).composite(overlays).png({ compressionLevel: 8 }).toBuffer();
      const embedded = await doc.embedPng(new Uint8Array(flattened));
      // Replace the page's content entirely: drop the old stream, then draw the image over it.
      target.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream("")));
      target.node.delete(PDFName.of("Annots"));
      target.drawImage(embedded, { x: 0, y: 0, width: pointWidth, height: pointHeight });
    }

    const bytes = await savePdf(doc);
    return {
      ok: true,
      output: { boxes, pages: touched, matched, result: `${boxes.length} regions on ${touched.length} pages` },
      summary: `Redacted ${plural(boxes.length, "region")} across ${plural(touched.length, "page")}. Those pages were re-rendered as images at ${dpi} DPI, so the hidden text is genuinely gone rather than covered up — the file is now ${formatBytes(bytes.length)} and that text is no longer searchable.`,
      files: [{ name: outputName(file.ref.name, "redacted"), mimeType: PDF_MIME, bytes }],
    };
  });

// ---- table extractor ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const tableExtractorExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-table-extractor", async () => {
    const file = await readSinglePdf(input, ctx);
    const selection = optString(options, "pages", "");
    const pages = await withPdfJs(file.bytes, (pdf) =>
      layoutFromDocument(pdf, parsePageSelection(selection, pdf.numPages), ctx?.signal),
    );
    const minRows = optNumber(options, "minRows", 2, { min: 1, max: 100 });
    const minColumns = optNumber(options, "minColumns", 2, { min: 1, max: 50 });
    const tables = pages
      .map((page) => ({ page: page.pageNumber, rows: toTable(page) }))
      .map(({ page, rows }) => ({
        page,
        rows: rows.filter((row) => row.some((cell) => cell.trim() !== "")),
      }))
      .filter((t) => t.rows.length >= minRows && Math.max(...t.rows.map((r) => r.length)) >= minColumns);

    if (tables.length === 0) {
      throw unsupported(
        "No tables were detected. This finds tables from the text's own column positions, so a scanned page needs OCR PDF first, and a table drawn only with lines and no aligned text cannot be found this way.",
      );
    }

    const format = optEnum(options, "format", ["csv", "json", "both"] as const, "csv");
    const separate = optBool(options, "separateFiles", true);
    const files: OutputFile[] = [];
    const stem = baseName(file.ref.name);

    if (format !== "json") {
      if (separate && tables.length > 1) {
        const parts = tables.map((t) => ({
          name: `${stem}-page${t.page}.csv`,
          mimeType: "text/csv; charset=utf-8",
          bytes: new TextEncoder().encode(t.rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n"),
        }));
        files.push({ name: `${stem}-tables.zip`, mimeType: ZIP_MIME, bytes: createZip(parts) });
      } else {
        const text = tables
          .map((t) => (tables.length > 1 ? `# page ${t.page}\r\n` : "") + t.rows.map((r) => r.map(csvEscape).join(",")).join("\r\n"))
          .join("\r\n\r\n");
        files.push({ name: `${stem}-tables.csv`, mimeType: "text/csv; charset=utf-8", bytes: new TextEncoder().encode(text + "\r\n") });
      }
    }
    if (format !== "csv") {
      const asObjects = optBool(options, "firstRowIsHeader", true);
      const payload = tables.map((t) => ({
        page: t.page,
        ...(asObjects && t.rows.length > 1
          ? {
              rows: t.rows.slice(1).map((row) => Object.fromEntries(t.rows[0]!.map((h, i) => [h.trim() || `column${i + 1}`, row[i] ?? ""]))),
            }
          : { rows: t.rows }),
      }));
      files.push({
        name: `${stem}-tables.json`,
        mimeType: "application/json; charset=utf-8",
        bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2) + "\n"),
      });
    }

    const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
    return {
      ok: true,
      output: {
        tables: tables.map((t) => ({ page: t.page, rows: t.rows.length, columns: Math.max(...t.rows.map((r) => r.length)) })),
        preview: tables[0]!.rows.slice(0, 10),
        result: `${tables.length} tables, ${totalRows} rows`,
      },
      summary: `Extracted ${plural(tables.length, "table")} (${totalRows} rows in all) from ${plural(tables.length, "page")}. Column edges are inferred from where the text sits, so check the first few rows before relying on it.`,
      files,
    };
  });

// ---- PDF/UA accessibility checker --------------------------------------------------------------

export interface AccessibilityIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  detail: string;
  fix: string;
}

export interface AccessibilityReport {
  tagged: boolean;
  language: string | null;
  title: string | null;
  pageCount: number;
  imagesWithoutAlt: number;
  imagesTotal: number;
  formFieldsWithoutLabel: number;
  formFieldsTotal: number;
  pagesWithoutText: number;
  score: number;
  issues: AccessibilityIssue[];
}

/**
 * The PDF/UA-1 rules that can be checked structurally, in the same spirit as phase 06's PDF/A
 * checker: every rule here is a real clause, and the tool never claims conformance it did not test.
 * Reading order and "is the alt text actually useful" need a human, and the report says so.
 */
export async function checkPdfUa(bytes: Uint8Array, textPerPage: string[]): Promise<AccessibilityReport> {
  const doc = await loadPdf(bytes, { tolerant: true });
  const issues: AccessibilityIssue[] = [];
  const catalog = doc.catalog;

  const structTreeRef = catalog.get(PDFName.of("StructTreeRoot"));
  const tagged = structTreeRef !== undefined;
  const markInfoRef = catalog.get(PDFName.of("MarkInfo"));
  const markInfo = markInfoRef instanceof PDFRef ? doc.context.lookup(markInfoRef) : markInfoRef;
  const marked = markInfo instanceof PDFDict ? String(markInfo.get(PDFName.of("Marked"))) === "true" : false;
  if (!tagged) {
    issues.push({
      rule: "7.1 Tagged content",
      severity: "error",
      detail: "There is no structure tree, so a screen reader has no headings, lists or reading order to work with.",
      fix: "Export from the original document with tagging/accessibility turned on — tags cannot be invented after the fact.",
    });
  } else if (!marked) {
    issues.push({
      rule: "7.1 Tagged content",
      severity: "warning",
      detail: "A structure tree exists, but /MarkInfo /Marked is not true, so readers may ignore it.",
      fix: "Set /MarkInfo << /Marked true >> in the catalog.",
    });
  }

  const langValue = catalog.get(PDFName.of("Lang"));
  const language = langValue instanceof PDFString || langValue instanceof PDFHexString ? langValue.decodeText() : null;
  if (!language) {
    issues.push({
      rule: "7.2 Natural language",
      severity: "error",
      detail: "No document language is set, so a screen reader has to guess the pronunciation.",
      fix: "Set the catalog's /Lang entry, for example /Lang (en-GB).",
    });
  }

  const title = doc.getTitle() ?? null;
  const viewerPrefsRef = catalog.get(PDFName.of("ViewerPreferences"));
  const viewerPrefs = viewerPrefsRef instanceof PDFRef ? doc.context.lookup(viewerPrefsRef) : viewerPrefsRef;
  const displayTitle = viewerPrefs instanceof PDFDict ? String(viewerPrefs.get(PDFName.of("DisplayDocTitle"))) === "true" : false;
  if (!title) {
    issues.push({
      rule: "7.1 Document title",
      severity: "error",
      detail: "The document has no title, so its window and tab show only the file name.",
      fix: "Set a title with Edit PDF Metadata.",
    });
  } else if (!displayTitle) {
    issues.push({
      rule: "7.1 DisplayDocTitle",
      severity: "warning",
      detail: "A title is set, but /ViewerPreferences /DisplayDocTitle is not true, so readers still show the file name.",
      fix: "Set /ViewerPreferences << /DisplayDocTitle true >>.",
    });
  }

  // Images: an XObject of subtype /Image needs alternate text on its enclosing Figure tag. Without a
  // structure tree there is nowhere for that to live, which is counted as one issue rather than many.
  let imagesTotal = 0;
  for (const page of doc.getPages()) {
    const resourcesRef = page.node.get(PDFName.of("Resources"));
    const resources = resourcesRef instanceof PDFRef ? doc.context.lookup(resourcesRef) : resourcesRef;
    if (!(resources instanceof PDFDict)) continue;
    const xobjectsRef = resources.get(PDFName.of("XObject"));
    const xobjects = xobjectsRef instanceof PDFRef ? doc.context.lookup(xobjectsRef) : xobjectsRef;
    if (!(xobjects instanceof PDFDict)) continue;
    for (const key of xobjects.keys()) {
      const objRef = xobjects.get(key);
      const obj = objRef instanceof PDFRef ? doc.context.lookup(objRef) : objRef;
      const dict = obj instanceof PDFDict ? obj : (obj as { dict?: PDFDict })?.dict;
      if (dict instanceof PDFDict && String(dict.get(PDFName.of("Subtype"))) === "/Image") imagesTotal += 1;
    }
  }
  const imagesWithoutAlt = tagged ? 0 : imagesTotal;
  if (imagesTotal > 0 && !tagged) {
    issues.push({
      rule: "7.3 Figure alternate text",
      severity: "error",
      detail: `${imagesTotal} image${imagesTotal === 1 ? "" : "s"} cannot carry alternate text, because there is no structure tree to attach it to.`,
      fix: "Tag the document, then give each figure an /Alt value. The AI Alt-Text Generator can draft the wording.",
    });
  }

  const form = doc.getForm();
  const fields = form.getFields();
  let formFieldsWithoutLabel = 0;
  for (const field of fields) {
    const tooltip = field.acroField.dict.get(PDFName.of("TU"));
    if (!(tooltip instanceof PDFString || tooltip instanceof PDFHexString)) formFieldsWithoutLabel += 1;
  }
  if (formFieldsWithoutLabel > 0) {
    issues.push({
      rule: "7.18 Form field labels",
      severity: "error",
      detail: `${formFieldsWithoutLabel} of ${fields.length} form fields have no tooltip (/TU), which is what a screen reader reads out as the field's name.`,
      fix: "Give every field a tooltip describing what to type into it.",
    });
  }

  const pagesWithoutText = textPerPage.filter((t) => t.trim().length < 8).length;
  if (pagesWithoutText > 0) {
    issues.push({
      rule: "7.2 Text alternatives",
      severity: pagesWithoutText === textPerPage.length ? "error" : "warning",
      detail: `${pagesWithoutText} of ${textPerPage.length} pages have almost no extractable text — they are probably scans.`,
      fix: "Run OCR PDF to add a real text layer.",
    });
  }

  if (doc.catalog.get(PDFName.of("AcroForm")) !== undefined && fields.length === 0) {
    issues.push({
      rule: "7.18 Forms",
      severity: "info",
      detail: "The file declares a form but has no fields in it.",
      fix: "Harmless, but the empty /AcroForm can be removed.",
    });
  }
  issues.push({
    rule: "7.1 Reading order",
    severity: "info",
    detail: "Logical reading order, heading levels and whether alt text is actually useful cannot be judged automatically.",
    fix: "Check those by hand in a reader's accessibility panel, or with a screen reader.",
  });

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 100 - errors * 22 - warnings * 8);
  return {
    tagged: tagged && marked,
    language,
    title,
    pageCount: doc.getPageCount(),
    imagesWithoutAlt,
    imagesTotal,
    formFieldsWithoutLabel,
    formFieldsTotal: fields.length,
    pagesWithoutText,
    score,
    issues,
  };
}

export const accessibilityCheckerExecutor: Executor = (input, _options, ctx) =>
  runPdfTool("pdf-accessibility-checker", async () => {
    const file = await readSinglePdf(input, ctx);
    const perPage = await withPdfJs(file.bytes, async (pdf) => {
      const { pageText } = await import("./render.ts");
      const out: string[] = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        throwIfAborted(ctx?.signal);
        out.push(await pageText(pdf, i));
      }
      return out;
    });
    const report = await checkPdfUa(file.bytes, perPage);
    const errors = report.issues.filter((i) => i.severity === "error");
    const lines = [
      `PDF/UA accessibility check — ${file.ref.name}`,
      `Score ${report.score}/100 · ${errors.length} error${errors.length === 1 ? "" : "s"}, ${report.issues.filter((i) => i.severity === "warning").length} warnings`,
      "",
      ...report.issues.flatMap((i) => [`[${i.severity.toUpperCase()}] ${i.rule}`, `  ${i.detail}`, `  Fix: ${i.fix}`, ""]),
    ];
    return {
      ok: true,
      output: { ...report, result: `${report.score}/100` },
      summary:
        errors.length === 0
          ? `Score ${report.score}/100 — no blocking problems found. Reading order and the usefulness of any alt text still need a human eye.`
          : `Score ${report.score}/100 with ${plural(errors.length, "blocking problem")}. The biggest: ${errors[0]!.detail}`,
      files: [
        { name: `${baseName(file.ref.name)}-accessibility.txt`, mimeType: "text/plain; charset=utf-8", bytes: new TextEncoder().encode(lines.join("\n")) },
        { name: `${baseName(file.ref.name)}-accessibility.json`, mimeType: "application/json; charset=utf-8", bytes: new TextEncoder().encode(JSON.stringify(report, null, 2) + "\n") },
      ],
    };
  });

// ---- visual diff -------------------------------------------------------------------------------

export const visualDiffExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-visual-diff", async () => {
    const files = await readPdfInputs(input, ctx, { min: 2 });
    if (files.length > 2) throw unsupported("Choose exactly two PDFs to compare.");
    const dpi = optNumber(options, "dpi", 110, { min: 72, max: 200 });
    const threshold = optNumber(options, "threshold", 12, { min: 0, max: 255 });
    const pagesOption = optString(options, "pages", "");
    const [left, right] = await Promise.all([
      renderPdfPages(files[0]!.bytes, { pages: pagesOption, format: "png", dpi, signal: ctx?.signal }),
      renderPdfPages(files[1]!.bytes, { pages: pagesOption, format: "png", dpi, signal: ctx?.signal }),
    ]);
    const sharp = (await import("sharp")).default;
    const count = Math.max(left.length, right.length);
    const out: OutputFile[] = [];
    const perPage: { page: number; changedPixels: number; percent: number; note?: string }[] = [];

    for (let i = 0; i < count; i += 1) {
      throwIfAborted(ctx?.signal);
      const a = left[i];
      const b = right[i];
      if (!a || !b) {
        perPage.push({ page: i + 1, changedPixels: 0, percent: 100, note: a ? "only in the first PDF" : "only in the second PDF" });
        const only = (a ?? b)!;
        out.push({ name: `page-${i + 1}-${a ? "only-in-first" : "only-in-second"}.png`, mimeType: "image/png", bytes: only.bytes });
        continue;
      }
      // Compare at one size: a page that changed dimensions is still worth diffing.
      const width = Math.min(a.width, b.width);
      const height = Math.min(a.height, b.height);
      const [ra, rb] = await Promise.all([
        sharp(Buffer.from(a.bytes)).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer(),
        sharp(Buffer.from(b.bytes)).resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer(),
      ]);
      const overlay = Buffer.alloc(width * height * 4);
      let changed = 0;
      for (let p = 0; p < ra.length; p += 1) {
        const delta = Math.abs(ra[p]! - rb[p]!);
        const o = p * 4;
        if (delta > threshold) {
          changed += 1;
          // Removed content (dark on the left, light on the right) in red; added content in green.
          const removed = ra[p]! < rb[p]!;
          overlay[o] = removed ? 220 : 40;
          overlay[o + 1] = removed ? 40 : 190;
          overlay[o + 2] = 60;
          overlay[o + 3] = 190;
        } else {
          overlay[o + 3] = 0;
        }
      }
      const percent = Math.round((changed / (width * height)) * 10000) / 100;
      perPage.push({ page: i + 1, changedPixels: changed, percent });
      if (changed > 0 || optBool(options, "includeUnchanged", false)) {
        const composed = await sharp(Buffer.from(b.bytes))
          .resize(width, height, { fit: "fill" })
          .composite([{ input: overlay, raw: { width, height, channels: 4 } }])
          .png({ compressionLevel: 8 })
          .toBuffer();
        out.push({ name: `page-${i + 1}-diff.png`, mimeType: "image/png", bytes: new Uint8Array(composed) });
      }
    }

    const changedPages = perPage.filter((p) => p.changedPixels > 0 || p.note);
    if (out.length === 0) {
      return {
        ok: true,
        output: { identical: true, pages: perPage, result: "identical" },
        summary: `These two PDFs look the same on every one of ${plural(count, "page")}, at ${dpi} DPI. Turn on "Include unchanged pages" if you want the overlays anyway.`,
        files: [],
      };
    }
    const packaged =
      out.length === 1
        ? out
        : [{ name: `${baseName(files[0]!.ref.name)}-visual-diff.zip`, mimeType: ZIP_MIME, bytes: createZip(out) }];
    return {
      ok: true,
      output: { identical: false, pages: perPage, changedPages: changedPages.length, result: `${changedPages.length} pages differ` },
      summary: `${plural(changedPages.length, "page")} of ${count} differ. Red marks what the first PDF had and the second does not; green marks what is new. The worst page is ${perPage.reduce((worst, p) => (p.percent > worst.percent ? p : worst)).page}, at ${perPage.reduce((worst, p) => (p.percent > worst.percent ? p : worst)).percent}% of its pixels.`,
      files: packaged,
    };
  });

// ---- form designer -----------------------------------------------------------------------------

export interface FieldSpec {
  kind: "text" | "checkbox" | "dropdown" | "radio" | "multiline";
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  choices: string[];
}

/** "text | Full name | 1 | 60,700,220,22" — kind, label, page, then x,y,width,height in points. */
export function parseFieldSpecs(text: string, pageCount: number): FieldSpec[] {
  const specs: FieldSpec[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s*\|\s*/);
    if (parts.length < 4) {
      throw unsupported(`"${trimmed}" is not a field. Use: kind | label | page | x,y,width,height`);
    }
    const kind = parts[0]!.toLowerCase();
    if (!["text", "checkbox", "dropdown", "radio", "multiline"].includes(kind)) {
      throw unsupported(`"${parts[0]}" is not a field kind. Use text, multiline, checkbox, dropdown or radio.`);
    }
    const label = parts[1]!.trim() || "Field";
    const page = Number(parts[2]);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw unsupported(`"${label}" is on page ${parts[2]}, but this PDF has ${pageCount} pages.`);
    }
    const box = parts[3]!.split(/\s*,\s*/).map(Number);
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
      throw unsupported(`"${label}" has an invalid position. Use four numbers: x,y,width,height.`);
    }
    // Field names must be unique within a form, or readers tie the fields together.
    let name = label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || `field_${specs.length + 1}`;
    let attempt = 2;
    while (seen.has(name)) {
      name = `${name}_${attempt}`;
      attempt += 1;
    }
    seen.add(name);
    specs.push({
      kind: kind as FieldSpec["kind"],
      name,
      label,
      page,
      x: box[0]!,
      y: box[1]!,
      width: Math.max(8, box[2]!),
      height: Math.max(8, box[3]!),
      choices: (parts[4] ?? "").split(/\s*[,;]\s*/).filter(Boolean),
    });
  }
  if (specs.length === 0) throw unsupported('Add at least one field, like "text | Full name | 1 | 60,700,220,22".');
  return specs;
}

export const formDesignerExecutor: Executor = (input, options, ctx) =>
  runPdfTool("pdf-form-designer", async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const specs = parseFieldSpecs(optString(options, "fields", ""), doc.getPageCount());
    const form = doc.getForm();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const drawLabels = optBool(options, "drawLabels", true);
    const border = optBool(options, "border", true);

    for (const spec of specs) {
      const page: PDFPage = doc.getPage(spec.page - 1);
      if (drawLabels) {
        page.drawText(spec.label.replace(/[^\x20-\x7e]/g, "?"), {
          x: spec.x,
          y: spec.y + spec.height + 4,
          size: 9,
          font,
          color: rgb(0.28, 0.32, 0.36),
        });
      }
      const common = { x: spec.x, y: spec.y, width: spec.width, height: spec.height, ...(border ? { borderWidth: 1, borderColor: rgb(0.64, 0.7, 0.75) } : {}) };
      if (spec.kind === "checkbox") {
        const field = form.createCheckBox(spec.name);
        field.addToPage(page, common);
        field.acroField.dict.set(PDFName.of("TU"), PDFString.of(spec.label));
        continue;
      }
      if (spec.kind === "dropdown") {
        if (spec.choices.length === 0) throw unsupported(`The dropdown "${spec.label}" needs choices — add them after the position, separated by commas.`);
        const field = form.createDropdown(spec.name);
        field.addOptions(spec.choices);
        field.addToPage(page, { ...common, font });
        field.acroField.dict.set(PDFName.of("TU"), PDFString.of(spec.label));
        continue;
      }
      if (spec.kind === "radio") {
        if (spec.choices.length < 2) throw unsupported(`The radio group "${spec.label}" needs at least two choices.`);
        const group = form.createRadioGroup(spec.name);
        spec.choices.forEach((choice, index) => {
          group.addOptionToPage(choice, page, { ...common, y: spec.y - index * (spec.height + 6) });
        });
        group.acroField.dict.set(PDFName.of("TU"), PDFString.of(spec.label));
        continue;
      }
      const field = form.createTextField(spec.name);
      if (spec.kind === "multiline") field.enableMultiline();
      field.addToPage(page, { ...common, font });
      // The tooltip is what a screen reader announces, so it is set for every field, not just some.
      field.acroField.dict.set(PDFName.of("TU"), PDFString.of(spec.label));
    }

    const bytes = await savePdf(doc);
    return {
      ok: true,
      output: { fields: specs.map((s) => ({ name: s.name, kind: s.kind, page: s.page })), result: `${specs.length} fields` },
      summary: `Added ${plural(specs.length, "fillable field")} across the PDF. Each one carries a tooltip, so screen readers announce it — fill them in with Fill PDF Forms, or in any reader.`,
      files: [{ name: outputName(file.ref.name, "form"), mimeType: PDF_MIME, bytes }],
    };
  });

export { PDFArray, PDFDict, PDFNumber };
