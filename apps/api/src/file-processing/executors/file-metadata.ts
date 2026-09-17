// The phase-04 proof tool: File Metadata Viewer, running for real through the pipeline.
//
// It reads the validated bytes out of the temp store, inspects them (checksums, true format from
// magic bytes, text statistics) and returns both a JSON view for the page and a downloadable
// report file. Nothing is executed and no path is touched — it only ever sees `Uint8Array`s.
import { createHash } from "node:crypto";
import { extensionOf, type Executor } from "@onestop/tool-registry";
import type { FileRef } from "@onestop/types";
import { mimeTypeForExtension, sanitizeFileName, sniffExtensions } from "../validate.ts";

const TOOL_ID = "file-metadata-viewer";
const TEXT_SAMPLE_BYTES = 64 * 1024;

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** Cheap heuristic: a NUL byte in the first block means "treat this as binary". */
function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
  return !sample.includes(0);
}

function textStats(bytes: Uint8Array): { lines: number; characters: number; words: number } | null {
  if (!looksTextual(bytes)) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, TEXT_SAMPLE_BYTES),
  );
  return {
    lines: text.split(/\r\n|\r|\n/).length,
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

export const fileMetadataExecutor: Executor = async (input, _options, ctx) => {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, code: "UNSUPPORTED_INPUT", message: "Choose at least one file." };
  }
  if (!ctx) {
    return {
      ok: false,
      code: "FAILED",
      message: "This tool could not read your file. Please try again.",
    };
  }

  const files = [];
  for (const ref of input as FileRef[]) {
    const bytes = await ctx.readFile(ref);
    const name = sanitizeFileName(ref.name);
    const extension = extensionOf(name);
    const sniffed = sniffExtensions(bytes);
    files.push({
      name,
      extension: extension || null,
      size: bytes.length,
      sizeLabel: formatSize(bytes.length),
      declaredType: ref.type || mimeTypeForExtension(extension),
      detectedFormats: sniffed,
      extensionMatchesContent: sniffed === null ? null : sniffed.includes(extension),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      md5: createHash("md5").update(bytes).digest("hex"),
      firstBytes: toHex(bytes.subarray(0, 16)),
      text: textStats(bytes),
      modified: ref.lastModified ? new Date(ref.lastModified).toISOString() : null,
    });
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const report = {
    tool: TOOL_ID,
    generatedAt: new Date().toISOString(),
    jobId: ctx.jobId,
    fileCount: files.length,
    totalSize: total,
    files,
  };

  return {
    ok: true,
    output: report,
    summary:
      files.length === 1
        ? `${files[0]?.name} — ${formatSize(total)}, SHA-256 ${files[0]?.sha256.slice(0, 16)}…`
        : `${files.length} files, ${formatSize(total)} in total.`,
    files: [
      {
        name: files.length === 1 ? `${files[0]?.name}.metadata.json` : "file-metadata.json",
        mimeType: "application/json",
        bytes: new TextEncoder().encode(JSON.stringify(report, null, 2)),
      },
    ],
  };
};

export const FILE_METADATA_TOOL_ID = TOOL_ID;
