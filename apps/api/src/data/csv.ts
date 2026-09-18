// CSV read/write (08-excel-csv-data-tools.md), on papaparse.
//
// Parsing is streamed row by row (`step`), so a large file is never held twice: the rows go
// straight into the table as they are read. Values are typed on the way in — numbers stay numbers
// ("007" and 20-digit ids stay text), `true`/`false` become booleans, and ISO dates become real
// dates only when the target has a date type (Excel).
import Papa from "papaparse";
import {
  cellText,
  type Cell,
  inferCell,
  type InferOptions,
  lineCol,
  makeTable,
  type Table,
  uniqueHeaders,
  unsupported,
} from "./common.ts";

export const DELIMITERS = { auto: "", comma: ",", semicolon: ";", tab: "\t", pipe: "|" } as const;
export type DelimiterChoice = keyof typeof DELIMITERS;

export interface CsvReadOptions {
  delimiter?: DelimiterChoice;
  /** First row holds column names (default). Otherwise columns are "Column 1…". */
  header?: boolean;
  /** Type values (default on); `false` keeps every value as text. */
  infer?: InferOptions | false;
  /** Keep completely blank lines as empty rows (cleaners need them; conversions skip them). */
  keepBlankLines?: boolean;
  name?: string;
}

export interface CsvReadResult {
  table: Table;
  delimiter: string;
  /** Rows whose field count differs from the header, as "row N has X fields…" lines. */
  ragged: { row: number; fields: number }[];
  warnings: string[];
  headerWidth: number;
}

export function describeRagged(ragged: CsvReadResult["ragged"], expected: number): string[] {
  if (ragged.length === 0) return [];
  const first = ragged
    .slice(0, 3)
    .map((r) => `row ${r.row} has ${r.fields}`)
    .join(", ");
  const more = ragged.length > 3 ? ` and ${ragged.length - 3} more rows differ` : "";
  return [`The header has ${expected} columns but ${first}${more}; missing cells were left empty.`];
}

export function parseCsv(text: string, options: CsvReadOptions = {}): CsvReadResult {
  const {
    delimiter = "auto",
    header = true,
    infer = {},
    keepBlankLines = false,
    name = "data",
  } = options;
  if (text.trim() === "") throw unsupported("This CSV file is empty.");

  const raw: string[][] = [];
  const recordNo: number[] = [];
  let record = 0;
  let fatal: Papa.ParseError | null = null;
  let detected: string = DELIMITERS[delimiter] || guessDelimiter(text);

  Papa.parse<string[]>(text, {
    delimiter: detected,
    skipEmptyLines: false,
    step: (result, parser) => {
      record += 1;
      detected = result.meta.delimiter || detected;
      const quoteError = result.errors.find((e) => e.type === "Quotes");
      if (quoteError) {
        fatal = quoteError;
        parser.abort();
        return;
      }
      const row = result.data;
      if (row.length === 1 && row[0] === "" && !keepBlankLines) return;
      raw.push(row);
      recordNo.push(record);
    },
  });

  if (fatal) {
    const e = fatal as Papa.ParseError;
    const where =
      typeof e.index === "number" ? lineCol(text, e.index) : { line: record, column: 1 };
    throw unsupported(
      `This CSV has a quoted value that is never closed (starting near line ${where.line}). Check for a stray " character on that line.`,
    );
  }
  // A trailing newline gives papaparse one empty final record.
  while (raw.length > 0 && isEmptyRecord(raw[raw.length - 1]!)) {
    raw.pop();
    recordNo.pop();
  }
  while (header && raw.length > 0 && isEmptyRecord(raw[0]!)) {
    raw.shift();
    recordNo.shift();
  }
  if (raw.length === 0) throw unsupported("This CSV file has no rows.");

  let headers: string[];
  let body: string[][];
  let bodyNo: number[];
  let headerRow: number;
  if (header) {
    headers = uniqueHeaders(raw[0]!);
    body = raw.slice(1);
    bodyNo = recordNo.slice(1);
    headerRow = recordNo[0]!;
  } else {
    const width = Math.max(...raw.map((r) => r.length));
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    body = raw;
    bodyNo = recordNo;
    headerRow = 0;
  }

  const width = headers.length;
  const ragged: CsvReadResult["ragged"] = [];
  const rows: Cell[][] = new Array(body.length);
  let maxWidth = width;
  for (let i = 0; i < body.length; i += 1) {
    const src = body[i]!;
    const blank = src.length === 1 && src[0] === "";
    if (!blank && src.length !== width) ragged.push({ row: bodyNo[i]!, fields: src.length });
    maxWidth = Math.max(maxWidth, src.length);
    rows[i] = src.map((v) => (infer === false ? v : inferCell(v, infer)));
  }
  // Rows longer than the header get their own (named) columns instead of being dropped.
  for (let c = width; c < maxWidth; c += 1) headers.push(`Column ${c + 1}`);
  for (const row of rows) while (row.length < maxWidth) row.push(infer === false ? "" : null);

  const table = makeTable(name, headers, rows, { headerRow });
  table.rowNumbers = bodyNo;
  table.blankHeader = headers.map((_, c) => !header || (raw[0]![c] ?? "").trim() === "");
  return {
    table,
    delimiter: detected,
    ragged,
    warnings: describeRagged(ragged, width),
    headerWidth: width,
  };
}

/**
 * The separator used consistently on the first lines (outside quotes): the candidate that appears
 * the same, non-zero number of times on most lines wins; ties go to the more frequent one.
 */
export function guessDelimiter(text: string): string {
  const lines = text
    .slice(0, 64 * 1024)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 20);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, "").split(d).length - 1);
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function isEmptyRecord(row: string[]): boolean {
  return row.length === 1 && row[0] === "";
}

export interface CsvWriteOptions {
  delimiter?: string;
  /**
   * Prefix text cells that look like formulas (=…, @…, +SUM(…), -A1…) with an apostrophe so a
   * spreadsheet opening the CSV shows them instead of running them (CSV injection). Numbers and
   * phone numbers such as "+44 20 7946 0000" are left alone.
   */
  escapeFormulas?: boolean;
  /** Byte-order mark, so Excel on Windows reads UTF-8 correctly. */
  bom?: boolean;
  header?: boolean;
}

const FORMULA_START = /^(?:[=@]|[+-]\s*[A-Za-z_(])/;

export function toCsv(
  table: Pick<Table, "headers" | "rows">,
  { delimiter = ",", escapeFormulas = true, bom = false, header = true }: CsvWriteOptions = {},
): { text: string; escaped: number } {
  let escaped = 0;
  const text = (v: Cell | undefined): string => {
    const s = cellText(v);
    if (escapeFormulas && typeof v === "string" && FORMULA_START.test(s)) {
      escaped += 1;
      return `'${s}`;
    }
    return s;
  };
  const out = Papa.unparse(
    {
      fields: table.headers.map((h) => text(h)),
      data: table.rows.map((r) => table.headers.map((_, i) => text(r[i]))),
    },
    { delimiter, newline: "\r\n", header },
  );
  return { text: (bom ? "\uFEFF" : "") + out + "\r\n", escaped };
}
