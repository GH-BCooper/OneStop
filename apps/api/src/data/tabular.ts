// One reader and one writer for "any spreadsheet": the cleaners, transformer, formatter and
// validator accept CSV or Excel and hand back the same kind of file they were given.
import type ExcelJS from "exceljs";
import type { OutputFile } from "@onestop/types";
import {
  type DataInput,
  decodeText,
  MIME,
  optEnum,
  optString,
  type Table,
  textOutput,
} from "./common.ts";
import { DELIMITERS, type DelimiterChoice, parseCsv } from "./csv.ts";
import { toCsv } from "./csv.ts";
import { type CellStats, loadWorkbook, pickSheets, sheetToTable, tablesToXlsx } from "./excel.ts";

export interface TabularSource {
  kind: "csv" | "excel";
  name: string;
  tables: Table[];
  workbook?: ExcelJS.Workbook;
  delimiter: string;
  warnings: string[];
  ragged: { row: number; fields: number }[];
  /** Columns in the header row (CSV rows can differ). */
  headerWidth: number;
}

export interface ReadTabularOptions {
  /** Excel: "" first sheet, "all", a name or a number. */
  sheet?: string;
  header?: boolean;
  /** ISO text → dates (only useful when the result is Excel). */
  dates?: boolean;
  keepBlankLines?: boolean;
  delimiter?: DelimiterChoice;
  infer?: boolean;
}

export const isExcel = (ext: string) => ext === "xlsx" || ext === "xls" || ext === "ods";

export async function readTabular(
  file: DataInput,
  {
    sheet = "all",
    header = true,
    dates = false,
    keepBlankLines = false,
    delimiter = "auto",
    infer = true,
  }: ReadTabularOptions = {},
  signal?: AbortSignal,
): Promise<TabularSource> {
  if (isExcel(file.ext)) {
    const workbook = await loadWorkbook(file, signal);
    const stats: CellStats = { formulasWithoutResult: 0 };
    const tables = pickSheets(workbook, sheet).map((ws) => sheetToTable(ws, { header, stats }));
    const warnings =
      stats.formulasWithoutResult > 0
        ? [
            `${stats.formulasWithoutResult} formula cell${stats.formulasWithoutResult === 1 ? " has" : "s have"} no saved result (the workbook was never recalculated) and came out empty — open and save it in Excel first to include them.`,
          ]
        : [];
    return {
      kind: "excel",
      name: file.name,
      tables,
      workbook,
      delimiter: ",",
      warnings,
      ragged: [],
      headerWidth: tables[0]?.headers.length ?? 0,
    };
  }
  const parsed = parseCsv(decodeText(file.bytes), {
    delimiter,
    header,
    keepBlankLines,
    infer: infer ? { dates } : false,
    name: file.name,
  });
  return {
    kind: "csv",
    name: file.name,
    tables: [parsed.table],
    delimiter: parsed.delimiter,
    warnings: parsed.warnings,
    ragged: parsed.ragged,
    headerWidth: parsed.headerWidth,
  };
}

/** The delimiter option shared by the CSV tools. */
export function delimiterOption(options: Record<string, unknown>): DelimiterChoice {
  return optEnum(options, "delimiter", Object.keys(DELIMITERS) as DelimiterChoice[], "auto");
}

export function sheetOption(options: Record<string, unknown>, fallback = "all"): string {
  const raw = optString(options, "sheet", "").trim();
  return raw === "" ? fallback : raw;
}

/** Tables back into the kind of file they came from. */
export async function writeTabular(
  source: Pick<TabularSource, "kind" | "delimiter" | "name">,
  tables: Table[],
  suffix: string,
  { keepFormatting = true }: { keepFormatting?: boolean } = {},
): Promise<{ file: OutputFile; escaped: number }> {
  if (source.kind === "excel") {
    return {
      file: {
        name: `${source.name}-${suffix}.xlsx`,
        mimeType: MIME.xlsx,
        bytes: await tablesToXlsx(tables, { keepFormatting }),
      },
      escaped: 0,
    };
  }
  const { text, escaped } = toCsv(tables[0]!, { delimiter: source.delimiter });
  return { file: textOutput(`${source.name}-${suffix}.csv`, MIME.csv, text), escaped };
}
