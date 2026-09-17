import { getTool } from "@onestop/tool-registry";
import { ERROR_MESSAGES } from "@onestop/types";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSafeFileName,
  MAX_FILENAME_LENGTH,
  mimeTypeForExtension,
  resolveWithin,
  sanitizeFileName,
  sniffExtensions,
  validateOutputFile,
  validateUpload,
} from "./validate.ts";

const mergePdf = getTool("merge-pdf")!;
const zipCreator = getTool("zip-creator")!;
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("sanitizeFileName", () => {
  it("strips directory traversal in both path styles", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\system32\\config.sys")).toBe("config.sys");
    expect(sanitizeFileName("/etc/shadow")).toBe("shadow");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("....//....//secret.txt")).toBe("secret.txt");
  });

  it("removes control characters, nulls and unsafe punctuation", () => {
    expect(sanitizeFileName("a\u0000b.txt")).toBe("ab.txt");
    expect(sanitizeFileName("re\nport.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("in|voice*?.pdf")).toBe("in_voice__.pdf");
    expect(sanitizeFileName("\u202eexe.txt")).toBe("_exe.txt");
  });

  it("never returns an empty or hidden name", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName("/")).toBe("file");
    expect(sanitizeFileName(".env")).toBe("env");
  });

  it("defuses Windows reserved device names and caps the length", () => {
    expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFileName("lpt1.pdf")).toBe("_lpt1.pdf");
    const long = `${"a".repeat(500)}.pdf`;
    expect(sanitizeFileName(long).length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(sanitizeFileName(long).endsWith(".pdf")).toBe(true);
  });

  it("leaves ordinary names untouched", () => {
    for (const name of ["report.pdf", "my photo 2.png", "data-set_1.csv"]) {
      expect(sanitizeFileName(name)).toBe(name);
      expect(isSafeFileName(name)).toBe(true);
    }
    expect(isSafeFileName("../x.pdf")).toBe(false);
  });
});

describe("resolveWithin", () => {
  const base = path.resolve("/tmp/onestop-test");

  it("keeps every resolved path inside the base directory", () => {
    expect(resolveWithin(base, "a.pdf")).toBe(path.join(base, "a.pdf"));
    expect(resolveWithin(base, "../../etc/passwd")).toBe(path.join(base, "passwd"));
    expect(resolveWithin(base, "..\\..\\x.txt")).toBe(path.join(base, "x.txt"));
  });
});

describe("validateUpload", () => {
  const maxBytes = 1024;

  it("accepts a well-formed file for a tool that wants it", () => {
    expect(
      validateUpload(
        { name: "doc.pdf", size: 100, type: "application/pdf", head: PDF_HEAD },
        { tool: mergePdf, maxBytes },
      ),
    ).toEqual({ valid: true });
  });

  it("rejects a file type the tool does not accept, with the master-plan §22 wording", () => {
    const result = validateUpload(
      { name: "song.mp3", size: 100, type: "audio/mpeg" },
      { tool: mergePdf, maxBytes },
    );
    expect(result).toEqual({ valid: false, reason: ERROR_MESSAGES.unsupportedType });
    expect(result.reason).toBe("This file type is not supported.");
  });

  it("rejects an oversized file with the master-plan §22 wording", () => {
    const result = validateUpload(
      { name: "doc.pdf", size: maxBytes + 1, type: "application/pdf" },
      { tool: mergePdf, maxBytes },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("The file is too large for local processing. Try a smaller file.");
  });

  it("rejects an empty file and a file with no extension", () => {
    expect(validateUpload({ name: "doc.pdf", size: 0 }, { tool: mergePdf, maxBytes }).valid).toBe(
      false,
    );
    expect(validateUpload({ name: "noextension", size: 10 }, { maxBytes }).valid).toBe(false);
  });

  it("rejects a MIME type that contradicts the extension", () => {
    expect(
      validateUpload(
        { name: "doc.pdf", size: 10, type: "application/x-msdownload" },
        { tool: mergePdf, maxBytes },
      ).valid,
    ).toBe(false);
    // A generic type from the browser is not evidence of anything and must not reject.
    expect(
      validateUpload(
        { name: "doc.pdf", size: 10, type: "application/octet-stream", head: PDF_HEAD },
        { tool: mergePdf, maxBytes },
      ).valid,
    ).toBe(true);
  });

  it("rejects a file whose bytes do not match its extension", () => {
    const disguised = validateUpload(
      { name: "invoice.pdf", size: 8, type: "application/pdf", head: PNG_HEAD },
      { tool: mergePdf, maxBytes },
    );
    expect(disguised).toEqual({ valid: false, reason: ERROR_MESSAGES.unsupportedType });
  });

  it("validates a sanitised name, so traversal cannot smuggle an extension past the tool", () => {
    expect(
      validateUpload(
        { name: "../../etc/passwd.mp3", size: 10, type: "audio/mpeg" },
        { tool: mergePdf, maxBytes },
      ).valid,
    ).toBe(false);
    expect(
      validateUpload(
        { name: "../../tmp/notes.pdf", size: 10, type: "application/pdf", head: PDF_HEAD },
        { tool: mergePdf, maxBytes },
      ).valid,
    ).toBe(true);
  });

  it("lets an any-file tool through but still enforces size", () => {
    expect(
      validateUpload({ name: "thing.bin", size: 10 }, { tool: zipCreator, maxBytes }).valid,
    ).toBe(true);
    expect(
      validateUpload({ name: "thing.bin", size: maxBytes + 1 }, { tool: zipCreator, maxBytes })
        .valid,
    ).toBe(false);
  });
});

describe("sniffExtensions and MIME lookup", () => {
  it("recognises common signatures", () => {
    expect(sniffExtensions(PDF_HEAD)).toContain("pdf");
    expect(sniffExtensions(PNG_HEAD)).toContain("png");
    expect(sniffExtensions(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toContain("docx");
    expect(sniffExtensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("maps extensions to a sensible content type", () => {
    expect(mimeTypeForExtension("pdf")).toBe("application/pdf");
    expect(mimeTypeForExtension("PNG")).toBe("image/png");
    expect(mimeTypeForExtension("unknown")).toBe("application/octet-stream");
  });
});

describe("validateOutputFile", () => {
  it("rejects empty, nameless or oversized results", () => {
    expect(validateOutputFile({ name: "a.json", bytes: new Uint8Array([1]) }, 10).valid).toBe(true);
    expect(validateOutputFile({ name: "a.json", bytes: new Uint8Array() }, 10).valid).toBe(false);
    expect(validateOutputFile({ name: "noext", bytes: new Uint8Array([1]) }, 10).valid).toBe(false);
    expect(validateOutputFile({ name: "a.json", bytes: new Uint8Array(11) }, 10).valid).toBe(false);
  });
});
