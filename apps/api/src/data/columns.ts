// Column references typed by users: a header name (any case), a letter (A, AB) or a number (1).
import { columnLetter, type Table, unsupported } from "./common.ts";

function lettersToNumber(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function available(table: Table): string {
  const shown = table.headers.slice(0, 12).map((h, i) => `${columnLetter(i + 1)} "${h}"`);
  return (
    shown.join(", ") + (table.headers.length > 12 ? `, … (${table.headers.length} columns)` : "")
  );
}

/** One reference → 0-based column index. */
export function resolveColumn(table: Table, ref: string): number {
  const raw = ref.trim().replace(/^["']|["']$/g, "");
  if (raw === "") throw unsupported("A column name is empty.");
  const exact = table.headers.indexOf(raw);
  if (exact !== -1) return exact;
  const lower = raw.toLowerCase();
  const byName = table.headers.findIndex((h) => h.toLowerCase() === lower);
  if (byName !== -1) return byName;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= table.headers.length) return n - 1;
  }
  if (/^[A-Za-z]{1,3}$/.test(raw)) {
    const n = lettersToNumber(raw);
    if (n >= 1 && n <= table.headers.length) return n - 1;
  }
  throw unsupported(`There is no column "${raw}". The columns are: ${available(table)}.`);
}

/** "Name, B, 4" → indexes (in the order given, no repeats). Blank → []. */
export function resolveColumns(table: Table, spec: string): number[] {
  const out: number[] = [];
  for (const part of splitList(spec)) {
    const i = resolveColumn(table, part);
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/** Comma- or newline-separated list, allowing "quoted, names". */
export function splitList(spec: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|([^,\n]+)/g;
  for (const m of spec.matchAll(re)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (v !== "") out.push(v);
  }
  return out;
}
