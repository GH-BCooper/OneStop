// ZIP Creator / ZIP Extractor / File Compressor (12-dev-utility-tools.md §14.1-14.3).
//
// `jszip` rather than phase 05's `createZip`: that one stores entries uncompressed (deliberately
// — it packages PDFs and PNGs, which do not compress), and a ZIP tool has to actually deflate.
// Reading an archive needs a real reader anyway.
//
// Extraction is the security-sensitive direction, so it is defensive by default:
//   - entry names are flattened to a safe base name (no absolute paths, no `..`, no drive
//     letters), which is what closes zip-slip;
//   - a total-size and entry-count ceiling stops a zip bomb before it is written anywhere;
//   - nothing extracted is ever executed — it is handed back as a download like any other result.
import JSZip from "jszip";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  MIME,
  bytesLabel,
  optEnum,
  optNumber,
  optString,
  readFiles,
  runUtilTool,
  safeStem,
  unsupported,
} from "./common.ts";

/** Ceilings for extraction. Generous for real archives, fatal for a bomb. */
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRIES = 5000;

/** Extensions whose contents are already compressed; re-deflating them only wastes time. */
const ALREADY_COMPRESSED = new Set([
  "zip",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "mp3",
  "aac",
  "m4a",
  "ogg",
  "opus",
  "flac",
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "epub",
]);

/**
 * A zip entry name reduced to something that cannot escape the folder it is written to. Paths are
 * flattened rather than recreated: the pipeline hands results back as a flat list of downloads,
 * so a nested name would be misleading, and flattening removes every traversal case at once.
 */
export function safeEntryPath(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== "." && p !== "..");
  const base = parts[parts.length - 1] ?? "file";
  const cleaned = base
    .replace(/^[a-zA-Z]:/, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^\.+/, "");
  const withParent =
    parts.length > 1
      ? `${parts[parts.length - 2]!.replace(/[^A-Za-z0-9._ -]+/g, "_")}-${cleaned}`
      : cleaned;
  const final = (withParent.replace(/^[.\s]+/, "") || "file").slice(0, 120);
  return /\.[A-Za-z0-9]{1,8}$/.test(final) ? final : `${final}.bin`;
}

function deflateLevel(options: Record<string, unknown>): number {
  const level = optEnum(
    options,
    "level",
    ["store", "fast", "normal", "maximum"] as const,
    "normal",
  );
  return level === "store" ? 0 : level === "fast" ? 1 : level === "maximum" ? 9 : 6;
}

export interface ZipBuildEntry {
  name: string;
  bytes: Uint8Array;
  date?: Date;
}

export async function buildZip(entries: ZipBuildEntry[], level: number): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const entry of entries) {
    let name = safeEntryPath(entry.name);
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`)) n += 1;
      name = `${stem}-${n}${ext}`;
    }
    used.add(name);
    zip.file(name, entry.bytes, entry.date ? { date: entry.date } : {});
  }
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: level === 0 ? "STORE" : "DEFLATE",
    compressionOptions: { level: Math.max(1, level) },
  });
  return bytes;
}

export interface ExtractedEntry {
  name: string;
  originalName: string;
  size: number;
  bytes: Uint8Array;
  modified: string | null;
}

export async function readZip(bytes: Uint8Array): Promise<ExtractedEntry[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw unsupported("This file is not a readable ZIP archive, or it is damaged.", err);
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length === 0) throw unsupported("This ZIP archive is empty.");
  if (files.length > MAX_ENTRIES) {
    throw unsupported(
      `This archive holds ${files.length} files, more than OneStop extracts in one go (${MAX_ENTRIES}).`,
    );
  }
  const declared = files.reduce(
    (sum, f) =>
      sum +
      ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
    0,
  );
  if (declared > MAX_EXTRACTED_BYTES) {
    throw unsupported(
      `This archive expands to ${bytesLabel(declared)}, more than OneStop extracts in one go (${bytesLabel(MAX_EXTRACTED_BYTES)}).`,
    );
  }

  const out: ExtractedEntry[] = [];
  let total = 0;
  for (const file of files) {
    const content = await file.async("uint8array");
    total += content.length;
    if (total > MAX_EXTRACTED_BYTES) {
      throw unsupported(
        `This archive expands past ${bytesLabel(MAX_EXTRACTED_BYTES)}, which OneStop will not extract in one go.`,
      );
    }
    out.push({
      name: safeEntryPath(file.name),
      originalName: file.name,
      size: content.length,
      bytes: content,
      modified: file.date ? new Date(file.date).toISOString() : null,
    });
  }
  return out;
}

// ---- executors --------------------------------------------------------------------------------

function archiveName(options: Record<string, unknown>, fallback: string): string {
  const requested = safeStem(optString(options, "archiveName", ""), "");
  const stem = requested === "" ? fallback : requested.replace(/\.zip$/i, "");
  return `${stem || "archive"}.zip`;
}

export const zipCreatorExecutor: Executor = (input, options, ctx) =>
  runUtilTool("zip-creator", async () => {
    const files = await readFiles(input, ctx);
    const level = deflateLevel(options);
    const bytes = await buildZip(
      files.map((f) => ({
        name: f.ref.name,
        bytes: f.bytes,
        ...(f.ref.lastModified ? { date: new Date(f.ref.lastModified) } : {}),
      })),
      level,
    );
    const original = files.reduce((sum, f) => sum + f.bytes.length, 0);
    const name = archiveName(
      options,
      files.length === 1 ? safeStem(files[0]!.name, "archive") : "archive",
    );
    return {
      ok: true,
      output: {
        entries: files.map((f) => ({ name: f.ref.name, size: f.bytes.length })),
        bytesBefore: original,
        bytesAfter: bytes.length,
      },
      summary: `Zipped ${files.length} file${files.length === 1 ? "" : "s"}: ${bytesLabel(original)} → ${bytesLabel(bytes.length)}.`,
      files: [{ name, mimeType: MIME.zip, bytes }],
    };
  });

export const fileCompressorExecutor: Executor = (input, options, ctx) =>
  runUtilTool("file-compressor", async () => {
    const files = await readFiles(input, ctx);
    const level = deflateLevel({
      level: optEnum(options, "level", ["store", "fast", "normal", "maximum"] as const, "maximum"),
    });
    const bytes = await buildZip(
      files.map((f) => ({ name: f.ref.name, bytes: f.bytes })),
      level,
    );
    const original = files.reduce((sum, f) => sum + f.bytes.length, 0);
    const saved = original - bytes.length;
    const alreadyPacked = files.filter((f) => ALREADY_COMPRESSED.has(f.ext)).map((f) => f.ref.name);
    const note =
      saved <= 0
        ? " These files are already compressed, so the archive is not smaller — it is still useful for sending them as one download."
        : alreadyPacked.length > 0
          ? ` ${alreadyPacked.length} of them (${alreadyPacked.slice(0, 3).join(", ")}${alreadyPacked.length > 3 ? "…" : ""}) were already compressed and barely shrank.`
          : "";
    return {
      ok: true,
      output: {
        bytesBefore: original,
        bytesAfter: bytes.length,
        savedBytes: saved,
        savedPercent: original > 0 ? Math.round((saved / original) * 100) : 0,
        alreadyCompressed: alreadyPacked,
      },
      summary: `Compressed ${files.length} file${files.length === 1 ? "" : "s"}: ${bytesLabel(original)} → ${bytesLabel(bytes.length)}${original > 0 ? ` (${Math.round((saved / original) * 100)}% smaller)` : ""}.${note}`,
      files: [{ name: archiveName(options, "compressed"), mimeType: MIME.zip, bytes }],
    };
  });

export const zipExtractorExecutor: Executor = (input, options, ctx) =>
  runUtilTool("zip-extractor", async () => {
    const file = await readFiles(input, ctx, { what: "ZIP file" }).then((f) => f[0]!);
    const entries = await readZip(file.bytes);
    const filter = optString(options, "only", "").trim().toLowerCase();
    const limit = optNumber(options, "limit", 200, { min: 1, max: 1000 });

    let chosen = entries;
    if (filter !== "") {
      const wanted = filter
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((e) => (e.startsWith(".") ? e.slice(1) : e));
      chosen = entries.filter((e) => wanted.some((w) => e.name.toLowerCase().endsWith(`.${w}`)));
      if (chosen.length === 0) {
        throw unsupported(
          `No files in this archive match ${wanted.map((w) => `.${w}`).join(", ")}.`,
        );
      }
    }
    const empty = chosen.filter((e) => e.size === 0).map((e) => e.originalName);
    const usable = chosen.filter((e) => e.size > 0);
    if (usable.length === 0) throw unsupported("Every file in this archive is empty.");
    const trimmed = usable.length > limit;
    const delivered = usable.slice(0, limit);

    const outputs: OutputFile[] = delivered.map((e) => ({
      name: e.name,
      mimeType: MIME.bin,
      bytes: e.bytes,
    }));
    const renamed = delivered.filter((e) => e.name !== e.originalName).length;
    const notes = [
      trimmed
        ? ` Only the first ${limit} are offered as downloads; raise the limit to get the rest.`
        : "",
      empty.length > 0
        ? ` ${empty.length} empty file${empty.length === 1 ? " was" : "s were"} skipped.`
        : "",
      renamed > 0
        ? ` ${renamed} name${renamed === 1 ? " was" : "s were"} simplified because the archive stored them in folders.`
        : "",
    ].join("");
    return {
      ok: true,
      output: {
        entryCount: entries.length,
        extracted: delivered.map((e) => ({
          name: e.name,
          from: e.originalName,
          size: e.size,
          modified: e.modified,
        })),
        skippedEmpty: empty,
      },
      summary: `Extracted ${delivered.length} of ${entries.length} file${entries.length === 1 ? "" : "s"} (${bytesLabel(delivered.reduce((s, e) => s + e.size, 0))}).${notes}`,
      files: outputs,
    };
  });
