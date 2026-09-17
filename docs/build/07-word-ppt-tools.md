# Phase 07 — Word & PowerPoint Tools

## Objective
Implement all Word/Document and PowerPoint tools from the Feature & Tool List.

## Depends On
04-file-core.md, 06-pdf-tools-advanced.md (for the shared `office-convert` interface)

## Tools Implemented This Phase
**Word/Document:** Word → PDF, Word → Excel, Word → Text, Word → HTML, Document → PDF, Document → Images, Merge Documents, Split Documents, Compress Documents, OCR → Word, Document Translator, Grammar Checker, Text Formatter, Document Summarizer, Document Metadata Viewer/Remover.

**PowerPoint:** PPT/PPTX → PDF, PDF → PPT/PPTX, PPT → Images, PPT → Text, Merge Presentations, Split Presentation, Compress Presentation, Extract Slides, Rearrange Slides, Remove Slides.

## Libraries
- `docx` (Node) for reading/writing `.docx`.
- `mammoth` for `.docx` → HTML/text extraction.
- LibreOffice headless (shared, optional dependency from phase 06) for higher-fidelity Word/PPT ↔ PDF/image conversion, with the same graceful-degradation rule.
- For PPTX, a library like `pptxgenjs` (write) and a PPTX parsing library or LibreOffice (read/convert).

## Handling the "AI-flavored" tools without hard-blocking on AI
Grammar Checker, Document Translator, and Document Summarizer are listed here but their *best* implementation depends on the AI Assistant (phase 16). Build them now with a working non-AI fallback so the tool is never hard-blocked:
- Grammar Checker: use a local grammar-checking library (e.g. `write-good`/LanguageTool self-hosted/local) as the default.
- Translator: use a local/offline translation package if one is practical, and clearly label quality limitations; do not require a paid translation API.
- Summarizer: implement a simple local extractive summarizer (e.g. TF-IDF sentence ranking) as the default; note in code that phase 16 can upgrade this to the local LLM without changing the tool's public interface.

## Acceptance Criteria
- [ ] Every tool listed works offline except where explicitly using the (optional, degrading) LibreOffice path.
- [ ] Merge/split/compress documents and presentations work on multi-file, multi-page/slide fixtures.
- [ ] Extract/Rearrange/Remove Slides correctly renumbers remaining slides.
- [ ] Grammar Checker, Translator, and Summarizer all produce a real (non-AI) result today, with an inline note that quality improves once the AI Assistant module is enabled.
- [ ] Document Metadata Viewer/Remover correctly reads and strips author/creation-date/etc. metadata.

## Test Cases
- Fixture-based round-trip tests per conversion pair.
- Multi-file merge tests (documents and presentations).
- Metadata test: known fixture with embedded author/title metadata → viewer shows it, remover strips it (verify by re-reading the file).
- Fallback path test: with LibreOffice simulated as unavailable, confirm the pure-JS/degraded path still returns a usable (if lower-fidelity) result rather than an error.

## Notes
Log the summarizer/grammar/translation approach chosen in PROGRESS.md — phase 16 needs to know what it's upgrading.
