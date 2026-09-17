# Phase 12 — Developer & File Utility Tools

## Objective
Implement the Developer/Utility tools and File Utilities from the Feature & Tool List. These are the simplest, most self-contained tools in the app — a good confidence-building phase, and every one of them should be fully client-side or trivially local.

## Depends On
04-file-core.md

## Tools Implemented This Phase
(Deduplicated — several tools appear in both source lists, e.g. ZIP Creator/Extractor and File Metadata Viewer; implement each once.)

JSON/XML/HTML/CSS/JavaScript Formatter, JSON/XML Validator, Markdown Converter, Markdown → HTML, Base64 Encoder/Decoder, URL Encoder/Decoder, UUID Generator, Password Generator, Hash Generator, Checksum Generator, Timestamp Converter, Regex Tester, User-Agent Viewer, File Metadata Viewer/Remover, ZIP Creator/Extractor, File Compressor, File Merger, File Splitter, File Type Converter (delegates to the relevant format-specific module built in an earlier phase), Duplicate File Detector.

## Libraries
- `prettier` (as a library, not just CLI) for JSON/HTML/CSS/JS formatting.
- Web Crypto API (`crypto.subtle`) for hashing (SHA-256/512) and secure random values (UUID, password generator) — no external service needed.
- `jszip` for ZIP creation/extraction.
- A markdown parser (e.g. `marked` or `remark`) for Markdown conversions.

## Modules / Files
`apps/api/dev-utils/{formatters.ts, validators.ts, encoders.ts, generators.ts, hashing.ts, timestamps.ts, regex.ts, userAgent.ts, fileMeta.ts, zip.ts, fileOps.ts, duplicateDetector.ts}`.

## Acceptance Criteria
- [ ] Every tool listed works with zero network calls.
- [ ] Password Generator uses a cryptographically secure random source, not `Math.random()`.
- [ ] Hash/Checksum Generator supports at least MD5 (for legacy compatibility labeling) and SHA-256.
- [ ] Regex Tester correctly highlights matches and reports capture groups.
- [ ] ZIP Creator/Extractor round-trips a folder of mixed file types without corruption.
- [ ] Duplicate File Detector correctly identifies byte-identical files via hash comparison, and correctly does *not* flag similar-but-different files.
- [ ] File Type Converter correctly routes to the matching tool from an earlier phase (e.g. routing an image conversion request to the phase 09 module) rather than reimplementing logic.

## Test Cases
- Unit test per formatter/validator/encoder against known-good and known-bad inputs.
- Hash/checksum test against known test vectors (e.g. hash of an empty string, hash of "abc").
- ZIP round-trip test with nested folders and mixed file types.
- Duplicate detector test: 2 identical + 1 different file → correctly groups the 2, ignores the 1.

## Notes
This phase should be quick relative to the media/office phases — if any single tool here is taking disproportionately long, double-check you're not over-engineering it; these are meant to be lightweight utilities.
