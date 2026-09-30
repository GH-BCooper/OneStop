// Excel / CSV / data tools (08-excel-csv-data-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves.
import { yamlFormatterExecutor } from "./yamlFormatter.ts";
import { registerExecutor } from "@onestop/tool-registry";

import { chartGeneratorExecutor } from "./chart.ts";
import { dataDiffExecutor, jsonSchemaExecutor, sampleDataExecutor } from "./dataDiff.ts";
import { pivotTableExecutor } from "./pivot.ts";

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
export {
  AGGREGATIONS,
  aggregate,
  buildPivot,
  findColumn,
  pivotTableExecutor,
  type Aggregation,
} from "./pivot.ts";
export {
  CHART_TYPES,
  SERIES_COLORS,
  chartGeneratorExecutor,
  readSeries,
  renderChartSvg,
  type ChartOptions,
  type ChartPoint,
  type ChartType,
} from "./chart.ts";
export {
  FIELD_TYPES,
  dataDiffExecutor,
  diffTables,
  diffToCsv,
  generateField,
  inferSchema,
  jsonSchemaExecutor,
  parseFieldSpec,
  sampleDataExecutor,
  type DataDiffReport,
  type FieldType,
  type RowDiff,
} from "./dataDiff.ts";

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

/** Every data tool 21-roadmap-expansion.md adds (roadmap §1.3), kept separate from phase 08's. */
export const DATA_EXPANSION_EXECUTORS = [
  ["pivot-table-builder", pivotTableExecutor],
  ["chart-generator", chartGeneratorExecutor],
  ["data-diff", dataDiffExecutor],
  ["json-schema-generator", jsonSchemaExecutor],
  ["sample-data-generator", sampleDataExecutor],
] as const;

for (const [id, executor] of DATA_EXPANSION_EXECUTORS) registerExecutor(id, executor);

/** Added after the end-to-end QA pass: a YAML formatter and validator to sit beside the JSON and XML ones. */
export const DATA_EXTRAS_EXECUTORS = [["yaml-formatter-and-validator", yamlFormatterExecutor]] as const;

for (const [id, executor] of DATA_EXTRAS_EXECUTORS) registerExecutor(id, executor);
