// The shared "compare two things" engine (21-roadmap-expansion.md, roadmap §5).
//
// Compare PDFs (phase 06), the new Data Diff and the new Text Diff Viewer all want the same core:
// align two sequences, then say which entries are the same, removed or added. Writing it once and
// using it three ways is what `CLAUDE.md` §7 asks for; `apps/api/src/pdf/compare.ts` keeps its own
// `lcsDiff` export for compatibility and is re-exported from here as the canonical implementation.
import { lcsDiff } from "../pdf/compare.ts";

export { lcsDiff };

export type DiffOp = "=" | "-" | "+";

export interface DiffRow<T> {
  op: DiffOp;
  /** 1-based position in the left sequence, or null for an addition. */
  leftIndex: number | null;
  /** 1-based position in the right sequence, or null for a removal. */
  rightIndex: number | null;
  left: T | null;
  right: T | null;
}

export interface DiffStats {
  same: number;
  removed: number;
  added: number;
  /** Removals immediately followed by additions, counted as one change each. */
  changed: number;
}

export interface DiffResult<T> {
  rows: DiffRow<T>[];
  stats: DiffStats;
  identical: boolean;
}

/** Aligns `a` and `b` and returns one row per aligned entry, in order. */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): DiffResult<T> {
  const ops = lcsDiff([...a], [...b], eq);
  const rows: DiffRow<T>[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "=") {
      rows.push({ op, leftIndex: i + 1, rightIndex: j + 1, left: a[i]!, right: b[j]! });
      i += 1;
      j += 1;
    } else if (op === "-") {
      rows.push({ op, leftIndex: i + 1, rightIndex: null, left: a[i]!, right: null });
      i += 1;
    } else {
      rows.push({ op, leftIndex: null, rightIndex: j + 1, left: null, right: b[j]! });
      j += 1;
    }
  }
  const stats: DiffStats = { same: 0, removed: 0, added: 0, changed: 0 };
  for (const [index, row] of rows.entries()) {
    if (row.op === "=") stats.same += 1;
    else if (row.op === "-") {
      stats.removed += 1;
      // A removal with an addition right after it reads as one modified line, not two.
      if (rows[index + 1]?.op === "+") stats.changed += 1;
    } else stats.added += 1;
  }
  return { rows, stats, identical: stats.removed === 0 && stats.added === 0 };
}

/** Splits text into lines for diffing, with the usual normalisation switches. */
export function toLines(
  text: string,
  { trim = false, ignoreCase = false, ignoreBlank = false }: { trim?: boolean; ignoreCase?: boolean; ignoreBlank?: boolean } = {},
): string[] {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (trim) lines = lines.map((l) => l.trim());
  if (ignoreCase) lines = lines.map((l) => l.toLowerCase());
  if (ignoreBlank) lines = lines.filter((l) => l.trim() !== "");
  return lines;
}

/** A word-level diff inside one changed line, for highlighting what actually moved. */
export function inlineDiff(left: string, right: string): { op: DiffOp; text: string }[] {
  const split = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
  const a = split(left);
  const b = split(right);
  const ops = lcsDiff(a, b, (x, y) => x === y);
  const out: { op: DiffOp; text: string }[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const text = op === "+" ? b[j]! : a[i]!;
    if (op === "=") {
      i += 1;
      j += 1;
    } else if (op === "-") i += 1;
    else j += 1;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  }
  return out;
}

/** A unified diff, the format `git diff` and `patch` both speak. */
export function unifiedDiff(
  a: readonly string[],
  b: readonly string[],
  { leftName = "left", rightName = "right", context = 3 }: { leftName?: string; rightName?: string; context?: number } = {},
): string {
  const { rows } = diffSequences(a, b);
  if (rows.every((r) => r.op === "=")) return "";
  // Group the changed rows into hunks, each padded with `context` unchanged rows either side.
  const changed = rows.map((r) => r.op !== "=");
  const keep = new Array<boolean>(rows.length).fill(false);
  for (const [index, isChanged] of changed.entries()) {
    if (!isChanged) continue;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  }
  const out = [`--- ${leftName}`, `+++ ${rightName}`];
  let index = 0;
  while (index < rows.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && keep[end]) end += 1;
    const hunk = rows.slice(index, end);
    const leftStart = hunk.find((r) => r.leftIndex !== null)?.leftIndex ?? 0;
    const rightStart = hunk.find((r) => r.rightIndex !== null)?.rightIndex ?? 0;
    const leftCount = hunk.filter((r) => r.op !== "+").length;
    const rightCount = hunk.filter((r) => r.op !== "-").length;
    out.push(`@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`);
    for (const row of hunk) {
      const text = row.op === "+" ? row.right! : row.left!;
      out.push(`${row.op === "=" ? " " : row.op}${text}`);
    }
    index = end;
  }
  return out.join("\n") + "\n";
}
