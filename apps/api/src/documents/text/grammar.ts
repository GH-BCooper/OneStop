// Grammar Checker engine (Features 2.12) — 07-word-ppt-tools.md.
//
// Fully local and free, no AI:
// - spelling: nspell (Hunspell in JS) with the `dictionary-en` en-US word list, read from
//   node_modules by path (so a bundler never has to understand the dictionary package);
// - grammar & punctuation: OneStop's own rules — repeated words, a/an, lower-case "i", sentence
//   capitals, spacing around punctuation, "could of" and friends, common misspellings, then/than;
// - style: `write-good` (passive voice, weasel words, wordiness, clichés…), optional.
// Phase 16 can put an LLM behind the same `checkGrammar` contract; callers do not change.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { findPackageDir } from "../../shared/node-modules.ts";

export type IssueKind = "spelling" | "grammar" | "punctuation" | "style";

export interface GrammarIssue {
  kind: IssueKind;
  message: string;
  /** Offset and length in the checked text. */
  offset: number;
  length: number;
  line: number;
  column: number;
  text: string;
  suggestions: string[];
  /** True when the first suggestion is safe to apply automatically. */
  fixable: boolean;
}

interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

let speller: Speller | null | undefined;

function loadSpeller(): Speller | null {
  if (speller !== undefined) return speller;
  try {
    const dir = findPackageDir("dictionary-en", "index.dic");
    if (!dir) throw new Error("dictionary-en is not installed");
    const require = createRequire(import.meta.url);
    const nspell = require("nspell") as (aff: Buffer, dic: Buffer) => Speller;
    speller = nspell(
      readFileSync(path.join(dir, "index.aff")),
      readFileSync(path.join(dir, "index.dic")),
    );
  } catch (err) {
    console.error("[documents:grammar] spelling dictionary unavailable", err);
    speller = null;
  }
  return speller;
}

type WriteGood = (
  text: string,
  options?: Record<string, boolean>,
) => { index: number; offset: number; reason: string }[];

function loadWriteGood(): WriteGood | null {
  try {
    return createRequire(import.meta.url)("write-good") as WriteGood;
  } catch (err) {
    console.error("[documents:grammar] write-good unavailable", err);
    return null;
  }
}

// ---- rules ------------------------------------------------------------------------------------

const MISSPELLINGS: Record<string, string> = {
  alot: "a lot",
  definately: "definitely",
  definatly: "definitely",
  seperate: "separate",
  recieve: "receive",
  recieved: "received",
  untill: "until",
  occured: "occurred",
  occurence: "occurrence",
  wich: "which",
  teh: "the",
  thier: "their",
  beleive: "believe",
  acheive: "achieve",
  accomodate: "accommodate",
  adress: "address",
  begining: "beginning",
  calender: "calendar",
  commited: "committed",
  concious: "conscious",
  embarass: "embarrass",
  enviroment: "environment",
  existance: "existence",
  foward: "forward",
  goverment: "government",
  grammer: "grammar",
  independant: "independent",
  existant: "existent",
  neccessary: "necessary",
  necessery: "necessary",
  noticable: "noticeable",
  occassion: "occasion",
  persue: "pursue",
  posession: "possession",
  prefered: "preferred",
  publically: "publicly",
  recomend: "recommend",
  refered: "referred",
  relevent: "relevant",
  succesful: "successful",
  suprise: "surprise",
  tommorow: "tomorrow",
  tomorow: "tomorrow",
  truely: "truly",
  wierd: "weird",
  irregardless: "regardless",
  alright: "all right",
};

const PHRASES: [RegExp, string, string][] = [
  [/\b(could|should|would|must|might) of\b/gi, "$1 have", '"of" should be "have" here.'],
  [
    /\b(more|less|better|worse|rather|other|greater|fewer|larger|smaller) then\b/gi,
    "$1 than",
    'Use "than" for comparisons.',
  ],
  [/\bits self\b/gi, "itself", 'Write "itself" as one word.'],
  [
    /\bfor all intensive purposes\b/gi,
    "for all intents and purposes",
    'This phrase is usually written "for all intents and purposes".',
  ],
  [/\byour welcome\b/gi, "you're welcome", 'Use "you\'re" (you are) here.'],
  [/\bin regards to\b/gi, "with regard to", 'Use "with regard to" or "regarding".'],
  [
    /\bi( (?:am|have|was|will|would|think|know|can|do|did|had)\b)/g,
    "I$1",
    'The pronoun "I" is always capitalised.',
  ],
];

const AN_EXCEPTIONS = /^(?:hour|honest|honou?r|heir|herb)/i;
const A_EXCEPTIONS = /^(?:uni|use|usu|uti|ure|eu|ewe|one|once|ubiq|ukr|uran|urin|uter)/i;
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "no",
  "fig",
  "approx",
  "inc",
  "ltd",
  "jr",
  "sr",
]);

function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) {
    line += 1;
    last = i;
  }
  return { line, column: offset - last };
}

function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]!.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function checkGrammar(
  text: string,
  { spelling = true, style = true }: { spelling?: boolean; style?: boolean } = {},
): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  const add = (
    kind: IssueKind,
    offset: number,
    length: number,
    message: string,
    suggestions: string[] = [],
    fixable = suggestions.length > 0,
  ) => {
    if (issues.some((i) => offset < i.offset + i.length && i.offset < offset + length)) return;
    issues.push({
      kind,
      message,
      offset,
      length,
      ...lineCol(text, offset),
      text: text.slice(offset, offset + length),
      suggestions,
      fixable,
    });
  };

  for (const m of text.matchAll(/\b([A-Za-z']+)(\s+)\1\b/gi)) {
    if (/^(had|that)$/i.test(m[1]!)) continue;
    add("grammar", m.index!, m[0].length, `"${m[1]}" is repeated.`, [m[1]!]);
  }
  for (const [re, replacement, message] of PHRASES) {
    for (const m of text.matchAll(re)) {
      add("grammar", m.index!, m[0].length, message, [
        preserveCase(m[0], m[0].replace(new RegExp(re.source, "i"), replacement)),
      ]);
    }
  }
  for (const m of text.matchAll(/\b(a|an)\s+([A-Za-z][\w-]*)/gi)) {
    const [whole, article, word] = [m[0], m[1]!, m[2]!];
    if (/^[A-Z]{2,}/.test(word)) continue; // acronyms: "an FAQ" / "a URL" depend on pronunciation
    const vowel = /^[aeiou]/i.test(word);
    if (
      article.toLowerCase() === "a" &&
      ((vowel && !A_EXCEPTIONS.test(word)) || AN_EXCEPTIONS.test(word))
    ) {
      add("grammar", m.index!, whole.length, `Use "an" before "${word}".`, [
        `${preserveCase(article, "an")} ${word}`,
      ]);
    } else if (article.toLowerCase() === "an" && !vowel && !AN_EXCEPTIONS.test(word)) {
      add("grammar", m.index!, whole.length, `Use "a" before "${word}".`, [
        `${preserveCase(article, "a")} ${word}`,
      ]);
    }
  }
  for (const m of text.matchAll(/(^|[.!?]\s+|\n\s*)([a-z])(\w*)/g)) {
    const before = text.slice(Math.max(0, m.index! - 8), m.index! + m[1]!.length).trim();
    const prevWord = /([A-Za-z.]+)[.!?]\s*$/.exec(before)?.[1]?.toLowerCase().replace(/\.$/, "");
    if (prevWord && ABBREVIATIONS.has(prevWord)) continue;
    if (/\d[.]\s*$/.test(before)) continue;
    const start = m.index! + m[1]!.length;
    const word = m[2]! + m[3]!;
    add("grammar", start, word.length, "Start the sentence with a capital letter.", [
      word[0]!.toUpperCase() + word.slice(1),
    ]);
  }
  for (const m of text.matchAll(/(\S)( +)([,.;:!?])(?![.\d])/g)) {
    add("punctuation", m.index! + 1, m[2]!.length + 1, `Remove the space before "${m[3]}".`, [
      m[3]!,
    ]);
  }
  for (const m of text.matchAll(/([a-z])([,;!?])([A-Za-z])/g)) {
    add("punctuation", m.index! + 1, 2, `Add a space after "${m[2]}".`, [`${m[2]} ${m[3]}`]);
  }
  for (const m of text.matchAll(/([a-z]{2,})\.([A-Z][a-z]+)/g)) {
    add("punctuation", m.index! + m[1]!.length, m[2]!.length + 1, 'Add a space after ".".', [
      `. ${m[2]}`,
    ]);
  }
  for (const m of text.matchAll(/(\S)( {2,})(?=\S)/g)) {
    add("punctuation", m.index! + 1, m[2]!.length, "Use a single space between words.", [" "]);
  }

  const dictionary = spelling ? loadSpeller() : null;
  const cache = new Map<string, string[] | null>();
  let suggested = 0;
  for (const m of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    const word = m[0];
    const known = MISSPELLINGS[word.toLowerCase()];
    if (known) {
      add("spelling", m.index!, word.length, `"${word}" is misspelled.`, [
        preserveCase(word, known),
      ]);
      continue;
    }
    if (!dictionary || word.length < 3 || /[A-Z]/.test(word.slice(1))) continue;
    // Capitalised words mid-sentence are usually names; only check them at a sentence start.
    const atStart = /(^|[.!?]\s+|\n\s*)$/.test(text.slice(Math.max(0, m.index! - 4), m.index!));
    if (/^[A-Z]/.test(word) && !atStart) continue;
    const key = word.replace(/’/g, "'");
    let suggestions = cache.get(key);
    if (suggestions === undefined) {
      if (dictionary.correct(key) || dictionary.correct(key.toLowerCase())) suggestions = null;
      else suggestions = suggested++ < 60 ? dictionary.suggest(key).slice(0, 3) : [];
      cache.set(key, suggestions);
    }
    if (suggestions) {
      add("spelling", m.index!, word.length, `"${word}" may be misspelled.`, suggestions, false);
    }
  }

  const writeGood = style ? loadWriteGood() : null;
  for (const s of writeGood?.(text, {
    illusion: false,
    so: true,
    thereIs: true,
    passive: true,
    adverb: true,
    tooWordy: true,
    cliches: true,
    weasel: true,
    eprime: false,
  }) ?? []) {
    add(
      "style",
      s.index,
      s.offset,
      s.reason.charAt(0).toUpperCase() + s.reason.slice(1) + ".",
      [],
      false,
    );
  }
  return issues.sort((a, b) => a.offset - b.offset);
}

/** Applies every issue marked `fixable`, back to front so offsets stay valid. */
export function applyFixes(
  text: string,
  issues: GrammarIssue[],
): { text: string; applied: number } {
  let out = text;
  let applied = 0;
  for (const issue of [...issues].sort((a, b) => b.offset - a.offset)) {
    if (!issue.fixable || !issue.suggestions[0]) continue;
    out =
      out.slice(0, issue.offset) + issue.suggestions[0] + out.slice(issue.offset + issue.length);
    applied += 1;
  }
  return { text: out, applied };
}
