// Column/Row Transformer and Spreadsheet Formatter (08-excel-csv-data-tools.md).
//
// The transformer is a set of small pure operations over a `Table` — rename, choose/reorder,
// delete, split, merge, sort, transpose — so Workflows (phase 15) can chain them one step at a
// time. The formatter styles an Excel sheet in place (formulas survive) or builds one from a CSV.
import type ExcelJS from "exceljs";
import type { Executor } from "@onestop/tool-registry";
import {
  type Cell,
  cellText,
  isBlank,
  makeTable,
  MIME,
  optBool,
  optEnum,
  optString,
  plural,
  readDataInputs,
  runDataTool,
  selectTable,
  type Table,
  uniqueHeaders,
  unsupported,
} from "./common.ts";
import { resolveColumn, resolveColumns, splitList } from "./columns.ts";
import {
  addTableSheet,
  autoWidth,
  copyWorksheet,
  newWorkbook,
  sheetName,
  workbookBytes,
} from "./excel.ts";
import { delimiterOption, readTabular, sheetOption, writeTabular } from "./tabular.ts";

export const COLUMN_ROW_TRANSFORMER_TOOL_ID = "column-row-transformer";
export const SPREADSHEET_FORMATTER_TOOL_ID = "spreadsheet-formatter";

// ---- operations -------------------------------------------------------------------------------

/** "old = new" lines (or "old -> new", "old: new"). */
export function renameColumns(table: Table, mapping: string): { table: Table; renamed: number } {
  const lines = mapping
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0)
    throw unsupported('Enter at least one rename, such as "Old name = New name".');
  const headers = [...table.headers];
  for (const line of lines) {
    const m = /^(.+?)\s*(?:=|->|→|:)\s*(.+)$/.exec(line);
    if (!m) throw unsupported(`"${line}" is not a rename. Write it as "Old name = New name".`);
    headers[resolveColumn(table, m[1]!)] = m[2]!.trim();
  }
  return { table: { ...table, headers: uniqueHeaders(headers) }, renamed: lines.length };
}

/** Keep only these columns, in this order. */
export function chooseColumns(table: Table, spec: string, { keepRest = false } = {}): Table {
  const cols = resolveColumns(table, spec);
  if (cols.length === 0) throw unsupported("List the columns to keep, in the order you want them.");
  if (keepRest)
    for (let c = 0; c < table.headers.length; c += 1) if (!cols.includes(c)) cols.push(c);
  return selectTable(table, null, cols);
}

export function deleteColumns(table: Table, spec: string): Table {
  const drop = new Set(resolveColumns(table, spec));
  if (drop.size === 0) throw unsupported("List the columns to delete.");
  if (drop.size === table.headers.length) throw unsupported("That would delete every column.");
  return selectTable(
    table,
    null,
    table.headers.map((_, i) => i).filter((i) => !drop.has(i)),
  );
}

/** Splits one column into several at a delimiter ("Full name" → "Full name 1", "Full name 2"). */
export function splitColumn(table: Table, column: string, delimiter: string, names = ""): Table {
  const c = resolveColumn(table, column);
  const sep = delimiter === "" ? " " : delimiter.replace(/\\t/g, "\t");
  const parts = table.rows.map((r) =>
    isBlank(r[c])
      ? []
      : cellText(r[c])
          .split(sep)
          .map((p) => p.trim()),
  );
  const width = Math.max(1, ...parts.map((p) => p.length));
  const given = splitList(names);
  const newHeaders = Array.from(
    { length: width },
    (_, i) => given[i] ?? `${table.headers[c]} ${i + 1}`,
  );
  const headers = uniqueHeaders([
    ...table.headers.slice(0, c),
    ...newHeaders,
    ...table.headers.slice(c + 1),
  ]);
  const rows = table.rows.map((r, i) => [
    ...r.slice(0, c),
    ...Array.from({ length: width }, (_, k) => {
      const p = parts[i]![k];
      return p === undefined || p === "" ? null : p;
    }),
    ...r.slice(c + 1),
  ]);
  return {
    ...table,
    headers,
    rows,
    colNumbers: [
      ...table.colNumbers.slice(0, c),
      ...newHeaders.map(() => table.colNumbers[c]!),
      ...table.colNumbers.slice(c + 1),
    ],
    blankHeader: undefined,
  };
}

/** Joins several columns into one (placed where the first of them was). */
export function mergeColumns(table: Table, spec: string, separator: string, name: string): Table {
  const cols = resolveColumns(table, spec);
  if (cols.length < 2) throw unsupported("List at least two columns to merge.");
  const sep = separator.replace(/\\t/g, "\t");
  const at = Math.min(...cols);
  const header = name.trim() || cols.map((c) => table.headers[c]).join(" ");
  const keep = table.headers.map((_, i) => i).filter((i) => !cols.includes(i) || i === at);
  const rows = table.rows.map((r) =>
    keep.map((i) =>
      i === at
        ? cols
            .map((c) => cellText(r[c]))
            .filter((s) => s !== "")
            .join(sep) || null
        : (r[i] ?? null),
    ),
  );
  return {
    ...table,
    headers: uniqueHeaders(keep.map((i) => (i === at ? header : table.headers[i]!))),
    rows,
    colNumbers: keep.map((i) => table.colNumbers[i]!),
    blankHeader: undefined,
  };
}

function compare(a: Cell, b: Cell): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1; // blanks last, either direction
  if (isBlank(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows(table: Table, spec: string, order: "asc" | "desc" = "asc"): Table {
  const cols = resolveColumns(table, spec);
  if (cols.length === 0) throw unsupported("Choose the column to sort by.");
  const idx = table.rows.map((_, i) => i);
  idx.sort((x, y) => {
    for (const c of cols) {
      const a = table.rows[x]![c] ?? null;
      const b = table.rows[y]![c] ?? null;
      if (isBlank(a) !== isBlank(b)) return isBlank(a) ? 1 : -1;
      const d = compare(a, b);
      if (d !== 0) return order === "asc" ? d : -d;
    }
    return x - y; // stable
  });
  return selectTable(table, idx, null);
}

/** Rows become columns: the first column's values become the new headers. */
export function transpose(table: Table): Table {
  const grid: Cell[][] = [table.headers, ...table.rows];
  const width = table.headers.length;
  if (grid.length > 16_384)
    throw unsupported("That is too many rows to turn into columns (Excel allows 16,384 columns).");
  const out: Cell[][] = Array.from({ length: width }, (_, c) => grid.map((r) => r[c] ?? null));
  const [head, ...rows] = out;
  return makeTable(table.name, uniqueHeaders(head!), rows);
}

export const TRANSFORM_OPERATIONS = [
  "rename",
  "choose",
  "delete",
  "split",
  "merge",
  "sort",
  "transpose",
] as const;
export type TransformOperation = (typeof TRANSFORM_OPERATIONS)[number];

export function transformTable(
  table: Table,
  op: TransformOperation,
  options: Record<string, unknown>,
): { table: Table; detail: string } {
  const columns = optString(options, "columns", "");
  switch (op) {
    case "rename": {
      const r = renameColumns(table, optString(options, "mapping", ""));
      return { table: r.table, detail: `Renamed ${plural(r.renamed, "column")}.` };
    }
    case "choose": {
      const t = chooseColumns(table, columns, { keepRest: optBool(options, "keepRest", false) });
      return { table: t, detail: `Kept ${plural(t.headers.length, "column")} in the order given.` };
    }
    case "delete": {
      const t = deleteColumns(table, columns);
      return {
        table: t,
        detail: `Deleted ${plural(table.headers.length - t.headers.length, "column")}.`,
      };
    }
    case "split": {
      const t = splitColumn(
        table,
        columns,
        optString(options, "delimiter", ","),
        optString(options, "newNames", ""),
      );
      return {
        table: t,
        detail: `Split "${table.headers[resolveColumn(table, columns)]}" into ${plural(t.headers.length - table.headers.length + 1, "column")}.`,
      };
    }
    case "merge": {
      const t = mergeColumns(
        table,
        columns,
        optString(options, "separator", " "),
        optString(options, "newName", ""),
      );
      return {
        table: t,
        detail: `Merged ${plural(table.headers.length - t.headers.length + 1, "column")} into one.`,
      };
    }
    case "sort": {
      const t = sortRows(
        table,
        columns,
        optEnum(options, "order", ["asc", "desc"] as const, "asc"),
      );
      return { table: t, detail: `Sorted ${plural(t.rows.length, "row")} by ${columns.trim()}.` };
    }
    case "transpose": {
      const t = transpose(table);
      return { table: t, detail: `Turned ${plural(table.rows.length + 1, "row")} into columns.` };
    }
  }
}

export const columnRowTransformerExecutor: Executor = async (input, options, ctx) =>
  runDataTool(COLUMN_ROW_TRANSFORMER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(
      file!,
      { sheet: sheetOption(options, ""), delimiter: delimiterOption(options) },
      ctx?.signal,
    );
    const op = optEnum(options, "operation", TRANSFORM_OPERATIONS, "rename");
    const details: string[] = [];
    const tables = source.tables.map((t) => {
      if (t.headers.length === 0) throw unsupported(`"${t.name}" is empty.`);
      const r = transformTable(t, op, options);
      details.push(r.detail);
      return r.table;
    });
    // Sorting and transposing move cells, so formatting copied by position would be misleading.
    const keepFormatting = op !== "transpose";
    const { file: out } = await writeTabular(
      source,
      tables,
      op === "transpose" ? "transposed" : "transformed",
      { keepFormatting },
    );
    return {
      ok: true,
      output: { operation: op, columns: tables[0]!.headers, rows: tables[0]!.rows.length },
      summary: details[0]!,
      files: [out],
    };
  });

// ---- formatter --------------------------------------------------------------------------------

const THEMES = {
  blue: { header: "FF1F4E79", band: "FFDDEBF7", border: "FF9BC2E6" },
  green: { header: "FF375623", band: "FFE2EFDA", border: "FFA9D08E" },
  gray: { header: "FF404040", band: "FFF2F2F2", border: "FFBFBFBF" },
  orange: { header: "FFC65911", band: "FFFCE4D6", border: "FFF4B084" },
} as const;
export type FormatTheme = keyof typeof THEMES | "plain";

export interface FormatOptions {
  theme?: FormatTheme;
  freeze?: boolean;
  filter?: boolean;
  banded?: boolean;
  borders?: boolean;
  autoWidth?: boolean;
  /** "#,##0.00" on columns that hold decimals (integers such as years/ids are left alone). */
  thousands?: boolean;
}

/** Styles a sheet whose header is `headerRow` and data runs to `lastRow` × `lastCol`. */
export function styleSheet(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  lastRow: number,
  lastCol: number,
  o: FormatOptions,
): void {
  const {
    theme = "blue",
    freeze = true,
    filter = true,
    banded = true,
    borders = true,
    autoWidth: fit = true,
    thousands = false,
  } = o;
  if (lastCol === 0) return;
  const colors = theme === "plain" ? null : THEMES[theme];
  const edge = colors
    ? ({ style: "thin", color: { argb: colors.border } } as const)
    : ({ style: "thin", color: { argb: "FFBFBFBF" } } as const);

  const head = ws.getRow(headerRow);
  for (let c = 1; c <= lastCol; c += 1) {
    const cell = head.getCell(c);
    cell.font = {
      ...(cell.font ?? {}),
      bold: true,
      ...(colors ? { color: { argb: "FFFFFFFF" } } : {}),
    };
    if (colors) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.header } };
    cell.alignment = { vertical: "middle", wrapText: true };
    if (borders) cell.border = { top: edge, left: edge, bottom: edge, right: edge };
  }

  const decimals = new Array<boolean>(lastCol + 1).fill(false);
  const longText = new Array<boolean>(lastCol + 1).fill(false);
  for (let r = headerRow + 1; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      const v = cell.value;
      const n =
        typeof v === "number"
          ? v
          : v && typeof v === "object" && "result" in v && typeof v.result === "number"
            ? v.result
            : null;
      if (n !== null && !Number.isInteger(n)) decimals[c] = true;
      if (typeof v === "string" && v.length > 60) longText[c] = true;
    }
  }
  for (let r = headerRow + 1; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    const band = banded && colors && (r - headerRow) % 2 === 0;
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      if (band) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.band } };
      if (borders) cell.border = { top: edge, left: edge, bottom: edge, right: edge };
      if (thousands && decimals[c] && !cell.numFmt) cell.numFmt = "#,##0.00";
      if (longText[c])
        cell.alignment = { ...(cell.alignment ?? {}), wrapText: true, vertical: "top" };
    }
  }

  if (fit) {
    for (let c = 1; c <= lastCol; c += 1) {
      const values: Cell[] = [];
      for (let r = headerRow + 1; r <= Math.min(lastRow, headerRow + 2000); r += 1) {
        const v = ws.getRow(r).getCell(c).value;
        values.push(
          v instanceof Date
            ? v
            : v === null || typeof v === "object"
              ? v && "result" in v
                ? (v.result as Cell)
                : null
              : (v as Cell),
        );
      }
      ws.getColumn(c).width = autoWidth(cellText(head.getCell(c).value as Cell), values);
    }
  }
  if (freeze) ws.views = [{ state: "frozen", ySplit: headerRow, topLeftCell: `A${headerRow + 1}` }];
  if (filter && lastRow > headerRow) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: lastCol } };
  }
}

export const spreadsheetFormatterExecutor: Executor = async (input, options, ctx) =>
  runDataTool(SPREADSHEET_FORMATTER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(
      file!,
      { sheet: sheetOption(options), dates: true, delimiter: delimiterOption(options) },
      ctx?.signal,
    );
    const format: FormatOptions = {
      theme: optEnum(
        options,
        "theme",
        ["blue", "green", "gray", "orange", "plain"] as const,
        "blue",
      ),
      freeze: optBool(options, "freeze", true),
      filter: optBool(options, "filter", true),
      banded: optBool(options, "banded", true),
      borders: optBool(options, "borders", true),
      autoWidth: optBool(options, "autoWidth", true),
      thousands: optBool(options, "thousands", false),
    };
    const workbook = newWorkbook();
    const used = new Set<string>();
    let rows = 0;
    for (const table of source.tables) {
      if (source.kind === "excel" && table.source) {
        // Style the original sheet in place, so formulas, merges and anything else survive.
        const ws = copyWorksheet(
          table.source as ExcelJS.Worksheet,
          workbook,
          sheetName(table.name, used),
        );
        const lastRow = table.rowNumbers.length
          ? table.rowNumbers[table.rowNumbers.length - 1]!
          : table.headerRow;
        if (table.headerRow > 0) styleSheet(ws, table.headerRow, lastRow, ws.columnCount, format);
      } else {
        const ws = addTableSheet(workbook, table, used, { keepFormatting: false });
        styleSheet(ws, 1, table.rows.length + 1, table.headers.length, format);
      }
      rows += table.rows.length;
    }
    return {
      ok: true,
      output: { sheets: source.tables.length, rows, theme: format.theme },
      summary: `Formatted ${plural(source.tables.length, "sheet")} (${plural(rows, "row")}) with a ${format.theme === "plain" ? "plain" : format.theme} header${format.freeze ? ", frozen header row" : ""}${format.filter ? ", filters" : ""}.`,
      files: [
        {
          name: `${source.name}-formatted.xlsx`,
          mimeType: MIME.xlsx,
          bytes: await workbookBytes(workbook),
        },
      ],
    };
  });
