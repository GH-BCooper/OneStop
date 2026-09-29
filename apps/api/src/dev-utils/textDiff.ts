// Text/Code Diff Viewer (21-roadmap-expansion.md, roadmap §1.8) — built on the shared diff engine
// in `apps/api/src/shared/diff.ts`, the same one Compare PDFs and Data Diff use (roadmap §5).
//
// Two inputs: either two uploaded files, or pasted text in the box compared against the "Compare
// with" option. The HTML output is a self-contained side-by-side view so a diff can be shared.
import type { Executor } from "@onestop/tool-registry";
import type { ExecContext, FileRef } from "@onestop/types";
import { diffSequences, inlineDiff, toLines, unifiedDiff, type DiffRow } from "../shared/diff.ts";
import {
  MIME,
  decodeText,
  optBool,
  optEnum,
  optString,
  readFiles,
  runUtilTool,
  textFile,
  unsupported,
} from "./common.ts";

export interface DiffSide {
  name: string;
  text: string;
}

export async function readTwoSides(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  options: Record<string, unknown>,
): Promise<[DiffSide, DiffSide]> {
  if (Array.isArray(input) && input.length >= 2) {
    const files = await readFiles(input, ctx, { min: 2, what: "file" });
    return [
      { name: files[0]!.ref.name, text: decodeText(files[0]!.bytes) },
      { name: files[1]!.ref.name, text: decodeText(files[1]!.bytes) },
    ];
  }
  const against = optString(options, "against", "");
  if (Array.isArray(input) && input.length === 1) {
    if (against.trim() === "") {
      throw unsupported('Choose two files, or one file plus something to compare it with in "Compare with".');
    }
    const [file] = await readFiles(input, ctx, { what: "file" });
    return [
      { name: file!.ref.name, text: decodeText(file!.bytes) },
      { name: "pasted text", text: against },
    ];
  }
  if (typeof input === "string" && input.trim() !== "") {
    if (against.trim() === "") throw unsupported('Paste the other version into "Compare with".');
    return [
      { name: "left", text: input },
      { name: "right", text: against },
    ];
  }
  throw unsupported("Choose two files to compare, or paste both versions.");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A self-contained side-by-side diff page, in the app's own dark palette. */
export function diffHtml(left: DiffSide, right: DiffSide, rows: DiffRow<string>[], wordLevel: boolean): string {
  const pieces = (row: DiffRow<string>, side: "left" | "right"): string => {
    const text = side === "left" ? row.left : row.right;
    if (text === null) return "";
    const partner = side === "left" ? row.right : row.left;
    if (!wordLevel || row.op === "=" || partner === null) return escapeHtml(text);
    const wanted = side === "left" ? "-" : "+";
    return inlineDiff(row.left ?? "", row.right ?? "")
      .filter((p) => p.op === "=" || p.op === wanted)
      .map((p) => (p.op === "=" ? escapeHtml(p.text) : `<mark>${escapeHtml(p.text)}</mark>`))
      .join("");
  };
  // A removal followed straight away by an addition is one changed line, so pair them up.
  const paired: { left: DiffRow<string> | null; right: DiffRow<string> | null }[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.op === "-" && rows[i + 1]?.op === "+") {
      paired.push({ left: row, right: rows[i + 1]! });
      i += 1;
    } else if (row.op === "-") paired.push({ left: row, right: null });
    else if (row.op === "+") paired.push({ left: null, right: row });
    else paired.push({ left: row, right: row });
  }
  const body = paired
    .map(({ left: l, right: r }) => {
      const cls = l && r && l === r ? "same" : l && r ? "changed" : l ? "removed" : "added";
      return `<tr class="${cls}">
<td class="n">${l?.leftIndex ?? ""}</td><td class="c">${l ? pieces(l, "left") : ""}</td>
<td class="n">${r?.rightIndex ?? ""}</td><td class="c">${r ? pieces(r, "right") : ""}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diff — ${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#08090b; color:#eef1f5; font:13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
  header { padding:14px 18px; border-bottom:1px solid #2f353d; font-family:ui-sans-serif, system-ui, sans-serif; }
  header b { font-weight:600; } header span { color:#a3acb8; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  td.n { width:52px; text-align:right; padding:1px 10px; color:#6b7480; user-select:none; border-right:1px solid #1a1e23; }
  td.c { padding:1px 10px; white-space:pre-wrap; overflow-wrap:anywhere; }
  tr.added td.c:last-child { background:rgba(74,222,128,.13); }
  tr.removed td.c:nth-child(2) { background:rgba(248,113,113,.13); }
  tr.changed td.c:nth-child(2) { background:rgba(248,113,113,.10); }
  tr.changed td.c:last-child { background:rgba(74,222,128,.10); }
  mark { background:rgba(251,191,36,.32); color:inherit; border-radius:2px; }
</style></head>
<body><header><b>${escapeHtml(left.name)}</b> <span>vs</span> <b>${escapeHtml(right.name)}</b></header>
<table>${body}</table></body></html>`;
}

export const textDiffExecutor: Executor = (input, options, ctx) =>
  runUtilTool("text-diff-viewer", async () => {
    const [left, right] = await readTwoSides(input, ctx, options);
    const granularity = optEnum(options, "granularity", ["line", "word"] as const, "line");
    const normalise = {
      trim: optBool(options, "ignoreWhitespace", false),
      ignoreCase: optBool(options, "ignoreCase", false),
      ignoreBlank: optBool(options, "ignoreBlankLines", false),
    };
    const leftLines = toLines(left.text, normalise);
    const rightLines = toLines(right.text, normalise);
    const { rows, stats, identical } = diffSequences(leftLines, rightLines);
    const plainRemoved = stats.removed - stats.changed;
    const plainAdded = stats.added - stats.changed;
    return {
      ok: true,
      output: {
        identical,
        stats,
        leftLines: leftLines.length,
        rightLines: rightLines.length,
        rows: rows.slice(0, 5000).map((r) => ({ op: r.op, left: r.left, right: r.right, leftIndex: r.leftIndex, rightIndex: r.rightIndex })),
        result: identical ? "identical" : `${stats.changed} changed, ${plainAdded} added, ${plainRemoved} removed`,
      },
      summary: identical
        ? "These two are identical, line for line."
        : `${stats.changed} line${stats.changed === 1 ? "" : "s"} changed, ${plainAdded} added, ${plainRemoved} removed, ${stats.same} unchanged.`,
      files: [
        textFile("diff.html", MIME.html, diffHtml(left, right, rows, granularity === "word")),
        textFile(
          "diff.patch",
          MIME.txt,
          unifiedDiff(leftLines, rightLines, { leftName: left.name, rightName: right.name }) || "# no differences\n",
        ),
      ],
    };
  });
