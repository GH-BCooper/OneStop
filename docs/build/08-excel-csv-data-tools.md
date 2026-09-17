# Phase 08 — Excel / CSV / Data Conversion Tools

## Objective
Implement all Excel/Spreadsheet and Data Conversion tools from the Feature & Tool List.

## Depends On
04-file-core.md

## Tools Implemented This Phase
Excel → PDF/Word/CSV/JSON/XML; CSV → Excel/JSON/XML; JSON → Excel/XML/CSV/YAML; XML → Excel/JSON/CSV; YAML → JSON and back; Excel Merger/Splitter; CSV Merger/Splitter; Spreadsheet Cleaner; Duplicate Row Remover; Empty Row/Column Remover; Column/Row Transformer; Spreadsheet Formatter; Data Validator; JSON/XML Formatter & Validator.

(Excel → PDF and Excel → Word call into the shared `office-convert` interface from phase 06/07 rather than reimplementing PDF/Word generation.)

## Libraries
- `exceljs` or `xlsx` (SheetJS) for Excel read/write.
- `papaparse` for CSV parsing/generation (streaming for large files).
- `fast-xml-parser` for XML.
- `js-yaml` for YAML.
- Native `JSON.parse`/`stringify` plus a schema-based validator (e.g. `ajv`) for JSON Validator.

## Modules / Files
`apps/api/data/{excel.ts, csv.ts, json.ts, xml.ts, yaml.ts, clean.ts, validate.ts, transform.ts}`.

## Acceptance Criteria
- [ ] Every listed conversion round-trips reasonably (numbers stay numbers, dates aren't mangled where the source format supports typed values).
- [ ] Validators return actionable errors that include a line/row/column reference where possible, not just "invalid file."
- [ ] Duplicate Row Remover and Empty Row/Column Remover operate correctly on a fixture with intentional duplicates/blank rows.
- [ ] Large-file smoke test (e.g. a 50k-row CSV) completes without excessive memory use — prefer streaming parse over loading the whole file into memory where the library supports it.
- [ ] Malformed input (broken CSV quoting, invalid JSON, mismatched XML tags) produces a clear error, not a crash.

## Test Cases
- Fixture round-trip tests for every conversion pair listed above.
- Validator tests: valid file passes; each of 3–4 common malformed variants fails with a specific message.
- Cleaner tests: known fixture with duplicate/blank rows → correct rows removed, others untouched.
- Performance smoke test on a large CSV/Excel fixture (assert it completes within a reasonable time bound you define, e.g. under 10s for 50k rows on a typical dev machine).

## Notes
None of these tools need network access or any paid dependency — this phase should be entirely straightforward relative to the office/PDF phases and is a good place to build confidence before phase 09's heavier image work.
