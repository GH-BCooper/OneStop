// The one Office ⇄ PDF conversion interface (06-pdf-tools-advanced.md).
//
// Phase 06's PDF → Word/Excel/PowerPoint tools and phases 07/08's Word/Excel/PowerPoint → PDF
// tools all go through here, so there is exactly one place that decides *how* a conversion runs:
//
//   officeToPdf  LibreOffice (if installed) → built-in converter (docx/xlsx/pptx/txt)
//   pdfToOffice  built-in converter (default) → LibreOffice only when explicitly asked for (docx)
//
// LibreOffice is optional. When it is missing, a conversion the built-in path can do still runs
// and comes back with a `notice` saying fidelity may be lower; one it cannot do (e.g. legacy .doc)
// fails with an actionable message — it never crashes the app.
import { convertWithLibreOffice, findLibreOffice, LibreOfficeError } from "./libreoffice.ts";
import { pdfToDocx, pdfToPptx, pdfToXlsx, type FromPdfOptions } from "./office/fromPdf.ts";
import { docxToPdf, OfficeReadError, pptxToPdf, textToPdf, xlsxToPdf } from "./office/toPdf.ts";

export { findLibreOffice, setLibreOfficeLocator } from "./libreoffice.ts";
export { OfficeReadError } from "./office/toPdf.ts";
export type { FromPdfOptions } from "./office/fromPdf.ts";

export type OfficeTarget = "docx" | "xlsx" | "pptx";
export type OfficeSource =
  "docx" | "doc" | "odt" | "rtf" | "txt" | "xlsx" | "xls" | "ods" | "csv" | "pptx" | "ppt" | "odp";
export type ConvertEngine = "libreoffice" | "builtin";

export interface ConvertResult {
  bytes: Uint8Array;
  engine: ConvertEngine;
  /** Shown to the user when a lower-fidelity path was taken, and why. */
  notice?: string;
  pages?: number;
  units?: number;
}

export const LIBREOFFICE_MISSING_NOTICE =
  "LibreOffice isn't installed, so OneStop's built-in converter was used — text and structure are kept, but layout may differ. Install LibreOffice (free, libreoffice.org) for higher-fidelity conversions.";

const BUILTIN_TO_PDF: Partial<Record<OfficeSource, (bytes: Uint8Array) => Promise<Uint8Array>>> = {
  docx: docxToPdf,
  xlsx: xlsxToPdf,
  pptx: pptxToPdf,
  txt: textToPdf,
};

const LABEL: Record<OfficeSource, string> = {
  docx: "Word",
  doc: "Word",
  odt: "OpenDocument text",
  rtf: "RTF",
  txt: "text",
  xlsx: "Excel",
  xls: "Excel",
  ods: "OpenDocument spreadsheet",
  csv: "CSV",
  pptx: "PowerPoint",
  ppt: "PowerPoint",
  odp: "OpenDocument presentation",
};

export class OfficeConvertError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "OfficeConvertError";
  }
}

export interface ConvertOptions {
  /** "auto" prefers LibreOffice when present; "builtin" never uses it; "libreoffice" prefers it. */
  engine?: "auto" | "builtin" | "libreoffice";
  signal?: AbortSignal;
}

/** Word/Excel/PowerPoint/OpenDocument/text → PDF. Used by phases 07 and 08. */
export async function officeToPdf(
  bytes: Uint8Array,
  from: OfficeSource,
  { engine = "auto", signal }: ConvertOptions = {},
): Promise<ConvertResult> {
  const builtin = BUILTIN_TO_PDF[from];
  const soffice = engine === "builtin" ? null : findLibreOffice();
  let notice: string | undefined;

  if (soffice) {
    try {
      return {
        bytes: await convertWithLibreOffice(bytes, from, "pdf", signal ? { signal } : {}),
        engine: "libreoffice",
      };
    } catch (err) {
      if (!builtin) {
        throw new OfficeConvertError(
          `This ${LABEL[from]} file could not be converted. It may be damaged or password protected.`,
          err,
        );
      }
      console.error("[office-convert] LibreOffice failed, using the built-in converter", err);
      notice =
        "LibreOffice could not convert this file, so OneStop's built-in converter was used — layout may differ.";
    }
  }
  if (!builtin) {
    throw new OfficeConvertError(
      `Converting ${LABEL[from]} (.${from}) files needs LibreOffice, which isn't installed. Install it free from libreoffice.org, or save the file as .${from.startsWith("x") || from === "ods" || from === "csv" ? "xlsx" : from.startsWith("p") || from === "odp" ? "pptx" : "docx"} and try again.`,
    );
  }
  try {
    const out = await builtin(bytes);
    return {
      bytes: out,
      engine: "builtin",
      notice: notice ?? (engine === "builtin" ? undefined : LIBREOFFICE_MISSING_NOTICE),
    } as ConvertResult;
  } catch (err) {
    if (err instanceof OfficeReadError) throw new OfficeConvertError(err.message, err.detail);
    throw new OfficeConvertError(`This ${LABEL[from]} file could not be converted.`, err);
  }
}

const FROM_PDF = {
  docx: pdfToDocx,
  xlsx: pdfToXlsx,
  pptx: pdfToPptx,
} as const;

/**
 * PDF → Word/Excel/PowerPoint. The built-in converter is the default because it produces real,
 * editable structure; LibreOffice's PDF import (Word only) is used only when asked for.
 */
export async function pdfToOffice(
  bytes: Uint8Array,
  to: OfficeTarget,
  options: FromPdfOptions & ConvertOptions = {},
): Promise<ConvertResult> {
  if (options.engine === "libreoffice" && to === "docx") {
    if (findLibreOffice()) {
      try {
        const out = await convertWithLibreOffice(bytes, "pdf", "docx", {
          infilter: "writer_pdf_import",
          ...(options.signal ? { signal: options.signal } : {}),
        });
        return { bytes: out, engine: "libreoffice" };
      } catch (err) {
        console.error(
          "[office-convert] LibreOffice PDF import failed, using the built-in converter",
          err,
        );
        const result = await FROM_PDF[to](bytes, options);
        return {
          ...result,
          engine: "builtin",
          notice:
            "LibreOffice could not convert this PDF, so OneStop's built-in converter was used.",
        };
      }
    }
    const result = await FROM_PDF[to](bytes, options);
    return { ...result, engine: "builtin", notice: LIBREOFFICE_MISSING_NOTICE };
  }
  const result = await FROM_PDF[to](bytes, options);
  return { ...result, engine: "builtin" };
}

export function isLibreOfficeError(err: unknown): err is LibreOfficeError {
  return err instanceof LibreOfficeError;
}
