// Input/output helpers for the phase-06 tools that take more than one kind of file or produce
// more than one result (06-pdf-tools-advanced.md): Watermark and Sign accept a PDF plus an image,
// batch tools return one PDF per input, packed into a ZIP when there are several.
import type { ExecContext, FileRef, OutputFile } from "@onestop/types";
import type { PDFDocument, PDFImage } from "@cantoo/pdf-lib";
import { baseName, looksLikePdf, readPdfInputs, type PdfInput } from "./document.ts";
import { unsupported } from "./errors.ts";
import { createZip, ZIP_MIME } from "./zip.ts";

export type ImageKind = "png" | "jpg";

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

export interface MixedInputs {
  pdfs: PdfInput[];
  images: (PdfInput & { kind: ImageKind })[];
}

/** Sorts uploaded files into PDFs and PNG/JPG images by their bytes, not their names. */
export async function readMixedInputs(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
): Promise<MixedInputs> {
  const files = await readPdfInputs(input, ctx);
  const out: MixedInputs = { pdfs: [], images: [] };
  for (const file of files) {
    if (looksLikePdf(file.bytes)) {
      out.pdfs.push(file);
      continue;
    }
    const kind = imageKind(file.bytes);
    if (kind) out.images.push({ ...file, kind });
    else throw unsupported(`"${file.ref.name}" is not a PDF, PNG or JPG file.`);
  }
  if (out.pdfs.length === 0) throw unsupported("Choose a PDF file first.");
  return out;
}

const MAX_DATA_URL_BYTES = 3 * 1024 * 1024;

/**
 * Decodes a `data:image/png;base64,…` (or JPEG) value from a drawn-signature option. Strict: only
 * PNG/JPEG, only base64, capped in size, and the decoded bytes must really be that image type.
 */
export function decodeImageDataUrl(value: string): { bytes: Uint8Array; kind: ImageKind } | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(value.trim());
  if (!match) return null;
  if (match[2]!.length > (MAX_DATA_URL_BYTES * 4) / 3) {
    throw unsupported("The drawn signature is too large. Clear it and draw it again.");
  }
  const bytes = new Uint8Array(Buffer.from(match[2]!.replace(/\s+/g, ""), "base64"));
  const kind = imageKind(bytes);
  if (!kind) return null;
  return { bytes, kind };
}

export async function embedImage(
  doc: PDFDocument,
  image: { bytes: Uint8Array; kind: ImageKind },
): Promise<PDFImage> {
  try {
    return image.kind === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  } catch {
    throw unsupported("The image could not be read. Try a different PNG or JPG file.");
  }
}

/** One result → returned as is; several → one ZIP, unless the user asked for separate files. */
export function packageOutputs(
  files: OutputFile[],
  zipName: string,
  packaging: "zip" | "files" = "zip",
): OutputFile[] {
  if (files.length <= 1 || packaging === "files") return files;
  return [
    {
      name: zipName,
      mimeType: ZIP_MIME,
      bytes: createZip(files.map((f) => ({ name: f.name, bytes: f.bytes }))),
    },
  ];
}

export function zipNameFor(first: PdfInput, suffix: string): string {
  return `${baseName(first.ref.name)}-${suffix}.zip`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
