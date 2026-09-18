// YAML ⇄ JSON (08-excel-csv-data-tools.md), on js-yaml.
//
// Loading uses js-yaml's safe default (YAML 1.2 core schema: no custom tags, no code), so a YAML
// file can never construct anything but plain data. Several `---` documents become a JSON array.
import { dump, loadAll, YAMLException } from "js-yaml";
import { unsupported } from "./common.ts";
import type { Json } from "./json.ts";

export function parseYaml(text: string): { value: Json; documents: number } {
  let docs: unknown[];
  try {
    docs = loadAll(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err instanceof YAMLException) {
      const mark = err.mark;
      const where = mark ? `Line ${mark.line + 1}, column ${mark.column + 1}: ` : "";
      throw unsupported(`This YAML is not valid. ${where}${capitalise(err.reason)}.`, err.message);
    }
    throw unsupported("This YAML could not be read.", err);
  }
  const values = docs.map(toJsonSafe);
  if (values.length === 0) throw unsupported("This YAML file is empty.");
  return { value: values.length === 1 ? values[0]! : values, documents: values.length };
}

function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** YAML-only values (dates, binary, NaN) as their JSON equivalents. */
function toJsonSafe(value: unknown): Json {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([k, v]) => [String(k), toJsonSafe(v)]));
  }
  if (value instanceof Set) return [...value].map(toJsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v);
    return out;
  }
  return value as Json;
}

export function toYaml(
  value: Json,
  { indent = 2, sortKeys = false }: { indent?: number; sortKeys?: boolean } = {},
): string {
  return dump(value, { indent, sortKeys, lineWidth: -1, noRefs: true });
}
