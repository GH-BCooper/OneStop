// Excel read/write (08-excel-csv-data-tools.md), on exceljs (already used by phases 06/07).
//
// Reading keeps types: numbers, booleans and dates come through as themselves, formulas as their
// saved result. Writing either builds a clean sheet (bold, frozen header, sensible widths, date
// formats) or — when the table was read from a worksheet — copies that sheet's formatting cell by
// cell, so cleaning a styled workbook does not strip its styling.
//
// Legacy .xls / .ods go through LibreOffice when it is installed (phase 06's optional
// dependency); without it the user is told how to proceed instead of seeing a crash.
import ExcelJS from "exceljs";
import { convertWithLibreOffice, findLibreOffice } from "../shared/libreoffice.ts";
import {
  type Cell,
  cellText,
  type DataInput,
  isBlank,
  makeTable,
  type Table,
  uniqueHeaders,
  unsupported,
} from "./common.ts";

export async function loadWorkbook(
  file: DataInput,
  signal?: AbortSignal,
): Promise<ExcelJS.Workbook> {
  let bytes = file.bytes;
  if (file.ext !== "xlsx") {
    const label = file.ext === "xls" ? "Excel 97-2003 (.xls)" : `.${file.ext}`;
    if (!findLibreOffice()) {
      throw unsupported(
        `Working with ${label} files needs LibreOffice, which isn't installed. Install it free from libreoffice.org, or save the file as .xlsx and try again.`,
      );
    }
    try {
      bytes = await convertWithLibreOffice(file.bytes, file.ext, "xlsx", signal ? { signal } : {});
    } catch (err) {
      throw unsupported(`This ${label} file could not be opened. It may be damaged.`, err);
    }
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch (err) {
    throw unsupported(
      `"${file.ref.name}" could not be opened as an Excel workbook. It may be damaged or password protected.`,
      err,
    );
  }
  if (workbook.worksheets.length === 0) throw unsupported(`"${file.ref.name}" has no sheets.`);
  return workbook;
}

export interface CellStats {
  /** Formula cells with no saved result (the workbook was never recalculated). */
  formulasWithoutResult: number;
}

/** A cell's typed value; formulas give their saved result. */
export function readCell(value: ExcelJS.CellValue, stats?: CellStats): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value;
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value) {
    const result = (value as { result?: unknown }).result;
    if (result === undefined || result === null) {
      if (stats) stats.formulasWithoutResult += 1;
      return null;
    }
    if (typeof result === "object" && !(result instanceof Date) && "error" in result) {
      return String((result as { error: string }).error);
    }
    return result as Cell;
  }
  if ("richText" in value) return value.richText.map((r) => r.text).join("");
  if ("hyperlink" in value) {
    const text = (value as ExcelJS.CellHyperlinkValue).text as unknown;
    if (typeof text === "string") return text;
    if (text && typeof text === "object" && "richText" in text) {
      return (text as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    }
    return (value as ExcelJS.CellHyperlinkValue).hyperlink;
  }
  if ("error" in value) return String((value as ExcelJS.CellErrorValue).error);
  return null;
}

/**
 * A worksheet as a table. The header is the first row that has anything in it; columns run to the
 * last one used anywhere in the sheet.
 */
export function sheetToTable(
  ws: ExcelJS.Worksheet,
  { header = true, stats }: { header?: boolean; stats?: CellStats } = {},
): Table {
  const width = ws.actualColumnCount === 0 ? 0 : ws.columnCount;
  const rows: { n: number; cells: Cell[] }[] = [];
  const lastRow = ws.rowCount;
  for (let r = 1; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    const cells: Cell[] = new Array(width).fill(null);
    if (row.hasValues) {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        // A merged range's value lives in its top-left (master) cell only.
        if (c <= width && (!cell.isMerged || cell.master === cell)) {
          cells[c - 1] = readCell(cell.value, stats);
        }
      });
    }
    rows.push({ n: r, cells });
  }
  const firstUsed = rows.findIndex((r) => r.cells.some((c) => !isBlank(c)));
  if (firstUsed === -1) {
    return { ...makeTable(ws.name, [], []), source: ws };
  }
  let headers: string[];
  let body: typeof rows;
  let headerRow: number;
  if (header) {
    headers = uniqueHeaders(rows[firstUsed]!.cells);
    headerRow = rows[firstUsed]!.n;
    body = rows.slice(firstUsed + 1);
  } else {
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    headerRow = 0;
    body = rows.slice(firstUsed);
  }
  // Trailing blank rows are layout, not data.
  while (body.length > 0 && body[body.length - 1]!.cells.every(isBlank)) body.pop();
  const table = makeTable(
    ws.name,
    headers,
    body.map((r) => r.cells),
    { headerRow },
  );
  table.rowNumbers = body.map((r) => r.n);
  table.source = ws;
  table.blankHeader = headers.map((_, c) => !header || isBlank(rows[firstUsed]!.cells[c]));
  return table;
}

/**
 * Which sheets a tool works on: "" = the first sheet with data, "all" = every sheet, otherwise a
 * sheet name or 1-based number.
 */
export function pickSheets(workbook: ExcelJS.Workbook, spec: string): ExcelJS.Worksheet[] {
  const sheets = workbook.worksheets;
  const raw = spec.trim();
  if (raw === "" || raw.toLowerCase() === "first") {
    return [sheets.find((s) => s.actualRowCount > 0) ?? sheets[0]!];
  }
  if (raw.toLowerCase() === "all") return sheets;
  const byName = sheets.find((s) => s.name.toLowerCase() === raw.toLowerCase());
  if (byName) return [byName];
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= sheets.length) return [sheets[n - 1]!];
  }
  throw unsupported(
    `There is no sheet called "${raw}". This workbook has: ${sheets.map((s) => `"${s.name}"`).join(", ")}.`,
  );
}

// ---- writing ----------------------------------------------------------------------------------

const BAD_SHEET_CHARS = /[[\]:*?/\\]/g;

/** A valid, unique sheet name (≤ 31 characters, none of []:*?/\). */
export function sheetName(raw: string, used: Set<string>): string {
  const base = (
    raw
      .replace(BAD_SHEET_CHARS, " ")
      .replace(/^'+|'+$/g, "")
      .trim() || "Sheet"
  ).slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function dateFormat(d: Date): string {
  return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()
    ? "yyyy-mm-dd hh:mm:ss"
    : "yyyy-mm-dd";
}

function hasStyle(style: Partial<ExcelJS.Style> | undefined): boolean {
  return !!style && Object.keys(style).length > 0;
}

/** Width in characters that fits a column's first 2000 values, between 8 and 60. */
export function autoWidth(header: string, values: Cell[]): number {
  let max = header.length;
  const limit = Math.min(values.length, 2000);
  for (let i = 0; i < limit; i += 1) {
    const s = cellText(values[i]);
    if (s.length > max) max = s.length;
  }
  return Math.min(60, Math.max(8, max + 2));
}

/**
 * Adds a table as a worksheet. With a source worksheet its cell styles, column widths and row
 * heights are copied over (by the table's provenance); otherwise a clean default style is used.
 */
export function addTableSheet(
  workbook: ExcelJS.Workbook,
  table: Table,
  used: Set<string>,
  { keepFormatting = true }: { keepFormatting?: boolean } = {},
): ExcelJS.Worksheet {
  const src = keepFormatting ? (table.source as ExcelJS.Worksheet | undefined) : undefined;
  const ws = workbook.addWorksheet(sheetName(table.name, used));
  const width = table.headers.length;

  const header = ws.addRow(table.headers);
  if (src && table.headerRow > 0) {
    const srcRow = src.getRow(table.headerRow);
    if (srcRow.height) header.height = srcRow.height;
    for (let c = 0; c < width; c += 1) {
      const style = srcRow.getCell(table.colNumbers[c] ?? c + 1).style;
      if (hasStyle(style)) header.getCell(c + 1).style = style;
    }
  } else {
    header.font = { bold: true };
  }

  for (let r = 0; r < table.rows.length; r += 1) {
    const values = table.rows[r]!;
    const row = ws.addRow(values.map((v) => (v === null ? null : v)));
    const srcRow = src ? src.getRow(table.rowNumbers[r] ?? 0) : null;
    if (srcRow?.height) row.height = srcRow.height;
    for (let c = 0; c < width; c += 1) {
      const v = values[c];
      const style = srcRow?.getCell(table.colNumbers[c] ?? c + 1).style;
      if (hasStyle(style)) row.getCell(c + 1).style = style!;
      if (v instanceof Date && !row.getCell(c + 1).numFmt)
        row.getCell(c + 1).numFmt = dateFormat(v);
    }
  }

  for (let c = 0; c < width; c += 1) {
    const srcWidth = src?.getColumn(table.colNumbers[c] ?? c + 1).width;
    ws.getColumn(c + 1).width =
      srcWidth ??
      autoWidth(
        table.headers[c] ?? "",
        table.rows.map((row) => row[c] ?? null),
      );
  }
  if (!src && width > 0) ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

export async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OneStop";
  workbook.created = new Date();
  return workbook;
}

/** Tables → .xlsx, one sheet each. */
export async function tablesToXlsx(
  tables: Table[],
  options: { keepFormatting?: boolean } = {},
): Promise<Uint8Array> {
  const workbook = newWorkbook();
  const used = new Set<string>();
  for (const table of tables) addTableSheet(workbook, table, used, options);
  return workbookBytes(workbook);
}

/**
 * Copies a whole worksheet — values *including formulas*, styles, widths, heights, merges and
 * frozen panes — into another workbook. Used where addresses do not change (merge by sheet, split
 * by sheet), so formulas keep pointing at the right cells.
 */
export function copyWorksheet(
  src: ExcelJS.Worksheet,
  target: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet {
  const dst = target.addWorksheet(name, {
    views: src.views,
    properties: { ...src.properties },
    pageSetup: { ...src.pageSetup },
  });
  const cols = src.columnCount;
  for (let c = 1; c <= cols; c += 1) {
    const col = src.getColumn(c);
    const out = dst.getColumn(c);
    if (col.width) out.width = col.width;
    if (col.hidden) out.hidden = true;
  }
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const out = dst.getRow(r);
    if (row.height) out.height = row.height;
    if (row.hidden) out.hidden = true;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const target = out.getCell(c);
      if (!cell.isMerged || cell.master === cell) target.value = cell.value;
      if (hasStyle(cell.style)) target.style = cell.style;
    });
  });
  const merges = (src.model as { merges?: string[] }).merges ?? [];
  for (const range of merges) {
    try {
      dst.mergeCells(range);
    } catch {
      // An overlapping merge in a damaged file: skip it rather than fail the whole copy.
    }
  }
  return dst;
}
