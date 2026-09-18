// Shared plumbing for the Excel / CSV / data tools (08-excel-csv-data-tools.md): the in-memory
// table model every tool converts through, typed-cell inference, inputs (file or pasted text),
// positions for error messages and the error contract.
//
// Error handling follows phases 05–07: anything the user can act on is a `PdfToolError` (the
// shared "tool error" type — the name is historical) and `runDataTool` turns every throw into the
// pipeline's `ExecResult`, so no stack trace ever reaches the UI (CLAUDE.md §7).
import type { ExecErrorCode, ExecResult } from "@onestop/types";
import type { ExecContext, FileRef, OutputFile } from "@onestop/types";
import { PdfToolError } from "../pdf/errors.ts";
import { OfficeConvertError } from "../shared/office-convert.ts";
import { baseName, decodeText, extOf } from "../documents/common.ts";

export { baseName, optBool, optEnum, optNumber, optString, plural } from "../documents/common.ts";

export const MIME = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

// ---- the table model --------------------------------------------------------------------------

/** One typed value. Dates are real `Date`s (UTC) wherever the source format has a date type. */
export type Cell = string | number | boolean | Date | null;

export interface Table {
  /** Sheet name (Excel) or file stem (CSV). */
  name: string;
  headers: string[];
  rows: Cell[][];
  /**
   * Where each data row came from: the spreadsheet row number (header = its own row) or the CSV
   * record number (header = 1). Used for "row 12" in messages and to copy Excel formatting.
   */
  rowNumbers: number[];
  /** 1-based source column of each header (Excel formatting is copied from it). */
  colNumbers: number[];
  /** Spreadsheet row the header came from (Excel), 1 for CSV. */
  headerRow: number;
  /** The worksheet this table was read from, so writers can carry its formatting over. */
  source?: object;
  /** Columns whose header cell was blank in the source (their names were generated). */
  blankHeader?: boolean[];
}

export function makeTable(
  name: string,
  headers: string[],
  rows: Cell[][],
  { headerRow = 1 }: { headerRow?: number } = {},
): Table {
  return {
    name,
    headers,
    rows,
    rowNumbers: rows.map((_, i) => headerRow + 1 + i),
    colNumbers: headers.map((_, i) => i + 1),
    headerRow,
  };
}

/** Keeps the given data rows (by index) and columns (by index), carrying provenance along. */
export function selectTable(table: Table, rowIdx: number[] | null, colIdx: number[] | null): Table {
  const rows = rowIdx ?? table.rows.map((_, i) => i);
  const cols = colIdx ?? table.headers.map((_, i) => i);
  return {
    ...table,
    headers: cols.map((c) => table.headers[c] ?? ""),
    rows: rows.map((r) => cols.map((c) => table.rows[r]?.[c] ?? null)),
    rowNumbers: rows.map((r) => table.rowNumbers[r] ?? r + table.headerRow + 1),
    colNumbers: cols.map((c) => table.colNumbers[c] ?? c + 1),
    ...(table.blankHeader ? { blankHeader: cols.map((c) => table.blankHeader![c] ?? false) } : {}),
  };
}

/** Spreadsheet-style column letter: 1 → A, 27 → AA. */
export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** "column C (Email)" — the reference style every validator message uses. */
export function columnRef(table: Table, index: number): string {
  const name = table.headers[index];
  const letter = columnLetter(table.colNumbers[index] ?? index + 1);
  return name ? `column ${letter} ("${name}")` : `column ${letter}`;
}

/** Empty or duplicated header names become "Column 3" / "name (2)" so every key is unique. */
export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = cellText(h as Cell).trim() || `Column ${i + 1}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

export function isBlank(value: Cell | undefined): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}

// ---- typed values -----------------------------------------------------------------------------

// No leading zeros (zip codes, ids) and nothing beyond what a double holds exactly.
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A number, if the text is unambiguously one; otherwise null. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // "12345678901234567890" would lose digits as a double: keep it as text.
  if (/^-?\d+$/.test(t) && !Number.isSafeInteger(n)) return null;
  return n;
}

/** An ISO-8601 date / date-time string as a UTC `Date`, or null. */
export function parseIsoDate(text: string): Date | null {
  const m = ISO_DATE_RE.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms, tz] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = Date.UTC(
    Number(y),
    month - 1,
    day,
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(s ?? 0),
    Number((ms ?? "0").padEnd(3, "0")),
  );
  const check = new Date(base);
  if (check.getUTCDate() !== day) return null; // 2024-02-31
  let offset = 0;
  if (tz && tz !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
  }
  return new Date(base - offset);
}

export interface InferOptions {
  /** Turn ISO date strings into `Date`s (only for targets with a date type, i.e. Excel). */
  dates?: boolean;
}

/** Text from an untyped source (CSV, XML) → number / boolean / date / null / text. */
export function inferCell(text: string, { dates = false }: InferOptions = {}): Cell {
  if (text === "") return null;
  const n = parseNumber(text);
  if (n !== null) return n;
  const lower = text.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (dates) {
    const d = parseIsoDate(text);
    if (d) return d;
  }
  return text;
}

/** ISO text for a date: "2024-01-15" at UTC midnight, otherwise a full UTC timestamp. */
export function isoDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
  return iso.endsWith(".000Z") ? `${iso.slice(0, 19)}Z` : iso;
}

/** Plain text of a cell, as CSV/XML write it. */
export function cellText(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoDate(value);
  return String(value);
}

/** JSON value of a cell: dates become ISO strings, everything else keeps its type. */
export function cellJson(value: Cell | undefined): string | number | boolean | null {
  if (value === undefined) return null;
  if (value instanceof Date) return isoDate(value);
  return value;
}

// ---- positions --------------------------------------------------------------------------------

/** 1-based line and column of a character offset. */
export function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(Math.max(0, offset), text.length);
  for (let i = 0; i < end; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i;
    }
  }
  return { line, column: end - last };
}

/** The offending line with a caret under the column, for reports. */
export function snippet(text: string, line: number, column: number): string {
  const lines = text.split(/\r?\n/);
  const src = (lines[line - 1] ?? "").replace(/\t/g, " ");
  const start = Math.max(0, column - 60);
  const shown = src.slice(start, start + 100);
  return `${line} | ${shown}\n${" ".repeat(String(line).length)} | ${" ".repeat(Math.max(0, column - 1 - start))}^`;
}

// ---- errors -----------------------------------------------------------------------------------

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

export async function runDataTool(
  toolId: string,
  body: () => Promise<ExecResult>,
): Promise<ExecResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof PdfToolError) {
      if (err.detail !== undefined) console.error(`[data:${toolId}]`, err.message, err.detail);
      return { ok: false, code: err.code as ExecErrorCode, message: err.message };
    }
    if (err instanceof OfficeConvertError) {
      if (err.detail !== undefined) console.error(`[data:${toolId}]`, err.message, err.detail);
      return { ok: false, code: "UNSUPPORTED_INPUT", message: err.message };
    }
    if (err instanceof RangeError && /memory|Invalid (string|array) length/i.test(err.message)) {
      console.error(`[data:${toolId}] too large`, err);
      return {
        ok: false,
        code: "FAILED",
        message: "This file is too large to process in one go. Split it into smaller files first.",
      };
    }
    console.error(`[data:${toolId}] unexpected failure`, err);
    return {
      ok: false,
      code: "FAILED",
      message: "This file could not be processed. Please try again.",
    };
  }
}

// ---- inputs -----------------------------------------------------------------------------------

export interface DataInput {
  ref: FileRef;
  bytes: Uint8Array;
  /** Lower-case extension (phase 04 checked it against the content). */
  ext: string;
  name: string;
}

export async function readDataInputs(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  { min = 1, what = "file" }: { min?: number; what?: string } = {},
): Promise<DataInput[]> {
  if (!ctx)
    throw new PdfToolError("FAILED", "This tool could not read your file. Please try again.");
  if (!Array.isArray(input) || input.length < min) {
    throw unsupported(min > 1 ? `Choose at least ${min} ${what}s.` : `Choose a ${what} first.`);
  }
  const out: DataInput[] = [];
  for (const ref of input) {
    out.push({
      ref,
      bytes: await ctx.readFile(ref),
      ext: extOf(ref.name),
      name: baseName(ref.name),
    });
  }
  return out;
}

/** Tools that take a file *or* pasted text: the text either way, plus a name for the output. */
export async function readTextSource(
  input: FileRef[] | string | null,
  ctx: ExecContext | undefined,
  what: string,
): Promise<{ text: string; name: string; pasted: boolean }> {
  if (typeof input === "string") {
    if (input.trim() === "") throw unsupported(`Paste some ${what} or choose a file first.`);
    return { text: input, name: "data", pasted: true };
  }
  const [file] = await readDataInputs(input, ctx, { what: `${what} file` });
  const text = decodeText(file!.bytes);
  if (text.trim() === "") throw unsupported(`This ${what} file is empty.`);
  return { text, name: file!.name, pasted: false };
}

export function textOutput(name: string, mimeType: string, text: string): OutputFile {
  return { name, mimeType, bytes: new TextEncoder().encode(text) };
}

export { decodeText, extOf };
