// Invoice rendering for the Invoice Generator (21-roadmap-expansion.md, roadmap §1.10).
//
// Kept in its own file, and imported lazily, so the arithmetic tools next door do not pull `pdf-lib`
// and `docx` in just to add two numbers together. The PDF is drawn directly rather than going
// through a template file, which means there is nothing extra to ship and nothing to keep in sync.
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { markdownToDocx } from "../dev-utils/markdown.ts";
import type { InvoiceLine } from "./finance.ts";

export interface InvoiceData {
  number: string;
  from: string;
  to: string;
  issued: string;
  due: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
  notes: string;
}

function amount(n: number): string {
  return n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** WinAnsi is all the standard fonts can draw, so anything outside it becomes "?" rather than throwing. */
function ascii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?");
}

export async function renderInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 56;
  const ink = rgb(0.08, 0.1, 0.12);
  const muted = rgb(0.42, 0.46, 0.5);
  const rule = rgb(0.82, 0.85, 0.88);
  let y = height - margin;

  const text = (s: string, x: number, size: number, font = regular, color = ink) =>
    page.drawText(ascii(s), { x, y, size, font, color });
  const right = (s: string, x: number, size: number, font = regular, color = ink) =>
    page.drawText(ascii(s), { x: x - font.widthOfTextAtSize(ascii(s), size), y, size, font, color });

  text("INVOICE", margin, 26, bold);
  right(data.number, width - margin, 12, bold, muted);
  y -= 34;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rule });
  y -= 26;

  text("From", margin, 9, bold, muted);
  text("Bill to", width / 2, 9, bold, muted);
  y -= 14;
  text(data.from, margin, 11);
  text(data.to, width / 2, 11);
  y -= 26;
  text(`Issued ${data.issued}`, margin, 10, regular, muted);
  text(`Due ${data.due}`, width / 2, 10, regular, muted);
  y -= 30;

  // Table header.
  const qtyX = width - margin - 250;
  const priceX = width - margin - 130;
  const totalX = width - margin;
  text("Description", margin, 9, bold, muted);
  right("Qty", qtyX + 40, 9, bold, muted);
  right("Unit price", priceX + 60, 9, bold, muted);
  right("Amount", totalX, 9, bold, muted);
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: rule });
  y -= 18;

  for (const line of data.lines) {
    if (y < margin + 140) break; // one page is enough for a personal invoice; the rest is in the JSON
    const lineTotal = line.quantity * line.unitPrice;
    const label = line.description.length > 48 ? `${line.description.slice(0, 47)}…` : line.description;
    text(label, margin, 10.5);
    right(String(line.quantity), qtyX + 40, 10.5);
    right(amount(line.unitPrice), priceX + 60, 10.5);
    right(amount(lineTotal), totalX, 10.5);
    y -= 18;
  }

  y -= 8;
  page.drawLine({ start: { x: priceX - 20, y }, end: { x: width - margin, y }, thickness: 0.7, color: rule });
  y -= 18;
  const totals: [string, string, boolean][] = [
    ["Subtotal", `${data.currency} ${amount(data.subtotal)}`, false],
    ...(data.taxPercent > 0
      ? ([[`Tax (${data.taxPercent}%)`, `${data.currency} ${amount(data.tax)}`, false]] as [string, string, boolean][])
      : []),
    ["Total", `${data.currency} ${amount(data.total)}`, true],
  ];
  for (const [label, value, strong] of totals) {
    right(label, priceX + 60, strong ? 12 : 10.5, strong ? bold : regular, strong ? ink : muted);
    right(value, totalX, strong ? 12 : 10.5, strong ? bold : regular);
    y -= strong ? 22 : 17;
  }

  if (data.notes) {
    y -= 12;
    text("Notes", margin, 9, bold, muted);
    y -= 14;
    for (const chunk of data.notes.match(/.{1,92}(\s|$)/g) ?? []) {
      text(chunk.trim(), margin, 10, regular, muted);
      y -= 14;
    }
  }
  return await doc.save();
}

export async function renderInvoiceDocx(data: InvoiceData): Promise<Uint8Array> {
  const rows = data.lines.map(
    (l) => `| ${l.description} | ${l.quantity} | ${amount(l.unitPrice)} | ${amount(l.quantity * l.unitPrice)} |`,
  );
  const md = [
    `# Invoice ${data.number}`,
    "",
    `**From:** ${data.from}`,
    "",
    `**Bill to:** ${data.to}`,
    "",
    `Issued ${data.issued} · Due ${data.due}`,
    "",
    "| Description | Qty | Unit price | Amount |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    `**Subtotal:** ${data.currency} ${amount(data.subtotal)}`,
    ...(data.taxPercent > 0 ? [`**Tax (${data.taxPercent}%):** ${data.currency} ${amount(data.tax)}`] : []),
    "",
    `**Total: ${data.currency} ${amount(data.total)}**`,
    ...(data.notes ? ["", "## Notes", "", data.notes] : []),
    "",
  ].join("\n");
  return await markdownToDocx(md, `Invoice ${data.number}`);
}
