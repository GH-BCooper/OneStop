// Everyday text, number and date utilities added after the end-to-end QA pass: Word Counter, Line
// Sorter & Cleaner, HTML Entity Converter, Number Base Converter, Date Calculator and Percentage
// Calculator.
//
// They are the small jobs people reach for a website to do - "how many words is this?", "sort and
// de-duplicate this list", "what is 15% of 240?" - and they are exactly the kind that should never
// need an upload, an account or a network. Every one is a pure function of its input: no
// dependency, no I/O, no clock unless the person asks for "today".
import { randomInt } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import {
  MIME,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readTextSource,
  runUtilTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";

// ---- Word Counter -----------------------------------------------------------------------------

const STOP_WORDS = new Set(
  (
    "a about after all also am an and any are as at be because been but by can could did do does " +
    "for from had has have he her his how i if in into is it its just me more most my no not of on " +
    "one or our out over she so some than that the their them then there these they this to too up " +
    "us was we were what when which who will with would you your"
  ).split(" "),
);

export interface TextReport {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  averageWordLength: number;
  longestWord: string;
  readingMinutes: number;
  speakingMinutes: number;
  keywords: { word: string; count: number; percent: number }[];
}

const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’-]*[\p{L}\p{N}])?/gu;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A number option that keeps its decimals (the shared `optNumber` rounds to a whole number). */
function optDecimal(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const raw = options[key];
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Counts a piece of text the way a writer means it: words, sentences, paragraphs, reading time. */
export function analyseText(text: string, keywordCount = 10): TextReport {
  const words = text.match(WORD_RE) ?? [];
  const lower = words.map((w) => w.toLowerCase());
  const counts = new Map<string, number>();
  for (const w of lower) {
    if (w.length < 3 || STOP_WORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const keywords = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, keywordCount))
    .map(([word, count]) => ({
      word,
      count,
      percent: words.length === 0 ? 0 : Math.round((count / words.length) * 1000) / 10,
    }));
  const sentences = text
    .split(/[.!?…]+(?:["')\]]*)(?:\s+|$)/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((p) => /\S/.test(p)).length;
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const wordLetters = words.reduce((sum, w) => sum + [...w].length, 0);
  return {
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, "")].length,
    words: words.length,
    uniqueWords: new Set(lower).size,
    sentences,
    paragraphs,
    lines: text.split(/\r?\n/).filter((l) => l.trim() !== "").length,
    averageWordLength: words.length === 0 ? 0 : round1(wordLetters / words.length),
    longestWord: longest,
    // 238 words a minute silently, 150 aloud: the commonly quoted averages for adult English readers.
    readingMinutes: round1(words.length / 238),
    speakingMinutes: round1(words.length / 150),
    keywords,
  };
}

export const wordCounterExecutor: Executor = (input, options, ctx) =>
  runUtilTool("word-counter", async () => {
    const src = await readTextSource(input, ctx, "text", { stem: "text" });
    const report = analyseText(src.text, optNumber(options, "keywords", 10, { min: 0, max: 50 }));
    const minutes =
      report.readingMinutes < 1
        ? "under a minute"
        : `about ${report.readingMinutes} minute${report.readingMinutes === 1 ? "" : "s"}`;
    return {
      ok: true,
      output: { ...report, result: `${report.words} words, ${report.characters} characters` },
      summary: `${plural(report.words, "word")}, ${plural(report.characters, "character")} (${report.charactersNoSpaces.toLocaleString("en")} without spaces), ${plural(report.sentences, "sentence")}, ${plural(report.paragraphs, "paragraph")}. Reading takes ${minutes}.`,
      files: optBool(options, "saveReport", false)
        ? [textFile("word-count.json", MIME.json, `${JSON.stringify(report, null, 2)}\n`)]
        : [],
    };
  });

// ---- Line Sorter & Cleaner --------------------------------------------------------------------

export type LineSort =
  "none" | "az" | "za" | "natural" | "shortest" | "longest" | "reverse" | "shuffle";
const LINE_SORTS: readonly LineSort[] = [
  "none",
  "az",
  "za",
  "natural",
  "shortest",
  "longest",
  "reverse",
  "shuffle",
];

export interface LineOptions {
  trim: boolean;
  removeEmpty: boolean;
  dedupe: boolean;
  ignoreCase: boolean;
  sort: LineSort;
  prefix: string;
  suffix: string;
  numberLines: boolean;
}

export interface LineResult {
  lines: string[];
  before: number;
  emptyRemoved: number;
  duplicatesRemoved: number;
}

/** Fisher-Yates with a CSPRNG, so "shuffle" is fair rather than merely mixed-up. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function processLines(text: string, o: LineOptions): LineResult {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  // A file that ends with a newline has one phantom empty "line" after the last real one.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const before = lines.length;
  if (o.trim) lines = lines.map((l) => l.trim());
  let emptyRemoved = 0;
  if (o.removeEmpty) {
    const kept = lines.filter((l) => l.trim() !== "");
    emptyRemoved = lines.length - kept.length;
    lines = kept;
  }
  let duplicatesRemoved = 0;
  if (o.dedupe) {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const line of lines) {
      const key = o.ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(line);
    }
    duplicatesRemoved = lines.length - kept.length;
    lines = kept;
  }
  const collator = new Intl.Collator("en", { sensitivity: o.ignoreCase ? "accent" : "variant" });
  const natural = new Intl.Collator("en", {
    numeric: true,
    sensitivity: o.ignoreCase ? "accent" : "variant",
  });
  switch (o.sort) {
    case "az":
      lines = [...lines].sort(collator.compare);
      break;
    case "za":
      lines = [...lines].sort((a, b) => collator.compare(b, a));
      break;
    case "natural":
      lines = [...lines].sort(natural.compare);
      break;
    case "shortest":
      lines = [...lines].sort((a, b) => a.length - b.length || collator.compare(a, b));
      break;
    case "longest":
      lines = [...lines].sort((a, b) => b.length - a.length || collator.compare(a, b));
      break;
    case "reverse":
      lines = [...lines].reverse();
      break;
    case "shuffle":
      lines = shuffled(lines);
      break;
    case "none":
      break;
  }
  if (o.prefix !== "" || o.suffix !== "" || o.numberLines) {
    const width = String(lines.length).length;
    lines = lines.map(
      (l, i) =>
        `${o.numberLines ? `${String(i + 1).padStart(width, " ")}. ` : ""}${o.prefix}${l}${o.suffix}`,
    );
  }
  return { lines, before, emptyRemoved, duplicatesRemoved };
}

export const lineToolsExecutor: Executor = (input, options, ctx) =>
  runUtilTool("line-sorter-and-cleaner", async () => {
    const src = await readTextSource(input, ctx, "text", { stem: "lines" });
    const result = processLines(src.text, {
      trim: optBool(options, "trim", true),
      removeEmpty: optBool(options, "removeEmpty", true),
      dedupe: optBool(options, "dedupe", false),
      ignoreCase: optBool(options, "ignoreCase", false),
      sort: optEnum(options, "sort", LINE_SORTS, "none"),
      prefix: optString(options, "prefix"),
      suffix: optString(options, "suffix"),
      numberLines: optBool(options, "numberLines", false),
    });
    const text = result.lines.join("\n");
    const bits = [
      `${plural(result.before, "line")} in, ${plural(result.lines.length, "line")} out`,
      result.emptyRemoved > 0 ? `${plural(result.emptyRemoved, "empty line")} removed` : null,
      result.duplicatesRemoved > 0
        ? `${plural(result.duplicatesRemoved, "duplicate")} removed`
        : null,
    ].filter(Boolean);
    return {
      ok: true,
      output: {
        before: result.before,
        after: result.lines.length,
        emptyRemoved: result.emptyRemoved,
        duplicatesRemoved: result.duplicatesRemoved,
        result: text,
      },
      summary: `${bits.join("; ")}.`,
      files: [
        textFile(
          `${src.pasted ? "lines" : safeStem(src.name, "lines").replace(/\.[^.]+$/, "")}-cleaned.txt`,
          MIME.txt,
          `${text}\n`,
        ),
      ],
    };
  });

// ---- HTML Entity Converter --------------------------------------------------------------------

/** The named entities people actually meet. Anything else round-trips as a numeric reference. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  hearts: "♥",
  spades: "♠",
  clubs: "♣",
  diams: "♦",
  infin: "∞",
  ne: "≠",
  le: "≤",
  ge: "≥",
  asymp: "≈",
  micro: "µ",
  iexcl: "¡",
  iquest: "¿",
  szlig: "ß",
  ntilde: "ñ",
  Ntilde: "Ñ",
  ccedil: "ç",
  Ccedil: "Ç",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  auml: "ä",
  Auml: "Ä",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  Egrave: "È",
  ecirc: "ê",
  aacute: "á",
  Aacute: "Á",
  agrave: "à",
  Agrave: "À",
  acirc: "â",
  aring: "å",
  Aring: "Å",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  oacute: "ó",
  Oacute: "Ó",
  iacute: "í",
  Iacute: "Í",
  uacute: "ú",
  Uacute: "Ú",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  pi: "π",
  sigma: "σ",
  omega: "ω",
  lambda: "λ",
  mu: "μ",
  theta: "θ",
  sum: "∑",
  radic: "√",
  check: "✓",
  dagger: "†",
};
const NAME_OF = new Map<string, string>(
  Object.entries(NAMED_ENTITIES)
    .filter(([name]) => !["apos", "nbsp"].includes(name))
    .map(([name, ch]) => [ch, name]),
);

export function encodeHtmlEntities(text: string, { nonAscii }: { nonAscii: boolean }): string {
  let out = "";
  for (const ch of text) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else if (nonAscii && ch.codePointAt(0)! > 126) {
      const named = NAME_OF.get(ch);
      out += named ? `&${named};` : `&#${ch.codePointAt(0)};`;
    } else out += ch;
  }
  return out;
}

export function decodeHtmlEntities(text: string): {
  text: string;
  decoded: number;
  unknown: string[];
} {
  let decoded = 0;
  const unknown: string[] = [];
  const out = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (
        !Number.isFinite(code) ||
        code < 1 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        unknown.push(whole);
        return whole;
      }
      decoded += 1;
      return String.fromCodePoint(code);
    }
    const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    if (hit === undefined) {
      unknown.push(whole);
      return whole;
    }
    decoded += 1;
    return hit;
  });
  return { text: out, decoded, unknown: [...new Set(unknown)] };
}

export const htmlEntityExecutor: Executor = (input, options, ctx) =>
  runUtilTool("html-entity-converter", async () => {
    const src = await readTextSource(input, ctx, "text", { stem: "entities" });
    const mode = optEnum(options, "mode", ["encode", "decode"] as const, "encode");
    if (mode === "encode") {
      const result = encodeHtmlEntities(src.text, {
        nonAscii: optBool(options, "encodeNonAscii", false),
      });
      return {
        ok: true,
        output: { mode, result },
        summary: `Encoded ${plural([...src.text].length, "character")}; the output is safe to place inside HTML.`,
        files: [textFile("encoded.txt", MIME.txt, `${result}\n`)],
      };
    }
    const { text, decoded, unknown } = decodeHtmlEntities(src.text);
    return {
      ok: true,
      output: { mode, result: text, decoded, unknown },
      summary:
        `Decoded ${decoded} ${decoded === 1 ? "entity" : "entities"}.` +
        (unknown.length > 0
          ? ` ${unknown.length} not recognised and left as they were: ${unknown.slice(0, 5).join(" ")}.`
          : ""),
      files: [textFile("decoded.txt", MIME.txt, `${text}\n`)],
    };
  });

// ---- Number Base Converter --------------------------------------------------------------------

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Parses `0xFF`, `0b1010`, `0o17`, `-42`, `1_000` and (with an explicit base) bare digits. */
export function parseInteger(raw: string, base: "auto" | number): { value: bigint; base: number } {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_,]/g, "");
  if (s === "") throw unsupported("Enter a whole number first, such as 255, 0xFF or 0b1010.");
  if (s.length > 4000) throw unsupported("That number is too long. Use at most 4,000 digits.");
  let negative = false;
  if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  let radix: number;
  if (base === "auto") {
    if (s.startsWith("0x")) [radix, s] = [16, s.slice(2)];
    else if (s.startsWith("0b")) [radix, s] = [2, s.slice(2)];
    else if (s.startsWith("0o")) [radix, s] = [8, s.slice(2)];
    else radix = 10;
  } else {
    radix = base;
    const prefix = { 16: "0x", 2: "0b", 8: "0o" }[radix];
    if (prefix && s.startsWith(prefix)) s = s.slice(2);
  }
  if (s === "") throw unsupported("There are no digits after the prefix.");
  let value = 0n;
  const big = BigInt(radix);
  for (const ch of s) {
    const digit = DIGITS.indexOf(ch);
    if (digit < 0 || digit >= radix) {
      throw unsupported(
        `"${ch}" is not a base-${radix} digit. ${radix === 10 ? "Use 0x, 0b or 0o for other bases, or choose the base yourself." : `Base ${radix} uses ${DIGITS.slice(0, radix)}.`}`,
      );
    }
    value = value * big + BigInt(digit);
  }
  return { value: negative ? -value : value, base: radix };
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toRoman(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
  let out = "";
  for (const [v, sym] of ROMAN) while (n >= v) [out, n] = [out + sym, n - v];
  return out;
}

export const numberBaseExecutor: Executor = (input, options, ctx) =>
  runUtilTool("number-base-converter", async () => {
    const src = await readTextSource(input, ctx, "number", { stem: "number" });
    const from = optEnum(options, "from", ["auto", "2", "8", "10", "16", "36"] as const, "auto");
    const { value, base } = parseInteger(
      src.text.split(/\r?\n/)[0]!,
      from === "auto" ? "auto" : Number(from),
    );
    const abs = value < 0n ? -value : value;
    const sign = value < 0n ? "-" : "";
    const bin = abs.toString(2);
    const nibbles = bin.padStart(Math.ceil(bin.length / 4) * 4, "0").replace(/(.{4})(?=.)/g, "$1 ");
    const roman = value >= 1n && value <= 3999n ? toRoman(Number(value)) : null;
    const bytes = Math.max(1, Math.ceil(bin.length / 8));
    const result = {
      readAsBase: base,
      decimal: `${sign}${abs.toString(10)}`,
      binary: `${sign}${bin}`,
      binaryGrouped: `${sign}${nibbles}`,
      octal: `${sign}${abs.toString(8)}`,
      hexadecimal: `${sign}${abs.toString(16).toUpperCase()}`,
      base36: `${sign}${abs.toString(36).toUpperCase()}`,
      roman,
      bits: abs === 0n ? 1 : bin.length,
      bytes,
    };
    return {
      ok: true,
      output: { ...result, result: result.decimal },
      summary: `${result.decimal} is ${result.binary} in binary, ${result.octal} in octal and ${result.hexadecimal} in hex${roman ? `, or ${roman} in Roman numerals` : ""}.`,
      files: [textFile("number-bases.json", MIME.json, `${JSON.stringify(result, null, 2)}\n`)],
    };
  });

// ---- Date Calculator --------------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;

/** A calendar date with no time zone: always midnight UTC, so no daylight-saving hour can creep in. */
function utc(y: number, m: number, d: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(y, m, d);
  return date;
}

/** "mar", "March" and "sept" all find their month; anything under three letters is too vague. */
function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return w.length < 3 ? -1 : MONTHS.findIndex((name) => name.startsWith(w));
}

export function parseDate(raw: string, label: string): Date {
  const s = raw.trim();
  const fail = () =>
    unsupported(`${label}: enter a date like 2026-03-15, 15 March 2026 or March 15, 2026.`);
  let y: number, m: number, d: number;
  let hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]) - 1, Number(hit[3])];
  else if ((hit = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(s))) {
    m = monthIndex(hit[2]!);
    [y, d] = [Number(hit[3]), Number(hit[1])];
  } else if ((hit = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s))) {
    m = monthIndex(hit[1]!);
    [y, d] = [Number(hit[3]), Number(hit[2])];
  } else throw fail();
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1 || y > 9999) throw fail();
  const date = utc(y, m, d);
  // 31 February rolls over into March; refuse it rather than quietly answer for another date.
  if (date.getUTCMonth() !== m || date.getUTCDate() !== d)
    throw unsupported(`${label}: that date does not exist.`);
  return date;
}

const iso = (d: Date) =>
  `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number) => utc(y, m + 1, 0).getUTCDate();
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const today = () => {
  const n = new Date();
  return utc(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};

/** ISO 8601 week number and the year it belongs to (the first Thursday's year). */
export function isoWeek(date: Date): { year: number; week: number } {
  const t = utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = utc(t.getUTCFullYear(), 0, 1);
  return {
    year: t.getUTCFullYear(),
    week: Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7),
  };
}

const dayOfYear = (d: Date) =>
  Math.round((d.getTime() - utc(d.getUTCFullYear(), 0, 1).getTime()) / DAY_MS) + 1;

/**
 * Whole years, months and days from the earlier date to the later one. Months are counted with the
 * same clamping rule "add a month" uses (31 January plus one month is 28 February), so the two modes
 * of the Date Calculator can never disagree: 31 January to 1 March is one month and one day.
 */
export function calendarDifference(
  a: Date,
  b: Date,
): { years: number; months: number; days: number } {
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (addToDate(from, months, "months").getTime() > to.getTime()) months -= 1;
  const anchor = addToDate(from, months, "months");
  return {
    years: Math.floor(months / 12),
    months: months % 12,
    days: Math.round((to.getTime() - anchor.getTime()) / DAY_MS),
  };
}

/** Weekdays (Mon-Fri) from `a` up to but not including `b`. */
export function businessDaysBetween(a: Date, b: Date): number {
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  const total = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  const start = from.getUTCDay();
  for (let i = 0; i < total % 7; i += 1) {
    const day = (start + i) % 7;
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function addToDate(
  start: Date,
  amount: number,
  unit: "days" | "weeks" | "months" | "years" | "business-days",
): Date {
  if (unit === "days" || unit === "weeks") {
    return new Date(start.getTime() + amount * (unit === "weeks" ? 7 : 1) * DAY_MS);
  }
  if (unit === "business-days") {
    let d = new Date(start.getTime());
    const step = amount < 0 ? -1 : 1;
    for (let left = Math.abs(amount); left > 0;) {
      d = new Date(d.getTime() + step * DAY_MS);
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) left -= 1;
    }
    return d;
  }
  const totalMonths =
    start.getUTCFullYear() * 12 + start.getUTCMonth() + (unit === "years" ? amount * 12 : amount);
  const y = Math.floor(totalMonths / 12);
  const m = ((totalMonths % 12) + 12) % 12;
  // 31 January + 1 month is the last day of February, not 3 March.
  return utc(y, m, Math.min(start.getUTCDate(), daysInMonth(y, m)));
}

function describeDate(d: Date) {
  const week = isoWeek(d);
  return {
    date: iso(d),
    weekday: WEEKDAYS[d.getUTCDay()]!,
    isoWeek: `${week.year}-W${String(week.week).padStart(2, "0")}`,
    dayOfYear: dayOfYear(d),
    daysInMonth: daysInMonth(d.getUTCFullYear(), d.getUTCMonth()),
    quarter: Math.floor(d.getUTCMonth() / 3) + 1,
    leapYear: isLeap(d.getUTCFullYear()),
  };
}

export const dateCalculatorExecutor: Executor = (_input, options) =>
  runUtilTool("date-calculator", async () => {
    const mode = optEnum(options, "mode", ["difference", "add", "info"] as const, "difference");
    const startText = optString(options, "start");
    const start = startText.trim() === "" ? today() : parseDate(startText, "Start date");
    if (mode === "info") {
      const info = describeDate(start);
      const t = today();
      const delta = Math.round((start.getTime() - t.getTime()) / DAY_MS);
      return {
        ok: true,
        output: { ...info, daysFromToday: delta, result: info.date },
        summary: `${info.date} is a ${info.weekday}, day ${info.dayOfYear} of the year, in ISO week ${info.isoWeek}${info.leapYear ? " (a leap year)" : ""}.`,
        files: [],
      };
    }
    if (mode === "add") {
      const amount = optNumber(options, "amount", 30, { min: -100_000, max: 100_000 });
      const unit = optEnum(
        options,
        "unit",
        ["days", "weeks", "months", "years", "business-days"] as const,
        "days",
      );
      if (!Number.isInteger(amount)) throw unsupported("Enter a whole number to add or subtract.");
      const end = addToDate(start, amount, unit);
      if (end.getUTCFullYear() < 1 || end.getUTCFullYear() > 9999)
        throw unsupported("That lands outside the years 1 to 9999.");
      const info = describeDate(end);
      return {
        ok: true,
        output: { start: iso(start), amount, unit, ...info, result: info.date },
        summary: `${iso(start)} ${amount < 0 ? "minus" : "plus"} ${Math.abs(amount)} ${unit.replace("-", " ")} is ${info.weekday} ${info.date}.`,
        files: [],
      };
    }
    const endText = optString(options, "end");
    const end = endText.trim() === "" ? today() : parseDate(endText, "End date");
    const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const abs = Math.abs(totalDays);
    const cal = calendarDifference(start, end);
    const business = businessDaysBetween(start, end);
    const parts = [
      cal.years ? plural(cal.years, "year") : null,
      cal.months ? plural(cal.months, "month") : null,
      cal.days || (!cal.years && !cal.months) ? plural(cal.days, "day") : null,
    ].filter(Boolean);
    return {
      ok: true,
      output: {
        start: iso(start),
        end: iso(end),
        direction: totalDays < 0 ? "end is before start" : "end is after start",
        totalDays: abs,
        weeks: Math.floor(abs / 7),
        remainderDays: abs % 7,
        ...cal,
        businessDays: business,
        result: `${abs} days`,
      },
      summary: `${iso(start)} to ${iso(end)} is ${plural(abs, "day")} (${parts.join(", ")}), including ${plural(business, "weekday")}.${totalDays < 0 ? " The end date is before the start date." : ""}`,
      files: [],
    };
  });

// ---- Percentage Calculator --------------------------------------------------------------------

export type PercentMode = "of" | "what-percent" | "change" | "increase" | "decrease" | "reverse";
const PERCENT_MODES: readonly PercentMode[] = [
  "of",
  "what-percent",
  "change",
  "increase",
  "decrease",
  "reverse",
];

export function percentage(
  mode: PercentMode,
  a: number,
  b: number,
): { value: number; formula: string; sentence: string } {
  const f = (n: number) => Number.parseFloat(n.toPrecision(12)).toString();
  switch (mode) {
    case "of": {
      const value = (a / 100) * b;
      return {
        value,
        formula: `${f(a)} ÷ 100 × ${f(b)}`,
        sentence: `${f(a)}% of ${f(b)} is ${f(value)}.`,
      };
    }
    case "what-percent": {
      if (b === 0)
        throw unsupported("The second number cannot be zero: nothing is a percentage of zero.");
      const value = (a / b) * 100;
      return {
        value,
        formula: `${f(a)} ÷ ${f(b)} × 100`,
        sentence: `${f(a)} is ${f(value)}% of ${f(b)}.`,
      };
    }
    case "change": {
      if (a === 0)
        throw unsupported(
          "The starting value cannot be zero: a change from zero has no percentage.",
        );
      const value = ((b - a) / Math.abs(a)) * 100;
      return {
        value,
        formula: `(${f(b)} − ${f(a)}) ÷ |${f(a)}| × 100`,
        sentence: `From ${f(a)} to ${f(b)} is ${value >= 0 ? "an increase" : "a decrease"} of ${f(Math.abs(value))}%.`,
      };
    }
    case "increase": {
      const value = b * (1 + a / 100);
      return {
        value,
        formula: `${f(b)} × (1 + ${f(a)} ÷ 100)`,
        sentence: `${f(b)} increased by ${f(a)}% is ${f(value)}.`,
      };
    }
    case "decrease": {
      const value = b * (1 - a / 100);
      return {
        value,
        formula: `${f(b)} × (1 − ${f(a)} ÷ 100)`,
        sentence: `${f(b)} decreased by ${f(a)}% is ${f(value)}.`,
      };
    }
    case "reverse": {
      if (b === 0)
        throw unsupported("The percentage cannot be zero: no number is 0% of something.");
      const value = a / (b / 100);
      return {
        value,
        formula: `${f(a)} ÷ (${f(b)} ÷ 100)`,
        sentence: `${f(a)} is ${f(b)}% of ${f(value)}.`,
      };
    }
  }
}

export const percentageExecutor: Executor = (_input, options) =>
  runUtilTool("percentage-calculator", async () => {
    const mode = optEnum(options, "mode", PERCENT_MODES, "of");
    const a = optDecimal(options, "a", 0, { min: -1e15, max: 1e15 });
    const b = optDecimal(options, "b", 0, { min: -1e15, max: 1e15 });
    const decimals = optNumber(options, "decimals", 2, { min: 0, max: 10 });
    const r = percentage(mode, a, b);
    if (!Number.isFinite(r.value))
      throw unsupported("That works out to a number too large to show.");
    const shown = Number(r.value.toFixed(decimals));
    return {
      ok: true,
      output: { mode, a, b, formula: r.formula, exact: r.value, result: shown },
      summary: `${r.sentence}${Number(r.value.toFixed(decimals)) !== r.value ? ` (rounded to ${decimals} decimal place${decimals === 1 ? "" : "s"}: ${shown})` : ""}`,
      files: [],
    };
  });
