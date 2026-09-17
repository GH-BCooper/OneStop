import { defineCategory } from "../define";

// Features §3 (Excel / Spreadsheet) and §4 (Data Conversion). The conversions listed in both
// sections, and the JSON/XML formatters/validators also listed in §12, have one entry each.
const spreadsheet = defineCategory("data", { phase: "08", sub: "Excel / Spreadsheet" }, [
  { src: ["3.1"], name: "Excel → PDF", in: ["xls", "xlsx"], out: ["pdf"], batch: true, pop: 60, kw: ["xlsx", "spreadsheet", "convert"], desc: "Convert an Excel workbook to PDF." },
  { src: ["3.2"], name: "Excel → Word", in: ["xls", "xlsx"], out: ["docx"], kw: ["xlsx", "spreadsheet", "table", "convert"], desc: "Put spreadsheet tables into a Word document." },
  { src: ["3.11"], name: "Excel Merger", in: ["xls", "xlsx"], out: ["xlsx"], batch: true, kw: ["combine", "join", "workbooks", "sheets"], desc: "Combine several workbooks or sheets into one." },
  { src: ["3.12"], name: "Excel Splitter", in: ["xls", "xlsx"], out: ["xlsx", "zip"], kw: ["separate", "sheets", "divide"], desc: "Split a workbook by sheet or by row count." },
  { src: ["3.13"], name: "CSV Merger", in: ["csv"], out: ["csv"], batch: true, kw: ["combine", "join", "append"], desc: "Combine several CSV files into one." },
  { src: ["3.14"], name: "CSV Splitter", in: ["csv"], out: ["csv", "zip"], kw: ["separate", "chunks", "divide"], desc: "Split a large CSV into smaller files." },
  { src: ["3.15"], name: "Spreadsheet Cleaner", in: ["xls", "xlsx", "csv"], out: ["xlsx", "csv"], kw: ["clean", "tidy", "trim", "fix data"], desc: "Trim whitespace, fix types and tidy up messy spreadsheet data." },
  { src: ["3.16"], name: "Duplicate Row Remover", in: ["xls", "xlsx", "csv"], out: ["xlsx", "csv"], pop: 35, kw: ["dedupe", "deduplicate", "unique"], desc: "Remove duplicate rows from a spreadsheet or CSV." },
  { src: ["3.17"], name: "Empty Row/Column Remover", slug: "empty-row-column-remover", in: ["xls", "xlsx", "csv"], out: ["xlsx", "csv"], kw: ["blank", "delete empty"], desc: "Remove blank rows and columns." },
  { src: ["3.18"], name: "Column/Row Transformer", slug: "column-row-transformer", in: ["xls", "xlsx", "csv"], out: ["xlsx", "csv"], kw: ["rename columns", "reorder", "transpose", "pivot"], desc: "Rename, reorder, split or transpose columns and rows." },
  { src: ["3.19"], name: "Spreadsheet Formatter", in: ["xls", "xlsx", "csv"], out: ["xlsx"], kw: ["format", "style", "header"], desc: "Apply clean formatting, headers and column widths." },
  { src: ["3.20"], name: "Data Validator", in: ["xls", "xlsx", "csv"], out: ["json"], kw: ["validate", "check", "rules", "errors"], desc: "Check rows against rules and list invalid values." },
]);

const conversion = defineCategory("data", { phase: "08", sub: "Data Conversion" }, [
  { src: ["3.3", "4.11"], name: "Excel → CSV", in: ["xls", "xlsx"], out: ["csv"], pop: 55, kw: ["xlsx", "spreadsheet", "convert", "export"], desc: "Export an Excel sheet as CSV." },
  { src: ["3.4", "4.10"], name: "Excel → JSON", in: ["xls", "xlsx"], out: ["json"], kw: ["xlsx", "spreadsheet", "convert"], desc: "Convert spreadsheet rows into JSON objects." },
  { src: ["3.5", "4.12"], name: "Excel → XML", in: ["xls", "xlsx"], out: ["xml"], kw: ["xlsx", "spreadsheet", "convert"], desc: "Convert spreadsheet rows into XML." },
  { src: ["3.6", "4.6"], name: "CSV → Excel", in: ["csv"], out: ["xlsx"], pop: 50, kw: ["xlsx", "spreadsheet", "convert"], desc: "Turn a CSV file into an Excel workbook." },
  { src: ["3.7", "4.4"], name: "CSV → JSON", in: ["csv", "text"], out: ["json"], pop: 80, kw: ["convert", "parse"], desc: "Convert CSV rows into a JSON array." },
  { src: ["3.8", "4.5"], name: "CSV → XML", in: ["csv", "text"], out: ["xml"], kw: ["convert"], desc: "Convert CSV rows into XML." },
  { src: ["3.9", "4.3"], name: "JSON → Excel", in: ["json", "text"], out: ["xlsx"], kw: ["xlsx", "spreadsheet", "convert"], desc: "Turn a JSON array into an Excel sheet." },
  { src: ["3.10", "4.9"], name: "XML → Excel", in: ["xml", "text"], out: ["xlsx"], kw: ["xlsx", "spreadsheet", "convert"], desc: "Turn XML records into an Excel sheet." },
  { src: ["4.1"], name: "JSON → CSV", in: ["json", "text"], out: ["csv"], pop: 45, kw: ["convert", "flatten"], desc: "Flatten a JSON array into CSV." },
  { src: ["4.2"], name: "JSON → XML", in: ["json", "text"], out: ["xml"], kw: ["convert"], desc: "Convert JSON into XML." },
  { src: ["4.7"], name: "XML → JSON", in: ["xml", "text"], out: ["json"], pop: 35, kw: ["convert", "parse"], desc: "Convert XML into JSON." },
  { src: ["4.8"], name: "XML → CSV", in: ["xml", "text"], out: ["csv"], kw: ["convert", "flatten"], desc: "Flatten XML records into CSV." },
  { src: ["4.13", "12.1"], name: "JSON Formatter", in: ["json", "text"], out: ["json"], pop: 70, kw: ["beautify", "pretty print", "indent", "minify"], desc: "Pretty-print or minify JSON." },
  { src: ["4.14", "12.2"], name: "JSON Validator", in: ["json", "text"], out: ["json"], pop: 50, kw: ["validate", "lint", "check", "syntax"], desc: "Check that JSON is valid and point to any errors." },
  { src: ["4.15", "12.3"], name: "XML Formatter", in: ["xml", "text"], out: ["xml"], kw: ["beautify", "pretty print", "indent"], desc: "Pretty-print or minify XML." },
  { src: ["4.16", "12.4"], name: "XML Validator", in: ["xml", "text"], out: ["json"], kw: ["validate", "well-formed", "check", "syntax"], desc: "Check that XML is well-formed and point to any errors." },
  { src: ["4.17"], name: "YAML → JSON", in: ["yaml", "yml", "text"], out: ["json"], kw: ["yml", "convert"], desc: "Convert YAML into JSON." },
  { src: ["4.18"], name: "JSON → YAML", in: ["json", "text"], out: ["yaml"], kw: ["yml", "convert"], desc: "Convert JSON into YAML." },
]);

export const dataTools = [...spreadsheet, ...conversion];
