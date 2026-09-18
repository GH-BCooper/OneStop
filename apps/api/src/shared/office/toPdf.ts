// Built-in Office → PDF converters: the no-LibreOffice fallback (06-pdf-tools-advanced.md).
//
// Lower fidelity than LibreOffice by design, but never empty or garbled: the document's text,
// headings, emphasis, lists, tables and images come through in order.
// - .docx: mammoth turns it into semantic HTML, which is laid out with FlowPdf;
// - .xlsx: exceljs reads each sheet, drawn as a ruled table (landscape when it is wide);
// - .pptx: each slide's shapes and pictures are placed at their positions on a slide-sized page;
// - .txt: wrapped plain text.
import JSZip from "jszip";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { FlowPdf, type Run } from "./flowPdf.ts";
import { imageKind } from "../../pdf/inputs.ts";

export class OfficeReadError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "OfficeReadError";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// ---- Word -------------------------------------------------------------------------------------

export async function docxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }));
  } catch (err) {
    throw new OfficeReadError("This Word document could not be read. It may be damaged.", err);
  }
  const pdf = await FlowPdf.create();
  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  let block: { tag: string; depth: number } | null = null;
  let listDepth = 0;
  const ordered: number[] = [];
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;

  const flush = async () => {
    const text = runs.map((r) => r.text).join("");
    if (!block || text.trim() === "") {
      runs = [];
      return;
    }
    if (/^h[1-6]$/.test(block.tag)) pdf.heading(text.trim(), Number(block.tag[1]));
    else if (block.tag === "li") {
      const counter = ordered[ordered.length - 1];
      const bullet = counter !== undefined && counter > 0 ? `${counter}.` : "•";
      if (counter !== undefined && counter > 0) ordered[ordered.length - 1] = counter + 1;
      pdf.paragraph(runs, { indent: 16 * block.depth, bullet, after: 2 });
    } else pdf.paragraph(runs);
    runs = [];
  };

  const token = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  for (const match of html.matchAll(token)) {
    const [, closing, rawTag, attrs, text] = match;
    if (text !== undefined) {
      const value = decodeEntities(text);
      if (cell !== null) cell += value;
      else runs.push({ text: value, bold: bold > 0, italic: italic > 0 });
      continue;
    }
    const tag = rawTag!.toLowerCase();
    const open = closing === "";
    switch (tag) {
      case "strong":
      case "b":
        bold += open ? 1 : -1;
        break;
      case "em":
      case "i":
        italic += open ? 1 : -1;
        break;
      case "br":
        if (cell !== null) cell += "\n";
        else runs.push({ text: " " });
        break;
      case "p":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
      case "li":
        if (cell !== null) {
          if (!open) cell += " ";
          break;
        }
        await flush();
        block = open ? { tag, depth: Math.max(1, listDepth) } : null;
        break;
      case "ul":
      case "ol":
        await flush();
        listDepth += open ? 1 : -1;
        if (open) ordered.push(tag === "ol" ? 1 : 0);
        else ordered.pop();
        break;
      case "table":
        await flush();
        if (open) table = [];
        else if (table) {
          pdf.table(table);
          table = null;
        }
        break;
      case "tr":
        if (open) row = [];
        else if (row && table) {
          table.push(row);
          row = null;
        }
        break;
      case "td":
      case "th":
        if (open) cell = "";
        else if (cell !== null && row) {
          row.push(cell.trim());
          cell = null;
        }
        break;
      case "img": {
        const src = /src="data:image\/(png|jpeg|jpg);base64,([^"]+)"/i.exec(attrs ?? "");
        if (src) {
          await flush();
          const data = new Uint8Array(Buffer.from(src[2]!, "base64"));
          const kind = imageKind(data);
          if (kind) await pdf.image(data, kind).catch(() => undefined);
        }
        break;
      }
      default:
        break;
    }
  }
  await flush();
  return pdf.save();
}

// ---- Excel ------------------------------------------------------------------------------------

export async function xlsxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch (err) {
    throw new OfficeReadError("This Excel workbook could not be read. It may be damaged.", err);
  }
  let pdf: FlowPdf | null = null;
  for (const sheet of workbook.worksheets) {
    if (sheet.state && sheet.state !== "visible") continue;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (r) => {
      const values: string[] = [];
      for (let c = 1; c <= sheet.actualColumnCount || c <= r.cellCount; c += 1) {
        values.push(r.getCell(c).text ?? "");
      }
      while (values.length && values[values.length - 1] === "") values.pop();
      rows.push(values);
    });
    const columns = Math.max(0, ...rows.map((r) => r.length));
    const landscape: [number, number] = [841.89, 595.28];
    const portrait: [number, number] = [595.28, 841.89];
    const size = columns > 6 ? landscape : portrait;
    if (!pdf) pdf = await FlowPdf.create({ pageSize: size, margin: 36, fontSize: 10 });
    else pdf.pageBreak(size);
    pdf.heading(sheet.name, 2);
    if (rows.length === 0) pdf.paragraph([{ text: "(empty sheet)", italic: true }]);
    else pdf.table(rows, { size: columns > 12 ? 6 : 8 });
  }
  if (!pdf) {
    pdf = await FlowPdf.create();
    pdf.paragraph([{ text: "(this workbook has no visible sheets)", italic: true }]);
  }
  return pdf.save();
}

// ---- PowerPoint -------------------------------------------------------------------------------

const EMU_PER_POINT = 12700;

interface SlideShape {
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs?: { text: string; size?: number; bold?: boolean; italic?: boolean }[];
  image?: string;
}

function attr(xml: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
}

function shapesOf(xml: string): SlideShape[] {
  const shapes: SlideShape[] = [];
  for (const m of xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)) {
    const body = m[0];
    const off = /<a:off\b([^>]*)\/?>/.exec(body)?.[1] ?? "";
    const ext = /<a:ext\b([^>]*)\/?>/.exec(body)?.[1] ?? "";
    const shape: SlideShape = {
      x: Number(attr(off, "x") ?? 0) / EMU_PER_POINT,
      y: Number(attr(off, "y") ?? 0) / EMU_PER_POINT,
      w: Number(attr(ext, "cx") ?? 0) / EMU_PER_POINT,
      h: Number(attr(ext, "cy") ?? 0) / EMU_PER_POINT,
    };
    if (m[1] === "pic") {
      const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(body)?.[1];
      if (embed) shape.image = embed;
    } else {
      const paragraphs: NonNullable<SlideShape["paragraphs"]> = [];
      for (const p of body.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
        const runs = [...p[0].matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)].map((r) => r[0]);
        const text = runs
          .map((r) => decodeEntities(/<a:t>([\s\S]*?)<\/a:t>/.exec(r)?.[1] ?? ""))
          .join("");
        if (text.trim() === "") continue;
        const rPr = /<a:rPr\b([^>]*)/.exec(runs[0] ?? "")?.[1] ?? "";
        const sz = attr(rPr, "sz");
        paragraphs.push({
          text,
          ...(sz ? { size: Number(sz) / 100 } : {}),
          bold: attr(rPr, "b") === "1",
          italic: attr(rPr, "i") === "1",
        });
      }
      if (paragraphs.length) shape.paragraphs = paragraphs;
    }
    if (shape.image || shape.paragraphs) shapes.push(shape);
  }
  return shapes;
}

function resolveTarget(base: string, target: string): string {
  const parts = base.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

function relationships(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of (xml ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, "Id");
    const target = attr(m[1]!, "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

export async function pptxToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new OfficeReadError("This PowerPoint file could not be read. It may be damaged.", err);
  }
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentation)
    throw new OfficeReadError("This PowerPoint file could not be read. It may be damaged.");
  const sldSz = /<p:sldSz\b([^>]*)/.exec(presentation)?.[1] ?? "";
  const width = Number(attr(sldSz, "cx") ?? 12192000) / EMU_PER_POINT;
  const height = Number(attr(sldSz, "cy") ?? 6858000) / EMU_PER_POINT;
  const presRels = relationships(
    await zip.file("ppt/_rels/presentation.xml.rels")?.async("string"),
  );
  const order = [...presentation.matchAll(/<p:sldId\b([^>]*)\/?>/g)]
    .map((m) => attr(m[1]!, "r:id"))
    .map((id) => (id ? presRels.get(id) : undefined))
    .filter((t): t is string => Boolean(t))
    .map((t) => resolveTarget("ppt/presentation.xml", t));

  const pdf = await FlowPdf.create({ pageSize: [width, height], margin: 0 });
  let first = true;
  for (const path of order) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    if (!first) pdf.newPage([width, height]);
    first = false;
    const rels = relationships(
      await zip
        .file(path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"))
        ?.async("string"),
    );
    for (const shape of shapesOf(xml)) {
      if (shape.image) {
        const target = rels.get(shape.image);
        const data = target
          ? await zip.file(resolveTarget(path, target))?.async("uint8array")
          : undefined;
        const kind = data ? imageKind(data) : null;
        if (data && kind)
          await pdf.imageAt(data, kind, shape.x, shape.y, shape.w, shape.h).catch(() => undefined);
        continue;
      }
      let top = shape.y;
      for (const p of shape.paragraphs ?? []) {
        const size = p.size ?? 18;
        top += pdf.textAt(p.text, shape.x, top, {
          size,
          width: shape.w || width - shape.x,
          ...(p.bold ? { bold: true } : {}),
          ...(p.italic ? { italic: true } : {}),
        });
      }
    }
  }
  return pdf.save();
}

// ---- Plain text -------------------------------------------------------------------------------

export async function textToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const text = new TextDecoder().decode(bytes);
  const pdf = await FlowPdf.create({ fontSize: 10.5 });
  for (const paragraph of text.split(/\r?\n/)) pdf.paragraph([{ text: paragraph }], { after: 1 });
  return pdf.save();
}
