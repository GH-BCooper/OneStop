// Data Diff, JSON Schema Generator and Sample Data Generator (21-roadmap-expansion.md, roadmap §1.3).
//
// Data Diff uses the shared diff engine (`apps/api/src/shared/diff.ts`) for unkeyed comparison and a
// key-based match when a key column is given, which is what makes "row 12 changed" possible rather
// than "everything after row 12 shifted". Nothing here adds a dependency: the Sample Data Generator
// is hand-rolled rather than pulling in `@faker-js/faker`, and it only ever produces example.com
// addresses and names of well-known computer scientists, so no plausible real person is invented.
import { randomInt } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { diffSequences } from "../shared/diff.ts";
import {
  MIME,
  cellText,
  makeTable,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readDataInputs,
  readTextSource,
  runDataTool,
  textOutput,
  unsupported,
  type Cell,
  type Table,
} from "./common.ts";
import { toCsv } from "./csv.ts";
import { findColumn } from "./pivot.ts";
import { delimiterOption, readTabular, sheetOption } from "./tabular.ts";

// ---- data diff --------------------------------------------------------------------------------

export interface CellChange {
  column: string;
  before: string;
  after: string;
}

export interface RowDiff {
  kind: "added" | "removed" | "changed";
  key: string;
  leftRow: number | null;
  rightRow: number | null;
  changes: CellChange[];
}

export interface DataDiffReport {
  identical: boolean;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  columnsAdded: string[];
  columnsRemoved: string[];
  rows: RowDiff[];
}

function rowSignature(headers: string[], row: Cell[], columns: number[]): string {
  return columns.map((c) => cellText(row[c])).join("\u0001") + `\u0002${headers.length}`;
}

export function diffTables(
  left: Table,
  right: Table,
  { keyColumn, ignoreCase, trim }: { keyColumn: number | null; ignoreCase: boolean; trim: boolean },
): DataDiffReport {
  const shared = left.headers.filter((h) => right.headers.some((r) => r.toLowerCase() === h.toLowerCase()));
  const columnsAdded = right.headers.filter((h) => !left.headers.some((l) => l.toLowerCase() === h.toLowerCase()));
  const columnsRemoved = left.headers.filter((h) => !right.headers.some((r) => r.toLowerCase() === h.toLowerCase()));
  const leftCols = shared.map((h) => left.headers.findIndex((l) => l.toLowerCase() === h.toLowerCase()));
  const rightCols = shared.map((h) => right.headers.findIndex((r) => r.toLowerCase() === h.toLowerCase()));

  const normalise = (value: Cell | undefined) => {
    let text = cellText(value);
    if (trim) text = text.trim();
    if (ignoreCase) text = text.toLowerCase();
    return text;
  };
  const rows: RowDiff[] = [];
  let unchanged = 0;

  const compare = (l: Cell[], r: Cell[]): CellChange[] =>
    shared
      .map((column, i) => ({ column, before: cellText(l[leftCols[i]!]), after: cellText(r[rightCols[i]!]) }))
      .filter((c, i) => normalise(l[leftCols[i]!]) !== normalise(r[rightCols[i]!]));

  if (keyColumn !== null) {
    // Key-based matching: a row that moved is not a change, and a row that changed is reported once.
    const rightIndex = new Map<string, { row: Cell[]; number: number }>();
    for (const [i, row] of right.rows.entries()) {
      rightIndex.set(normalise(row[keyColumn]), { row, number: right.rowNumbers[i] ?? i + 1 });
    }
    const seen = new Set<string>();
    for (const [i, row] of left.rows.entries()) {
      const key = normalise(row[keyColumn]);
      seen.add(key);
      const match = rightIndex.get(key);
      if (!match) {
        rows.push({ kind: "removed", key, leftRow: left.rowNumbers[i] ?? i + 1, rightRow: null, changes: [] });
        continue;
      }
      const changes = compare(row, match.row);
      if (changes.length === 0) unchanged += 1;
      else rows.push({ kind: "changed", key, leftRow: left.rowNumbers[i] ?? i + 1, rightRow: match.number, changes });
    }
    for (const [i, row] of right.rows.entries()) {
      const key = normalise(row[keyColumn]);
      if (!seen.has(key)) {
        rows.push({ kind: "added", key, leftRow: null, rightRow: right.rowNumbers[i] ?? i + 1, changes: [] });
      }
    }
  } else {
    const leftKeys = left.rows.map((row) => rowSignature(left.headers, row, leftCols).replace(/./gu, (c) => c));
    const rightKeys = right.rows.map((row) => rowSignature(right.headers, row, rightCols));
    const normKey = (headers: string[], row: Cell[], cols: number[]) => cols.map((c) => normalise(row[c])).join("\u0001");
    const { rows: aligned } = diffSequences(
      left.rows.map((row) => normKey(left.headers, row, leftCols)),
      right.rows.map((row) => normKey(right.headers, row, rightCols)),
    );
    void leftKeys;
    void rightKeys;
    for (const [index, row] of aligned.entries()) {
      if (row.op === "=") {
        unchanged += 1;
        continue;
      }
      if (row.op === "-" && aligned[index + 1]?.op === "+") {
        const l = left.rows[row.leftIndex! - 1]!;
        const r = right.rows[aligned[index + 1]!.rightIndex! - 1]!;
        rows.push({
          kind: "changed",
          key: `row ${row.leftIndex}`,
          leftRow: left.rowNumbers[row.leftIndex! - 1] ?? row.leftIndex,
          rightRow: right.rowNumbers[aligned[index + 1]!.rightIndex! - 1] ?? aligned[index + 1]!.rightIndex,
          changes: compare(l, r),
        });
        continue;
      }
      if (row.op === "+" && aligned[index - 1]?.op === "-") continue; // already paired above
      if (row.op === "-") {
        rows.push({ kind: "removed", key: `row ${row.leftIndex}`, leftRow: row.leftIndex, rightRow: null, changes: [] });
      } else {
        rows.push({ kind: "added", key: `row ${row.rightIndex}`, leftRow: null, rightRow: row.rightIndex, changes: [] });
      }
    }
  }

  const counts = { added: 0, removed: 0, changed: 0 };
  for (const row of rows) counts[row.kind] += 1;
  return {
    identical: rows.length === 0 && columnsAdded.length === 0 && columnsRemoved.length === 0,
    ...counts,
    unchanged,
    columnsAdded,
    columnsRemoved,
    rows,
  };
}

/** A flat CSV of every difference, one row per change — the shape a spreadsheet can filter. */
export function diffToCsv(report: DataDiffReport): string {
  const rows: Cell[][] = [];
  for (const row of report.rows) {
    if (row.changes.length === 0) {
      rows.push([row.kind, row.key, row.leftRow ?? "", row.rightRow ?? "", "", "", ""]);
      continue;
    }
    for (const change of row.changes) {
      rows.push([row.kind, row.key, row.leftRow ?? "", row.rightRow ?? "", change.column, change.before, change.after]);
    }
  }
  const table = makeTable("diff", ["Change", "Key", "Left row", "Right row", "Column", "Before", "After"], rows);
  return toCsv(table, { delimiter: "," }).text;
}

export const dataDiffExecutor: Executor = (input, options, ctx) =>
  runDataTool("data-diff", async () => {
    const files = await readDataInputs(input, ctx, { min: 2, what: "file" });
    if (files.length > 2) throw unsupported("Choose exactly two files to compare.");
    const read = async (index: number) => {
      const file = files[index]!;
      if (file.ext === "json") {
        const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as unknown;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const headers = [...new Set(list.flatMap((row) => (row && typeof row === "object" ? Object.keys(row as object) : ["value"])))];
        const rows = list.map((row) =>
          headers.map((h) => {
            const value = row && typeof row === "object" ? (row as Record<string, unknown>)[h] : row;
            return (value === undefined || value === null ? null : typeof value === "object" ? JSON.stringify(value) : (value as Cell)) as Cell;
          }),
        );
        return makeTable(file.name, headers, rows);
      }
      const source = await readTabular(file, { sheet: sheetOption(options, ""), delimiter: delimiterOption(options) }, ctx?.signal);
      const table = source.tables[0];
      if (!table) throw unsupported(`"${file.ref.name}" has no readable sheet in it.`);
      return table;
    };
    const left = await read(0);
    const right = await read(1);

    const keySpec = optString(options, "key", "").trim();
    const report = diffTables(left, right, {
      keyColumn: keySpec === "" ? null : findColumn(left, keySpec, "the key column"),
      ignoreCase: optBool(options, "ignoreCase", false),
      trim: optBool(options, "trimWhitespace", true),
    });

    const files_: OutputFile[] = [
      textOutput("data-diff.json", MIME.json, JSON.stringify(report, null, 2) + "\n"),
      textOutput("data-diff.csv", MIME.csv, diffToCsv(report)),
    ];
    const columnNote =
      report.columnsAdded.length + report.columnsRemoved.length > 0
        ? ` Columns differ too: ${[...report.columnsAdded.map((c) => `+${c}`), ...report.columnsRemoved.map((c) => `-${c}`)].join(", ")}.`
        : "";
    return {
      ok: true,
      output: { ...report, rows: report.rows.slice(0, 2000), result: report.identical ? "identical" : `${report.changed} changed, ${report.added} added, ${report.removed} removed` },
      summary: report.identical
        ? `"${files[0]!.ref.name}" and "${files[1]!.ref.name}" hold the same data.`
        : `${report.changed} row${report.changed === 1 ? "" : "s"} changed, ${report.added} added, ${report.removed} removed, ${report.unchanged} unchanged.${columnNote}`,
      files: files_,
    };
  });

// ---- JSON Schema generator --------------------------------------------------------------------

type Schema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "object" ? "object" : typeof value;
}

const FORMATS: [RegExp, string][] = [
  [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, "date-time"],
  [/^\d{4}-\d{2}-\d{2}$/, "date"],
  [/^\d{2}:\d{2}(:\d{2})?$/, "time"],
  [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email"],
  [/^https?:\/\/\S+$/, "uri"],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "uuid"],
  [/^(?:\d{1,3}\.){3}\d{1,3}$/, "ipv4"],
];

/** Merges the schema of every sample so an optional field shows up as optional, not as absent. */
export function inferSchema(samples: unknown[], { examples = true, enums = true }: { examples?: boolean; enums?: boolean } = {}): Schema {
  const types = new Set(samples.map(typeOf));
  if (types.has("integer") && types.has("number")) {
    types.delete("integer");
  }
  const schema: Schema = {};
  const nullable = types.delete("null");
  const list = [...types];
  schema.type = nullable ? [...list, "null"] : list.length === 1 ? list[0] : list;

  if (list.includes("object")) {
    const objects = samples.filter((s) => s !== null && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    const properties: Schema = {};
    const required: string[] = [];
    for (const key of keys) {
      const present = objects.filter((o) => key in o);
      properties[key] = inferSchema(present.map((o) => o[key]), { examples, enums });
      if (present.length === objects.length) required.push(key);
    }
    schema.properties = properties;
    if (required.length > 0) schema.required = required;
    schema.additionalProperties = false;
  }
  if (list.includes("array")) {
    const items = samples.filter(Array.isArray).flat();
    schema.items = items.length > 0 ? inferSchema(items, { examples, enums }) : {};
  }
  if (list.length === 1 && (list[0] === "string" || list[0] === "number" || list[0] === "integer")) {
    const values = samples.filter((s) => s !== null);
    if (list[0] === "string") {
      const strings = values as string[];
      const format = FORMATS.find(([re]) => strings.length > 0 && strings.every((s) => re.test(s)))?.[1];
      if (format) schema.format = format;
      const distinct = [...new Set(strings)];
      // A small, closed set of repeated values is almost always an enum in disguise.
      if (enums && distinct.length > 1 && distinct.length <= 12 && strings.length >= distinct.length * 2) {
        schema.enum = distinct.sort();
      } else if (strings.length > 0) {
        schema.minLength = Math.min(...strings.map((s) => s.length));
        schema.maxLength = Math.max(...strings.map((s) => s.length));
      }
    } else {
      const numbers = values as number[];
      if (numbers.length > 0) {
        schema.minimum = Math.min(...numbers);
        schema.maximum = Math.max(...numbers);
      }
    }
    if (examples && values.length > 0 && schema.enum === undefined) schema.examples = [values[0]];
  }
  return schema;
}

export const jsonSchemaExecutor: Executor = (input, options, ctx) =>
  runDataTool("json-schema-generator", async () => {
    const source = await readTextSource(input, ctx, "JSON");
    let parsed: unknown;
    try {
      parsed = JSON.parse(source.text);
    } catch (err) {
      throw unsupported("That is not valid JSON. Run it through the JSON Validator to find the problem.", err);
    }
    const samples = optBool(options, "treatArrayAsSamples", true) && Array.isArray(parsed) ? parsed : [parsed];
    const body = inferSchema(samples, {
      examples: optBool(options, "examples", true),
      enums: optBool(options, "enums", true),
    });
    const schema = {
      $schema: optEnum(options, "draft", ["2020-12", "07"] as const, "2020-12") === "07"
        ? "http://json-schema.org/draft-07/schema#"
        : "https://json-schema.org/draft/2020-12/schema",
      title: optString(options, "title", "") || source.name,
      ...(Array.isArray(parsed) && optBool(options, "wrapArray", false)
        ? { type: "array", items: body }
        : body),
    };
    const text = JSON.stringify(schema, null, 2) + "\n";
    const countProps = (s: Schema): number =>
      Object.keys((s.properties as Schema) ?? {}).length +
      Object.values((s.properties as Schema) ?? {}).reduce((sum: number, v) => sum + countProps(v as Schema), 0);
    return {
      ok: true,
      output: { schema, properties: countProps(body), samples: samples.length, result: text },
      summary: `Inferred a JSON Schema from ${plural(samples.length, "sample")}, describing ${plural(countProps(body), "property")}. A field missing from any sample is left out of "required".`,
      files: [textOutput(`${source.name}.schema.json`, MIME.json, text)],
    };
  });

// ---- sample data generator --------------------------------------------------------------------

const FIRST_NAMES = ["Ada", "Grace", "Alan", "Katherine", "Linus", "Radia", "Barbara", "Tim", "Anita", "Guido", "Margaret", "Donald", "Frances", "Edsger", "Shafi", "Leslie", "Jean", "Vint"];
const LAST_NAMES = ["Lovelace", "Hopper", "Turing", "Johnson", "Torvalds", "Perlman", "Liskov", "Berners-Lee", "Borg", "van Rossum", "Hamilton", "Knuth", "Allen", "Dijkstra", "Goldwasser", "Lamport", "Bartik", "Cerf"];
const CITIES = ["Springfield", "Rivertown", "Lakeside", "Fairview", "Greenfield", "Oakdale", "Milltown", "Westport", "Northbridge", "Eastvale"];
const COUNTRIES = ["Exampleland", "Testonia", "Sampleville", "Demoland", "Placeholderia"];
const COMPANIES = ["Example Industries", "Test Works", "Sample Holdings", "Demo Logistics", "Placeholder Foods", "Fixture Labs"];
const PRODUCTS = ["Widget", "Sprocket", "Gadget", "Doohickey", "Contraption", "Gizmo", "Apparatus", "Thingamajig"];
const STATUSES = ["active", "pending", "suspended", "cancelled", "completed"];
const WORDS = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda sigma omega".split(" ");

export const FIELD_TYPES = [
  "id", "uuid", "firstName", "lastName", "fullName", "email", "username", "phone", "company",
  "jobTitle", "street", "city", "country", "postcode", "date", "datetime", "boolean", "integer",
  "decimal", "price", "percent", "status", "product", "sentence", "paragraph", "url", "ipv4", "colorHex",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

export function generateField(type: FieldType, row: number): string | number | boolean {
  switch (type) {
    case "id":
      return row;
    case "uuid":
      return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${"89ab"[randomInt(4)]}${randomHex(3)}-${randomHex(12)}`;
    case "firstName":
      return pick(FIRST_NAMES);
    case "lastName":
      return pick(LAST_NAMES);
    case "fullName":
      return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case "email":
      // example.com is reserved by RFC 2606 precisely so generated addresses cannot reach anyone.
      return `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase().replace(/[^a-z]/g, "")}${randomInt(100)}@example.com`;
    case "username":
      return `${pick(WORDS)}_${pick(WORDS)}${randomInt(1000)}`;
    case "phone":
      // +1 555-01xx is the reserved fictional range, so no real number is ever produced.
      return `+1 555-01${String(randomInt(100)).padStart(2, "0")}`;
    case "company":
      return pick(COMPANIES);
    case "jobTitle":
      return `${pick(["Senior", "Lead", "Principal", "Junior", "Staff"])} ${pick(["Engineer", "Designer", "Analyst", "Manager", "Technician"])}`;
    case "street":
      return `${randomInt(1, 400)} ${pick(["Oak", "Elm", "Maple", "Cedar", "Pine"])} ${pick(["Street", "Road", "Avenue", "Lane"])}`;
    case "city":
      return pick(CITIES);
    case "country":
      return pick(COUNTRIES);
    case "postcode":
      return `${String(randomInt(10000, 100000))}`;
    case "date":
      return new Date(Date.now() - randomInt(1, 1200) * 86_400_000).toISOString().slice(0, 10);
    case "datetime":
      return new Date(Date.now() - randomInt(1, 1200) * 3_600_000).toISOString();
    case "boolean":
      return randomInt(2) === 1;
    case "integer":
      return randomInt(1, 1000);
    case "decimal":
      return Math.round(randomInt(1, 100000) / 100 * 100) / 100;
    case "price":
      return Math.round(randomInt(99, 99999)) / 100;
    case "percent":
      return randomInt(0, 101);
    case "status":
      return pick(STATUSES);
    case "product":
      return `${pick(["Chrome", "Matte", "Compact", "Heavy-duty", "Portable"])} ${pick(PRODUCTS)}`;
    case "sentence":
      return `${Array.from({ length: randomInt(4, 11) }, () => pick(WORDS)).join(" ")}.`;
    case "paragraph":
      return Array.from({ length: randomInt(2, 5) }, () => `${Array.from({ length: randomInt(5, 13) }, () => pick(WORDS)).join(" ")}.`).join(" ");
    case "url":
      return `https://example.com/${pick(WORDS)}/${randomInt(1000)}`;
    case "ipv4":
      // 198.51.100.0/24 is the RFC 5737 documentation range.
      return `198.51.100.${randomInt(1, 255)}`;
    case "colorHex":
      return `#${randomHex(6)}`;
  }
}

function randomHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += "0123456789abcdef"[randomInt(16)];
  return out;
}

/** "name:fullName, email:email, joined:date" — the column spec the option takes. */
export function parseFieldSpec(spec: string): { name: string; type: FieldType }[] {
  const parts = spec.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw unsupported("List the columns you want, like: name:fullName, email:email, joined:date");
  return parts.map((part) => {
    const [name, type = "sentence"] = part.split(":").map((s) => s.trim());
    if (!(FIELD_TYPES as readonly string[]).includes(type)) {
      throw unsupported(`"${type}" is not a field type. Choose from: ${FIELD_TYPES.join(", ")}.`);
    }
    return { name: name || type, type: type as FieldType };
  });
}

export const sampleDataExecutor: Executor = (_input, options) =>
  runDataTool("sample-data-generator", async () => {
    const fields = parseFieldSpec(optString(options, "fields", "id:id, name:fullName, email:email, joined:date, active:boolean"));
    const count = optNumber(options, "rows", 25, { min: 1, max: 20_000 });
    const format = optEnum(options, "format", ["csv", "json", "both"] as const, "csv");
    const records = Array.from({ length: count }, (_, i) =>
      Object.fromEntries(fields.map((f) => [f.name, generateField(f.type, i + 1)])),
    );
    const files: OutputFile[] = [];
    if (format !== "json") {
      const table = makeTable("sample", fields.map((f) => f.name), records.map((r) => fields.map((f) => r[f.name] as Cell)));
      files.push(textOutput("sample-data.csv", MIME.csv, toCsv(table, { delimiter: "," }).text));
    }
    if (format !== "csv") {
      files.push(textOutput("sample-data.json", MIME.json, JSON.stringify(records, null, 2) + "\n"));
    }
    return {
      ok: true,
      output: { rows: records.slice(0, 100), count, fields, result: `${count} rows` },
      summary: `Generated ${plural(count, "row")} across ${plural(fields.length, "column")}. Every email is @example.com, every phone number is in the reserved 555-01xx range and every IP is in the documentation range, so nothing here can reach a real person.`,
      files,
    };
  });
