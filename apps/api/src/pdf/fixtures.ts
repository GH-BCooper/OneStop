// Test fixtures for the PDF tools (05-pdf-tools-core.md — "golden-file tests").
//
// The samples are built at run time rather than committed as binaries: it keeps the repo free of
// opaque blobs, and it means a fixture can be described ("three pages, mixed sizes") instead of
// inspected. Only tests import this file.
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

export interface TextPdfOptions {
  pages?: number;
  /** Page sizes in points; cycled when there are more pages than sizes. */
  sizes?: [number, number][];
  title?: string;
}

/** A plain multi-page PDF with real, extractable text. */
export async function makeTextPdf({
  pages = 3,
  sizes = [[595.28, 841.89]],
  title = "OneStop fixture",
}: TextPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const size = sizes[i % sizes.length]!;
    const page = doc.addPage(size);
    page.drawText(`Page ${i + 1} of ${pages}`, {
      x: 40,
      y: size[1] - 80,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`This is fixture text for page ${i + 1}.`, {
      x: 40,
      y: size[1] - 120,
      size: 12,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  doc.setTitle(title);
  return doc.save();
}

/** A single-page PDF — the edge case split/extract/reorder have to survive. */
export async function makeSinglePagePdf(): Promise<Uint8Array> {
  return makeTextPdf({ pages: 1, title: "single" });
}

/**
 * A PDF dominated by photographic JPEG data, for the "compress meaningfully reduces file size"
 * criterion. The noise is deliberate: a flat colour would compress to nothing and prove nothing.
 */
export async function makeImageHeavyPdf(pages = 2): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const width = 1240;
  const height = 1754; // A4 at 150 DPI
  const doc = await PDFDocument.create();

  for (let p = 0; p < pages; p += 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    const data = image.data;
    let seed = 1103515245 + p * 7919;
    for (let i = 0; i < data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = seed % 256;
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      data[i] = (noise + x) % 256;
      data[i + 1] = (noise + y) % 256;
      data[i + 2] = (noise * 3) % 256;
      data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const jpeg = canvas.toBuffer("image/jpeg", 92);
    const embedded = await doc.embedJpg(new Uint8Array(jpeg));
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(embedded, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}

/**
 * A structurally valid PDF whose trailer declares encryption. pdf-lib and pdf.js both refuse it
 * the same way a real password-protected file is refused, which is exactly what the reject-path
 * test needs — and it keeps a genuinely encrypted binary out of the repo.
 */
export function makeEncryptedPdf(): Uint8Array {
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
    "4 0 obj<</Filter/Standard/V 1/R 2/O<0102030405060708090a0b0c0d0e0f10" +
      "1112131415161718191a1b1c1d1e1f20>/U<0102030405060708090a0b0c0d0e0f10" +
      "1112131415161718191a1b1c1d1e1f20>/P -1>>endobj",
    "trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R/ID[<0102030405060708090a0b0c0d0e0f10>" +
      "<0102030405060708090a0b0c0d0e0f10>]>>",
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(body);
}

function lastIndexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = haystack.length - needle.length; i >= 0; i -= 1) {
    if (needle.every((b, j) => haystack[i + j] === b)) return i;
  }
  return -1;
}

export type Corruption = "truncated" | "bad-xref" | "leading-junk" | "trailing-junk";

/** Damages a valid PDF in a specific, reproducible way. */
export async function makeCorruptPdf(kind: Corruption = "bad-xref"): Promise<Uint8Array> {
  const valid = await makeTextPdf({ pages: 2 });

  if (kind === "truncated") {
    return valid.subarray(0, Math.floor(valid.length * 0.6));
  }
  if (kind === "bad-xref") {
    // Point startxref at an offset that is not a cross-reference table. Done byte-for-byte in
    // place: re-encoding the file through a text codec would corrupt its compressed streams.
    const broken = new Uint8Array(valid);
    const marker = new TextEncoder().encode("startxref");
    const at = lastIndexOfBytes(broken, marker);
    if (at >= 0) {
      let cursor = at + marker.length;
      while (cursor < broken.length && (broken[cursor] === 0x0a || broken[cursor] === 0x0d)) {
        cursor += 1;
      }
      while (cursor < broken.length && broken[cursor]! >= 0x30 && broken[cursor]! <= 0x39) {
        broken[cursor] = 0x39; // every digit becomes 9 — a wildly wrong, same-length offset
        cursor += 1;
      }
    }
    return broken;
  }
  if (kind === "leading-junk") {
    const junk = new TextEncoder().encode("GARBAGE BEFORE THE HEADER\n");
    const out = new Uint8Array(junk.length + valid.length);
    out.set(junk, 0);
    out.set(valid, junk.length);
    return out;
  }
  const junk = new TextEncoder().encode("\ntrailing junk that is not part of the document\n");
  const out = new Uint8Array(valid.length + junk.length);
  out.set(valid, 0);
  out.set(junk, valid.length);
  return out;
}

// ---- phase 06 fixtures (06-pdf-tools-advanced.md) ---------------------------------------------

/**
 * An image-only "scan": real text rendered to pixels, with no text layer at all — exactly what a
 * scanner produces. OCR must recover the words from the pixels alone.
 */
export async function makeScannedPdf(
  lines: string[] = ["Invoice number 4821", "Total due 1250 dollars", "OneStop scanned fixture"],
): Promise<Uint8Array> {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
  const { findPackageDir } = await import("../shared/node-modules.ts");
  const dir = findPackageDir("pdfjs-dist", "standard_fonts");
  if (dir)
    GlobalFonts.registerFromPath(`${dir}/standard_fonts/LiberationSans-Regular.ttf`, "FixtureSans");
  const width = 1240;
  const height = 1754; // A4 at 150 DPI
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "44px FixtureSans";
  lines.forEach((line, i) => ctx.fillText(line, 110, 220 + i * 90));
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(new Uint8Array(canvas.toBuffer("image/png")));
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return doc.save();
}

/** A fillable form: text, checkbox, dropdown and radio fields. */
export async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  const name = form.createTextField("Name");
  name.addToPage(page, { x: 50, y: 700, width: 250, height: 24 });
  const subscribe = form.createCheckBox("Subscribe");
  subscribe.addToPage(page, { x: 50, y: 650, width: 18, height: 18 });
  const country = form.createDropdown("Country");
  country.addOptions(["India", "UK", "US"]);
  country.addToPage(page, { x: 50, y: 600, width: 150, height: 24 });
  const plan = form.createRadioGroup("Plan");
  plan.addOptionToPage("basic", page, { x: 50, y: 550, width: 18, height: 18 });
  plan.addOptionToPage("pro", page, { x: 100, y: 550, width: 18, height: 18 });
  return doc.save();
}

/** A document with a heading, body paragraphs and a small table, for the Office converters. */
export async function makeStructuredPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Quarterly Report", { x: 56, y: 770, size: 26, font: bold });
  page.drawText("Revenue grew steadily across every region this quarter.", {
    x: 56,
    y: 720,
    size: 11,
    font: regular,
  });
  page.drawText("The team shipped three major releases on schedule.", {
    x: 56,
    y: 704,
    size: 11,
    font: regular,
  });
  const rows = [
    ["Region", "Units", "Revenue"],
    ["North", "120", "4,500.50"],
    ["South", "85", "3,210.00"],
  ];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      page.drawText(cell, {
        x: 56 + c * 150,
        y: 640 - r * 20,
        size: 11,
        font: r === 0 ? bold : regular,
      });
    });
  });
  const second = doc.addPage([595.28, 841.89]);
  second.drawText("Next Steps", { x: 56, y: 770, size: 26, font: bold });
  second.drawText("Hire two engineers and expand support hours.", {
    x: 56,
    y: 720,
    size: 11,
    font: regular,
  });
  doc.setTitle("Quarterly Report");
  return doc.save();
}

/** A small opaque PNG (a dark bar), standing in for a signature or logo. */
export async function makePng(width = 200, height = 60): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b1f5c";
  ctx.fillRect(10, height / 2 - 4, width - 20, 8);
  return new Uint8Array(canvas.toBuffer("image/png"));
}
