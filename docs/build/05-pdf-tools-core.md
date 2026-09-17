# Phase 05 — PDF Tools (Core)

## Objective
Implement the foundational, purely-local PDF manipulation tools — the ones that don't need OCR, signing, forms, or office-format conversion.

## Depends On
01–04

## Tools Implemented This Phase
PDF → Images, PDF → Text, Merge PDF, Split PDF, Extract Pages, Delete Pages, Reorder Pages, Rotate Pages, Compress PDF, Resize PDF, Repair PDF.

## Scope — Out (this phase)
PDF/A, PDF → HTML, Watermark, Page Numbers, Password Protect/Remove, Sign PDF, Fill Forms, Metadata edit/remove, Compare PDFs, OCR PDF, PDF ↔ Word/Excel/PowerPoint — all of these are **phase 06**.

## Libraries (all free/open-source, all local)
- `pdf-lib` (Node) for merge/split/extract/delete/reorder/rotate — fast, no external process needed.
- `pdfjs-dist` or `pdf-parse` for text extraction; a local renderer (e.g. `pdf-lib` + `sharp`, or PyMuPDF via `processors/python`) for PDF → Images.
- For repair and heavier rendering, prefer PyMuPDF (`fitz`) in `processors/python` if Node libraries struggle with a malformed file — this is the "Python where materially better" case from master plan §11.

## Modules / Files
`apps/api/pdf/{merge.ts, split.ts, extractPages.ts, deletePages.ts, reorderPages.ts, rotate.ts, compress.ts, resize.ts, toImages.ts, toText.ts, repair.ts}`; each registered as a real `Executor` replacing its phase-03 stub.

## Acceptance Criteria
- [ ] Every tool listed above works fully offline, no network calls.
- [ ] Merge handles 2+ PDFs of different page sizes without crashing.
- [ ] Split/extract/delete/reorder correctly handle single-page PDFs and out-of-range page numbers (clear error, not a crash).
- [ ] Compress meaningfully reduces file size on an image-heavy sample PDF.
- [ ] A password-protected input PDF produces a clear "this PDF is protected" error rather than a silent failure (full password handling is phase 06 — this phase just needs to fail gracefully).
- [ ] A corrupted PDF either gets repaired by Repair PDF or produces a clear, specific error from the other tools.

## Test Cases
- Golden-file tests: run each tool against 2–3 small fixture PDFs (empty/1-page, multi-page, image-heavy) and assert output validity.
- Edge cases: non-PDF file rejected at validation (reuses phase 04); empty PDF; single-page PDF through split/extract/reorder.
- Reject-path test: password-protected fixture PDF produces the correct actionable error.

## Notes
Design the module so phase 06's PDF↔Office conversions can call into these primitives (e.g. reuse `toImages` internally) rather than duplicating page-handling logic.
