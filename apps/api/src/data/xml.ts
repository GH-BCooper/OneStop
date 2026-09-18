// XML read/write (08-excel-csv-data-tools.md), on fast-xml-parser.
//
// Every XML input is checked for well-formedness first (`checkXml`), so a mismatched tag becomes
// "Line 4, column 7: Expected closing tag 'b'…" rather than a parser crash. Documents that declare
// entities (`<!ENTITY`) are refused: entity expansion is the classic XML bomb, and no data file
// needs it. Values are read as text and typed afterwards with the same rules as CSV.
//
// The formatter works on tokens rather than a parse tree so comments, CDATA, processing
// instructions and entity references come through exactly as written.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  type Cell,
  cellText,
  inferCell,
  lineCol,
  makeTable,
  type Table,
  unsupported,
} from "./common.ts";
import { flatten, type Json } from "./json.ts";

export interface XmlProblem {
  message: string;
  line: number;
  column: number;
}

/** Well-formedness problems, or null. */
export function checkXml(text: string): XmlProblem | null {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") return { message: "The XML is empty.", line: 1, column: 1 };
  const entity = /<!ENTITY/i.exec(body);
  if (entity) {
    const line = body.slice(0, entity.index).split("\n").length;
    return {
      message:
        "This XML declares entities (<!ENTITY …>), which OneStop does not expand for safety. Remove the DOCTYPE entity declarations and try again.",
      line,
      column: 1,
    };
  }
  const result = XMLValidator.validate(body, { allowBooleanAttributes: false });
  if (result === true) return checkSingleRoot(body);
  const { msg, line, col } = result.err;
  return { message: friendly(msg), line, column: col };
}

/** fast-xml-parser accepts `<a/><b/>`; XML allows exactly one root element and no stray text. */
function checkSingleRoot(body: string): XmlProblem | null {
  let depth = 0;
  let roots = 0;
  let offset = 0;
  for (const t of tokenize(body)) {
    const at = offset;
    offset += t.text.length;
    if (depth === 0 && t.kind === "text" && t.text.trim() !== "") {
      const { line, column } = lineCol(body, at + t.text.search(/\S/));
      return {
        message:
          "There is text outside the root element. Everything must sit inside one root element.",
        line,
        column,
      };
    }
    if (t.kind === "open" || t.kind === "self") {
      if (depth === 0) {
        roots += 1;
        if (roots > 1) {
          const { line, column } = lineCol(body, at);
          return {
            message:
              "There is more than one top-level element. XML must have exactly one root element that wraps everything else.",
            line,
            column,
          };
        }
      }
      if (t.kind === "open") depth += 1;
    } else if (t.kind === "close") depth -= 1;
  }
  return null;
}

function friendly(msg: string): string {
  if (/Unclosed tag/i.test(msg)) return `${msg} Add the matching closing tag.`;
  if (/Closing tag '([^']+)' is expected/i.test(msg))
    return `${msg} Add it before the end of the file.`;
  if (/Multiple possible root nodes/i.test(msg)) {
    return "There is more than one top-level element. XML must have exactly one root element that wraps everything else.";
  }
  if (/Start tag expected/i.test(msg))
    return "The XML should start with an element such as <root>.";
  if (/char '&'/i.test(msg) || /entity/i.test(msg)) {
    return `${msg} Write a literal & as &amp;.`;
  }
  return msg;
}

export function describeXmlProblem(p: XmlProblem): string {
  return `Line ${p.line}, column ${p.column}: ${p.message}`;
}

function assertXml(text: string): string {
  const problem = checkXml(text);
  if (problem) throw unsupported(`This XML is not well-formed. ${describeXmlProblem(problem)}`);
  return text.replace(/^\uFEFF/, "");
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  htmlEntities: false,
  commentPropName: false,
});

function inferDeep(node: Json, dates = false): Json {
  if (typeof node === "string") {
    const v = inferCell(node, { dates });
    return v instanceof Date ? node : (v as Json);
  }
  if (Array.isArray(node)) return node.map((n) => inferDeep(n, dates));
  if (node && typeof node === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(node)) out[k] = inferDeep(v, dates);
    return out;
  }
  return node;
}

export interface XmlToJsonOptions {
  /** Numbers/booleans become JSON numbers/booleans (default); otherwise everything is text. */
  typed?: boolean;
  /** Keep attributes (as "@name" keys, the default). */
  attributes?: boolean;
}

export function xmlToJson(
  text: string,
  { typed = true, attributes = true }: XmlToJsonOptions = {},
): Json {
  const body = assertXml(text);
  let value = parser.parse(body) as Json;
  if (!attributes) value = stripAttributes(value);
  return typed ? inferDeep(value) : value;
}

function stripAttributes(node: Json): Json {
  if (Array.isArray(node)) return node.map(stripAttributes);
  if (node && typeof node === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(node)) if (!k.startsWith("@")) out[k] = stripAttributes(v);
    const keys = Object.keys(out);
    if (keys.length === 1 && keys[0] === "#text") return out["#text"]!;
    return out;
  }
  return node;
}

// ---- XML → table ------------------------------------------------------------------------------

/**
 * The repeating records in a document: the largest list of same-named sibling elements anywhere
 * in the tree (ties go to the shallower one). A document with no repetition is one record.
 */
export function findRecords(doc: Json): { records: Json[]; element: string } {
  let best: { records: Json[]; element: string; depth: number } | null = null;
  const visit = (node: Json, key: string, depth: number) => {
    if (Array.isArray(node)) {
      if (node.length > 1 && (!best || node.length > best.records.length)) {
        best = { records: node, element: key, depth };
      }
      node.forEach((n) => visit(n, key, depth + 1));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) if (!k.startsWith("@")) visit(v, k, depth + 1);
    }
  };
  visit(doc, "", 0);
  if (best)
    return {
      records: (best as { records: Json[] }).records,
      element: (best as { element: string }).element,
    };
  // No repeated element: the root's single child (or the root itself) is one record.
  const obj = doc as Record<string, Json>;
  const rootKey = Object.keys(obj).find((k) => !k.startsWith("@") && k !== "#text");
  let node: Json = rootKey ? obj[rootKey]! : doc;
  let element = rootKey ?? "record";
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const kids = Object.entries(node).filter(([k]) => !k.startsWith("@") && k !== "#text");
    if (kids.length === 1 && kids[0]![1] && typeof kids[0]![1] === "object") {
      [element, node] = kids[0]!;
    }
  }
  return { records: [node], element };
}

/** One record → flat columns: attributes without "@" (unless that collides), text as "value". */
function recordColumns(record: Json): Record<string, Cell> {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { value: record as Cell };
  }
  const renamed: Record<string, Json> = {};
  const childNames = new Set(Object.keys(record).filter((k) => !k.startsWith("@")));
  for (const [k, v] of Object.entries(record)) {
    if (k === "#text") renamed[childNames.has("value") ? "#text" : "value"] = v;
    else if (k.startsWith("@") && !childNames.has(k.slice(1))) renamed[k.slice(1)] = v;
    else renamed[k] = v;
  }
  const flat = flatten(renamed);
  // "price.#text" (an element with attributes) reads better as just "price".
  const out: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(flat)) out[k.replace(/\.#text$/, "")] = v;
  return out;
}

export function xmlToTable(
  text: string,
  name = "data",
  { dates = false }: { dates?: boolean } = {},
): { table: Table; element: string } {
  const body = assertXml(text);
  const doc = parser.parse(body) as Json;
  const { records, element } = findRecords(doc);
  const flats = records.map(recordColumns);
  const index = new Map<string, number>();
  for (const f of flats)
    for (const k of Object.keys(f)) if (!index.has(k)) index.set(k, index.size);
  const headers = [...index.keys()];
  if (headers.length === 0) throw unsupported("This XML has no values to put into rows.");
  const rows = flats.map((f) =>
    headers.map((h) => {
      const v = f[h];
      if (v === undefined || v === null) return null;
      return typeof v === "string" ? inferCell(v, { dates }) : v;
    }),
  );
  return { table: makeTable(name, headers, rows), element };
}

// ---- writing ----------------------------------------------------------------------------------

export function escapeXml(s: string): string {
  return (
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Characters XML 1.0 cannot carry at all.
      // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  );
}

/** Any text → a valid XML element name ("First Name" → "First_Name", "2024" → "_2024"). */
export function xmlName(raw: string, fallback = "field"): string {
  let name = raw
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (name === "") name = fallback;
  if (!/^[\p{L}_]/u.test(name)) name = `_${name}`;
  if (/^xml/i.test(name)) name = `_${name}`;
  return name;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

export interface TableXmlOptions {
  root?: string;
  row?: string;
}

function rowsXml(table: Table, row: string, pad: string): string {
  const names = new Map<string, number>();
  const tags = table.headers.map((h, i) => {
    let tag = xmlName(h, `column${i + 1}`);
    const n = (names.get(tag) ?? 0) + 1;
    names.set(tag, n);
    if (n > 1) tag = `${tag}_${n}`;
    return tag;
  });
  const parts: string[] = [];
  for (const r of table.rows) {
    parts.push(`${pad}<${row}>`);
    tags.forEach((tag, c) => {
      const v = cellText(r[c]);
      parts.push(v === "" ? `${pad}  <${tag}/>` : `${pad}  <${tag}>${escapeXml(v)}</${tag}>`);
    });
    parts.push(`${pad}</${row}>`);
  }
  return parts.join("\n");
}

/** One table → `<rows><row><col>…`; several (Excel sheets) → `<workbook><sheet name="…">`. */
export function tablesToXml(tables: Table[], { root, row = "row" }: TableXmlOptions = {}): string {
  const rowTag = xmlName(row, "row");
  if (tables.length === 1) {
    const rootTag = xmlName(root || "rows", "rows");
    const body = rowsXml(tables[0]!, rowTag, "  ");
    return `${XML_DECL}<${rootTag}>${body ? `\n${body}\n` : ""}</${rootTag}>\n`;
  }
  const rootTag = xmlName(root || "workbook", "workbook");
  const sheets = tables.map((t) => {
    const body = rowsXml(t, rowTag, "    ");
    return `  <sheet name="${escapeXml(t.name)}">${body ? `\n${body}\n  ` : ""}</sheet>`;
  });
  return `${XML_DECL}<${rootTag}>\n${sheets.join("\n")}\n</${rootTag}>\n`;
}

/**
 * Any JSON → XML. Object keys become elements (arrays repeat the element), "@name" keys become
 * attributes and "#text" becomes text, so XML → JSON → XML keeps attributes.
 */
export function jsonToXml(
  value: Json,
  { root = "root", item = "item" }: { root?: string; item?: string } = {},
): string {
  const itemTag = xmlName(item, "item");
  const out: string[] = [];

  const element = (tag: string, v: Json, pad: string, depth: number): void => {
    if (depth > 500) throw unsupported("The JSON is nested too deeply to convert.");
    if (Array.isArray(v)) {
      element(tag, { [itemTag]: v }, pad, depth + 1);
      return;
    }
    if (v === null) {
      out.push(`${pad}<${tag}/>`);
      return;
    }
    if (typeof v !== "object") {
      out.push(`${pad}<${tag}>${escapeXml(String(v))}</${tag}>`);
      return;
    }
    const attrs: string[] = [];
    const children: [string, Json][] = [];
    let text: string | null = null;
    for (const [k, child] of Object.entries(v)) {
      if (k.startsWith("@") && k.length > 1 && (child === null || typeof child !== "object")) {
        attrs.push(` ${xmlName(k.slice(1))}="${escapeXml(child === null ? "" : String(child))}"`);
      } else if (k === "#text" && (child === null || typeof child !== "object")) {
        text = child === null ? "" : String(child);
      } else {
        children.push([k, child]);
      }
    }
    const open = `${tag}${attrs.join("")}`;
    if (children.length === 0) {
      out.push(
        text === null || text === ""
          ? `${pad}<${open}/>`
          : `${pad}<${open}>${escapeXml(text)}</${tag}>`,
      );
      return;
    }
    out.push(`${pad}<${open}>`);
    if (text !== null && text !== "") out.push(`${pad}  ${escapeXml(text)}`);
    for (const [k, child] of children) {
      const childTag = xmlName(k, itemTag);
      const each = Array.isArray(child) ? child : [child];
      for (const c of each) {
        element(childTag, Array.isArray(c) ? { [itemTag]: c } : c, `${pad}  `, depth + 1);
      }
    }
    out.push(`${pad}</${tag}>`);
  };

  const rootTag = xmlName(root, "root");
  const keys =
    value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const single = keys.length === 1 && !keys[0]!.startsWith("@") && keys[0] !== "#text";
  const onlyChild = single ? (value as Record<string, Json>)[keys[0]!]! : null;
  if (single && onlyChild !== null && typeof onlyChild === "object" && !Array.isArray(onlyChild)) {
    // `{ "catalog": {...} }` already names its root: use it rather than wrapping it again.
    element(xmlName(keys[0]!), onlyChild, "", 0);
  } else if (Array.isArray(value)) {
    out.push(`<${rootTag}>`);
    for (const v of value) element(itemTag, Array.isArray(v) ? { [itemTag]: v } : v, "  ", 1);
    out.push(`</${rootTag}>`);
  } else {
    element(rootTag, value, "", 0);
  }
  return `${XML_DECL}${out.join("\n")}\n`;
}

// ---- formatting -------------------------------------------------------------------------------

type Token =
  | { kind: "open" | "close" | "self"; text: string; name: string }
  | { kind: "text" | "comment" | "cdata" | "pi" | "doctype"; text: string };

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] !== "<") {
      const end = xml.indexOf("<", i);
      const stop = end === -1 ? xml.length : end;
      tokens.push({ kind: "text", text: xml.slice(i, stop) });
      i = stop;
      continue;
    }
    const take = (kind: Token["kind"], close: string) => {
      const end = xml.indexOf(close, i);
      const stop = end === -1 ? xml.length : end + close.length;
      tokens.push({ kind, text: xml.slice(i, stop) } as Token);
      i = stop;
    };
    if (xml.startsWith("<!--", i)) take("comment", "-->");
    else if (xml.startsWith("<![CDATA[", i)) take("cdata", "]]>");
    else if (xml.startsWith("<?", i)) take("pi", "?>");
    else if (xml.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset in [ … ].
      let depth = 0;
      let j = i;
      for (; j < xml.length; j += 1) {
        if (xml[j] === "[") depth += 1;
        else if (xml[j] === "]") depth -= 1;
        else if (xml[j] === ">" && depth <= 0) break;
      }
      tokens.push({ kind: "doctype", text: xml.slice(i, j + 1) });
      i = j + 1;
    } else {
      // A tag: find its end, skipping quoted attribute values that may contain '>'.
      let j = i + 1;
      let quote: string | null = null;
      for (; j < xml.length; j += 1) {
        const c = xml[j]!;
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      const text = xml.slice(i, j + 1);
      const name = /^<\/?\s*([^\s/>]+)/.exec(text)?.[1] ?? "";
      const kind = text.startsWith("</") ? "close" : text.endsWith("/>") ? "self" : "open";
      tokens.push({ kind, text, name });
      i = j + 1;
    }
  }
  return tokens;
}

export interface XmlFormatOptions {
  indent?: string;
  minify?: boolean;
  keepComments?: boolean;
}

export function formatXml(
  text: string,
  { indent = "  ", minify = false, keepComments = true }: XmlFormatOptions = {},
): string {
  const body = assertXml(text);
  const tokens = tokenize(body).filter(
    (t) => !(t.kind === "text" && t.text.trim() === "") && (keepComments || t.kind !== "comment"),
  );
  if (minify) {
    return tokens
      .map((t) => (t.kind === "text" ? t.text.trim() : t.text.replace(/\s*\n\s*/g, " ")))
      .join("");
  }
  const out: string[] = [];
  let depth = 0;
  const pad = () => indent.repeat(Math.max(0, depth));
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k]!;
    if (t.kind === "open") {
      const next = tokens[k + 1];
      const after = tokens[k + 2];
      if (next?.kind === "close") {
        out.push(`${pad()}${t.text}${next.text}`);
        k += 1;
        continue;
      }
      if ((next?.kind === "text" || next?.kind === "cdata") && after?.kind === "close") {
        out.push(
          `${pad()}${t.text}${next.kind === "text" ? next.text.trim() : next.text}${after.text}`,
        );
        k += 2;
        continue;
      }
      out.push(`${pad()}${t.text}`);
      depth += 1;
    } else if (t.kind === "close") {
      depth -= 1;
      out.push(`${pad()}${t.text}`);
    } else {
      out.push(`${pad()}${t.kind === "text" ? t.text.trim() : t.text}`);
    }
  }
  return `${out.join("\n")}\n`;
}
