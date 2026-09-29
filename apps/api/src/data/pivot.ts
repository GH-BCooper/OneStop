// Pivot Table Builder (21-roadmap-expansion.md, roadmap §1.3).
//
// Group by one or two columns, aggregate a third. Pure aggregation over the table phase 08 already
// parses, so it works the same whether the input was CSV or Excel and needs no new dependency.
import type { Executor } from "@onestop/tool-registry";
import {
  cellText,
  makeTable,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  runDataTool,
  readDataInputs,
  unsupported,
  type Cell,
  type Table,
} from "./common.ts";
import { delimiterOption, readTabular, sheetOption, writeTabular } from "./tabular.ts";

export const AGGREGATIONS = ["sum", "count", "average", "min", "max", "median", "distinct", "first"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** Resolves a column by header name (case-insensitive), by A/B/C letter, or by 1-based number. */
export function findColumn(table: Table, spec: string, what: string): number {
  const trimmed = spec.trim();
  if (trimmed === "") throw unsupported(`Choose which column to use for ${what}.`);
  const byName = table.headers.findIndex((h) => h.toLowerCase() === trimmed.toLowerCase());
  if (byName >= 0) return byName;
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index >= 0 && index < table.headers.length) return index;
  }
  if (/^[A-Za-z]{1,3}$/.test(trimmed)) {
    let index = 0;
    for (const ch of trimmed.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
    if (index - 1 < table.headers.length) return index - 1;
  }
  throw unsupported(`There is no column "${spec}" for ${what}. This sheet has: ${table.headers.slice(0, 12).join(", ")}.`);
}

function numeric(value: Cell | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const n = Number(value.replace(/[\s,]/g, "").replace(/^[$£€¥]/, ""));
    return Number.isFinite(n) && value.trim() !== "" ? n : null;
  }
  return null;
}

export function aggregate(values: (Cell | undefined)[], how: Aggregation): number | string {
  if (how === "count") return values.filter((v) => v !== undefined && v !== null && cellText(v) !== "").length;
  if (how === "distinct") return new Set(values.map((v) => cellText(v)).filter((t) => t !== "")).size;
  if (how === "first") return cellText(values.find((v) => cellText(v) !== "") ?? null);
  const numbers = values.map(numeric).filter((n): n is number => n !== null);
  if (numbers.length === 0) return 0;
  switch (how) {
    case "sum":
      return round(numbers.reduce((a, b) => a + b, 0));
    case "average":
      return round(numbers.reduce((a, b) => a + b, 0) / numbers.length);
    case "min":
      return round(Math.min(...numbers));
    case "max":
      return round(Math.max(...numbers));
    case "median": {
      const sorted = [...numbers].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return round(sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!);
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface PivotResult {
  table: Table;
  rowKeys: string[];
  columnKeys: string[];
  cellCount: number;
}

export function buildPivot(
  source: Table,
  {
    rowColumn,
    columnColumn,
    valueColumn,
    how,
    totals,
    sortBy,
  }: {
    rowColumn: number;
    columnColumn: number | null;
    valueColumn: number | null;
    how: Aggregation;
    totals: boolean;
    sortBy: "label" | "value";
  },
): PivotResult {
  const buckets = new Map<string, Map<string, (Cell | undefined)[]>>();
  const columnKeys = new Set<string>();
  for (const row of source.rows) {
    const rowKey = cellText(row[rowColumn]) || "(blank)";
    const columnKey = columnColumn === null ? "value" : cellText(row[columnColumn]) || "(blank)";
    columnKeys.add(columnKey);
    const byColumn = buckets.get(rowKey) ?? new Map<string, (Cell | undefined)[]>();
    buckets.set(rowKey, byColumn);
    byColumn.set(columnKey, [...(byColumn.get(columnKey) ?? []), valueColumn === null ? row[rowColumn] : row[valueColumn]]);
  }

  const columns = [...columnKeys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const label = `${source.headers[rowColumn] ?? "Group"}`;
  const valueLabel = valueColumn === null ? "rows" : source.headers[valueColumn] ?? "value";
  const headers = [
    label,
    ...(columnColumn === null ? [`${how} of ${valueLabel}`] : columns),
    ...(totals && columnColumn !== null ? ["Total"] : []),
  ];

  let rows: Cell[][] = [...buckets.entries()].map(([rowKey, byColumn]) => {
    const cells = columns.map((c) => aggregate(byColumn.get(c) ?? [], how));
    const rowTotal =
      how === "count" || how === "sum" || how === "distinct"
        ? cells.reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0)
        : aggregate([...byColumn.values()].flat(), how);
    return [rowKey, ...cells, ...(totals && columnColumn !== null ? [round(Number(rowTotal) || 0)] : [])];
  });

  rows.sort((a, b) =>
    sortBy === "value"
      ? Number(b[b.length - 1] ?? 0) - Number(a[a.length - 1] ?? 0) || String(a[0]).localeCompare(String(b[0]))
      : String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }),
  );

  if (totals) {
    const totalRow: Cell[] = ["Total"];
    for (let column = 1; column < headers.length; column += 1) {
      const values = rows.map((r) => r[column]);
      totalRow.push(
        how === "average" || how === "median"
          ? aggregate(values, how)
          : round(values.reduce<number>((sum, v) => sum + (Number(v) || 0), 0)),
      );
    }
    rows = [...rows, totalRow];
  }

  return {
    table: makeTable(`Pivot of ${source.name}`.slice(0, 31), headers, rows),
    rowKeys: [...buckets.keys()],
    columnKeys: columns,
    cellCount: rows.length * (headers.length - 1),
  };
}

export const pivotTableExecutor: Executor = (input, options, ctx) =>
  runDataTool("pivot-table-builder", async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(file!, { sheet: sheetOption(options, ""), delimiter: delimiterOption(options) }, ctx?.signal);
    const table = source.tables[0];
    if (!table || table.rows.length === 0) throw unsupported("This sheet has no data rows to pivot.");

    const how = optEnum(options, "aggregate", AGGREGATIONS, "sum");
    const rowColumn = findColumn(table, optString(options, "rows", table.headers[0] ?? ""), "the row grouping");
    const columnSpec = optString(options, "columns", "").trim();
    const valueSpec = optString(options, "values", "").trim();
    const result = buildPivot(table, {
      rowColumn,
      columnColumn: columnSpec === "" ? null : findColumn(table, columnSpec, "the column grouping"),
      valueColumn: valueSpec === "" ? (how === "count" ? null : findColumn(table, table.headers[1] ?? "", "the values")) : findColumn(table, valueSpec, "the values"),
      how,
      totals: optBool(options, "totals", true),
      sortBy: optEnum(options, "sortBy", ["label", "value"] as const, "label"),
    });

    const limit = optNumber(options, "maxRows", 5000, { min: 10, max: 100_000 });
    if (result.table.rows.length > limit) {
      throw unsupported(
        `That grouping produces ${result.table.rows.length} rows, more than the ${limit} allowed. Group by a column with fewer distinct values.`,
      );
    }
    const written = await writeTabular(
      { kind: optEnum(options, "output", ["csv", "xlsx"] as const, source.kind === "excel" ? "xlsx" : "csv") === "xlsx" ? "excel" : "csv", delimiter: source.delimiter, name: file!.name },
      [result.table],
      "pivot",
      { keepFormatting: false },
    );
    return {
      ok: true,
      output: {
        headers: result.table.headers,
        rows: result.table.rows.slice(0, 500),
        rowGroups: result.rowKeys.length,
        columnGroups: result.columnKeys.length,
        result: `${result.rowKeys.length} × ${result.columnKeys.length}`,
      },
      summary: `Pivoted ${plural(table.rows.length, "row")} into ${plural(result.rowKeys.length, "group")}${result.columnKeys.length > 1 ? ` across ${plural(result.columnKeys.length, "column")}` : ""}, aggregated by ${how}.`,
      files: [written.file],
    };
  });
