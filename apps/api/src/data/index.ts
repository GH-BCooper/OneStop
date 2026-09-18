// Excel / CSV / data tools (08-excel-csv-data-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves.
import { registerExecutor } from "@onestop/tool-registry";

import {
  duplicateRowRemoverExecutor,
  emptyRowColumnRemoverExecutor,
  spreadsheetCleanerExecutor,
} from "./clean.ts";
import {
  csvToExcelExecutor,
  csvToJsonExecutor,
  csvToXmlExecutor,
  excelToCsvExecutor,
  excelToJsonExecutor,
  excelToPdfExecutor,
  excelToWordExecutor,
  excelToXmlExecutor,
  jsonFormatterExecutor,
  jsonToCsvExecutor,
  jsonToExcelExecutor,
  jsonToXmlExecutor,
  jsonToYamlExecutor,
  xmlFormatterExecutor,
  xmlToCsvExecutor,
  xmlToExcelExecutor,
  xmlToJsonExecutor,
  yamlToJsonExecutor,
} from "./convert.ts";
import {
  csvMergerExecutor,
  csvSplitterExecutor,
  excelMergerExecutor,
  excelSplitterExecutor,
} from "./spreadsheet.ts";
import { columnRowTransformerExecutor, spreadsheetFormatterExecutor } from "./transform.ts";
import { dataValidatorExecutor, jsonValidatorExecutor, xmlValidatorExecutor } from "./validate.ts";

export { parseCsv, toCsv } from "./csv.ts";
export { formatJson, jsonToTable, parseJson, scanJson, tableToJson } from "./json.ts";
export { checkXml, formatXml, jsonToXml, tablesToXml, xmlToJson, xmlToTable } from "./xml.ts";
export { parseYaml, toYaml } from "./yaml.ts";
export { cleanTable, removeDuplicateRows, removeEmpty } from "./clean.ts";
export { transformTable } from "./transform.ts";
export { validateJson, validateTable, validateXml } from "./validate.ts";
export { chunkTable, groupTable, stackTables } from "./spreadsheet.ts";

/** Every tool this phase owns, in the order the build file lists them. */
export const DATA_EXECUTORS = [
  ["excel-to-pdf", excelToPdfExecutor],
  ["excel-to-word", excelToWordExecutor],
  ["excel-to-csv", excelToCsvExecutor],
  ["excel-to-json", excelToJsonExecutor],
  ["excel-to-xml", excelToXmlExecutor],
  ["csv-to-excel", csvToExcelExecutor],
  ["csv-to-json", csvToJsonExecutor],
  ["csv-to-xml", csvToXmlExecutor],
  ["json-to-excel", jsonToExcelExecutor],
  ["json-to-xml", jsonToXmlExecutor],
  ["json-to-csv", jsonToCsvExecutor],
  ["json-to-yaml", jsonToYamlExecutor],
  ["xml-to-excel", xmlToExcelExecutor],
  ["xml-to-json", xmlToJsonExecutor],
  ["xml-to-csv", xmlToCsvExecutor],
  ["yaml-to-json", yamlToJsonExecutor],
  ["excel-merger", excelMergerExecutor],
  ["excel-splitter", excelSplitterExecutor],
  ["csv-merger", csvMergerExecutor],
  ["csv-splitter", csvSplitterExecutor],
  ["spreadsheet-cleaner", spreadsheetCleanerExecutor],
  ["duplicate-row-remover", duplicateRowRemoverExecutor],
  ["empty-row-column-remover", emptyRowColumnRemoverExecutor],
  ["column-row-transformer", columnRowTransformerExecutor],
  ["spreadsheet-formatter", spreadsheetFormatterExecutor],
  ["data-validator", dataValidatorExecutor],
  ["json-formatter", jsonFormatterExecutor],
  ["json-validator", jsonValidatorExecutor],
  ["xml-formatter", xmlFormatterExecutor],
  ["xml-validator", xmlValidatorExecutor],
] as const;

for (const [id, executor] of DATA_EXECUTORS) registerExecutor(id, executor);
