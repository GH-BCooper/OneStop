// Shared error type for the PDF tools (05-pdf-tools-core.md).
//
// Every PDF module throws `PdfToolError` for anything the user can act on — a protected file, a
// page number that does not exist, a document too damaged to read. `runPdfTool` turns it into the
// `ExecResult` shape the pipeline expects, so no stack trace ever reaches the UI (CLAUDE.md §7).
import type { ExecErrorCode, ExecResult } from "@onestop/types";

export class PdfToolError extends Error {
  constructor(
    readonly code: ExecErrorCode,
    message: string,
    /** Technical detail for the server log only — never shown to the user. */
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PdfToolError";
  }
}

/** The file is encrypted and this tool was not given its password. */
export function protectedPdfError(): PdfToolError {
  return new PdfToolError(
    "UNSUPPORTED_INPUT",
    "This PDF is password protected. Remove its password first, then try again.",
  );
}

/** A password was supplied and it does not open the file. Never hints at what the right one is. */
export function wrongPasswordError(): PdfToolError {
  return new PdfToolError(
    "UNSUPPORTED_INPUT",
    "That password is not correct for this PDF. Check it and try again.",
  );
}

export function damagedPdfError(detail?: unknown): PdfToolError {
  return new PdfToolError(
    "UNSUPPORTED_INPUT",
    "This PDF is damaged and could not be read. Try Repair PDF first.",
    detail,
  );
}

/** True when a thrown value is pdf-lib's / pdf.js's way of saying "this file is encrypted". */
export function isEncryptionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  if (name === "PasswordException" || name === "EncryptedPDFError") return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && /encrypt|password/i.test(message);
}

/**
 * Runs the body of an executor, mapping thrown errors onto the pipeline's result contract.
 * Anything that is not a `PdfToolError` is logged and reported as a generic failure.
 */
export async function runPdfTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[pdf:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (isEncryptionError(err)) {
      const mapped = protectedPdfError();
      return { ok: false, code: mapped.code, message: mapped.message };
    }
    console.error(`[pdf:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This PDF could not be processed. Please try again.",
    };
  }
}

export function unsupported(message: string): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message);
}
