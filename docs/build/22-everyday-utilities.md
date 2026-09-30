# Phase 22 — Everyday utilities (added after the end-to-end QA pass)

**Scope.** Seven small tools that the 285-tool catalogue still lacked, all pure functions of their
input, all free and offline, none adding a dependency. A gap analysis of the catalogue during the
2026-09-30 QA pass found people would reach for a web page to do each of these:

| Tool | Category | Route id | What it does |
| --- | --- | --- | --- |
| Word Counter | Developer / utility | `word-counter` | words, characters, sentences, paragraphs, reading/speaking time, top keywords |
| Line Sorter & Cleaner | Developer / utility | `line-sorter-and-cleaner` | trim, drop empty lines, de-duplicate, sort (A–Z, natural, length, reverse, shuffle), prefix/suffix, number |
| HTML Entity Converter | Developer / utility | `html-entity-converter` | encode / decode `&amp;`-style entities (named, decimal, hex) |
| Number Base Converter | Developer / utility | `number-base-converter` | binary / octal / decimal / hex / base-36 / Roman numerals, exact beyond 2^53 |
| Date Calculator | Calendar & time | `date-calculator` | days between dates, add/subtract (incl. business days), weekday / ISO week / day of year |
| Percentage Calculator | Finance & math | `percentage-calculator` | X% of Y, what percent, change, increase, decrease, reverse |
| YAML Formatter & Validator | Excel, CSV & data | `yaml-formatter-and-validator` | validate with line/column errors, or re-indent (comments are not kept, and it says so) |

The seven are Features items 12.52-12.57 and 4.22 (added to `docs/OneStop_Features.md`, which the
registry test reconciles one-to-one against the catalogue).

Implementation: `apps/api/src/dev-utils/extras.ts` and `apps/api/src/data/yamlFormatter.ts`; registry
entries in `packages/tool-registry/src/entries/expansion.ts` (phase `"22"`), options in
`options-expansion.ts`.

## Acceptance criteria

- Every tool is registered once, `status: "available"`, phase `"22"`, with options that have sensible
  defaults so its page does something the moment it opens.
- Each is proved offline by `apps/api/src/dev-utils/extras.test.ts` (network trapped) and listed in
  `VERIFIED_OFFLINE`.
- The tests target the places where "it ran" and "it is right" differ: leap days, month-end clamping,
  ISO week 53, business-day arithmetic, decimals in percentage inputs, big integers, Roman numerals,
  entity round-trips and double-decoding, YAML custom tags.
- No new runtime dependency.

## Notes and deliberate choices

- `optNumber` rounds to a whole number, so the Percentage Calculator uses its own decimal-preserving
  reader; typing 15.5 % must not silently mean 16 %.
- Dates are calendar dates at midnight UTC, so no daylight-saving hour can shift an answer.
- Shuffle uses `crypto.randomInt`, not `Math.random`.
- Deliberately not built: a Markdown previewer and a PDF cropper were considered and left out; the
  first needs an HTML sanitiser to be safe and the second needs a page-preview UI to be usable.
