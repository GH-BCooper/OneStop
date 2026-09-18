// Data Validator, JSON Validator and XML Validator (08-excel-csv-data-tools.md).
//
// A validator's job is to report, so "the file has problems" is a successful run with a report —
// every problem carries a row + column (spreadsheets) or a line + column (JSON/XML) and says what
// to change. Only a file that cannot be read at all is a failed run.
import { Ajv, type ErrorObject } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Executor } from "@onestop/tool-registry";
import {
  type Cell,
  cellText,
  columnRef,
  isBlank,
  lineCol,
  MIME,
  optString,
  parseIsoDate,
  plural,
  readDataInputs,
  readTextSource,
  runDataTool,
  snippet,
  type Table,
  textOutput,
  unsupported,
} from "./common.ts";
import { resolveColumns } from "./columns.ts";
import { describeProblem, type Json, scanJson } from "./json.ts";
import { checkXml } from "./xml.ts";
import { delimiterOption, readTabular, sheetOption } from "./tabular.ts";

export const DATA_VALIDATOR_TOOL_ID = "data-validator";
export const JSON_VALIDATOR_TOOL_ID = "json-validator";
export const XML_VALIDATOR_TOOL_ID = "xml-validator";

const MAX_LISTED = 1000;

// ---- Data Validator rules ---------------------------------------------------------------------

export type Rule =
  | { kind: "required" | "unique" | "number" | "integer" | "email" | "url" | "date" | "boolean" }
  | { kind: "min" | "max" | "minLength" | "maxLength"; value: number }
  | { kind: "in"; values: string[] }
  | { kind: "pattern"; regex: RegExp; source: string };

export interface ColumnRules {
  columns: number[];
  rules: Rule[];
  line: number;
}

const RULE_HELP =
  "Write one line per column, like: Email: required, email — or Age: integer, min=0, max=120 — or Status: in=active|inactive. Use * for every column.";

function parseRule(text: string, line: number): Rule {
  const m = /^([a-z ]+?)\s*(?:[=:]\s*(.*))?$/i.exec(text.trim());
  const name = (m?.[1] ?? "").toLowerCase().replace(/[\s_-]/g, "");
  const arg = (m?.[2] ?? "").trim();
  const num = () => {
    const n = Number(arg);
    if (arg === "" || !Number.isFinite(n))
      throw unsupported(`Rules line ${line}: "${text}" needs a number, e.g. ${name}=10.`);
    return n;
  };
  switch (name) {
    case "required":
    case "notempty":
    case "unique":
    case "number":
    case "numeric":
    case "integer":
    case "int":
    case "email":
    case "url":
    case "date":
    case "boolean":
    case "bool": {
      const alias: Record<string, Rule["kind"]> = {
        notempty: "required",
        numeric: "number",
        int: "integer",
        bool: "boolean",
      };
      return { kind: (alias[name] ?? name) as "required" };
    }
    case "min":
    case "max":
      return { kind: name, value: num() };
    case "minlength":
    case "maxlength":
      return { kind: name === "minlength" ? "minLength" : "maxLength", value: num() };
    case "in":
    case "oneof":
    case "values": {
      const values = arg
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length === 0)
        throw unsupported(`Rules line ${line}: list the allowed values, e.g. in=yes|no.`);
      return { kind: "in", values };
    }
    case "pattern":
    case "regex":
    case "matches": {
      if (arg === "" || arg.length > 300)
        throw unsupported(
          `Rules line ${line}: give a pattern of up to 300 characters, e.g. pattern=^[A-Z]{3}$.`,
        );
      try {
        return { kind: "pattern", regex: new RegExp(arg, "u"), source: arg };
      } catch {
        throw unsupported(`Rules line ${line}: "${arg}" is not a valid pattern.`);
      }
    }
    default:
      throw unsupported(`Rules line ${line}: "${text}" is not a rule OneStop knows. ${RULE_HELP}`);
  }
}

/** Splits "a, b, pattern=x,y" on commas that start a new rule (patterns may contain commas). */
function splitRules(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const starts = /^\s*[a-z][a-z _-]*\s*(?:[=:]|$)/i.test(part);
    if (out.length > 0 && !starts) out[out.length - 1] += `,${part}`;
    else out.push(part);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseRules(table: Table, text: string): ColumnRules[] {
  const out: ColumnRules[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const sep = line.indexOf(":");
    if (sep <= 0) throw unsupported(`Rules line ${i + 1}: "${line}" has no column. ${RULE_HELP}`);
    const target = line.slice(0, sep).trim();
    const columns = target === "*" ? table.headers.map((_, c) => c) : resolveColumns(table, target);
    const rules = splitRules(line.slice(sep + 1)).map((r) => parseRule(r, i + 1));
    if (rules.length === 0)
      throw unsupported(`Rules line ${i + 1}: no rules after "${target}:". ${RULE_HELP}`);
    out.push({ columns, rules, line: i + 1 });
  });
  return out;
}

/** ISO dates, 15/01/2024-style dates and dates with a month name ("15 Jan 2024"). */
function looksLikeDate(s: string): boolean {
  if (parseIsoDate(s)) return true;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return true;
  return /[a-z]{3}/i.test(s) && /\d/.test(s) && !Number.isNaN(Date.parse(s));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ruleProblem(rule: Rule, v: Cell): string | null {
  if (rule.kind === "required") return isBlank(v) ? "is empty but is required" : null;
  if (isBlank(v)) return null; // every other rule applies only to values that are present
  const s = cellText(v).trim();
  const num = typeof v === "number" ? v : Number(s.replace(/,/g, ""));
  switch (rule.kind) {
    case "number":
      return Number.isFinite(num) && s !== "" ? null : "is not a number";
    case "integer":
      return Number.isInteger(num) ? null : "is not a whole number";
    case "min":
      return !Number.isFinite(num)
        ? "is not a number"
        : num < rule.value
          ? `is below the minimum of ${rule.value}`
          : null;
    case "max":
      return !Number.isFinite(num)
        ? "is not a number"
        : num > rule.value
          ? `is above the maximum of ${rule.value}`
          : null;
    case "minLength":
      return s.length < rule.value ? `is shorter than ${rule.value} characters` : null;
    case "maxLength":
      return s.length > rule.value ? `is longer than ${rule.value} characters` : null;
    case "email":
      return EMAIL.test(s) ? null : "is not a valid email address";
    case "url":
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:"
          ? null
          : "is not a web address (http/https)";
      } catch {
        return "is not a valid web address";
      }
    case "date":
      return v instanceof Date || looksLikeDate(s) ? null : "is not a date";
    case "boolean":
      return typeof v === "boolean" || /^(true|false|yes|no|y|n|1|0)$/i.test(s)
        ? null
        : "is not true/false or yes/no";
    case "in":
      return rule.values.some((a) => a.toLowerCase() === s.toLowerCase())
        ? null
        : `is not one of ${rule.values.join(", ")}`;
    case "pattern":
      return rule.regex.test(s.slice(0, 10_000))
        ? null
        : `does not match the pattern ${rule.source}`;
    default:
      return null;
  }
}

export interface DataIssue {
  sheet?: string;
  row: number;
  column: string;
  columnName: string;
  value: string;
  rule: string;
  message: string;
}

export interface DataReport {
  valid: boolean;
  rows: number;
  issues: DataIssue[];
  totalIssues: number;
  byRule: Record<string, number>;
  warnings: string[];
}

/** Checks every row; with no rules, only the automatic checks (mixed types, ragged rows) run. */
export function validateTable(table: Table, rulesText: string, sheetLabel?: string): DataReport {
  const rules = parseRules(table, rulesText);
  const issues: DataIssue[] = [];
  const byRule: Record<string, number> = {};
  let total = 0;
  const add = (r: number, c: number, rule: string, message: string) => {
    total += 1;
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    if (issues.length >= MAX_LISTED) return;
    const v = cellText(table.rows[r]![c]);
    const ref = columnRef(table, c);
    issues.push({
      ...(sheetLabel ? { sheet: sheetLabel } : {}),
      row: table.rowNumbers[r]!,
      column: ref.split(" ")[1]!,
      columnName: table.headers[c]!,
      value: v.length > 80 ? `${v.slice(0, 77)}…` : v,
      rule,
      message: `Row ${table.rowNumbers[r]}, ${ref}: ${v === "" ? "the value" : `"${v.length > 40 ? `${v.slice(0, 37)}…` : v}"`} ${message}.`,
    });
  };

  for (const { columns, rules: list } of rules) {
    for (const c of columns) {
      for (const rule of list) {
        if (rule.kind === "unique") {
          const first = new Map<string, number>();
          table.rows.forEach((row, r) => {
            if (isBlank(row[c])) return;
            const key = cellText(row[c]).trim().toLowerCase();
            const at = first.get(key);
            if (at === undefined) first.set(key, table.rowNumbers[r]!);
            else add(r, c, "unique", `repeats the value in row ${at}`);
          });
          continue;
        }
        table.rows.forEach((row, r) => {
          const problem = ruleProblem(rule, row[c] ?? null);
          if (problem) add(r, c, rule.kind, problem);
        });
      }
    }
  }

  // Automatic: a column that is almost all numbers but has a few text values.
  const warnings: string[] = [];
  for (let c = 0; c < table.headers.length; c += 1) {
    let numbers = 0;
    const texts: number[] = [];
    table.rows.forEach((row, r) => {
      const v = row[c];
      if (typeof v === "number") numbers += 1;
      else if (typeof v === "string" && v.trim() !== "") texts.push(r);
    });
    if (numbers >= 5 && texts.length > 0 && texts.length <= numbers * 0.1) {
      for (const r of texts) add(r, c, "type", "is text in a column of numbers");
    }
  }
  if (rules.length === 0 && total === 0)
    warnings.push("No rules were given, so only the automatic checks ran.");
  return {
    valid: total === 0,
    rows: table.rows.length,
    issues,
    totalIssues: total,
    byRule,
    warnings,
  };
}

export const dataValidatorExecutor: Executor = async (input, options, ctx) =>
  runDataTool(DATA_VALIDATOR_TOOL_ID, async () => {
    const [file] = await readDataInputs(input, ctx, { what: "spreadsheet" });
    const source = await readTabular(
      file!,
      { sheet: sheetOption(options, ""), delimiter: delimiterOption(options) },
      ctx?.signal,
    );
    const rules = optString(options, "rules", "");
    const reports = source.tables.map((t) =>
      validateTable(t, rules, source.tables.length > 1 ? t.name : undefined),
    );
    const issues = reports.flatMap((r) => r.issues).slice(0, MAX_LISTED);
    const total = reports.reduce((n, r) => n + r.totalIssues, 0);
    const byRule: Record<string, number> = {};
    for (const r of reports)
      for (const [k, v] of Object.entries(r.byRule)) byRule[k] = (byRule[k] ?? 0) + v;

    // Rows with a different number of fields than the header (CSV) are problems too.
    const ragged = source.ragged.map((r) => ({
      row: r.row,
      column: "",
      columnName: "",
      value: "",
      rule: "fields",
      message: `Row ${r.row} has ${plural(r.fields, "field")} but the header has ${source.headerWidth}.`,
    }));
    const allIssues = [...ragged, ...issues].slice(0, MAX_LISTED);
    const count = total + ragged.length;
    if (ragged.length) byRule.fields = ragged.length;

    const report = {
      valid: count === 0,
      file: file!.ref.name,
      rowsChecked: reports.reduce((n, r) => n + r.rows, 0),
      totalIssues: count,
      byRule,
      issues: allIssues,
      truncated: count > allIssues.length,
      warnings: [
        ...source.warnings.filter((w) => !source.ragged.length || !w.startsWith("The header has")),
        ...reports.flatMap((r) => r.warnings),
      ],
    };
    const first = allIssues
      .slice(0, 3)
      .map((i) => i.message)
      .join(" ");
    return {
      ok: true,
      output: report,
      summary:
        count === 0
          ? `All ${plural(report.rowsChecked, "row")} passed${rules.trim() ? " every rule" : " the automatic checks"}.`
          : `Found ${plural(count, "problem")} in ${plural(report.rowsChecked, "row")}. ${first}${count > 3 ? " See the report for the rest." : ""}`,
      files: [
        textOutput(`${source.name}-validation.json`, MIME.json, JSON.stringify(report, null, 2)),
      ],
    };
  });

// ---- JSON Validator ---------------------------------------------------------------------------

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

function makeAjv(schema: Record<string, unknown>): Ajv {
  const draft = typeof schema.$schema === "string" ? schema.$schema : "";
  const opts = { allErrors: true, strict: false, logger: false as const, loadSchema: undefined };
  const ajv = draft.includes("2020-12")
    ? new Ajv2020(opts)
    : draft.includes("2019-09")
      ? new Ajv2019(opts)
      : new Ajv(opts);
  addFormats(ajv);
  return ajv;
}

function schemaMessage(e: ErrorObject): string {
  const where = e.instancePath === "" ? "The document" : `\`${e.instancePath}\``;
  switch (e.keyword) {
    case "required":
      return `${where} is missing the required property "${(e.params as { missingProperty: string }).missingProperty}".`;
    case "additionalProperties":
      return `${where} has a property that is not allowed: "${(e.params as { additionalProperty: string }).additionalProperty}".`;
    case "type":
      return `${where} should be ${(e.params as { type: string }).type}.`;
    case "enum":
      return `${where} should be one of: ${((e.params as { allowedValues: unknown[] }).allowedValues ?? []).map((v) => JSON.stringify(v)).join(", ")}.`;
    default:
      return `${where} ${e.message ?? "does not match the schema"}.`;
  }
}

export interface JsonValidation {
  valid: boolean;
  syntax: { line: number; column: number; message: string; snippet: string } | null;
  schema: { pointer: string; line: number | null; column: number | null; message: string }[];
  duplicateKeys: { pointer: string; line: number; column: number }[];
  stats: { type: string; items: number | null; depth: number } | null;
}

function depthOf(v: Json, d = 0): number {
  if (d > 1000) return d;
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, depthOf(x, d + 1)), d + 1);
  if (v && typeof v === "object")
    return Object.values(v).reduce<number>((m, x) => Math.max(m, depthOf(x, d + 1)), d + 1);
  return d;
}

export function validateJson(text: string, schemaText = ""): JsonValidation {
  const scan = scanJson(text);
  const duplicateKeys = scan.duplicates.map(({ pointer, line, column }) => ({
    pointer,
    line,
    column,
  }));
  if (scan.error) {
    const { line, column, message } = scan.error;
    return {
      valid: false,
      syntax: { line, column, message, snippet: snippet(text, line, column) },
      schema: [],
      duplicateKeys,
      stats: null,
    };
  }
  const value = JSON.parse(text.replace(/^\uFEFF/, "")) as Json;
  const stats = {
    type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
    items: Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : null,
    depth: depthOf(value),
  };
  const schema: JsonValidation["schema"] = [];
  if (schemaText.trim() !== "") {
    const s = scanJson(schemaText);
    if (s.error)
      throw unsupported(`The JSON Schema itself is not valid JSON. ${describeProblem(s.error)}`);
    const schemaValue = JSON.parse(schemaText) as Record<string, unknown>;
    let validate;
    try {
      validate = makeAjv(schemaValue).compile(schemaValue);
    } catch (err) {
      throw unsupported(`The JSON Schema could not be used: ${(err as Error).message}`, err);
    }
    if (!validate(value)) {
      for (const e of (validate.errors ?? []).slice(0, MAX_LISTED)) {
        const at = scan.pointers.get(e.instancePath);
        const pos = at === undefined ? null : lineCol(text, at);
        schema.push({
          pointer: e.instancePath || "/",
          line: pos?.line ?? null,
          column: pos?.column ?? null,
          message: schemaMessage(e),
        });
      }
    }
  }
  return { valid: schema.length === 0, syntax: null, schema, duplicateKeys, stats };
}

export const jsonValidatorExecutor: Executor = async (input, options, ctx) =>
  runDataTool(JSON_VALIDATOR_TOOL_ID, async () => {
    const { text, name } = await readTextSource(input, ctx, "JSON");
    const schemaText = optString(options, "schema", "");
    const result = validateJson(text, schemaText);
    let summary: string;
    if (result.syntax) {
      summary = `Not valid JSON. Line ${result.syntax.line}, column ${result.syntax.column}: ${result.syntax.message}`;
    } else if (result.schema.length > 0) {
      const first = result.schema[0]!;
      summary = `Valid JSON, but ${plural(result.schema.length, "schema error")}. ${first.line ? `Line ${first.line}: ` : ""}${first.message}`;
    } else {
      summary = `Valid JSON${schemaText.trim() ? " that matches the schema" : ""} (${result.stats!.type}${result.stats!.items !== null ? ` with ${plural(result.stats!.items, result.stats!.type === "array" ? "item" : "key")}` : ""}).`;
    }
    if (result.duplicateKeys.length > 0) {
      const d = result.duplicateKeys[0]!;
      summary += ` Warning: ${plural(result.duplicateKeys.length, "duplicate key")} (first "${d.pointer}" on line ${d.line}) — only the last value is kept by most readers.`;
    }
    return {
      ok: true,
      output: result,
      summary,
      files: [textOutput(`${name}-validation.json`, MIME.json, JSON.stringify(result, null, 2))],
    };
  });

// ---- XML Validator ----------------------------------------------------------------------------

export interface XmlValidation {
  valid: boolean;
  error: { line: number; column: number; message: string; snippet: string } | null;
  stats: { root: string; elements: number; attributes: number; depth: number } | null;
  note: string;
}

const XML_NOTE = "Checks that the XML is well-formed. DTD/XSD schema validation is not performed.";

export function validateXml(text: string): XmlValidation {
  const body = text.replace(/^\uFEFF/, "");
  const problem = checkXml(body);
  if (problem) {
    return {
      valid: false,
      error: { ...problem, snippet: snippet(body, problem.line, problem.column) },
      stats: null,
      note: XML_NOTE,
    };
  }
  let elements = 0;
  let attributes = 0;
  let depth = 0;
  let max = 0;
  let root = "";
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const stripped = body.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  for (const m of stripped.matchAll(tag)) {
    if (m[1]) {
      depth -= 1;
      continue;
    }
    elements += 1;
    if (!root) root = m[2]!;
    attributes += (m[3]!.match(/=/g) ?? []).length;
    if (!m[4]) {
      depth += 1;
      max = Math.max(max, depth);
    } else max = Math.max(max, depth + 1);
  }
  return {
    valid: true,
    error: null,
    stats: { root, elements, attributes, depth: max },
    note: XML_NOTE,
  };
}

export const xmlValidatorExecutor: Executor = async (input, _options, ctx) =>
  runDataTool(XML_VALIDATOR_TOOL_ID, async () => {
    const { text, name } = await readTextSource(input, ctx, "XML");
    const result = validateXml(text);
    return {
      ok: true,
      output: result,
      summary: result.error
        ? `Not well-formed. Line ${result.error.line}, column ${result.error.column}: ${result.error.message}`
        : `Well-formed XML: <${result.stats!.root}> with ${plural(result.stats!.elements, "element")}, nested ${result.stats!.depth} deep. (Schema validation is not performed.)`,
      files: [textOutput(`${name}-validation.json`, MIME.json, JSON.stringify(result, null, 2))],
    };
  });
