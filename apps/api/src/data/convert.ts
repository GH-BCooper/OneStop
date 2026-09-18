// Every data conversion (08-excel-csv-data-tools.md): Excel/CSV/JSON/XML/YAML to each other, Excel
// → PDF/Word, and the JSON/XML formatters.
//
// Each pair is "read into a Table (or a JSON value), write out" through the modules beside this
// one, so types survive the trip: numbers stay numbers, booleans stay booleans, Excel dates become
// ISO dates in text formats and ISO dates become real dates in Excel.
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table as DocxTable,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { packageOutputs } from "../pdf/inputs.ts";
import { officeToPdf, type OfficeSource } from "../shared/office-convert.ts";
import {
  cellText,
  type DataInput,
  MIME,
  optBool,
  optEnum,
  optNumber,
  optString,
  parseIsoDate,
  plural,
  readDataInputs,
  readTextSource,
  runDataTool,
  type Table,
  textOutput,
  unsupported,
} from "./common.ts";
import { DELIMITERS, parseCsv, toCsv } from "./csv.ts";
import { tablesToXlsx } from "./excel.ts";
import {
  type EmptyAs,
  formatJson,
  type Json,
  jsonToTable,
  parseJson,
  tableToJson,
} from "./json.ts";
import { delimiterOption, readTabular, sheetOption } from "./tabular.ts";
import { formatXml, jsonToXml, tablesToXml, xmlToJson, xmlToTable } from "./xml.ts";
import { parseYaml, toYaml } from "./yaml.ts";

const PACKAGING = ["zip", "files"] as const;

// ---- readers ----------------------------------------------------------------------------------

async function readExcelTables(
  input: Parameters<Executor>[0],
  options: Record<string, unknown>,
  signal: AbortSignal | undefined,
  ctx: Parameters<Executor>[2],
  { dates = false, fallbackSheet = "" } = {},
): Promise<{ file: DataInput; tables: Table[]; warnings: string[] }> {
  const [file] = await readDataInputs(input, ctx, { what: "Excel file" });
  const source = await readTabular(
    file!,
    { sheet: sheetOption(options, fallbackSheet), header: optBool(options, "header", true), dates },
    signal,
  );
  const tables = source.tables.filter((t) => t.headers.length > 0);
  if (tables.length === 0) throw unsupported("This workbook has no data in the chosen sheet.");
  return { file: file!, tables, warnings: source.warnings };
}

async function readCsvTable(
  input: Parameters<Executor>[0],
  options: Record<string, unknown>,
  ctx: Parameters<Executor>[2],
  { dates = false } = {},
): Promise<{ table: Table; name: string; warnings: string[] }> {
  const { text, name } = await readTextSource(input, ctx, "CSV");
  const parsed = parseCsv(text, {
    delimiter: delimiterOption(options),
    header: optBool(options, "header", true),
    infer: optBool(options, "typed", true) ? { dates } : false,
    name,
  });
  return { table: parsed.table, name, warnings: parsed.warnings };
}

async function readJson(input: Parameters<Executor>[0], ctx: Parameters<Executor>[2]) {
  const { text, name } = await readTextSource(input, ctx, "JSON");
  return { value: parseJson(text), name };
}

async function readXml(input: Parameters<Executor>[0], ctx: Parameters<Executor>[2]) {
  return readTextSource(input, ctx, "XML");
}

// ---- writers ----------------------------------------------------------------------------------

function jsonOptions(options: Record<string, unknown>) {
  return {
    nested: optBool(options, "nested", false),
    emptyAs: optEnum(options, "emptyAs", ["null", "empty", "omit"] as const, "null") as EmptyAs,
  };
}

function indentOf(options: Record<string, unknown>): number | "\t" | 0 {
  const v = optEnum(options, "indent", ["2", "4", "tab", "0"] as const, "2");
  return v === "tab" ? "\t" : Number(v);
}

function csvWrite(table: Table, options: Record<string, unknown>) {
  const choice = optEnum(
    options,
    "outDelimiter",
    ["comma", "semicolon", "tab", "pipe"] as const,
    "comma",
  );
  return toCsv(table, {
    delimiter: DELIMITERS[choice],
    bom: optBool(options, "bom", false),
    escapeFormulas: optBool(options, "escapeFormulas", true),
  });
}

function withWarnings(summary: string, warnings: string[]): string {
  return warnings.length ? `${summary} ${warnings.join(" ")}` : summary;
}

const rowsOf = (tables: Table[]) => tables.reduce((n, t) => n + t.rows.length, 0);

// ---- Excel → … --------------------------------------------------------------------------------

export const excelToCsvExecutor: Executor = async (input, options, ctx) =>
  runDataTool("excel-to-csv", async () => {
    const { file, tables, warnings } = await readExcelTables(input, options, ctx?.signal, ctx);
    let escaped = 0;
    const outputs: OutputFile[] = tables.map((t) => {
      const r = csvWrite(t, options);
      escaped += r.escaped;
      const suffix = tables.length > 1 ? `-${t.name.replace(/[^\w.-]+/g, "_")}` : "";
      return textOutput(`${file.name}${suffix}.csv`, MIME.csv, r.text);
    });
    const packaging = optEnum(options, "packaging", PACKAGING, "zip");
    return {
      ok: true,
      output: { sheets: tables.map((t) => t.name), rows: rowsOf(tables), formulasEscaped: escaped },
      summary: withWarnings(
        `Exported ${plural(rowsOf(tables), "row")} from ${tables.length === 1 ? `"${tables[0]!.name}"` : plural(tables.length, "sheet")} as CSV.${escaped ? ` ${plural(escaped, "cell")} that looked like formulas were prefixed with ' so spreadsheets show them as text.` : ""}`,
        warnings,
      ),
      files: packageOutputs(outputs, `${file.name}-csv.zip`, packaging),
    };
  });

export const excelToJsonExecutor: Executor = async (input, options, ctx) =>
  runDataTool("excel-to-json", async () => {
    const { file, tables, warnings } = await readExcelTables(input, options, ctx?.signal, ctx);
    const opts = jsonOptions(options);
    const value: Json =
      tables.length === 1
        ? tableToJson(tables[0]!, opts)
        : Object.fromEntries(tables.map((t) => [t.name, tableToJson(t, opts)]));
    return {
      ok: true,
      output: { sheets: tables.map((t) => t.name), rows: rowsOf(tables) },
      summary: withWarnings(
        `Converted ${plural(rowsOf(tables), "row")} to JSON${tables.length > 1 ? ` (one array per sheet, ${plural(tables.length, "sheet")})` : ""}.`,
        warnings,
      ),
      files: [
        textOutput(
          `${file.name}.json`,
          MIME.json,
          `${formatJson(value, { indent: indentOf(options) })}\n`,
        ),
      ],
    };
  });

export const excelToXmlExecutor: Executor = async (input, options, ctx) =>
  runDataTool("excel-to-xml", async () => {
    const { file, tables, warnings } = await readExcelTables(input, options, ctx?.signal, ctx);
    const xml = tablesToXml(tables, {
      root: optString(options, "root", ""),
      row: optString(options, "row", "row"),
    });
    return {
      ok: true,
      output: { sheets: tables.map((t) => t.name), rows: rowsOf(tables) },
      summary: withWarnings(`Converted ${plural(rowsOf(tables), "row")} to XML.`, warnings),
      files: [textOutput(`${file.name}.xml`, MIME.xml, xml)],
    };
  });

/** Excel → PDF goes through the shared `office-convert` interface (phase 06), per the build file. */
export const excelToPdfExecutor: Executor = async (input, options, ctx) =>
  runDataTool("excel-to-pdf", async () => {
    const files = await readDataInputs(input, ctx, { what: "Excel file" });
    const engine = optEnum(options, "engine", ["auto", "builtin"] as const, "auto");
    const outputs: OutputFile[] = [];
    const notices = new Set<string>();
    for (const file of files) {
      const result = await officeToPdf(file.bytes, file.ext as OfficeSource, {
        engine,
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      if (result.notice) notices.add(result.notice);
      outputs.push({ name: `${file.name}.pdf`, mimeType: MIME.pdf, bytes: result.bytes });
    }
    return {
      ok: true,
      output: { files: files.length, notice: [...notices][0] ?? null },
      summary: withWarnings(`Converted ${plural(files.length, "workbook")} to PDF.`, [...notices]),
      files: packageOutputs(
        outputs,
        `${files[0]!.name}-pdf.zip`,
        optEnum(options, "packaging", PACKAGING, "zip"),
      ),
    };
  });

const WORD_ROW_LIMIT = 5000;

export async function tablesToDocx(
  tables: Table[],
  title: string,
): Promise<{ bytes: Uint8Array; truncated: number }> {
  let truncated = 0;
  const children: (Paragraph | DocxTable)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];
  const wide = tables.some((t) => t.headers.length > 6);
  for (const t of tables) {
    if (tables.length > 1)
      children.push(new Paragraph({ text: t.name, heading: HeadingLevel.HEADING_1 }));
    const rows = t.rows.slice(0, WORD_ROW_LIMIT);
    truncated += t.rows.length - rows.length;
    const cell = (text: string, bold = false, numeric = false) =>
      new TableCell({
        children: [
          new Paragraph({
            alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text, bold, size: 18 })],
          }),
        ],
      });
    children.push(
      new DocxTable({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: t.headers.map((h) => cell(h, true)) }),
          ...rows.map(
            (r) =>
              new TableRow({
                children: t.headers.map((_, c) =>
                  cell(cellText(r[c]), false, typeof r[c] === "number"),
                ),
              }),
          ),
        ],
      }),
    );
    if (t.rows.length > rows.length) {
      children.push(
        new Paragraph({ text: `… ${t.rows.length - rows.length} more rows are not shown.` }),
      );
    }
  }
  const doc = new Document({
    creator: "OneStop",
    title,
    sections: [
      {
        properties: wide ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {},
        children,
      },
    ],
  });
  return { bytes: new Uint8Array(await Packer.toBuffer(doc)), truncated };
}

export const excelToWordExecutor: Executor = async (input, options, ctx) =>
  runDataTool("excel-to-word", async () => {
    const { file, tables, warnings } = await readExcelTables(input, options, ctx?.signal, ctx, {
      fallbackSheet: "all",
    });
    const { bytes, truncated } = await tablesToDocx(tables, file.name);
    return {
      ok: true,
      output: { sheets: tables.map((t) => t.name), rows: rowsOf(tables), truncated },
      summary: withWarnings(
        `Put ${plural(tables.length, "sheet")} (${plural(rowsOf(tables) - truncated, "row")}) into a Word document as tables.${truncated ? ` ${truncated} rows beyond ${WORD_ROW_LIMIT} per sheet were left out to keep the document usable.` : ""}`,
        warnings,
      ),
      files: [{ name: `${file.name}.docx`, mimeType: MIME.docx, bytes }],
    };
  });

// ---- CSV → … ----------------------------------------------------------------------------------

export const csvToExcelExecutor: Executor = async (input, options, ctx) =>
  runDataTool("csv-to-excel", async () => {
    const { table, name, warnings } = await readCsvTable(input, options, ctx, {
      dates: optBool(options, "dates", true),
    });
    table.name = optString(options, "sheetName", "").trim() || name;
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers.length },
      summary: withWarnings(
        `Converted ${plural(table.rows.length, "row")} × ${plural(table.headers.length, "column")} to Excel.`,
        warnings,
      ),
      files: [{ name: `${name}.xlsx`, mimeType: MIME.xlsx, bytes: await tablesToXlsx([table]) }],
    };
  });

export const csvToJsonExecutor: Executor = async (input, options, ctx) =>
  runDataTool("csv-to-json", async () => {
    const { table, name, warnings } = await readCsvTable(input, options, ctx);
    const value = tableToJson(table, jsonOptions(options));
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers },
      summary: withWarnings(
        `Converted ${plural(table.rows.length, "row")} to a JSON array.`,
        warnings,
      ),
      files: [
        textOutput(
          `${name}.json`,
          MIME.json,
          `${formatJson(value, { indent: indentOf(options) })}\n`,
        ),
      ],
    };
  });

export const csvToXmlExecutor: Executor = async (input, options, ctx) =>
  runDataTool("csv-to-xml", async () => {
    const { table, name, warnings } = await readCsvTable(input, options, ctx);
    const xml = tablesToXml([table], {
      root: optString(options, "root", ""),
      row: optString(options, "row", "row"),
    });
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers },
      summary: withWarnings(`Converted ${plural(table.rows.length, "row")} to XML.`, warnings),
      files: [textOutput(`${name}.xml`, MIME.xml, xml)],
    };
  });

// ---- JSON → … ---------------------------------------------------------------------------------

function fromPath(path: string) {
  return path ? ` (the "${path}" array)` : "";
}

export const jsonToExcelExecutor: Executor = async (input, options, ctx) =>
  runDataTool("json-to-excel", async () => {
    const { value, name } = await readJson(input, ctx);
    const { table, path } = jsonToTable(value, name);
    // ISO date strings become real Excel dates (they read back as the same ISO text).
    if (optBool(options, "dates", true)) {
      table.rows = table.rows.map((r) =>
        r.map((v) => (typeof v === "string" ? (parseIsoDate(v) ?? v) : v)),
      );
    }
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers },
      summary: `Converted ${plural(table.rows.length, "record")}${fromPath(path)} into ${plural(table.headers.length, "column")}; nested fields became dotted column names.`,
      files: [{ name: `${name}.xlsx`, mimeType: MIME.xlsx, bytes: await tablesToXlsx([table]) }],
    };
  });

export const jsonToCsvExecutor: Executor = async (input, options, ctx) =>
  runDataTool("json-to-csv", async () => {
    const { value, name } = await readJson(input, ctx);
    const { table, path } = jsonToTable(value, name);
    const { text, escaped } = csvWrite(table, options);
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers, formulasEscaped: escaped },
      summary: `Flattened ${plural(table.rows.length, "record")}${fromPath(path)} into ${plural(table.headers.length, "column")}.${escaped ? ` ${plural(escaped, "cell")} that looked like formulas were prefixed with '.` : ""}`,
      files: [textOutput(`${name}.csv`, MIME.csv, text)],
    };
  });

export const jsonToXmlExecutor: Executor = async (input, options, ctx) =>
  runDataTool("json-to-xml", async () => {
    const { value, name } = await readJson(input, ctx);
    const xml = jsonToXml(value, {
      root: optString(options, "root", "root") || "root",
      item: optString(options, "item", "item") || "item",
    });
    return {
      ok: true,
      output: { bytes: xml.length },
      summary: "Converted JSON to XML. Keys starting with @ became attributes.",
      files: [textOutput(`${name}.xml`, MIME.xml, xml)],
    };
  });

export const jsonToYamlExecutor: Executor = async (input, options, ctx) =>
  runDataTool("json-to-yaml", async () => {
    const { value, name } = await readJson(input, ctx);
    const yaml = toYaml(value, {
      indent: optNumber(options, "yamlIndent", 2, { min: 2, max: 8 }),
      sortKeys: optBool(options, "sortKeys", false),
    });
    return {
      ok: true,
      output: { lines: yaml.split("\n").length - 1 },
      summary: "Converted JSON to YAML.",
      files: [textOutput(`${name}.yaml`, MIME.yaml, yaml)],
    };
  });

// ---- XML → … ----------------------------------------------------------------------------------

export const xmlToJsonExecutor: Executor = async (input, options, ctx) =>
  runDataTool("xml-to-json", async () => {
    const { text, name } = await readXml(input, ctx);
    const value = xmlToJson(text, {
      typed: optBool(options, "typed", true),
      attributes: optBool(options, "attributes", true),
    });
    return {
      ok: true,
      output: { bytes: text.length },
      summary: `Converted XML to JSON${optBool(options, "attributes", true) ? " (attributes are keys starting with @)" : ""}.`,
      files: [
        textOutput(
          `${name}.json`,
          MIME.json,
          `${formatJson(value, { indent: indentOf(options) })}\n`,
        ),
      ],
    };
  });

export const xmlToCsvExecutor: Executor = async (input, options, ctx) =>
  runDataTool("xml-to-csv", async () => {
    const { text, name } = await readXml(input, ctx);
    const { table, element } = xmlToTable(text, name);
    const { text: csv } = csvWrite(table, options);
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers, recordElement: element },
      summary: `Flattened ${plural(table.rows.length, `<${element}> record`)} into ${plural(table.headers.length, "column")}.`,
      files: [textOutput(`${name}.csv`, MIME.csv, csv)],
    };
  });

export const xmlToExcelExecutor: Executor = async (input, options, ctx) =>
  runDataTool("xml-to-excel", async () => {
    const { text, name } = await readXml(input, ctx);
    const { table, element } = xmlToTable(text, name, { dates: optBool(options, "dates", true) });
    return {
      ok: true,
      output: { rows: table.rows.length, columns: table.headers, recordElement: element },
      summary: `Converted ${plural(table.rows.length, `<${element}> record`)} into ${plural(table.headers.length, "column")}.`,
      files: [{ name: `${name}.xlsx`, mimeType: MIME.xlsx, bytes: await tablesToXlsx([table]) }],
    };
  });

// ---- YAML ⇄ JSON ------------------------------------------------------------------------------

export const yamlToJsonExecutor: Executor = async (input, options, ctx) =>
  runDataTool("yaml-to-json", async () => {
    const { text, name } = await readTextSource(input, ctx, "YAML");
    const { value, documents } = parseYaml(text);
    return {
      ok: true,
      output: { documents },
      summary: `Converted YAML to JSON${documents > 1 ? ` (${documents} documents became one array)` : ""}.`,
      files: [
        textOutput(
          `${name}.json`,
          MIME.json,
          `${formatJson(value, { indent: indentOf(options), sortKeys: optBool(options, "sortKeys", false) })}\n`,
        ),
      ],
    };
  });

// ---- formatters -------------------------------------------------------------------------------

export const jsonFormatterExecutor: Executor = async (input, options, ctx) =>
  runDataTool("json-formatter", async () => {
    const { value, name } = await readJson(input, ctx);
    const mode = optEnum(options, "mode", ["pretty", "minify"] as const, "pretty");
    const out = formatJson(value, {
      indent: mode === "minify" ? 0 : indentOf(options),
      sortKeys: optBool(options, "sortKeys", false),
    });
    return {
      ok: true,
      output: { mode, bytes: out.length },
      summary:
        mode === "minify"
          ? `Minified to ${out.length.toLocaleString("en")} characters.`
          : "Formatted the JSON.",
      files: [
        textOutput(
          `${name}${mode === "minify" ? ".min" : ""}.json`,
          MIME.json,
          mode === "minify" ? out : `${out}\n`,
        ),
      ],
    };
  });

export const xmlFormatterExecutor: Executor = async (input, options, ctx) =>
  runDataTool("xml-formatter", async () => {
    const { text, name } = await readXml(input, ctx);
    const mode = optEnum(options, "mode", ["pretty", "minify"] as const, "pretty");
    const indent = optEnum(options, "indent", ["2", "4", "tab", "0"] as const, "2");
    const out = formatXml(text, {
      minify: mode === "minify",
      indent: indent === "tab" ? "\t" : " ".repeat(Number(indent) || 2),
      keepComments: optBool(options, "keepComments", true),
    });
    return {
      ok: true,
      output: { mode, bytes: out.length },
      summary:
        mode === "minify"
          ? `Minified to ${out.length.toLocaleString("en")} characters.`
          : "Formatted the XML.",
      files: [textOutput(`${name}${mode === "minify" ? ".min" : ""}.xml`, MIME.xml, out)],
    };
  });
