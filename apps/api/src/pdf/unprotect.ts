// Remove PDF Password (Features 1.19) — authorized use only.
//
// This is decrypt-with-a-known-password, never a cracker: the user must supply the document's
// existing open (or owner) password, it is tried exactly once, and a wrong one is refused with
// a plain message. There is no retry loop, no dictionary and no brute force anywhere in OneStop.
import type { Executor } from "@onestop/tool-registry";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  loadPdf,
  looksLikePdf,
  optString,
  outputName,
  PDF_MIME,
  readSinglePdf,
  savePdf,
} from "./document.ts";
import { damagedPdfError, isEncryptionError, runPdfTool, unsupported } from "./errors.ts";

export const UNPROTECT_PDF_TOOL_ID = "remove-pdf-password";

/** True when the file carries an /Encrypt dictionary. */
export async function isPdfEncrypted(bytes: Uint8Array): Promise<boolean> {
  if (!looksLikePdf(bytes)) throw damagedPdfError("missing %PDF header");
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted;
  } catch (err) {
    if (isEncryptionError(err)) return true;
    throw damagedPdfError(err);
  }
}

export const unprotectPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(UNPROTECT_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const password = optString(options, "password");
    if (!(await isPdfEncrypted(file.bytes))) {
      throw unsupported("This PDF is not password protected, so there is nothing to remove.");
    }
    if (password === "") throw unsupported("Enter the PDF's current password.");

    // One attempt with the password the user gave. loadPdf maps a wrong password to a clear error.
    const doc = await loadPdf(file.bytes, { password });
    const bytes = await savePdf(doc);

    return {
      ok: true,
      output: { pageCount: doc.getPageCount(), encrypted: false },
      summary: "Password removed. The new copy opens without a password.",
      files: [{ name: outputName(file.ref.name, "unlocked"), mimeType: PDF_MIME, bytes }],
    };
  });
