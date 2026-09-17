# Phase 06 — PDF Tools (Advanced)

## Objective
Implement the remaining PDF tools that need more than basic page manipulation: security, forms, signing, OCR, metadata, comparison, and conversion to/from other office formats.

## Depends On
05-pdf-tools-core.md

## Tools Implemented This Phase
PDF → PDF/A, PDF → HTML, Add Watermark, Add Page Numbers, Password Protect PDF, Remove PDF Password (authorized only), Sign PDF, Fill PDF Forms, Edit PDF Metadata, Remove PDF Metadata, Compare PDFs, OCR PDF, PDF ↔ Word, PDF ↔ Excel, PDF ↔ PowerPoint.

## Key Constraints
- **Remove PDF Password** must require the user to supply the correct existing password — this is a decrypt-with-known-password operation, never a brute-force/crack feature. Reject clearly if the password is wrong.
- **Sign PDF**: implement as a practical free e-signature (user draws or uploads a signature image, places it on a page, optionally applies a self-signed certificate for basic integrity) — not a paid PKI/notarization service.
- **OCR PDF** must run fully locally and free — use Tesseract (via `tesseract.js` or Python `pytesseract`), never a paid cloud OCR API.
- **PDF ↔ Word/Excel/PowerPoint**: build a shared `office-convert` interface (e.g. `apps/api/shared/office-convert.ts`) that this module and phases 07/08 both import, so the Word/Excel/PPT-side conversions (Word → PDF, Excel → PDF, etc.) aren't duplicated. If you use LibreOffice headless (`soffice --headless`) as the high-fidelity converter, treat it as an *optional* local dependency: detect if it's missing and degrade to a lower-fidelity pure-JS path with a clear message, rather than hard-failing the whole feature.

## Modules / Files
`apps/api/pdf/{watermark.ts, pageNumbers.ts, protect.ts, unprotect.ts, sign.ts, fillForm.ts, metadata.ts, compare.ts, ocr.ts, toPdfA.ts, toHtml.ts}`; `apps/api/shared/office-convert.ts`.

## Acceptance Criteria
- [ ] Watermark/page numbers apply correctly across all pages of a multi-page PDF.
- [ ] Password protect/remove round-trips correctly (protect then remove with correct password returns the original content); wrong password on remove is rejected with a clear message.
- [ ] OCR correctly extracts text from a scanned (image-only) PDF fixture, fully offline.
- [ ] PDF/A output validates against a basic PDF/A conformance check.
- [ ] PDF ↔ Word/Excel/PowerPoint round-trip preserves reasonable structure (text, basic layout) — perfect fidelity is not required, but garbled/empty output is a failure.
- [ ] If LibreOffice (or equivalent optional local dependency) isn't installed, the affected tools show an actionable message per §22 rather than crashing the app.

## Test Cases
- Fixture-based tests per tool as in phase 05.
- Security test: attempt Remove Password with the wrong password → rejected; with the right password → succeeds.
- OCR accuracy smoke test against a known scanned fixture (assert key expected words appear in output).
- Missing-optional-dependency test: simulate LibreOffice not being on PATH, confirm graceful degradation path is taken.

## Notes
Log in PROGRESS.md whether LibreOffice ends up required-for-full-fidelity or truly optional, and which OCR path (JS vs Python) you picked.
