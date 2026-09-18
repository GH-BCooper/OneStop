// A small flowing-layout PDF writer for the built-in Office → PDF converters
// (06-pdf-tools-advanced.md; used by phases 07/08 through office-convert.ts).
//
// Headings, wrapped paragraphs with bold/italic runs, bullet items, simple ruled tables, images
// and page breaks — enough to turn a document's structure into a clean, readable PDF when
// LibreOffice is not installed. Embedded Unicode fonts, so any Latin/Greek/Cyrillic text works.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { drawableText, embedUnicodeFont } from "../../pdf/fonts.ts";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

export interface FlowOptions {
  pageSize?: [number, number];
  margin?: number;
  fontSize?: number;
}

export class FlowPdf {
  private page!: PDFPage;
  private y = 0;
  private constructor(
    readonly doc: PDFDocument,
    private readonly fonts: Fonts,
    private pageSize: [number, number],
    private readonly margin: number,
    readonly fontSize: number,
  ) {}

  static async create({
    pageSize = [595.28, 841.89],
    margin = 56,
    fontSize = 11,
  }: FlowOptions = {}) {
    const doc = await PDFDocument.create();
    const fonts: Fonts = {
      regular: await embedUnicodeFont(doc, "regular"),
      bold: await embedUnicodeFont(doc, "bold"),
      italic: await embedUnicodeFont(doc, "italic"),
      boldItalic: await embedUnicodeFont(doc, "bold-italic"),
    };
    const writer = new FlowPdf(doc, fonts, pageSize, margin, fontSize);
    writer.newPage();
    return writer;
  }

  get contentWidth(): number {
    return this.pageSize[0] - this.margin * 2;
  }

  private font(run: Run): PDFFont {
    if (run.bold && run.italic) return this.fonts.boldItalic;
    if (run.bold) return this.fonts.bold;
    if (run.italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  newPage(size?: [number, number]): void {
    if (size) this.pageSize = size;
    this.page = this.doc.addPage(this.pageSize);
    this.y = this.pageSize[1] - this.margin;
  }

  /** Starts a new page unless the current one is still empty. */
  pageBreak(size?: [number, number]): void {
    if (
      this.y < this.pageSize[1] - this.margin - 1 ||
      (size && (size[0] !== this.pageSize[0] || size[1] !== this.pageSize[1]))
    ) {
      this.newPage(size);
    }
  }

  private ensure(height: number): void {
    if (this.y - height < this.margin) this.newPage();
  }

  space(points: number): void {
    this.y -= points;
  }

  /** Wraps mixed-style runs into lines that fit `width`, then draws them. */
  paragraph(
    runs: Run[],
    {
      size = this.fontSize,
      indent = 0,
      after = size * 0.6,
      bullet,
    }: { size?: number; indent?: number; after?: number; bullet?: string } = {},
  ): void {
    const words: { text: string; font: PDFFont; width: number; space: number }[] = [];
    for (const run of runs) {
      const font = this.font(run);
      for (const part of drawableText(font, run.text).split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) {
          const last = words[words.length - 1];
          if (last) last.space = font.widthOfTextAtSize(" ", size);
          continue;
        }
        words.push({ text: part, font, width: font.widthOfTextAtSize(part, size), space: 0 });
      }
    }
    if (words.length === 0) {
      this.space(size * 0.8);
      return;
    }
    const width = this.contentWidth - indent;
    const lineHeight = size * 1.35;
    let line: typeof words = [];
    let lineWidth = 0;
    let firstLine = true;
    const flush = () => {
      this.ensure(lineHeight);
      this.y -= size;
      if (firstLine && bullet) {
        this.page.drawText(bullet, {
          x: this.margin + indent - size,
          y: this.y,
          size,
          font: this.fonts.regular,
        });
      }
      let x = this.margin + indent;
      for (const word of line) {
        this.page.drawText(word.text, {
          x,
          y: this.y,
          size,
          font: word.font,
          color: rgb(0.07, 0.07, 0.07),
        });
        x += word.width + word.space;
      }
      this.y -= lineHeight - size;
      line = [];
      lineWidth = 0;
      firstLine = false;
    };
    for (const word of words) {
      // A single word longer than the line is hard-split so it can never overflow the page.
      let piece = word;
      while (piece.width > width) {
        let cut = piece.text.length - 1;
        while (cut > 1 && piece.font.widthOfTextAtSize(piece.text.slice(0, cut), size) > width)
          cut -= 1;
        if (line.length) flush();
        line.push({
          ...piece,
          text: piece.text.slice(0, cut),
          width: piece.font.widthOfTextAtSize(piece.text.slice(0, cut), size),
          space: 0,
        });
        flush();
        const rest = piece.text.slice(cut);
        piece = { ...piece, text: rest, width: piece.font.widthOfTextAtSize(rest, size) };
      }
      if (line.length && lineWidth + piece.width > width) flush();
      line.push(piece);
      lineWidth += piece.width + piece.space;
    }
    if (line.length) flush();
    this.y -= after;
  }

  heading(text: string, level: number): void {
    const size = [0, 22, 18, 15, 13, 12, 11][Math.min(Math.max(level, 1), 6)]!;
    this.ensure(size * 3);
    this.space(size * 0.4);
    this.paragraph([{ text, bold: true }], { size, after: size * 0.5 });
  }

  /** A ruled table; columns share the width in proportion to their longest text. */
  table(
    rows: string[][],
    {
      size = Math.max(7, this.fontSize - 2),
      header = true,
    }: { size?: number; header?: boolean } = {},
  ): void {
    const columns = Math.max(0, ...rows.map((r) => r.length));
    if (columns === 0) return;
    const longest = Array.from({ length: columns }, (_, c) =>
      Math.min(40, Math.max(3, ...rows.map((r) => (r[c] ?? "").length))),
    );
    const total = longest.reduce((a, b) => a + b, 0);
    const widths = longest.map((l) => (l / total) * this.contentWidth);
    const pad = 3;
    for (const [index, row] of rows.entries()) {
      const bold = header && index === 0;
      const font = bold ? this.fonts.bold : this.fonts.regular;
      const cells = widths.map((w, c) =>
        wrap(drawableText(font, row[c] ?? ""), font, size, w - pad * 2),
      );
      const height = Math.max(1, ...cells.map((l) => l.length)) * size * 1.25 + pad * 2;
      this.ensure(height);
      let x = this.margin;
      for (const [c, lines] of cells.entries()) {
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: widths[c]!,
          height,
          borderColor: rgb(0.7, 0.7, 0.7),
          borderWidth: 0.5,
          ...(bold ? { color: rgb(0.93, 0.93, 0.93) } : {}),
        });
        lines.forEach((text, i) => {
          this.page.drawText(text, {
            x: x + pad,
            y: this.y - pad - size * (i + 1) * 1.25 + size * 0.25,
            size,
            font,
          });
        });
        x += widths[c]!;
      }
      this.y -= height;
    }
    this.y -= this.fontSize;
  }

  async image(bytes: Uint8Array, kind: "png" | "jpg", maxWidth = this.contentWidth): Promise<void> {
    const image = kind === "png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    const maxHeight = this.pageSize[1] - this.margin * 2;
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    this.ensure(h);
    this.page.drawImage(image, { x: this.margin, y: this.y - h, width: w, height: h });
    this.y -= h + this.fontSize * 0.6;
  }

  /** Draws text at an absolute position on the current page (slides use this). */
  textAt(
    text: string,
    x: number,
    top: number,
    {
      size,
      bold,
      italic,
      width,
    }: { size: number; bold?: boolean; italic?: boolean; width: number },
  ): number {
    const font = this.font({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
    const lines = wrap(drawableText(font, text), font, size, Math.max(width, size));
    lines.forEach((line, i) => {
      this.page.drawText(line, {
        x,
        y: this.pageSize[1] - top - size * (i + 1) * 1.2 + size * 0.2,
        size,
        font,
        color: rgb(0.07, 0.07, 0.07),
      });
    });
    return lines.length * size * 1.2;
  }

  async imageAt(
    bytes: Uint8Array,
    kind: "png" | "jpg",
    x: number,
    top: number,
    width: number,
    height: number,
  ): Promise<void> {
    const image = kind === "png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    this.page.drawImage(image, { x, y: this.pageSize[1] - top - height, width, height });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: true });
  }
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}
