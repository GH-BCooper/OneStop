// Small pure-text developer utilities (21-roadmap-expansion.md, roadmap §1.8):
// Case Converter, Unit Converter, Lorem Ipsum / placeholder generator and Readability Score Checker.
// Every one of them is a function of its input and nothing else — no network, no dependency, no
// state — which is exactly why they are cheap to add and cheap to trust.
import { randomInt } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  MIME,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readTextSource,
  requireText,
  runUtilTool,
  textFile,
  unsupported,
} from "./common.ts";

// ---- case converter ---------------------------------------------------------------------------

/** Splits an identifier or sentence into its words, whatever convention it came in. */
export function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "if",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "v",
  "via",
  "vs",
]);

export const CASE_STYLES = [
  "camel",
  "pascal",
  "snake",
  "kebab",
  "constant",
  "dot",
  "path",
  "title",
  "sentence",
  "lower",
  "upper",
  "train",
  "alternating",
  "inverse",
] as const;
export type CaseStyle = (typeof CASE_STYLES)[number];

export function convertCase(text: string, style: CaseStyle): string {
  const words = splitWords(text);
  const lower = words.map((w) => w.toLowerCase());
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  switch (style) {
    case "camel":
      return lower.map((w, i) => (i === 0 ? w : cap(w))).join("");
    case "pascal":
      return lower.map(cap).join("");
    case "snake":
      return lower.join("_");
    case "kebab":
      return lower.join("-");
    case "constant":
      return lower.join("_").toUpperCase();
    case "dot":
      return lower.join(".");
    case "path":
      return lower.join("/");
    case "train":
      return lower.map(cap).join("-");
    case "title":
      // Title Case proper: small words stay lower unless they open or close the phrase.
      return lower
        .map((w, i) => (i > 0 && i < lower.length - 1 && SMALL_WORDS.has(w) ? w : cap(w)))
        .join(" ");
    case "sentence":
      return lower.length === 0
        ? ""
        : `${cap(lower[0]!)}${lower.length > 1 ? ` ${lower.slice(1).join(" ")}` : ""}`;
    case "lower":
      return text.toLowerCase();
    case "upper":
      return text.toUpperCase();
    case "alternating":
      return [...text].map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase())).join("");
    case "inverse":
      return [...text]
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join("");
  }
}

const CASE_LABELS: Record<CaseStyle, string> = {
  camel: "camelCase",
  pascal: "PascalCase",
  snake: "snake_case",
  kebab: "kebab-case",
  constant: "CONSTANT_CASE",
  dot: "dot.case",
  path: "path/case",
  title: "Title Case",
  sentence: "Sentence case",
  lower: "lower case",
  upper: "UPPER CASE",
  train: "Train-Case",
  alternating: "aLtErNaTiNg",
  inverse: "iNVERSE",
};

export const caseConverterExecutor: Executor = (input, options, ctx) =>
  runUtilTool("case-converter", async () => {
    const src = await readTextSource(input, ctx, "text", { stem: "text" });
    const style = optEnum(options, "style", CASE_STYLES, "camel");
    const perLine = optBool(options, "perLine", true);
    const apply = (text: string) => convertCase(text, style);
    const result = perLine ? src.text.split(/\r?\n/).map(apply).join("\n") : apply(src.text);
    const all = Object.fromEntries(
      CASE_STYLES.map((s) => [s, convertCase(src.text.split(/\r?\n/)[0] ?? "", s)]),
    );
    return {
      ok: true,
      output: { style, label: CASE_LABELS[style], all, result },
      summary: `Converted to ${CASE_LABELS[style]}.`,
      files: [textFile(`${src.name}-${style}.txt`, MIME.txt, result + "\n")],
    };
  });

// ---- unit converter ---------------------------------------------------------------------------

/**
 * Every unit as a factor relative to one base unit per family, so a conversion is two multiplies.
 * Temperature is the exception — it is affine, not linear — so it gets its own pair of functions.
 */
export const UNITS: Record<string, Record<string, number>> = {
  length: {
    mm: 0.001,
    cm: 0.01,
    m: 1,
    km: 1000,
    in: 0.0254,
    ft: 0.3048,
    yd: 0.9144,
    mi: 1609.344,
    nmi: 1852,
    thou: 0.0000254,
    furlong: 201.168,
    ly: 9.4607304725808e15,
  },
  mass: {
    mg: 0.000001,
    g: 0.001,
    kg: 1,
    t: 1000,
    oz: 0.0283495231,
    lb: 0.45359237,
    st: 6.35029318,
    "us-ton": 907.18474,
    "uk-ton": 1016.0469088,
    carat: 0.0002,
  },
  area: {
    mm2: 0.000001,
    cm2: 0.0001,
    m2: 1,
    km2: 1e6,
    in2: 0.00064516,
    ft2: 0.09290304,
    yd2: 0.83612736,
    acre: 4046.8564224,
    hectare: 10000,
    mi2: 2589988.110336,
  },
  volume: {
    ml: 0.000001,
    l: 0.001,
    m3: 1,
    tsp: 4.92892159e-6,
    tbsp: 1.47867648e-5,
    "fl-oz": 2.95735296e-5,
    cup: 2.365882365e-4,
    pint: 4.73176473e-4,
    quart: 9.46352946e-4,
    gallon: 0.003785411784,
    "imp-gallon": 0.00454609,
    ft3: 0.028316846592,
  },
  speed: {
    "m/s": 1,
    "km/h": 0.2777777778,
    mph: 0.44704,
    knot: 0.5144444444,
    "ft/s": 0.3048,
    mach: 340.29,
  },
  data: {
    bit: 0.125,
    B: 1,
    KB: 1000,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    PB: 1e15,
    KiB: 1024,
    MiB: 1048576,
    GiB: 1073741824,
    TiB: 1099511627776,
  },
  time: {
    ms: 0.001,
    s: 1,
    min: 60,
    h: 3600,
    day: 86400,
    week: 604800,
    month: 2629746,
    year: 31556952,
  },
  pressure: { pa: 1, kpa: 1000, bar: 100000, psi: 6894.757293, atm: 101325, mmhg: 133.322387415 },
  energy: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6, btu: 1055.05585262 },
  angle: { deg: 1, rad: 57.2957795131, grad: 0.9, turn: 360, arcmin: 1 / 60, arcsec: 1 / 3600 },
};

export const TEMPERATURE_UNITS = ["c", "f", "k", "r"] as const;

export function toCelsius(value: number, unit: string): number {
  switch (unit) {
    case "f":
      return ((value - 32) * 5) / 9;
    case "k":
      return value - 273.15;
    case "r":
      return ((value - 491.67) * 5) / 9;
    default:
      return value;
  }
}

export function fromCelsius(celsius: number, unit: string): number {
  switch (unit) {
    case "f":
      return (celsius * 9) / 5 + 32;
    case "k":
      return celsius + 273.15;
    case "r":
      return ((celsius + 273.15) * 9) / 5;
    default:
      return celsius;
  }
}

/** Words people actually type, mapped to the symbols the tables above use. */
const UNIT_ALIASES: Record<string, string> = {
  millimeter: "mm",
  millimetre: "mm",
  centimeter: "cm",
  centimetre: "cm",
  meter: "m",
  metre: "m",
  kilometer: "km",
  kilometre: "km",
  inch: "in",
  inches: "in",
  foot: "ft",
  feet: "ft",
  yard: "yd",
  mile: "mi",
  "nautical-mile": "nmi",
  lightyear: "ly",
  "light-year": "ly",
  milligram: "mg",
  gram: "g",
  kilogram: "kg",
  kilo: "kg",
  tonne: "t",
  ounce: "oz",
  pound: "lb",
  lbs: "lb",
  stone: "st",
  hectare: "hectare",
  ha: "hectare",
  sqm: "m2",
  sqft: "ft2",
  sqkm: "km2",
  sqmi: "mi2",
  milliliter: "ml",
  millilitre: "ml",
  liter: "l",
  litre: "l",
  gal: "gallon",
  teaspoon: "tsp",
  tablespoon: "tbsp",
  floz: "fl-oz",
  "fluid-ounce": "fl-oz",
  pt: "pint",
  qt: "quart",
  kph: "km/h",
  kmh: "km/h",
  kmph: "km/h",
  knots: "knot",
  kn: "knot",
  mps: "m/s",
  fps: "ft/s",
  byte: "B",
  kilobyte: "KB",
  megabyte: "MB",
  gigabyte: "GB",
  terabyte: "TB",
  petabyte: "PB",
  kibibyte: "KiB",
  mebibyte: "MiB",
  gibibyte: "GiB",
  tebibyte: "TiB",
  millisecond: "ms",
  sec: "s",
  second: "s",
  minute: "min",
  hour: "h",
  hr: "h",
  days: "day",
  weeks: "week",
  months: "month",
  yr: "year",
  pascal: "pa",
  kilopascal: "kpa",
  torr: "mmhg",
  joule: "j",
  kilojoule: "kj",
  calorie: "cal",
  kilocalorie: "kcal",
  "watt-hour": "wh",
  "kilowatt-hour": "kwh",
  degree: "deg",
  "°": "deg",
  radian: "rad",
  gradian: "grad",
  revolution: "turn",
  celsius: "c",
  centigrade: "c",
  fahrenheit: "f",
  kelvin: "k",
  rankine: "r",
};

/** Turns "Miles", "kilometers" or "°F" into the key a unit table uses, or undefined. */
function normaliseUnit(raw: string): string {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/^°(?=[cfkr]$)/, "")
    .replace(/\s+/g, "-");
  if (UNIT_ALIASES[word]) return UNIT_ALIASES[word]!;
  if (word.endsWith("s") && UNIT_ALIASES[word.slice(0, -1)])
    return UNIT_ALIASES[word.slice(0, -1)]!;
  return word;
}

function findUnitKey(table: Record<string, number>, raw: string): string | undefined {
  const exact = Object.keys(table).find((k) => k === raw.trim());
  if (exact) return exact;
  const word = normaliseUnit(raw);
  const singular = word.endsWith("s") ? word.slice(0, -1) : word;
  return Object.keys(table).find((k) => [word, singular].includes(k.toLowerCase()));
}

/** The family both units belong to, so "10 kg to lb" works without picking "Mass" first. */
export function detectUnitFamily(from: string, to: string, preferred: string): string {
  const both = (family: string) =>
    family === "temperature"
      ? TEMPERATURE_UNITS.includes(normaliseUnit(from) as never) &&
        TEMPERATURE_UNITS.includes(normaliseUnit(to) as never)
      : Boolean(
          UNITS[family] && findUnitKey(UNITS[family]!, from) && findUnitKey(UNITS[family]!, to),
        );
  if (both(preferred)) return preferred;
  return ["temperature", ...Object.keys(UNITS)].find(both) ?? preferred;
}

export function convertUnit(value: number, from: string, to: string, family: string): number {
  if (family === "temperature") {
    const f = normaliseUnit(from);
    const t = normaliseUnit(to);
    if (
      !(TEMPERATURE_UNITS as readonly string[]).includes(f) ||
      !(TEMPERATURE_UNITS as readonly string[]).includes(t)
    ) {
      throw unsupported("Temperature units are C, F, K or R (Rankine).");
    }
    return fromCelsius(toCelsius(value, f), t);
  }
  const table = UNITS[family];
  if (!table) throw unsupported(`"${family}" is not a unit family this tool knows.`);
  const fromKey = findUnitKey(table, from);
  const toKey = findUnitKey(table, to);
  if (!fromKey)
    throw unsupported(
      `"${from}" is not a ${family} unit. Try: ${Object.keys(table).slice(0, 8).join(", ")}.`,
    );
  if (!toKey)
    throw unsupported(
      `"${to}" is not a ${family} unit. Try: ${Object.keys(table).slice(0, 8).join(", ")}.`,
    );
  return (value * table[fromKey]!) / table[toKey]!;
}

function tidy(n: number): number {
  if (!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  const places = abs === 0 ? 0 : abs < 0.001 ? 10 : abs < 1 ? 6 : abs < 1000 ? 4 : 2;
  return Number(n.toFixed(places));
}

export const unitConverterExecutor: Executor = (input, options) =>
  runUtilTool("unit-converter", async () => {
    const chosenFamily = optEnum(
      options,
      "family",
      [
        "length",
        "mass",
        "temperature",
        "area",
        "volume",
        "speed",
        "data",
        "time",
        "pressure",
        "energy",
        "angle",
      ] as const,
      "length",
    );
    const typed = typeof input === "string" ? input.trim() : "";
    // "12 km to mi" is how people actually type this, so parse it when it is offered.
    const shorthand = /^(-?[\d.]+)\s*([^\s]+)\s*(?:to|in|->|=)\s*([^\s]+)$/i.exec(typed);
    const value = shorthand
      ? Number(shorthand[1])
      : typed !== "" && Number.isFinite(Number(typed))
        ? Number(typed)
        : optNumber(options, "value", 1, { min: -1e15, max: 1e15 });
    const from = shorthand
      ? shorthand[2]!
      : optString(options, "from", chosenFamily === "temperature" ? "c" : "km");
    const to = shorthand
      ? shorthand[3]!
      : optString(options, "to", chosenFamily === "temperature" ? "f" : "mi");
    const family = detectUnitFamily(from, to, chosenFamily);
    const converted = convertUnit(value, from, to, family);
    const table =
      family === "temperature"
        ? TEMPERATURE_UNITS.map((u) => ({
            unit: u.toUpperCase(),
            value: tidy(convertUnit(value, from, u, family)),
          }))
        : Object.keys(UNITS[family]!).map((u) => ({
            unit: u,
            value: tidy(convertUnit(value, from, u, family)),
          }));
    return {
      ok: true,
      output: {
        value,
        from,
        to,
        family,
        converted: tidy(converted),
        all: table,
        result: `${tidy(converted)} ${to}`,
      },
      summary: `${value} ${from} = ${tidy(converted)} ${to}.`,
      files: [],
    };
  });

// ---- lorem ipsum / placeholders ---------------------------------------------------------------

const LOREM_WORDS = `lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco
laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse
cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui
officia deserunt mollit anim id est laborum`
  .split(/\s+/)
  .filter(Boolean);

export function loremWords(count: number): string {
  return Array.from({ length: count }, () => LOREM_WORDS[randomInt(LOREM_WORDS.length)]!).join(" ");
}

export function loremSentence(): string {
  const text = loremWords(randomInt(6, 18));
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function loremParagraph(sentences = randomInt(3, 7)): string {
  return Array.from({ length: sentences }, loremSentence).join(" ");
}

/** A placeholder image as SVG, with its own dimensions printed on it. No raster encoder needed. */
export function placeholderSvg(width: number, height: number, label?: string): string {
  const text = label ?? `${width} × ${height}`;
  const size = Math.max(11, Math.min(width, height) / 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text}">
  <rect width="${width}" height="${height}" fill="#1a1e23"/>
  <path d="M0 0 L${width} ${height} M${width} 0 L0 ${height}" stroke="#2f353d" stroke-width="1"/>
  <text x="50%" y="50%" fill="#a3acb8" font-family="ui-monospace, monospace" font-size="${size.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
}

export function placeholderJson(count: number): unknown[] {
  const first = [
    "Ada",
    "Grace",
    "Alan",
    "Katherine",
    "Linus",
    "Radia",
    "Barbara",
    "Tim",
    "Anita",
    "Guido",
  ];
  const last = [
    "Lovelace",
    "Hopper",
    "Turing",
    "Johnson",
    "Torvalds",
    "Perlman",
    "Liskov",
    "Berners-Lee",
    "Borg",
    "van Rossum",
  ];
  return Array.from({ length: count }, (_, i) => {
    const f = first[randomInt(first.length)]!;
    const l = last[randomInt(last.length)]!;
    return {
      id: i + 1,
      name: `${f} ${l}`,
      email: `${f.toLowerCase()}.${l.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
      active: randomInt(4) > 0,
      joined: new Date(Date.now() - randomInt(1, 900) * 86_400_000).toISOString().slice(0, 10),
      score: randomInt(0, 101),
    };
  });
}

export const loremIpsumExecutor: Executor = (_input, options) =>
  runUtilTool("lorem-ipsum-generator", async () => {
    const kind = optEnum(
      options,
      "kind",
      ["paragraphs", "sentences", "words", "json", "image"] as const,
      "paragraphs",
    );
    const count = optNumber(options, "count", kind === "words" ? 50 : 3, { min: 1, max: 500 });

    if (kind === "image") {
      const width = optNumber(options, "width", 640, { min: 16, max: 4000 });
      const height = optNumber(options, "height", 360, { min: 16, max: 4000 });
      const svg = placeholderSvg(width, height, optString(options, "label", "") || undefined);
      return {
        ok: true,
        output: { width, height, result: svg },
        summary: `Placeholder image, ${width} × ${height}. It is an SVG, so it stays sharp at any size.`,
        files: [textFile(`placeholder-${width}x${height}.svg`, "image/svg+xml", svg)],
      };
    }
    if (kind === "json") {
      const rows = placeholderJson(count);
      const text = JSON.stringify(rows, null, 2) + "\n";
      return {
        ok: true,
        output: { rows, result: text },
        summary: `Generated ${plural(count, "placeholder record")}. Every name is a well-known computer scientist and every address is @example.com, so nothing here is a real person's data.`,
        files: [textFile("placeholder.json", MIME.json, text)],
      };
    }

    const startClassic = optBool(options, "classicOpening", true);
    let text: string;
    if (kind === "words") text = loremWords(count);
    else if (kind === "sentences") text = Array.from({ length: count }, loremSentence).join(" ");
    else text = Array.from({ length: count }, () => loremParagraph()).join("\n\n");
    if (startClassic && kind !== "words") {
      text = text.replace(/^[^.]*\./, "Lorem ipsum dolor sit amet, consectetur adipiscing elit.");
    }
    const wrapped = optBool(options, "html", false)
      ? text
          .split("\n\n")
          .map((p) => `<p>${p}</p>`)
          .join("\n")
      : text;
    return {
      ok: true,
      output: { kind, count, characters: wrapped.length, result: wrapped },
      summary: `Generated ${plural(count, kind.replace(/s$/, ""))} — ${wrapped.length} characters.`,
      files: [
        textFile(
          "lorem.txt",
          optBool(options, "html", false) ? MIME.html : MIME.txt,
          wrapped + "\n",
        ),
      ],
    };
  });

// ---- readability ------------------------------------------------------------------------------

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  characters: number;
  complexWords: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  gunningFog: number;
  smog: number;
  colemanLiau: number;
  automatedReadability: number;
  averageGrade: number;
  band: string;
  readingMinutes: number;
}

/** A well-known heuristic: count vowel groups, drop a silent trailing "e", never go below one. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

export function analyseReadability(text: string): Readability {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const sentenceCount = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syllablesPerWord = words.map(countSyllables);
  const syllables = syllablesPerWord.reduce((a, b) => a + b, 0);
  const complex = syllablesPerWord.filter((n) => n >= 3).length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const wordCount = Math.max(1, words.length);

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWordAvg = syllables / wordCount;
  const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWordAvg;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWordAvg - 15.59;
  const fog = 0.4 * (wordsPerSentence + 100 * (complex / wordCount));
  const smog = 1.043 * Math.sqrt(complex * (30 / sentenceCount)) + 3.1291;
  const L = (letters / wordCount) * 100;
  const S = (sentenceCount / wordCount) * 100;
  const colemanLiau = 0.0588 * L - 0.296 * S - 15.8;
  const ari = 4.71 * (letters / wordCount) + 0.5 * wordsPerSentence - 21.43;

  const grades = [grade, fog, smog, colemanLiau, ari].map((g) => Math.max(1, g));
  const averageGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    words: words.length,
    sentences: sentenceCount,
    syllables,
    characters: text.length,
    complexWords: complex,
    fleschReadingEase: round1(ease),
    fleschKincaidGrade: round1(grade),
    gunningFog: round1(fog),
    smog: round1(smog),
    colemanLiau: round1(colemanLiau),
    automatedReadability: round1(ari),
    averageGrade: round1(averageGrade),
    band:
      ease >= 90
        ? "very easy — a 5th-grader could read it"
        : ease >= 70
          ? "easy — comfortable for most adults"
          : ease >= 60
            ? "plain English — the level most writing guides aim for"
            : ease >= 50
              ? "fairly hard — high-school level"
              : ease >= 30
                ? "hard — undergraduate level"
                : "very hard — dense, specialist prose",
    readingMinutes: Math.max(1, Math.round(words.length / 225)),
  };
}

export const readabilityExecutor: Executor = (input, options, ctx) =>
  runUtilTool("readability-score-checker", async () => {
    const src = await readTextSource(input, ctx, "text", { stem: "text" });
    const report = analyseReadability(src.text);
    const files: OutputFile[] = optBool(options, "saveReport", false)
      ? [textFile("readability.json", MIME.json, JSON.stringify(report, null, 2) + "\n")]
      : [];
    return {
      ok: true,
      output: {
        ...report,
        result: `Reading ease ${report.fleschReadingEase} (grade ${report.averageGrade})`,
      },
      summary: `Flesch reading ease ${report.fleschReadingEase} — ${report.band}. Around grade ${report.averageGrade} across five measures, ${report.words} words in ${report.sentences} sentences, about ${report.readingMinutes} minute${report.readingMinutes === 1 ? "" : "s"} to read.`,
      files,
    };
  });

export { requireText };
