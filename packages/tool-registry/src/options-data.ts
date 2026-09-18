// Options for the Excel / CSV / data tools (08-excel-csv-data-tools.md). Kept beside
// `options.ts` (which spreads them into TOOL_OPTIONS) so that file stays readable.
import type { BooleanOption, SelectOption, TextOption, ToolOption } from "./options";

const packaging: SelectOption = {
  id: "packaging",
  type: "select",
  label: "Deliver as",
  default: "zip",
  choices: [
    { value: "zip", label: "One ZIP archive" },
    { value: "files", label: "Separate downloads" },
  ],
  help: "Only applies when there is more than one result.",
};

const sheet = (fallback: "first" | "all"): TextOption => ({
  id: "sheet",
  type: "text",
  label: "Sheet",
  default: "",
  placeholder: fallback === "all" ? "all sheets" : "first sheet",
  help: `Excel only. A sheet name or number, or "all". Leave blank for ${fallback === "all" ? "every sheet" : "the first sheet"}.`,
});

const delimiter: SelectOption = {
  id: "delimiter",
  type: "select",
  label: "CSV separator",
  default: "auto",
  choices: [
    { value: "auto", label: "Detect automatically" },
    { value: "comma", label: "Comma ," },
    { value: "semicolon", label: "Semicolon ;" },
    { value: "tab", label: "Tab" },
    { value: "pipe", label: "Pipe |" },
  ],
};

const outDelimiter: SelectOption = {
  id: "outDelimiter",
  type: "select",
  label: "Separator in the CSV",
  default: "comma",
  choices: [
    { value: "comma", label: "Comma ," },
    { value: "semicolon", label: "Semicolon ; (European Excel)" },
    { value: "tab", label: "Tab" },
    { value: "pipe", label: "Pipe |" },
  ],
};

const bom: BooleanOption = {
  id: "bom",
  type: "boolean",
  label: "Add a byte-order mark",
  default: false,
  help: "Helps Excel on Windows show accented characters correctly.",
};

const escapeFormulas: BooleanOption = {
  id: "escapeFormulas",
  type: "boolean",
  label: "Protect against formula injection",
  default: true,
  help: "Text that looks like a formula (=…, @…) gets a leading ' so spreadsheets show it rather than run it.",
};

const header: BooleanOption = {
  id: "header",
  type: "boolean",
  label: "First row has column names",
  default: true,
};

const indent: SelectOption = {
  id: "indent",
  type: "select",
  label: "Indentation",
  default: "2",
  choices: [
    { value: "2", label: "2 spaces" },
    { value: "4", label: "4 spaces" },
    { value: "tab", label: "Tabs" },
    { value: "0", label: "None (one line)" },
  ],
};

const nested: BooleanOption = {
  id: "nested",
  type: "boolean",
  label: "Rebuild nested objects from dotted column names",
  default: false,
  help: 'A column called "address.city" becomes { "address": { "city": … } }.',
};

const emptyAs: SelectOption = {
  id: "emptyAs",
  type: "select",
  label: "Empty cells",
  default: "null",
  choices: [
    { value: "null", label: "null" },
    { value: "empty", label: 'Empty text ""' },
    { value: "omit", label: "Leave the key out" },
  ],
};

const typed: BooleanOption = {
  id: "typed",
  type: "boolean",
  label: "Detect numbers and true/false",
  default: true,
  help: 'Values like 42 and true become real numbers/booleans. Leading zeros ("007") always stay text.',
};

const dates: BooleanOption = {
  id: "dates",
  type: "boolean",
  label: "Turn ISO dates into Excel dates",
  default: true,
  help: "Text such as 2024-01-15 becomes a real date cell.",
};

const xmlNames: ToolOption[] = [
  { id: "root", type: "text", label: "Root element", default: "", placeholder: "rows" },
  { id: "row", type: "text", label: "Row element", default: "row", placeholder: "row" },
];

const sortKeys: BooleanOption = {
  id: "sortKeys",
  type: "boolean",
  label: "Sort keys A→Z",
  default: false,
};

const mode = (): SelectOption => ({
  id: "mode",
  type: "select",
  label: "Mode",
  default: "pretty",
  choices: [
    { value: "pretty", label: "Pretty-print" },
    { value: "minify", label: "Minify" },
  ],
});

const columnHelp = "Column names, letters (A, B) or numbers, separated by commas.";

export const DATA_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  "excel-to-pdf": [
    {
      id: "engine",
      type: "select",
      label: "Converter",
      default: "auto",
      choices: [
        { value: "auto", label: "Best available (LibreOffice if installed)" },
        { value: "builtin", label: "Built-in (always offline)" },
      ],
      help: "LibreOffice gives the closest layout; the built-in converter draws each sheet as a table.",
    },
    packaging,
  ],
  "excel-to-word": [sheet("all"), header],
  "excel-to-csv": [sheet("first"), outDelimiter, bom, escapeFormulas, packaging],
  "excel-to-json": [sheet("first"), header, nested, emptyAs, indent],
  "excel-to-xml": [sheet("first"), header, ...xmlNames],
  "csv-to-excel": [
    delimiter,
    header,
    typed,
    dates,
    { id: "sheetName", type: "text", label: "Sheet name", default: "", placeholder: "file name" },
  ],
  "csv-to-json": [delimiter, header, typed, nested, emptyAs, indent],
  "csv-to-xml": [delimiter, header, ...xmlNames],
  "json-to-excel": [dates],
  "json-to-xml": [
    { id: "root", type: "text", label: "Root element", default: "root", placeholder: "root" },
    { id: "item", type: "text", label: "Array item element", default: "item", placeholder: "item" },
  ],
  "json-to-csv": [outDelimiter, bom, escapeFormulas],
  "json-to-yaml": [
    {
      id: "yamlIndent",
      type: "number",
      label: "Indentation",
      default: 2,
      min: 2,
      max: 8,
      unit: "spaces",
    },
    sortKeys,
  ],
  "xml-to-excel": [dates],
  "xml-to-json": [
    { ...typed, help: "Values like 42 and true become JSON numbers/booleans." },
    { id: "attributes", type: "boolean", label: "Keep attributes (as @name keys)", default: true },
    indent,
  ],
  "xml-to-csv": [outDelimiter, bom, escapeFormulas],
  "yaml-to-json": [indent, sortKeys],
  "excel-merger": [
    {
      id: "mode",
      type: "select",
      label: "How to merge",
      default: "sheets",
      choices: [
        { value: "sheets", label: "Keep every sheet (one workbook, many sheets)" },
        { value: "append", label: "Stack rows into one sheet" },
      ],
    },
    {
      id: "prefix",
      type: "boolean",
      label: "Name sheets after their file",
      default: true,
      showWhen: { option: "mode", equals: ["sheets"] },
    },
    { ...sheet("first"), showWhen: { option: "mode", equals: ["append"] } },
    {
      id: "byName",
      type: "boolean",
      label: "Match columns by name",
      default: true,
      help: "Otherwise columns are matched by position.",
      showWhen: { option: "mode", equals: ["append"] },
    },
    {
      id: "sourceColumn",
      type: "boolean",
      label: 'Add a "Source file" column',
      default: false,
      showWhen: { option: "mode", equals: ["append"] },
    },
  ],
  "excel-splitter": [
    {
      id: "mode",
      type: "select",
      label: "Split by",
      default: "sheets",
      choices: [
        { value: "sheets", label: "Sheet (one workbook per sheet)" },
        { value: "rows", label: "Row count" },
        { value: "column", label: "Values in a column" },
      ],
    },
    { ...sheet("first"), showWhen: { option: "mode", equals: ["rows", "column"] } },
    {
      id: "rows",
      type: "number",
      label: "Rows per file",
      default: 1000,
      min: 1,
      max: 1_000_000,
      showWhen: { option: "mode", equals: ["rows"] },
    },
    {
      id: "column",
      type: "text",
      label: "Column",
      default: "",
      placeholder: "Region",
      help: "One file per distinct value.",
      showWhen: { option: "mode", equals: ["column"] },
    },
    packaging,
  ],
  "csv-merger": [
    delimiter,
    {
      id: "byName",
      type: "boolean",
      label: "Match columns by name",
      default: true,
      help: "Otherwise columns are matched by position.",
    },
    { id: "sourceColumn", type: "boolean", label: 'Add a "Source file" column', default: false },
  ],
  "csv-splitter": [
    {
      id: "mode",
      type: "select",
      label: "Split by",
      default: "rows",
      choices: [
        { value: "rows", label: "Rows per file" },
        { value: "parts", label: "Number of files" },
        { value: "column", label: "Values in a column" },
      ],
    },
    {
      id: "rows",
      type: "number",
      label: "Rows per file",
      default: 1000,
      min: 1,
      max: 10_000_000,
      showWhen: { option: "mode", equals: ["rows"] },
    },
    {
      id: "parts",
      type: "number",
      label: "Number of files",
      default: 2,
      min: 1,
      max: 1000,
      showWhen: { option: "mode", equals: ["parts"] },
    },
    {
      id: "column",
      type: "text",
      label: "Column",
      default: "",
      placeholder: "Region",
      help: "One file per distinct value.",
      showWhen: { option: "mode", equals: ["column"] },
    },
    {
      id: "repeatHeader",
      type: "boolean",
      label: "Repeat the header in every file",
      default: true,
    },
    delimiter,
    packaging,
  ],
  "spreadsheet-cleaner": [
    { id: "trim", type: "boolean", label: "Trim and collapse extra spaces", default: true },
    {
      id: "invisible",
      type: "boolean",
      label: "Remove invisible characters",
      default: true,
      help: "Zero-width spaces, non-breaking spaces and control characters.",
    },
    {
      id: "fixTypes",
      type: "boolean",
      label: "Fix numbers stored as text",
      default: true,
      help: '"1,234.50", "$12" and " 42 " become numbers; "007" stays text.',
    },
    { id: "headers", type: "boolean", label: "Tidy column names", default: true },
    { id: "emptyRows", type: "boolean", label: "Remove empty rows and columns", default: true },
    { id: "duplicates", type: "boolean", label: "Remove duplicate rows", default: false },
    sheet("all"),
    delimiter,
  ],
  "duplicate-row-remover": [
    {
      id: "columns",
      type: "text",
      label: "Compare columns",
      default: "",
      placeholder: "all columns",
      help: `Rows count as duplicates when these columns match. ${columnHelp}`,
    },
    {
      id: "keep",
      type: "select",
      label: "Keep",
      default: "first",
      choices: [
        { value: "first", label: "First occurrence" },
        { value: "last", label: "Last occurrence" },
      ],
    },
    { id: "ignoreCase", type: "boolean", label: "Ignore upper/lower case", default: false },
    { id: "ignoreSpaces", type: "boolean", label: "Ignore extra spaces", default: true },
    sheet("all"),
    delimiter,
  ],
  "empty-row-column-remover": [
    {
      id: "remove",
      type: "select",
      label: "Remove",
      default: "both",
      choices: [
        { value: "both", label: "Empty rows and columns" },
        { value: "rows", label: "Empty rows only" },
        { value: "columns", label: "Empty columns only" },
      ],
    },
    {
      id: "headedColumns",
      type: "boolean",
      label: "Also remove columns that have a name but no values",
      default: false,
    },
    sheet("all"),
    delimiter,
  ],
  "column-row-transformer": [
    {
      id: "operation",
      type: "select",
      label: "Operation",
      default: "rename",
      choices: [
        { value: "rename", label: "Rename columns" },
        { value: "choose", label: "Choose & reorder columns" },
        { value: "delete", label: "Delete columns" },
        { value: "split", label: "Split a column" },
        { value: "merge", label: "Merge columns" },
        { value: "sort", label: "Sort rows" },
        { value: "transpose", label: "Transpose (rows ↔ columns)" },
      ],
    },
    {
      id: "mapping",
      type: "text",
      multiline: true,
      label: "Renames",
      default: "",
      placeholder: "Old name = New name",
      help: "One per line. Columns can also be given by letter (B = Email).",
      showWhen: { option: "operation", equals: ["rename"] },
    },
    {
      id: "columns",
      type: "text",
      label: "Columns",
      default: "",
      placeholder: "Name, Email, C",
      help: columnHelp,
      showWhen: { option: "operation", equals: ["choose", "delete", "split", "merge", "sort"] },
    },
    {
      id: "keepRest",
      type: "boolean",
      label: "Keep the other columns after these",
      default: false,
      showWhen: { option: "operation", equals: ["choose"] },
    },
    {
      id: "delimiter",
      type: "text",
      label: "Split at",
      default: ",",
      help: "Type \\t for a tab.",
      showWhen: { option: "operation", equals: ["split"] },
    },
    {
      id: "newNames",
      type: "text",
      label: "New column names",
      default: "",
      placeholder: "First, Last",
      showWhen: { option: "operation", equals: ["split"] },
    },
    {
      id: "separator",
      type: "text",
      label: "Join with",
      default: " ",
      showWhen: { option: "operation", equals: ["merge"] },
    },
    {
      id: "newName",
      type: "text",
      label: "Merged column name",
      default: "",
      placeholder: "joined names",
      showWhen: { option: "operation", equals: ["merge"] },
    },
    {
      id: "order",
      type: "select",
      label: "Order",
      default: "asc",
      choices: [
        { value: "asc", label: "Ascending (A→Z, 0→9)" },
        { value: "desc", label: "Descending" },
      ],
      showWhen: { option: "operation", equals: ["sort"] },
    },
    sheet("first"),
  ],
  "spreadsheet-formatter": [
    {
      id: "theme",
      type: "select",
      label: "Header style",
      default: "blue",
      choices: [
        { value: "blue", label: "Blue" },
        { value: "green", label: "Green" },
        { value: "gray", label: "Gray" },
        { value: "orange", label: "Orange" },
        { value: "plain", label: "Plain (bold only)" },
      ],
    },
    { id: "freeze", type: "boolean", label: "Freeze the header row", default: true },
    { id: "filter", type: "boolean", label: "Add filter buttons", default: true },
    { id: "banded", type: "boolean", label: "Banded rows", default: true },
    { id: "borders", type: "boolean", label: "Cell borders", default: true },
    { id: "autoWidth", type: "boolean", label: "Fit column widths", default: true },
    {
      id: "thousands",
      type: "boolean",
      label: "Thousands separators on decimal columns",
      default: false,
    },
    sheet("all"),
  ],
  "data-validator": [
    {
      id: "rules",
      type: "text",
      multiline: true,
      label: "Rules",
      default: "",
      placeholder:
        "Email: required, email\nAge: integer, min=0, max=120\nStatus: in=active|inactive\nID: unique",
      help: "One line per column. Rules: required, unique, number, integer, min=, max=, minlength=, maxlength=, email, url, date, boolean, in=a|b, pattern=regex. Use * for every column. Blank = automatic checks only.",
    },
    sheet("first"),
    delimiter,
  ],
  "json-formatter": [
    mode(),
    {
      ...indent,
      choices: indent.choices.filter((c) => c.value !== "0"),
      showWhen: { option: "mode", equals: ["pretty"] },
    },
    sortKeys,
  ],
  "json-validator": [
    {
      id: "schema",
      type: "text",
      multiline: true,
      label: "JSON Schema (optional)",
      default: "",
      placeholder: '{ "type": "object", "required": ["id"] }',
      help: "Paste a JSON Schema to also check structure. Drafts 07, 2019-09 and 2020-12 are supported.",
    },
  ],
  "xml-formatter": [
    mode(),
    {
      ...indent,
      choices: indent.choices.filter((c) => c.value !== "0"),
      showWhen: { option: "mode", equals: ["pretty"] },
    },
    { id: "keepComments", type: "boolean", label: "Keep comments", default: true },
  ],
};
