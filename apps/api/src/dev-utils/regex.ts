// Regex Tester (12-dev-utility-tools.md §12.19).
//
// Takes the sample text as the tool's input and the pattern as an option, so a saved job records
// exactly what was tried. It reports every match with its position, its numbered and named
// capture groups, and the sample text split into matched/unmatched segments, which is what a
// highlighter needs.
//
// Two guards, because a regular expression is user-supplied code:
//   - the pattern is screened for nested quantifiers (`(a+)+`), the classic catastrophic
//     backtracking shape, and refused with an explanation rather than run;
//   - matching stops at a match limit and at a wall-clock budget, so a slow global scan ends with
//     a partial, labelled result instead of pinning a CPU.
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  optEnum,
  optNumber,
  optString,
  runUtilTool,
  textFile,
  unsupported,
} from "./common.ts";

export const MAX_SAMPLE_BYTES = 256 * 1024;
export const MATCH_BUDGET_MS = 2000;

export interface RegexMatch {
  index: number;
  length: number;
  text: string;
  line: number;
  column: number;
  /** Numbered capture groups, 1-based; `null` where a group did not take part. */
  groups: (string | null)[];
  named: Record<string, string | null>;
}

export interface RegexSegment {
  text: string;
  match: boolean;
  /** 1-based index of the match this segment belongs to. */
  matchNumber?: number;
}

export interface RegexReport {
  pattern: string;
  flags: string;
  matchCount: number;
  matches: RegexMatch[];
  segments: RegexSegment[];
  /** The sample with every match wrapped in guillemets — a plain-text highlight. */
  highlighted: string;
  truncated: boolean;
  groupNames: string[];
}

/** `(x+)+`, `(x*)*`, `(x+)*` and friends: a quantified group whose body is itself quantified. */
const NESTED_QUANTIFIER =
  /\((?![?]<?[=!])[^()]*[+*][^()]*\)\s*[+*]|\((?![?]<?[=!])[^()]*\{\d+,\}?[^()]*\)\s*[+*]/;

export function screenPattern(pattern: string): void {
  if (pattern.trim() === "") throw unsupported("Enter a regular expression first.");
  if (pattern.length > 2000) throw unsupported("That pattern is too long to test safely.");
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw unsupported(
      "This pattern nests one repeat inside another (like (a+)+), which can take effectively forever to match. Rewrite it with a single repeat and try again.",
    );
  }
}

export function compileRegex(pattern: string, flags: string): RegExp {
  screenPattern(pattern);
  const cleaned = [...new Set(flags.replace(/[^gimsuyv]/g, ""))].join("");
  try {
    return new RegExp(pattern, cleaned.includes("g") ? cleaned : cleaned + "g");
  } catch (err) {
    throw unsupported(
      `That is not a valid regular expression: ${(err as Error).message.replace(/^Invalid regular expression: [^:]*: /, "")}`,
    );
  }
}

function lineColumn(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

export function testRegex(
  sample: string,
  pattern: string,
  flags: string,
  { limit = 500, budgetMs = MATCH_BUDGET_MS, now = () => Date.now() } = {},
): RegexReport {
  const re = compileRegex(pattern, flags);
  const matches: RegexMatch[] = [];
  const segments: RegexSegment[] = [];
  const started = now();
  let last = 0;
  let truncated = false;
  const groupNames = new Set<string>();

  for (const m of sample.matchAll(re)) {
    if (matches.length >= limit || now() - started > budgetMs) {
      truncated = true;
      break;
    }
    const index = m.index ?? 0;
    if (index > last) segments.push({ text: sample.slice(last, index), match: false });
    const { line, column } = lineColumn(sample, index);
    for (const name of Object.keys(m.groups ?? {})) groupNames.add(name);
    matches.push({
      index,
      length: m[0].length,
      text: m[0],
      line,
      column,
      groups: m.slice(1).map((g) => g ?? null),
      named: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? null])),
    });
    segments.push({ text: m[0], match: true, matchNumber: matches.length });
    last = index + m[0].length;
    // A zero-length match would otherwise loop forever; `matchAll` advances lastIndex itself,
    // but the segment bookkeeping needs the same nudge.
    if (m[0].length === 0) last = index;
  }
  if (last < sample.length) segments.push({ text: sample.slice(last), match: false });

  return {
    pattern,
    flags: re.flags,
    matchCount: matches.length,
    matches,
    segments,
    highlighted: segments.map((s) => (s.match ? `«${s.text}»` : s.text)).join(""),
    truncated,
    groupNames: [...groupNames],
  };
}

export const regexTesterExecutor: Executor = (input, options) =>
  runUtilTool("regex-tester", async () => {
    if (typeof input !== "string" || input === "") {
      throw unsupported("Paste the text you want to test the expression against.");
    }
    if (new TextEncoder().encode(input).length > MAX_SAMPLE_BYTES) {
      throw unsupported(
        "That sample is larger than 256 KB. Test the expression on a smaller excerpt.",
      );
    }
    const pattern = optString(options, "pattern", "");
    const flags = optString(options, "flags", "g");
    const mode = optEnum(options, "mode", ["match", "replace", "split"] as const, "match");
    const limit = optNumber(options, "limit", 500, { min: 1, max: 5000 });

    const report = testRegex(input, pattern, flags, { limit });
    const extra: Record<string, unknown> = {};
    if (mode === "replace") {
      const replacement = optString(options, "replacement", "");
      extra.replaced = input.replace(compileRegex(pattern, flags), replacement);
    } else if (mode === "split") {
      extra.parts = input.split(compileRegex(pattern, flags)).map((p) => p ?? null);
    }

    const groupCount = report.matches[0]?.groups.length ?? 0;
    const lines = [
      `Pattern: /${report.pattern}/${report.flags}`,
      `Matches: ${report.matchCount}${report.truncated ? " (stopped at the limit)" : ""}`,
      "",
      ...report.matches.map((m) => {
        const groups = m.groups.map(
          (g, i) => `  $${i + 1} = ${g === null ? "(no match)" : JSON.stringify(g)}`,
        );
        const named = Object.entries(m.named).map(
          ([k, v]) => `  <${k}> = ${v === null ? "(no match)" : JSON.stringify(v)}`,
        );
        return [
          `line ${m.line}, column ${m.column}: ${JSON.stringify(m.text)}`,
          ...groups,
          ...named,
        ].join("\n");
      }),
    ];

    return {
      ok: true,
      output: { ...report, mode, ...extra },
      summary:
        report.matchCount === 0
          ? `No matches for /${report.pattern}/${report.flags}.`
          : `${report.matchCount} match${report.matchCount === 1 ? "" : "es"} for /${report.pattern}/${report.flags}` +
            (groupCount > 0
              ? `, each with ${groupCount} capture group${groupCount === 1 ? "" : "s"}`
              : "") +
            (report.groupNames.length > 0 ? ` (named: ${report.groupNames.join(", ")})` : "") +
            `.${report.truncated ? " Stopped early at the match limit." : ""}`,
      files: [textFile("regex-matches.txt", MIME.txt, lines.join("\n") + "\n")],
    };
  });
