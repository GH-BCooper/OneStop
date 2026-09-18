// Positioned text: where each piece of text sits on the page (06-pdf-tools-advanced.md).
//
// PDF → Word, Excel, PowerPoint and HTML, and Compare PDFs, all need more than the flat text
// PDF → Text returns: they need lines, their sizes and positions, and something that resembles
// paragraphs and table columns. This module derives all of that from pdf.js's text content,
// once, so the converters stay small and agree with each other.
import { parsePageSelection, throwIfAborted } from "./document.ts";
import { withPdfJs, type PdfJsDocument, type PdfJsPage } from "./render.ts";

/** One run of text, in page coordinates with the origin at the top-left (points). */
export interface TextRun {
  text: string;
  x: number;
  /** Top of the run (baseline minus font size). */
  y: number;
  baseline: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  baseline: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  runs: TextRun[];
}

export interface PageLayout {
  pageNumber: number;
  /** Page size as displayed (rotation applied), in points. */
  width: number;
  height: number;
  lines: TextLine[];
}

export type BlockKind = "heading1" | "heading2" | "heading3" | "paragraph";

export interface TextBlock {
  kind: BlockKind;
  lines: TextLine[];
  text: string;
  bold: boolean;
  italic: boolean;
  fontSize: number;
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/** Real font names ("ABCDEF+Arial-BoldMT") are only known once the operator list is loaded. */
function fontStyle(
  page: PdfJsPage,
  fontName: string | undefined,
): { bold: boolean; italic: boolean } {
  if (!fontName) return { bold: false, italic: false };
  let name = fontName;
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string; bold?: boolean } | null;
      if (font?.name) name = font.name;
      if (font?.bold) return { bold: true, italic: /italic|oblique/i.test(name) };
    }
  } catch {
    // Font not resolved; fall back to the id, which carries no style.
  }
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

async function pageRuns(
  page: PdfJsPage,
): Promise<{ runs: TextRun[]; width: number; height: number }> {
  const viewport = page.getViewport({ scale: 1 });
  try {
    await page.getOperatorList();
  } catch {
    // Styles are a nicety; text positions do not depend on them.
  }
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (typeof item.str !== "string" || item.str.trim() === "" || !item.transform) continue;
    const m = multiply(viewport.transform, item.transform);
    const fontSize = Math.hypot(m[2]!, m[3]!) || Math.hypot(m[0]!, m[1]!) || 10;
    const scaleX = Math.hypot(item.transform[0]!, item.transform[1]!) || 1;
    const vScaleX = Math.hypot(m[0]!, m[1]!) || scaleX;
    const width = (item.width ?? 0) * (vScaleX / scaleX);
    const baseline = m[5]!;
    runs.push({
      text: item.str,
      x: m[4]!,
      y: baseline - fontSize,
      baseline,
      width,
      fontSize,
      ...fontStyle(page, item.fontName),
    });
  }
  return { runs, width: viewport.width, height: viewport.height };
}

/** Groups runs that share a baseline into lines, left to right, top to bottom. */
export function groupLines(runs: TextRun[]): TextLine[] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: TextRun[][] = [];
  for (const run of sorted) {
    const line = lines.find((l) => {
      const ref = l[0]!;
      return (
        Math.abs(ref.baseline - run.baseline) <=
        Math.max(2, 0.45 * Math.min(ref.fontSize, run.fontSize))
      );
    });
    if (line) line.push(run);
    else lines.push([run]);
  }
  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let text = "";
      let end = -Infinity;
      for (const run of line) {
        const gap = run.x - end;
        if (
          text !== "" &&
          gap > run.fontSize * 0.15 &&
          !text.endsWith(" ") &&
          !run.text.startsWith(" ")
        ) {
          text += " ";
        }
        text += run.text;
        end = run.x + run.width;
      }
      const first = line[0]!;
      const fontSize = Math.max(...line.map((r) => r.fontSize));
      const x = first.x;
      return {
        text: text.replace(/\s+/g, " ").trim(),
        x,
        y: Math.min(...line.map((r) => r.y)),
        baseline: Math.max(...line.map((r) => r.baseline)),
        width: Math.max(...line.map((r) => r.x + r.width)) - x,
        fontSize,
        bold: line.every((r) => r.bold),
        italic: line.every((r) => r.italic),
        runs: line,
      };
    })
    .filter((l) => l.text !== "")
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}

/** Reads positioned lines for the selected pages. */
export async function extractLayout(
  bytes: Uint8Array,
  { pages, signal, password }: { pages?: string; signal?: AbortSignal; password?: string } = {},
): Promise<PageLayout[]> {
  return withPdfJs(
    bytes,
    async (doc) => layoutFromDocument(doc, parsePageSelection(pages, doc.numPages), signal),
    password !== undefined ? { password } : {},
  );
}

export async function layoutFromDocument(
  doc: PdfJsDocument,
  selected: number[],
  signal?: AbortSignal,
): Promise<PageLayout[]> {
  const out: PageLayout[] = [];
  for (const pageNumber of selected) {
    throwIfAborted(signal);
    const page = await doc.getPage(pageNumber);
    try {
      const { runs, width, height } = await pageRuns(page);
      out.push({ pageNumber, width, height, lines: groupLines(runs) });
    } finally {
      page.cleanup();
    }
  }
  return out;
}

/** The most common line font size across the document — the "body text" size. */
export function bodyFontSize(pages: PageLayout[]): number {
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const size = Math.round(line.fontSize * 2) / 2;
      counts.set(size, (counts.get(size) ?? 0) + line.text.length);
    }
  }
  let best = 11;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Joins lines into paragraphs and headings: a heading is noticeably larger than body text, a
 * paragraph break is a vertical gap, an indent, or a change of size.
 */
export function toBlocks(page: PageLayout, body: number): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextLine[] = [];
  const kindOf = (line: TextLine): BlockKind => {
    const ratio = line.fontSize / body;
    if (ratio >= 1.7) return "heading1";
    if (ratio >= 1.3) return "heading2";
    if (
      ratio >= 1.12 ||
      (line.bold && line.text.length < 80 && ratio >= 0.95 && !/[.,;:]$/.test(line.text))
    ) {
      return "heading3";
    }
    return "paragraph";
  };
  const flush = () => {
    if (current.length === 0) return;
    const kind = kindOf(current[0]!);
    const text = current
      .map((l) => l.text)
      .join(" ")
      .replace(/(\w)- (\w)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
    blocks.push({
      kind,
      lines: current,
      text,
      bold: current.every((l) => l.bold),
      italic: current.every((l) => l.italic),
      fontSize: current[0]!.fontSize,
    });
    current = [];
  };
  for (const line of page.lines) {
    const prev = current[current.length - 1];
    if (prev) {
      const gap = line.baseline - prev.baseline;
      const sameSize = Math.abs(line.fontSize - prev.fontSize) <= prev.fontSize * 0.1;
      const sameKind = kindOf(line) === kindOf(prev);
      const breaks =
        !sameSize ||
        !sameKind ||
        kindOf(line) !== "paragraph" ||
        gap > prev.fontSize * 1.75 ||
        gap < 0 ||
        Math.abs(line.x - current[0]!.x) > prev.fontSize * 2.5;
      if (breaks) flush();
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Splits each line into cells (runs separated by a wide gap) and snaps the cells to columns
 * shared across the page, so a PDF table comes out as rows × columns.
 */
export function toTable(page: PageLayout): string[][] {
  type Cell = { x: number; text: string };
  const rows: Cell[][] = page.lines.map((line) => {
    const cells: Cell[] = [];
    let current: Cell | null = null;
    let end = -Infinity;
    for (const run of line.runs) {
      const gap = run.x - end;
      if (!current || gap > Math.max(run.fontSize * 1.2, 8)) {
        current = { x: run.x, text: run.text.trim() };
        cells.push(current);
      } else {
        const joiner = gap > run.fontSize * 0.15 && !current.text.endsWith(" ") ? " " : "";
        current.text = `${current.text}${joiner}${run.text.trim()}`;
      }
      end = run.x + run.width;
    }
    return cells.filter((c) => c.text !== "");
  });

  const starts = rows
    .flat()
    .map((c) => c.x)
    .sort((a, b) => a - b);
  const columns: number[] = [];
  for (const x of starts) {
    const last = columns[columns.length - 1];
    if (last === undefined || x - last > 12) columns.push(x);
  }
  return rows
    .filter((cells) => cells.length > 0)
    .map((cells) => {
      const row = new Array<string>(Math.max(columns.length, 1)).fill("");
      for (const cell of cells) {
        let index = 0;
        for (let i = 0; i < columns.length; i += 1) {
          if (columns[i]! <= cell.x + 6) index = i;
        }
        while (row[index] !== "" && index < row.length - 1) index += 1;
        row[index] = row[index] ? `${row[index]} ${cell.text}` : cell.text;
      }
      return row;
    });
}
