// Compare PDFs (Features 1.24).
//
// Two independent comparisons of the "original" (first file) and the "changed" (second file):
// - text: a line-level diff (LCS) of the text, with word-level detail for edited lines, delivered
//   as a self-contained HTML report;
// - visual: each page pair rendered and compared pixel by pixel, delivered as a copy of the
//   changed PDF with the regions that differ highlighted in red.
import { degrees, PDFDocument, rgb } from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  baseName,
  loadPdf,
  optEnum,
  PDF_MIME,
  readPdfInputs,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { embedUnicodeFont } from "./fonts.ts";
import { plural } from "./inputs.ts";
import { layoutFromDocument } from "./layout.ts";
import { visualFrame } from "./placement.ts";
import { renderPage, withPdfJs, type PdfJsDocument } from "./render.ts";
import { escapeHtml } from "./toHtml.ts";

export const COMPARE_PDFS_TOOL_ID = "compare-pdfs";

export interface DocLine {
  page: number;
  text: string;
}

export type DiffOp =
  | { type: "same"; a: DocLine; b: DocLine }
  | { type: "removed"; a: DocLine }
  | { type: "added"; b: DocLine }
  | { type: "changed"; a: DocLine; b: DocLine };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Longest-common-subsequence diff of two sequences, as keep/delete/insert steps. */
export function lcsDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): ("=" | "-" | "+")[] {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix/suffix first: most comparisons are "mostly the same".
  let start = 0;
  while (start < n && start < m && eq(a[start]!, b[start]!)) start += 1;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && eq(a[endA - 1]!, b[endB - 1]!)) {
    endA -= 1;
    endB -= 1;
  }
  const rows = endA - start;
  const cols = endB - start;
  const middle: ("=" | "-" | "+")[] = [];
  if (rows * cols > 25_000_000) {
    // Too large to align precisely: report the middle as replaced, which is still honest.
    for (let i = 0; i < rows; i += 1) middle.push("-");
    for (let j = 0; j < cols; j += 1) middle.push("+");
  } else {
    const table = new Uint32Array((rows + 1) * (cols + 1));
    const at = (i: number, j: number) => i * (cols + 1) + j;
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[at(i, j)] = eq(a[start + i]!, b[start + j]!)
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (eq(a[start + i]!, b[start + j]!)) {
        middle.push("=");
        i += 1;
        j += 1;
      } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
        middle.push("-");
        i += 1;
      } else {
        middle.push("+");
        j += 1;
      }
    }
    while (i++ < rows) middle.push("-");
    while (j++ < cols) middle.push("+");
  }
  return [...Array<"=">(start).fill("="), ...middle, ...Array<"=">(n - endA).fill("=")];
}

/** Line diff, pairing a removal with the addition that follows it into one "changed" entry. */
export function diffDocuments(a: DocLine[], b: DocLine[]): DiffOp[] {
  const steps = lcsDiff(a, b, (x, y) => norm(x.text) === norm(y.text));
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  let removed: DocLine[] = [];
  let added: DocLine[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k += 1) ops.push({ type: "changed", a: removed[k]!, b: added[k]! });
    for (const line of removed.slice(pairs)) ops.push({ type: "removed", a: line });
    for (const line of added.slice(pairs)) ops.push({ type: "added", b: line });
    removed = [];
    added = [];
  };
  for (const step of steps) {
    if (step === "=") {
      flush();
      ops.push({ type: "same", a: a[i++]!, b: b[j++]! });
    } else if (step === "-") removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  flush();
  return ops;
}

function wordDiffHtml(before: string, after: string): { a: string; b: string } {
  const wa = before.split(/(\s+)/);
  const wb = after.split(/(\s+)/);
  const steps = lcsDiff(wa, wb, (x, y) => x === y);
  let i = 0;
  let j = 0;
  let a = "";
  let b = "";
  for (const s of steps) {
    if (s === "=") {
      a += escapeHtml(wa[i++]!);
      b += escapeHtml(wb[j++]!);
    } else if (s === "-") a += `<del>${escapeHtml(wa[i++]!)}</del>`;
    else b += `<ins>${escapeHtml(wb[j++]!)}</ins>`;
  }
  return { a, b };
}

async function documentLines(pdf: PdfJsDocument, signal?: AbortSignal): Promise<DocLine[]> {
  const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const layouts = await layoutFromDocument(pdf, pages, signal);
  return layouts.flatMap((p) => p.lines.map((l) => ({ page: p.pageNumber, text: l.text })));
}

function reportHtml(
  nameA: string,
  nameB: string,
  ops: DiffOp[],
  visual: VisualSummary | null,
): string {
  const changes = ops.filter((o) => o.type !== "same");
  const rows = ops
    .map((op, index) => {
      if (op.type === "same") {
        // Keep a little context around each change, collapse the rest.
        const near = ops.slice(Math.max(0, index - 2), index + 3).some((o) => o.type !== "same");
        return near
          ? `<tr class="same"><td>${op.a.page}</td><td>${escapeHtml(op.a.text)}</td><td>${op.b.page}</td><td>${escapeHtml(op.b.text)}</td></tr>`
          : "";
      }
      if (op.type === "removed")
        return `<tr class="removed"><td>${op.a.page}</td><td><del>${escapeHtml(op.a.text)}</del></td><td></td><td></td></tr>`;
      if (op.type === "added")
        return `<tr class="added"><td></td><td></td><td>${op.b.page}</td><td><ins>${escapeHtml(op.b.text)}</ins></td></tr>`;
      const w = wordDiffHtml(op.a.text, op.b.text);
      return `<tr class="changed"><td>${op.a.page}</td><td>${w.a}</td><td>${op.b.page}</td><td>${w.b}</td></tr>`;
    })
    .filter(Boolean)
    .join("\n");
  const visualLine = visual
    ? `<p>Visual comparison: ${visual.changedPages.length ? `differences on page${visual.changedPages.length === 1 ? "" : "s"} ${visual.changedPages.join(", ")} of the changed file` : "no visible differences on matching pages"}${visual.pageCountA !== visual.pageCountB ? ` (page count ${visual.pageCountA} → ${visual.pageCountB})` : ""}.</p>`
    : "";
  const count = (t: DiffOp["type"]) => changes.filter((c) => c.type === t).length;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Comparison: ${escapeHtml(nameA)} vs ${escapeHtml(nameB)}</title>`,
    "<style>body{font-family:Arial,Helvetica,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;width:100%;font-size:14px}",
    "td,th{border:1px solid #ddd;padding:4px 6px;vertical-align:top}td:nth-child(odd){width:3rem;color:#666;text-align:right}",
    "tr.removed td{background:#fdecea}tr.added td{background:#e8f6ea}tr.changed td{background:#fff8e1}tr.same td{color:#666}",
    "del{background:#f8b4b0;text-decoration:line-through}ins{background:#a7e3b0;text-decoration:none}</style>",
    "</head><body>",
    `<h1>PDF comparison</h1><p><strong>Original:</strong> ${escapeHtml(nameA)}<br><strong>Changed:</strong> ${escapeHtml(nameB)}</p>`,
    changes.length
      ? `<p>${count("changed")} changed, ${count("added")} added and ${count("removed")} removed line(s).</p>`
      : "<p>The text of both documents is identical.</p>",
    visualLine,
    changes.length
      ? `<table><thead><tr><th>Page</th><th>Original</th><th>Page</th><th>Changed</th></tr></thead><tbody>${rows}</tbody></table>`
      : "",
    "</body></html>",
    "",
  ].join("\n");
}

interface VisualSummary {
  changedPages: number[];
  pageCountA: number;
  pageCountB: number;
  pdf: Uint8Array;
}

const CELL = 8;

/** Renders page pairs at 72 DPI and returns the changed cells (visual coordinates, points). */
async function changedCells(a: PdfJsDocument, b: PdfJsDocument, page: number) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const ra = await renderPage(a, page, { dpi: 72, format: "png" });
  const rb = await renderPage(b, page, { dpi: 72, format: "png" });
  if (
    Math.abs(ra.pointWidth - rb.pointWidth) > 1 ||
    Math.abs(ra.pointHeight - rb.pointHeight) > 1
  ) {
    return { sizeChanged: true, cells: [] as { x: number; y: number; w: number; h: number }[] };
  }
  const width = Math.min(ra.width, rb.width);
  const height = Math.min(ra.height, rb.height);
  const pixels = async (bytes: Uint8Array) => {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(await loadImage(Buffer.from(bytes)), 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const pa = await pixels(ra.bytes);
  const pb = await pixels(rb.bytes);
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  const scale = rb.pointWidth / rb.width;
  for (let cy = 0; cy < height; cy += CELL) {
    let runStart = -1;
    for (let cx = 0; cx <= width; cx += CELL) {
      let differs = false;
      if (cx < width) {
        outer: for (let y = cy; y < Math.min(cy + CELL, height); y += 1) {
          for (let x = cx; x < Math.min(cx + CELL, width); x += 1) {
            const i = (y * width + x) * 4;
            if (
              Math.abs(pa[i]! - pb[i]!) +
                Math.abs(pa[i + 1]! - pb[i + 1]!) +
                Math.abs(pa[i + 2]! - pb[i + 2]!) >
              60
            ) {
              differs = true;
              break outer;
            }
          }
        }
      }
      if (differs && runStart < 0) runStart = cx;
      if (!differs && runStart >= 0) {
        cells.push({
          x: runStart * scale,
          y: cy * scale,
          w: (cx - runStart) * scale,
          h: Math.min(CELL, height - cy) * scale,
        });
        runStart = -1;
      }
    }
  }
  return { sizeChanged: false, cells };
}

async function visualDiff(
  bytesA: Uint8Array,
  bytesB: Uint8Array,
  signal?: AbortSignal,
): Promise<VisualSummary> {
  const docB = await loadPdf(bytesB);
  const docA = await loadPdf(bytesA);
  const out = await PDFDocument.create();
  const font = await embedUnicodeFont(out, "bold");
  const pagesB = await out.copyPages(docB, docB.getPageIndices());
  const changedPages: number[] = [];
  const red = rgb(0.9, 0.1, 0.1);

  await withPdfJs(bytesA, (a) =>
    withPdfJs(bytesB, async (b) => {
      for (let n = 1; n <= b.numPages; n += 1) {
        throwIfAborted(signal);
        const page = out.addPage(pagesB[n - 1]!);
        const frame = visualFrame(page);
        const banner = (text: string) => {
          const at = frame.toPage(12, frame.height - 24);
          page.drawText(text, {
            x: at.x,
            y: at.y,
            size: 12,
            font,
            color: red,
            rotate: degrees(frame.rotation),
          });
        };
        if (n > a.numPages) {
          banner("Added page (not in the original)");
          changedPages.push(n);
          continue;
        }
        const { sizeChanged, cells } = await changedCells(a, b, n);
        if (sizeChanged) {
          banner("Page size changed");
          changedPages.push(n);
          continue;
        }
        if (cells.length === 0) continue;
        changedPages.push(n);
        for (const c of cells) {
          const origin = frame.toPage(c.x, frame.height - c.y - c.h);
          page.drawRectangle({
            x: origin.x,
            y: origin.y,
            width: c.w,
            height: c.h,
            color: red,
            opacity: 0.3,
            rotate: degrees(frame.rotation),
          });
        }
      }
    }),
  );
  if (docA.getPageCount() > docB.getPageCount()) {
    const removed = await out.copyPages(docA, docA.getPageIndices().slice(docB.getPageCount()));
    for (const page of removed) {
      out.addPage(page);
      const frame = visualFrame(page);
      const at = frame.toPage(12, frame.height - 24);
      page.drawText("Removed page (only in the original)", {
        x: at.x,
        y: at.y,
        size: 12,
        font,
        color: red,
        rotate: degrees(frame.rotation),
      });
    }
  }
  return {
    changedPages,
    pageCountA: docA.getPageCount(),
    pageCountB: docB.getPageCount(),
    pdf: await savePdf(out),
  };
}

export const comparePdfsExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(COMPARE_PDFS_TOOL_ID, async () => {
    const files = await readPdfInputs(input, ctx, { min: 2 });
    if (files.length > 2)
      throw unsupported("Choose exactly two PDFs: the original, then the changed version.");
    const [a, b] = files as [(typeof files)[0], (typeof files)[0]];
    const output = optEnum(options, "output", ["both", "report", "pdf"] as const, "both");

    const [linesA, linesB] = await Promise.all([
      withPdfJs(a.bytes, (pdf) => documentLines(pdf, ctx?.signal)),
      withPdfJs(b.bytes, (pdf) => documentLines(pdf, ctx?.signal)),
    ]);
    const ops = diffDocuments(linesA, linesB);
    const changes = ops.filter((o) => o.type !== "same");
    const visual =
      output === "report" && changes.length > 0
        ? null
        : await visualDiff(a.bytes, b.bytes, ctx?.signal);

    const results: OutputFile[] = [];
    if (output !== "pdf") {
      results.push({
        name: `${baseName(a.ref.name)}-vs-${baseName(b.ref.name)}.html`,
        mimeType: "text/html",
        bytes: new TextEncoder().encode(reportHtml(a.ref.name, b.ref.name, ops, visual)),
      });
    }
    if (output !== "report" && visual) {
      results.push({
        name: `${baseName(b.ref.name)}-differences.pdf`,
        mimeType: PDF_MIME,
        bytes: visual.pdf,
      });
    }
    const identical = changes.length === 0 && (visual?.changedPages.length ?? 0) === 0;
    return {
      ok: true,
      output: {
        identical,
        textChanges: {
          changed: changes.filter((c) => c.type === "changed").length,
          added: changes.filter((c) => c.type === "added").length,
          removed: changes.filter((c) => c.type === "removed").length,
        },
        visuallyChangedPages: visual?.changedPages ?? null,
        changes: changes
          .slice(0, 200)
          .map((c) =>
            c.type === "changed"
              ? { type: c.type, page: c.b.page, before: c.a.text, after: c.b.text }
              : c.type === "added"
                ? { type: c.type, page: c.b.page, after: c.b.text }
                : { type: c.type, page: c.a.page, before: c.a.text },
          ),
      },
      summary: identical
        ? "No differences found — the two PDFs match."
        : `Found ${plural(changes.length, "text change")}` +
          (visual
            ? ` and visual differences on ${plural(visual.changedPages.length, "page")}.`
            : "."),
      files: results,
    };
  });
