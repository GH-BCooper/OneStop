// Password Protect PDF (Features 1.18).
//
// Standard PDF encryption, AES-256 by default (AES-128 for very old readers). RC4 is not offered:
// it is broken. An owner password is always set — a random one when the user gives none — so the
// permission choices cannot be lifted by anyone who merely has the open password.
import { randomBytes } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optBool,
  optEnum,
  optString,
  outputName,
  PDF_MIME,
  readSinglePdf,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";

export const PROTECT_PDF_TOOL_ID = "password-protect-pdf";

const ALGORITHMS = ["AES-256", "AES-128"] as const;

export const protectPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(PROTECT_PDF_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const password = optString(options, "password");
    if (password.length < 4) throw unsupported("Choose a password of at least 4 characters.");
    if (password.length > 127) throw unsupported("Keep the password under 128 characters.");
    const ownerOption = optString(options, "ownerPassword");
    const ownerPassword = ownerOption || randomBytes(24).toString("base64url");
    if (ownerOption && ownerOption === password) {
      throw unsupported(
        "Use a different owner password from the open password, or leave it blank.",
      );
    }
    const algorithm = optEnum(options, "algorithm", ALGORITHMS, "AES-256");
    const allowPrinting = optBool(options, "allowPrinting", true);
    const allowCopying = optBool(options, "allowCopying", false);
    const allowEditing = optBool(options, "allowEditing", false);

    const doc = await loadPdf(file.bytes);
    doc.encrypt({
      userPassword: password,
      ownerPassword,
      algorithm,
      permissions: {
        printing: allowPrinting ? "highResolution" : false,
        copying: allowCopying,
        modifying: allowEditing,
        annotating: allowEditing,
        fillingForms: allowEditing,
        contentAccessibility: true,
        documentAssembly: allowEditing,
      },
    });
    // Object streams would hide object-level encryption behaviour in some readers; keep it plain.
    const bytes = await doc.save({ useObjectStreams: false });

    return {
      ok: true,
      output: {
        algorithm,
        permissions: { printing: allowPrinting, copying: allowCopying, editing: allowEditing },
        ownerPasswordSet: ownerOption !== "",
      },
      summary: `Protected with ${algorithm}. Keep the password safe — it cannot be recovered.`,
      files: [{ name: outputName(file.ref.name, "protected"), mimeType: PDF_MIME, bytes }],
    };
  });
