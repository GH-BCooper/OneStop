// Spreadsheet Cleaner, Duplicate Row Remover and Empty Row/Column Remover
// (08-excel-csv-data-tools.md).
//
// Each tool is a pure function over a `Table` (so Workflows and the Assistant can call it on its
// own) plus a thin executor. Rows keep their provenance, so an Excel result keeps the formatting
// of the rows that survive; CSV in → CSV out, Excel in → Excel out.
import type { Executor } from "@onestop/tool-registry";
import {
  type Cell,
  cellText,
  isBlank,
  optBool,
  optEnum,
  optString,
  parseIsoDate,
  parseNumber,
  plural,
  readDataInputs,
  runDataTool,
  selectTable,
  type Table,
  uniqueHeaders,
} from "./common.ts";
import { resolveColumns } from "./columns.ts";
import { delimiterOption, readTabular, sheetOption, writeTabular } from "./tabular.ts";

export const SPREADSHEET_CLEANER_TOOL_ID = "spreadsheet-cleaner";
export const DUPLICATE_ROW_REMOVER_TOOL_ID = "duplicate-row-remover";
export const EMPTY_ROW_COLUMN_REMOVER_TOOL_ID = "empty-row-column-remover";

// ---- duplicates -------------------------------------------------------------------------------

export interface DedupeOptions {
  /** Columns that decide whether two rows are the same; empty = every column. */
  columns?: number[];
  ignoreCase?: boolean;
  /** Ignore leading/trailing spaces and repeated inner spaces when comparing. */
  ignoreSpaces?: boolean;
  keep?: "first" | "last";
}

function keyOf(row: Cell[], cols: number[], ignoreCase: boolean, ignoreSpaces: boolean): string {
  return cols
    .map((c) => {
      const v = row[c] ?? null;
      let s =
        v === null
          ? ""
          : `${typeof v === "number" ? "n" : v instanceof Date ? "d" : "s"}:${cellText(v)}`;
      if (ignoreSpaces) s = s.trim().replace(/\s+/g, " ");
      if (ignoreCase) s = s.toLowerCase();
      // Blank and whitespace-only compare equal when spaces are ignored.
      if (ignoreSpaces && /^s:\s*$/.test(s)) s = "";
      return s;
    })
    .join("\u0000");
}

export function removeDuplicateRows(
  table: Table,
  { columns = [], ignoreCase = false, ignoreSpaces = true, keep = "first" }: DedupeOptions = {},
): { table: Table; removed: number; removedRows: number[] } {
  const cols = columns.length > 0 ? columns : table.headers.map((_, i) => i);
  const seen = new Set<string>();
  const keepIdx: number[] = [];
  const order = table.rows.map((_, i) => i);
  if (keep === "last") order.reverse();
  for (const i of order) {
    const row = table.rows[i]!;
    // Completely blank rows are the Empty Row Remover's job, not duplicates.
    if (row.every(isBlank)) {
      keepIdx.push(i);
      continue;
    }
    const key = keyOf(row, cols, ignoreCase, ignoreSpaces);
    if (seen.has(key)) continue;
    seen.add(key);
    keepIdx.push(i);
  }
  keepIdx.sort((a, b) => a - b);
  const kept = new Set(keepIdx);
  const removedRows = table.rows
    .map((_, i) => i)
    .filter((i) => !kept.has(i))
    .map((i) => table.rowNumbers[i]!);
  return { table: selectTable(table, keepIdx, null), removed: removedRows.length, removedRows };
}

// ---- empty rows / columns ---------------------------------------------------------------------

export interface EmptyOptions {
  rows?: boolean;
  columns?: boolean;
  /** Also remove columns that have a header but no values. */
  headedColumns?: boolean;
}

export function removeEmpty(
  table: Table,
  { rows = true, columns = true, headedColumns = false }: EmptyOptions = {},
): { table: Table; rowsRemoved: number; columnsRemoved: number; removedColumns: string[] } {
  const keepRows = rows
    ? table.rows.map((r, i) => (r.every(isBlank) ? -1 : i)).filter((i) => i !== -1)
    : null;
  let keepCols: number[] | null = null;
  const removedColumns: string[] = [];
  if (columns) {
    keepCols = [];
    for (let c = 0; c < table.headers.length; c += 1) {
      const noValues = table.rows.every((r) => isBlank(r[c]));
      const headerBlank = table.blankHeader?.[c] ?? false;
      if (noValues && (headerBlank || headedColumns)) removedColumns.push(table.headers[c]!);
      else keepCols.push(c);
    }
  }
  const out = selectTable(table, keepRows, keepCols);
  return {
    table: out,
    rowsRemoved: table.rows.length - out.rows.length,
    columnsRemoved: removedColumns.length,
    removedColumns,
  };
}

// ---- cleaner ----------------------------------------------------------------------------------

export interface CleanOptions {
  trim?: boolean;
  collapseSpaces?: boolean;
  /** Zero-width spaces, non-breaking spaces, control characters. */
  invisible?: boolean;
  /** "1,234.50", "$12", " 42 " → numbers; "TRUE"/"no" → booleans; ISO text → dates (Excel). */
  fixTypes?: boolean;
  dates?: boolean;
  headers?: boolean;
  emptyRows?: boolean;
  emptyColumns?: boolean;
  duplicates?: boolean;
}

export interface CleanReport {
  trimmed: number;
  invisible: number;
  converted: number;
  headersFixed: number;
  emptyRows: number;
  emptyColumns: number;
  duplicates: number;
}

// U+00A0 no-break space, U+200B-U+200D zero-width, U+2060 word joiner, U+FEFF BOM, C0/C1 controls.
/* eslint-disable no-control-regex -- stripping control characters is the point */
const INVISIBLE =
  /[\u00A0\u200B-\u200D\u2060\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/* eslint-enable no-control-regex */
const MONEY = /^[-+]?[$€£¥₹]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/** A messy numeric string as a number, or null ("007" stays text: leading zeros are data). */
export function looseNumber(text: string): number | null {
  const t = text.trim();
  if (t === "" || /^[-+]?0\d/.test(t)) return null;
  const direct = parseNumber(t);
  if (direct !== null) return direct;
  if (!MONEY.test(t)) return null;
  const n = Number(t.replace(/[$€£¥₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function cleanTable(
  table: Table,
  options: CleanOptions = {},
): { table: Table; report: CleanReport } {
  const {
    trim = true,
    collapseSpaces = true,
    invisible = true,
    fixTypes = true,
    dates = false,
    headers = true,
    emptyRows = true,
    emptyColumns = true,
    duplicates = false,
  } = options;
  const report: CleanReport = {
    trimmed: 0,
    invisible: 0,
    converted: 0,
    headersFixed: 0,
    emptyRows: 0,
    emptyColumns: 0,
    duplicates: 0,
  };

  const cleanText = (s: string): string => {
    let out = s;
    if (invisible) {
      const stripped = out.replace(INVISIBLE, (ch) => (ch === "\u00A0" ? " " : ""));
      if (stripped !== out) report.invisible += 1;
      out = stripped;
    }
    const before = out;
    if (trim) out = out.trim();
    if (collapseSpaces) out = out.replace(/[ \t]{2,}/g, " ");
    if (out !== before) report.trimmed += 1;
    return out;
  };

  const rows = table.rows.map((row) =>
    row.map((v): Cell => {
      if (typeof v !== "string") return v;
      const s = cleanText(v);
      if (s === "") return null;
      if (fixTypes) {
        const n = looseNumber(s);
        if (n !== null) {
          report.converted += 1;
          return n;
        }
        const lower = s.toLowerCase();
        if (lower === "true" || lower === "false") {
          report.converted += 1;
          return lower === "true";
        }
        if (dates) {
          const d = parseIsoDate(s);
          if (d) {
            report.converted += 1;
            return d;
          }
        }
      }
      return s;
    }),
  );

  let headerNames = table.headers;
  if (headers) {
    const cleaned = uniqueHeaders(
      table.headers.map((h, i) =>
        table.blankHeader?.[i] ? "" : cleanText(h).replace(/\s+/g, " "),
      ),
    );
    report.headersFixed = cleaned.filter((h, i) => h !== table.headers[i]).length;
    headerNames = cleaned;
  }

  let out: Table = { ...table, headers: headerNames, rows };
  if (emptyRows || emptyColumns) {
    const r = removeEmpty(out, { rows: emptyRows, columns: emptyColumns });
    out = r.table;
    report.emptyRows = r.rowsRemoved;
    report.emptyColumns = r.columnsRemoved;
  }
  if (duplicates) {
    const r = removeDuplicateRows(out);
    out = r.table;
    report.duplicates = r.removed;
  }
  return { table: out, report };
}

// ---- executors --------------------------------------------------------------------------------

function listRows(rows: number[]): string {
  if (rows.length === 0) return "";
  const shown = rows.slice(0, 8).join(", ");
  return ` (row${rows.length === 1 ? "" : "s"} ${shown}${rows.length > 8 ? ", …" : ""})`;
}

export const duplicateRowRemoverExecutor: Executor = async (input, options, ctx) =>
  runDataTool(DUPLICATE_ROW_REMOVER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(
      file!,
      { sheet: sheetOption(options), delimiter: delimiterOption(options) },
      ctx?.signal,
    );
    const spec = optString(options, "columns", "");
    let removed = 0;
    const removedRows: string[] = [];
    const tables = source.tables.map((t) => {
      const r = removeDuplicateRows(t, {
        columns: resolveColumns(t, spec),
        ignoreCase: optBool(options, "ignoreCase", false),
        ignoreSpaces: optBool(options, "ignoreSpaces", true),
        keep: optEnum(options, "keep", ["first", "last"] as const, "first"),
      });
      removed += r.removed;
      if (r.removed > 0) {
        removedRows.push(
          `${source.tables.length > 1 ? `"${t.name}"` : ""}${listRows(r.removedRows)}`.trim(),
        );
      }
      return r.table;
    });
    const { file: out } = await writeTabular(source, tables, "deduplicated");
    const by = spec.trim() ? ` by ${spec.trim()}` : "";
    return {
      ok: true,
      output: {
        duplicatesRemoved: removed,
        rowsLeft: tables.reduce((n, t) => n + t.rows.length, 0),
        sheets: tables.length,
      },
      summary:
        removed === 0
          ? `No duplicate rows found${by}.`
          : `Removed ${plural(removed, "duplicate row")}${by} ${removedRows.join("; ")}.`.replace(
              /\s+\./,
              ".",
            ),
      files: [out],
    };
  });

export const emptyRowColumnRemoverExecutor: Executor = async (input, options, ctx) =>
  runDataTool(EMPTY_ROW_COLUMN_REMOVER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(
      file!,
      { sheet: sheetOption(options), keepBlankLines: true, delimiter: delimiterOption(options) },
      ctx?.signal,
    );
    const target = optEnum(options, "remove", ["both", "rows", "columns"] as const, "both");
    let rows = 0;
    let cols = 0;
    const names: string[] = [];
    const tables = source.tables.map((t) => {
      const r = removeEmpty(t, {
        rows: target !== "columns",
        columns: target !== "rows",
        headedColumns: optBool(options, "headedColumns", false),
      });
      rows += r.rowsRemoved;
      cols += r.columnsRemoved;
      names.push(...r.removedColumns);
      return r.table;
    });
    const { file: out } = await writeTabular(source, tables, "no-empty");
    const parts = [
      target !== "columns" ? plural(rows, "empty row") : null,
      target !== "rows" ? plural(cols, "empty column") : null,
    ].filter(Boolean);
    return {
      ok: true,
      output: { rowsRemoved: rows, columnsRemoved: cols, removedColumns: names },
      summary:
        rows + cols === 0
          ? "Nothing to remove — there are no empty rows or columns."
          : `Removed ${parts.join(" and ")}.`,
      files: [out],
    };
  });

export const spreadsheetCleanerExecutor: Executor = async (input, options, ctx) =>
  runDataTool(SPREADSHEET_CLEANER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    // Values are read as text so the cleaner can see (and count) what it fixes.
    const source = await readTabular(
      file!,
      {
        sheet: sheetOption(options),
        keepBlankLines: true,
        delimiter: delimiterOption(options),
        infer: false,
      },
      ctx?.signal,
    );
    const total: CleanReport = {
      trimmed: 0,
      invisible: 0,
      converted: 0,
      headersFixed: 0,
      emptyRows: 0,
      emptyColumns: 0,
      duplicates: 0,
    };
    const tables = source.tables.map((t) => {
      const r = cleanTable(t, {
        trim: optBool(options, "trim", true),
        collapseSpaces: optBool(options, "trim", true),
        invisible: optBool(options, "invisible", true),
        fixTypes: optBool(options, "fixTypes", true),
        dates: source.kind === "excel" && optBool(options, "fixTypes", true),
        headers: optBool(options, "headers", true),
        emptyRows: optBool(options, "emptyRows", true),
        emptyColumns: optBool(options, "emptyRows", true),
        duplicates: optBool(options, "duplicates", false),
      });
      for (const k of Object.keys(total) as (keyof CleanReport)[]) total[k] += r.report[k];
      return r.table;
    });
    const { file: out } = await writeTabular(source, tables, "clean");
    const parts = [
      total.trimmed && `tidied spaces in ${plural(total.trimmed, "cell")}`,
      total.invisible && `removed invisible characters from ${plural(total.invisible, "cell")}`,
      total.converted &&
        `turned ${plural(total.converted, "text value")} into numbers, booleans or dates`,
      total.headersFixed && `fixed ${plural(total.headersFixed, "header")}`,
      total.emptyRows && `removed ${plural(total.emptyRows, "empty row")}`,
      total.emptyColumns && `removed ${plural(total.emptyColumns, "empty column")}`,
      total.duplicates && `removed ${plural(total.duplicates, "duplicate row")}`,
    ].filter(Boolean) as string[];
    const summary =
      parts.length === 0
        ? "This data was already clean — nothing needed fixing."
        : `Cleaned: ${parts.join(", ")}.`;
    return {
      ok: true,
      output: { ...total, warnings: source.warnings },
      summary:
        summary[0]!.toUpperCase() +
        summary.slice(1) +
        (source.warnings.length ? ` ${source.warnings.join(" ")}` : ""),
      files: [out],
    };
  });
