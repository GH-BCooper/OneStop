// Duplicate File Detector (12-dev-utility-tools.md §14.10).
//
// Byte-identical only. Files are grouped by size first (different sizes cannot be identical, and
// that comparison is free), then by SHA-256 within each size group, and finally — for any group
// that still matches — by a direct byte comparison. That last step is what makes a false positive
// impossible rather than merely astronomically unlikely, and it costs nothing here because the
// bytes are already in memory.
//
// "Similar" files (the same photo re-encoded, a document with one word changed) are deliberately
// *not* flagged: this tool answers "can I delete one of these safely?", and only an exact match
// can answer that yes.
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  bytesLabel,
  optBool,
  plural,
  readFiles,
  runUtilTool,
  textFile,
  type UtilFile,
} from "./common.ts";
import { hashBytes } from "./hashing.ts";

export interface DuplicateGroup {
  sha256: string;
  size: number;
  files: string[];
  /** Bytes freed by keeping one copy of this group. */
  wastedBytes: number;
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  unique: string[];
  totalFiles: number;
  duplicateFiles: number;
  wastedBytes: number;
  /** Files with identical contents but different names, worth calling out separately. */
  renamedCopies: number;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function findDuplicates(files: UtilFile[]): DuplicateReport {
  const bySize = new Map<number, UtilFile[]>();
  for (const file of files) {
    bySize.set(file.bytes.length, [...(bySize.get(file.bytes.length) ?? []), file]);
  }

  const groups: DuplicateGroup[] = [];
  const unique: string[] = [];
  for (const [size, sameSize] of bySize) {
    if (sameSize.length === 1) {
      unique.push(sameSize[0]!.ref.name);
      continue;
    }
    const byHash = new Map<string, UtilFile[]>();
    for (const file of sameSize) {
      const hash = hashBytes(file.bytes, "sha256");
      byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }
    for (const [hash, candidates] of byHash) {
      // Confirm byte by byte before calling anything a duplicate.
      const confirmed: UtilFile[][] = [];
      for (const candidate of candidates) {
        const bucket = confirmed.find((b) => sameBytes(b[0]!.bytes, candidate.bytes));
        if (bucket) bucket.push(candidate);
        else confirmed.push([candidate]);
      }
      for (const bucket of confirmed) {
        if (bucket.length === 1) unique.push(bucket[0]!.ref.name);
        else {
          groups.push({
            sha256: hash,
            size,
            files: bucket.map((f) => f.ref.name),
            wastedBytes: size * (bucket.length - 1),
          });
        }
      }
    }
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  const duplicateFiles = groups.reduce((sum, g) => sum + g.files.length - 1, 0);
  const renamedCopies = groups.filter(
    (g) => new Set(g.files).size === g.files.length && g.files.length > 1,
  ).length;
  return {
    groups,
    unique: unique.sort(),
    totalFiles: files.length,
    duplicateFiles,
    wastedBytes: groups.reduce((sum, g) => sum + g.wastedBytes, 0),
    renamedCopies,
  };
}

export function reportText(report: DuplicateReport): string {
  if (report.groups.length === 0) {
    return `No duplicates: all ${report.totalFiles} files are different.\n`;
  }
  const lines = [
    `${report.groups.length} set${report.groups.length === 1 ? "" : "s"} of identical files.`,
    `${report.duplicateFiles} redundant copies, ${bytesLabel(report.wastedBytes)} that could be freed.`,
    "",
  ];
  report.groups.forEach((group, i) => {
    lines.push(`Set ${i + 1} — ${bytesLabel(group.size)} each, SHA-256 ${group.sha256}`);
    lines.push(`  keep:   ${group.files[0]}`);
    for (const name of group.files.slice(1)) lines.push(`  delete: ${name}`);
    lines.push("");
  });
  if (report.unique.length > 0) {
    lines.push("Not duplicated:", ...report.unique.map((n) => `  ${n}`), "");
  }
  return lines.join("\n");
}

export const duplicateFileDetectorExecutor: Executor = (input, options, ctx) =>
  runUtilTool("duplicate-file-detector", async () => {
    const files = await readFiles(input, ctx, { min: 2, what: "file" });
    const report = findDuplicates(files);
    const keepList = optBool(options, "listKeepers", true);
    return {
      ok: true,
      output: keepList ? report : { ...report, unique: [] },
      summary:
        report.groups.length === 0
          ? `No duplicates — all ${plural(report.totalFiles, "file")} are different.`
          : `Found ${plural(report.groups.length, "set")} of identical files among ${report.totalFiles}: ${report.duplicateFiles} ${report.duplicateFiles === 1 ? "copy" : "copies"} could be deleted, freeing ${bytesLabel(report.wastedBytes)}.`,
      files: [textFile("duplicates.txt", MIME.txt, reportText(report))],
    };
  });
