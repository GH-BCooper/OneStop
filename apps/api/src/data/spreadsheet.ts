// Excel Merger/Splitter and CSV Merger/Splitter (08-excel-csv-data-tools.md).
//
// Merging and splitting by sheet copy whole worksheets (values *and formulas*, styles, widths,
// merges), because addresses do not move. Stacking rows and splitting by row count go through
// the table model and line columns up by header name.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { packageOutputs } from "../pdf/inputs.ts";
import {
  type Cell,
  cellText,
  type DataInput,
  decodeText,
  makeTable,
  MIME,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readDataInputs,
  runDataTool,
  selectTable,
  type Table,
  textOutput,
  unsupported,
} from "./common.ts";
import { resolveColumn } from "./columns.ts";
import { parseCsv, toCsv } from "./csv.ts";
import {
  copyWorksheet,
  loadWorkbook,
  newWorkbook,
  pickSheets,
  sheetName,
  sheetToTable,
  tablesToXlsx,
  workbookBytes,
} from "./excel.ts";
import { delimiterOption, sheetOption } from "./tabular.ts";

export const EXCEL_MERGER_TOOL_ID = "excel-merger";
export const EXCEL_SPLITTER_TOOL_ID = "excel-splitter";
export const CSV_MERGER_TOOL_ID = "csv-merger";
export const CSV_SPLITTER_TOOL_ID = "csv-splitter";

const PACKAGING = ["zip", "files"] as const;
const MAX_PARTS = 1000;

/**
 * Stacks tables into one. Columns line up by name (case-insensitive) — new names are added on the
 * right — or by position when `byName` is off. `sourceColumn` adds the origin of every row.
 */
export function stackTables(
  tables: Table[],
  { byName = true, sourceColumn = "" }: { byName?: boolean; sourceColumn?: string } = {},
): Table {
  const headers: string[] = [];
  const index = new Map<string, number>();
  const maps = tables.map((t) =>
    t.headers.map((h, i) => {
      const key = byName ? h.trim().toLowerCase() : String(i);
      let at = index.get(key);
      if (at === undefined) {
        at = headers.length;
        index.set(key, at);
        headers.push(h);
      }
      return at;
    }),
  );
  const rows: Cell[][] = [];
  tables.forEach((t, k) => {
    for (const r of t.rows) {
      const row: Cell[] = new Array(headers.length).fill(null);
      maps[k]!.forEach((at, i) => (row[at] = r[i] ?? null));
      if (sourceColumn) row.push(t.name);
      rows.push(row);
    }
  });
  return makeTable(
    tables[0]?.name ?? "merged",
    sourceColumn ? [...headers, sourceColumn] : headers,
    rows,
  );
}

/** Splits rows into chunks of `size` (every chunk keeps the header). */
export function chunkTable(table: Table, size: number): Table[] {
  if (table.rows.length === 0) return [table];
  const parts: Table[] = [];
  for (let start = 0; start < table.rows.length; start += size) {
    const idx = Array.from(
      { length: Math.min(size, table.rows.length - start) },
      (_, i) => start + i,
    );
    parts.push({ ...selectTable(table, idx, null), name: `${table.name} ${parts.length + 1}` });
  }
  return parts;
}

/** One table per distinct value of a column, in order of first appearance. */
export function groupTable(table: Table, column: number): Table[] {
  const groups = new Map<string, number[]>();
  table.rows.forEach((r, i) => {
    const key = cellText(r[column]).trim() || "(blank)";
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  });
  return [...groups].map(([key, idx]) => ({ ...selectTable(table, idx, null), name: key }));
}

function checkParts(n: number): void {
  if (n > MAX_PARTS) {
    throw unsupported(
      `That would make ${n.toLocaleString("en")} files. Choose a larger size (at most ${MAX_PARTS} parts).`,
    );
  }
}

const safeFilePart = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "part";

function uniqueNames(names: string[], ext: string): string[] {
  const used = new Map<string, number>();
  return names.map((n) => {
    const base = safeFilePart(n);
    const count = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), count);
    return `${count > 1 ? `${base}-${count}` : base}.${ext}`;
  });
}

// ---- Excel ------------------------------------------------------------------------------------

export const excelMergerExecutor: Executor = async (input, options, ctx) =>
  runDataTool(EXCEL_MERGER_TOOL_ID, async () => {
    const files = await readDataInputs(input, ctx, { min: 2, what: "Excel file" });
    const mode = optEnum(options, "mode", ["sheets", "append"] as const, "sheets");
    const books = [];
    for (const f of files) books.push({ file: f, wb: await loadWorkbook(f, ctx?.signal) });

    if (mode === "sheets") {
      const out = newWorkbook();
      const used = new Set<string>();
      let sheets = 0;
      for (const { file, wb } of books) {
        for (const ws of wb.worksheets) {
          const name = wb.worksheets.length === 1 ? file.name : `${file.name} - ${ws.name}`;
          copyWorksheet(
            ws,
            out,
            sheetName(optBool(options, "prefix", true) ? name : ws.name, used),
          );
          sheets += 1;
        }
      }
      return {
        ok: true,
        output: { mode, files: files.length, sheets },
        summary: `Combined ${plural(files.length, "workbook")} into one with ${plural(sheets, "sheet")}; formulas and formatting were kept.`,
        files: [
          {
            name: `${files[0]!.name}-merged.xlsx`,
            mimeType: MIME.xlsx,
            bytes: await workbookBytes(out),
          },
        ],
      };
    }

    const tables: Table[] = [];
    for (const { file, wb } of books) {
      for (const ws of pickSheets(wb, sheetOption(options, ""))) {
        const t = sheetToTable(ws);
        if (t.headers.length > 0) tables.push({ ...t, name: file.name });
      }
    }
    if (tables.length === 0) throw unsupported("None of these workbooks has any data.");
    const merged = stackTables(tables, {
      byName: optBool(options, "byName", true),
      sourceColumn: optBool(options, "sourceColumn", false) ? "Source file" : "",
    });
    merged.name = "Merged";
    return {
      ok: true,
      output: { mode, files: files.length, rows: merged.rows.length, columns: merged.headers },
      summary: `Stacked ${plural(merged.rows.length, "row")} from ${plural(files.length, "workbook")} into one sheet with ${plural(merged.headers.length, "column")}.`,
      files: [
        {
          name: `${files[0]!.name}-merged.xlsx`,
          mimeType: MIME.xlsx,
          bytes: await tablesToXlsx([merged]),
        },
      ],
    };
  });

export const excelSplitterExecutor: Executor = async (input, options, ctx) =>
  runDataTool(EXCEL_SPLITTER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "Excel file" });
    const wb = await loadWorkbook(file!, ctx?.signal);
    const mode = optEnum(options, "mode", ["sheets", "rows", "column"] as const, "sheets");
    const outputs: OutputFile[] = [];
    let detail: string;

    if (mode === "sheets") {
      if (wb.worksheets.length < 2)
        throw unsupported(
          "This workbook has only one sheet. Split it by rows or by a column instead.",
        );
      const names = uniqueNames(
        wb.worksheets.map((ws) => ws.name),
        "xlsx",
      );
      for (const [i, ws] of wb.worksheets.entries()) {
        const out = newWorkbook();
        copyWorksheet(ws, out, sheetName(ws.name, new Set()));
        outputs.push({
          name: `${file!.name}-${names[i]}`,
          mimeType: MIME.xlsx,
          bytes: await workbookBytes(out),
        });
      }
      detail = `Split into ${plural(outputs.length, "workbook")}, one per sheet.`;
    } else {
      const [ws] = pickSheets(wb, sheetOption(options, ""));
      const table = sheetToTable(ws!);
      if (table.headers.length === 0) throw unsupported(`"${ws!.name}" is empty.`);
      const parts =
        mode === "rows"
          ? chunkTable(table, optNumber(options, "rows", 1000, { min: 1, max: 1_000_000 }))
          : groupTable(table, resolveColumn(table, optString(options, "column", "")));
      checkParts(parts.length);
      const names = uniqueNames(
        parts.map((p) => p.name),
        "xlsx",
      );
      for (const [i, part] of parts.entries()) {
        outputs.push({
          name: `${file!.name}-${names[i]}`,
          mimeType: MIME.xlsx,
          bytes: await tablesToXlsx([{ ...part, name: ws!.name }]),
        });
      }
      detail =
        mode === "rows"
          ? `Split ${plural(table.rows.length, "row")} into ${plural(parts.length, "workbook")}; each keeps the header row.`
          : `Split into ${plural(parts.length, "workbook")}, one per value of "${optString(options, "column", "")}".`;
    }
    return {
      ok: true,
      output: { mode, parts: outputs.length },
      summary: detail,
      files: packageOutputs(
        outputs,
        `${file!.name}-split.zip`,
        optEnum(options, "packaging", PACKAGING, "zip"),
      ),
    };
  });

// ---- CSV --------------------------------------------------------------------------------------

function readCsvFile(file: DataInput, options: Record<string, unknown>) {
  // Values stay text: merging/splitting must write back exactly what was read.
  return parseCsv(decodeText(file.bytes), {
    delimiter: delimiterOption(options),
    infer: false,
    name: file.name,
  });
}

export const csvMergerExecutor: Executor = async (input, options, ctx) =>
  runDataTool(CSV_MERGER_TOOL_ID, async () => {
    const files = await readDataInputs(input, ctx, { min: 2, what: "CSV file" });
    const parsed = files.map((f) => readCsvFile(f, options));
    const merged = stackTables(
      parsed.map((p) => p.table),
      {
        byName: optBool(options, "byName", true),
        sourceColumn: optBool(options, "sourceColumn", false) ? "Source file" : "",
      },
    );
    const { text } = toCsv(merged, { delimiter: parsed[0]!.delimiter, escapeFormulas: false });
    const widths = new Set(parsed.map((p) => p.table.headers.length));
    return {
      ok: true,
      output: { files: files.length, rows: merged.rows.length, columns: merged.headers },
      summary: `Merged ${plural(files.length, "CSV file")} into ${plural(merged.rows.length, "row")} × ${plural(merged.headers.length, "column")}.${widths.size > 1 || merged.headers.length > parsed[0]!.table.headers.length ? " The files had different columns, so missing values were left empty." : ""}`,
      files: [textOutput(`${files[0]!.name}-merged.csv`, MIME.csv, text)],
    };
  });

export const csvSplitterExecutor: Executor = async (input, options, ctx) =>
  runDataTool(CSV_SPLITTER_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "CSV file" });
    const { table, delimiter } = readCsvFile(file!, options);
    const mode = optEnum(options, "mode", ["rows", "parts", "column"] as const, "rows");
    let parts: Table[];
    if (mode === "column") {
      parts = groupTable(table, resolveColumn(table, optString(options, "column", "")));
    } else {
      const size =
        mode === "rows"
          ? optNumber(options, "rows", 1000, { min: 1, max: 10_000_000 })
          : Math.max(
              1,
              Math.ceil(
                table.rows.length / optNumber(options, "parts", 2, { min: 1, max: MAX_PARTS }),
              ),
            );
      parts = chunkTable(table, size);
    }
    checkParts(parts.length);
    const keepHeader = optBool(options, "repeatHeader", true);
    const names = uniqueNames(
      parts.map((p, i) =>
        mode === "column"
          ? p.name
          : `part-${String(i + 1).padStart(String(parts.length).length, "0")}`,
      ),
      "csv",
    );
    const outputs = parts.map((p, i) =>
      textOutput(
        `${file!.name}-${names[i]}`,
        MIME.csv,
        toCsv(p, { delimiter, escapeFormulas: false, header: keepHeader || i === 0 }).text,
      ),
    );
    return {
      ok: true,
      output: { mode, parts: parts.length, rows: table.rows.length },
      summary:
        mode === "column"
          ? `Split ${plural(table.rows.length, "row")} into ${plural(parts.length, "file")}, one per value of "${optString(options, "column", "")}".`
          : `Split ${plural(table.rows.length, "row")} into ${plural(parts.length, "file")}${keepHeader ? "; each keeps the header row" : ""}.`,
      files: packageOutputs(
        outputs,
        `${file!.name}-split.zip`,
        optEnum(options, "packaging", PACKAGING, "zip"),
      ),
    };
  });
