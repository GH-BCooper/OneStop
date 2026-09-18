// JSON read/write (08-excel-csv-data-tools.md).
//
// Values are parsed with the native `JSON.parse` (fast, exact). When that fails — or when the JSON
// Validator needs to map a schema error back to a line — `scanJson` walks the text itself: a small
// strict JSON reader that knows where everything is, so errors say "line 3, column 5: trailing
// comma…" instead of "invalid file", and duplicate keys (which `JSON.parse` silently collapses)
// can be reported.
import { type Cell, cellJson, lineCol, makeTable, type Table, unsupported } from "./common.ts";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface JsonProblem {
  message: string;
  line: number;
  column: number;
}

export interface JsonScan {
  error: JsonProblem | null;
  /** JSON Pointer (RFC 6901) → offset of the value, for mapping schema errors to lines. */
  pointers: Map<string, number>;
  duplicates: { pointer: string; key: string; line: number; column: number }[];
}

const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

class ScanError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

/** Strict JSON reader that records positions; never throws. */
export function scanJson(text: string): JsonScan {
  const pointers = new Map<string, number>();
  const duplicates: JsonScan["duplicates"] = [];
  let i = 0;
  const n = text.length;
  const src = text;
  if (src.charCodeAt(0) === 0xfeff) i = 1;

  const found = (at: number): string => {
    if (at >= n) return "the end of the file";
    const ch = src[at]!;
    if (ch === "\n" || ch === "\r") return "a line break";
    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(at, at + 40))?.[0];
    return word ? `\`${word}\`` : `'${ch}'`;
  };

  const skipSpace = () => {
    for (;;) {
      while (i < n && (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r")) {
        i += 1;
      }
      if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
        throw new ScanError("JSON does not allow comments — remove the // or /* */ comment.", i);
      }
      return;
    }
  };

  const readString = (): string => {
    const start = i;
    if (src[i] === "'") {
      throw new ScanError(
        'Strings and property names must use double quotes ("), not single quotes.',
        i,
      );
    }
    i += 1; // opening quote
    let out = "";
    let chunk = i;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 34) {
        out += src.slice(chunk, i);
        i += 1;
        return out;
      }
      if (c === 92) {
        out += src.slice(chunk, i);
        const e = src[i + 1];
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (e !== undefined && e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          throw new ScanError(
            `Invalid escape \`\\${e ?? ""}\` in a string. Use \\\\ for a backslash.`,
            i,
          );
        }
        chunk = i;
        continue;
      }
      if (c < 0x20) {
        throw new ScanError(
          c === 10 || c === 13
            ? 'A string runs onto the next line — close it with " or write the line break as \\n.'
            : "A string contains a raw control character (such as a tab) — escape it, e.g. \\t.",
          i,
        );
      }
      i += 1;
    }
    throw new ScanError('A string is never closed — add the missing ".', start);
  };

  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  const readValue = (pointer: string, depth: number): void => {
    if (depth > 500) throw new ScanError("The JSON is nested too deeply to process.", i);
    skipSpace();
    pointers.set(pointer, i);
    const c = src[i];
    if (c === "{") return readObject(pointer, depth);
    if (c === "[") return readArray(pointer, depth);
    if (c === '"' || c === "'") {
      readString();
      return;
    }
    for (const word of ["true", "false", "null"]) {
      if (src.startsWith(word, i)) {
        i += word.length;
        return;
      }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (m && m[0] !== "" && m[0] !== "-") {
      i += m[0].length;
      if (/[\w.]/.test(src[i] ?? "")) throw new ScanError(`${found(i)} cannot follow a number.`, i);
      return;
    }
    if (i >= n) throw new ScanError("The JSON ends where a value was expected.", i);
    const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 40))?.[0];
    if (word === "undefined" || word === "NaN" || word === "Infinity") {
      throw new ScanError(`\`${word}\` is not valid JSON — use null or a number.`, i);
    }
    if (word === "True" || word === "False" || word === "None") {
      throw new ScanError(
        `\`${word}\` is not valid JSON — use true, false or null (lower case).`,
        i,
      );
    }
    if (c === "+" || c === "." || (c === "0" && /\d/.test(src[i + 1] ?? ""))) {
      throw new ScanError("Invalid number: no leading +, leading zeros or bare decimal point.", i);
    }
    if (c === "}" || c === "]" || c === ",") {
      throw new ScanError(`Expected a value but found ${found(i)}.`, i);
    }
    throw new ScanError(
      word
        ? `Unexpected ${found(i)} — text values must be in double quotes.`
        : `Unexpected ${found(i)} where a value was expected.`,
      i,
    );
  };

  const readObject = (pointer: string, depth: number): void => {
    const open = i;
    i += 1;
    const keys = new Set<string>();
    skipSpace();
    if (src[i] === "}") {
      i += 1;
      return;
    }
    for (;;) {
      skipSpace();
      if (i >= n) throw unclosed(open, "{", "}");
      if (src[i] === "}")
        throw new ScanError(
          "Trailing comma before '}' — remove the comma after the last property.",
          i,
        );
      if (src[i] !== '"' && src[i] !== "'") {
        const word = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i, i + 60))?.[0];
        throw new ScanError(
          word
            ? `Property names must be in double quotes — write "${word}" instead of ${word}.`
            : `Expected a property name in double quotes but found ${found(i)}.`,
          i,
        );
      }
      const keyAt = i;
      const key = readString();
      if (keys.has(key)) {
        duplicates.push({
          pointer: `${pointer}/${escapePointer(key)}`,
          key,
          ...lineCol(src, keyAt),
        });
      }
      keys.add(key);
      skipSpace();
      if (src[i] !== ":") {
        throw new ScanError(
          `Expected ':' after the property name "${key}" but found ${found(i)}.`,
          i,
        );
      }
      i += 1;
      readValue(`${pointer}/${escapePointer(key)}`, depth + 1);
      skipSpace();
      if (src[i] === ",") {
        i += 1;
        continue;
      }
      if (src[i] === "}") {
        i += 1;
        return;
      }
      if (i >= n) throw unclosed(open, "{", "}");
      throw new ScanError(
        src[i] === '"'
          ? "Expected ',' or '}' after a property value — is a comma missing?"
          : `Expected ',' or '}' after a property value but found ${found(i)}.`,
        i,
      );
    }
  };

  const readArray = (pointer: string, depth: number): void => {
    const open = i;
    i += 1;
    skipSpace();
    if (src[i] === "]") {
      i += 1;
      return;
    }
    for (let index = 0; ; index += 1) {
      skipSpace();
      if (i >= n) throw unclosed(open, "[", "]");
      if (src[i] === "]" && index > 0) {
        throw new ScanError("Trailing comma before ']' — remove the comma after the last item.", i);
      }
      readValue(`${pointer}/${index}`, depth + 1);
      skipSpace();
      if (src[i] === ",") {
        i += 1;
        continue;
      }
      if (src[i] === "]") {
        i += 1;
        return;
      }
      if (i >= n) throw unclosed(open, "[", "]");
      throw new ScanError(
        `Expected ',' or ']' after an array item but found ${found(i)} — is a comma missing?`,
        i,
      );
    }
  };

  const unclosed = (open: number, o: string, c: string) => {
    const at = lineCol(src, open);
    return new ScanError(
      `The ${o === "{" ? "object" : "array"} opened with '${o}' on line ${at.line} is never closed — add the missing '${c}'.`,
      n,
    );
  };

  try {
    skipSpace();
    if (i >= n) throw new ScanError("The JSON is empty.", 0);
    readValue("", 0);
    skipSpace();
    if (i < n) {
      throw new ScanError(
        `Unexpected ${found(i)} after the end of the JSON value — only one top-level value is allowed (is a comma or bracket missing?).`,
        i,
      );
    }
    return { error: null, pointers, duplicates };
  } catch (err) {
    if (!(err instanceof ScanError)) throw err;
    const at = lineCol(src, err.at);
    return { error: { message: err.message, ...at }, pointers, duplicates };
  }
}

/** "Line 3, column 5: …" */
export function describeProblem(p: JsonProblem): string {
  return `Line ${p.line}, column ${p.column}: ${p.message}`;
}

/** JSON text → value, with a located, actionable error on failure. */
export function parseJson(text: string): Json {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    if (body.trim() === "") throw new SyntaxError("empty");
    return JSON.parse(body) as Json;
  } catch (err) {
    const scan = scanJson(body);
    if (scan.error)
      throw unsupported(`This JSON is not valid. ${describeProblem(scan.error)}`, err);
    throw unsupported("This JSON is not valid.", err);
  }
}

export interface FormatOptions {
  indent?: number | "\t" | 0;
  sortKeys?: boolean;
}

export function sortKeysDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortKeysDeep(value[key]!);
    }
    return out;
  }
  return value;
}

export function formatJson(
  value: Json,
  { indent = 2, sortKeys = false }: FormatOptions = {},
): string {
  const v = sortKeys ? sortKeysDeep(value) : value;
  return JSON.stringify(v, null, indent === 0 ? undefined : indent);
}

// ---- JSON ⇄ table -----------------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, Json> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Nested object → { "a.b": 1, "tags.0": "x" }. Empty containers stay as "[]" / "{}". */
export function flatten(
  value: Json,
  prefix = "",
  out: Record<string, Cell> = {},
): Record<string, Cell> {
  if (Array.isArray(value)) {
    if (value.length === 0) out[prefix || "value"] = prefix ? "[]" : null;
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out[prefix] = "{}";
    for (const key of keys) flatten(value[key]!, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out[prefix || "value"] = value;
  }
  return out;
}

/** The inverse of `flatten`: dotted keys → nested objects; runs of 0..n keys → arrays. */
export function unflatten(flat: Record<string, Json>): Json {
  const root: Record<string, Json> = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let node: Record<string, Json> = root;
    for (let p = 0; p < parts.length - 1; p += 1) {
      const key = parts[p]!;
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key] as Record<string, Json>;
    }
    node[parts[parts.length - 1]!] = value;
  }
  const arrays = (v: Json): Json => {
    if (!isPlainObject(v)) return v;
    const keys = Object.keys(v);
    for (const k of keys) v[k] = arrays(v[k]!);
    if (keys.length > 0 && keys.every((k, i) => k === String(i))) return keys.map((k) => v[k]!);
    return v;
  };
  return arrays(root);
}

/**
 * The records inside a JSON value: an array of objects as is; an object holding such an array
 * (e.g. `{ "data": [...] }`) → that array; a single object → one record.
 */
export function jsonRecords(value: Json): { records: Json[]; path: string } {
  if (Array.isArray(value)) return { records: value, path: "" };
  if (isPlainObject(value)) {
    let best: { records: Json[]; path: string } | null = null;
    for (const [key, v] of Object.entries(value)) {
      if (Array.isArray(v) && v.length > 0 && (!best || v.length > best.records.length)) {
        best = { records: v, path: key };
      }
    }
    if (best && best.records.some(isPlainObject)) return best;
    return { records: [value], path: "" };
  }
  return { records: [value], path: "" };
}

export function jsonToTable(value: Json, name = "data"): { table: Table; path: string } {
  const { records, path } = jsonRecords(value);
  if (records.length === 0)
    throw unsupported("This JSON array is empty, so there are no rows to convert.");

  // An array of arrays: the first inner array holds the column names.
  if (records.every(Array.isArray)) {
    const [head, ...rest] = records as Json[][];
    const headers = head!.map((h, i) => (h === null || h === "" ? `Column ${i + 1}` : String(h)));
    const width = Math.max(headers.length, ...rest.map((r) => r.length));
    for (let c = headers.length; c < width; c += 1) headers.push(`Column ${c + 1}`);
    const rows = rest.map((r) =>
      headers.map((_, c) => {
        const v = r[c];
        return v === undefined ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : v;
      }),
    );
    return { table: makeTable(name, headers, rows), path };
  }

  const flats = records.map((r) => flatten(r));
  const index = new Map<string, number>();
  for (const f of flats)
    for (const key of Object.keys(f)) if (!index.has(key)) index.set(key, index.size);
  const headers = [...index.keys()];
  const rows = flats.map((f) => headers.map((h) => (h in f ? f[h]! : null)));
  return { table: makeTable(name, headers, rows), path };
}

export type EmptyAs = "null" | "empty" | "omit";

export function tableToJson(
  table: Pick<Table, "headers" | "rows">,
  { nested = false, emptyAs = "null" }: { nested?: boolean; emptyAs?: EmptyAs } = {},
): Json[] {
  return table.rows.map((row) => {
    const obj: Record<string, Json> = {};
    table.headers.forEach((h, c) => {
      const v = cellJson(row[c]);
      if (v === null || v === "") {
        if (emptyAs === "omit") return;
        obj[h] = emptyAs === "empty" ? "" : null;
        return;
      }
      obj[h] = v;
    });
    return nested ? unflatten(obj) : obj;
  });
}
