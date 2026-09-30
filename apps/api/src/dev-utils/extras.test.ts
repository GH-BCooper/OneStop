// Tests for the everyday utilities added after the end-to-end QA pass (docs/build/22-everyday-
// utilities.md): Word Counter, Line Sorter & Cleaner, HTML Entity Converter, Number Base Converter,
// Date Calculator, Percentage Calculator and the YAML Formatter & Validator.
//
// As with phase 21, the unit tests aim at the places where "it ran" and "it is right" differ: a
// leap-year boundary, a month that has no 31st, ISO week 53, a percentage that must keep its
// decimals, a Roman numeral, an entity that is not real. Then one offline suite runs all of them with
// the network trapped and records what it proved for `VERIFIED_OFFLINE`.
import http from "node:http";
import https from "node:https";
import { getExecutor, getTool, tools } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";
import { afterEach, describe, expect, it } from "vitest";
import "../index.ts";
import { recordOfflineCoverage } from "../../../../tests/offline/coverage.ts";
import {
  addToDate,
  analyseText,
  businessDaysBetween,
  calendarDifference,
  decodeHtmlEntities,
  encodeHtmlEntities,
  isoWeek,
  parseDate,
  parseInteger,
  percentage,
  processLines,
  toRoman,
  type LineOptions,
} from "./extras.ts";

async function run(
  id: string,
  input: { name: string; text: string }[] | string | null,
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  const tool = getTool(id);
  expect(tool, `no registry entry for ${id}`).toBeDefined();
  const files = Array.isArray(input) ? input : [];
  const refs: FileRef[] = files.map((f, i) => ({
    name: f.name,
    size: f.text.length,
    type: "",
    tempId: `t-${i}`,
  }));
  const ctx: ExecContext = {
    jobId: "test",
    readFile: async (ref) =>
      new TextEncoder().encode(files[refs.findIndex((r) => r.tempId === ref.tempId)]!.text),
  };
  return getExecutor(tool!)(Array.isArray(input) ? refs : input, options, ctx);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  expect(result.ok, result.ok ? "" : `${result.code}: ${result.message}`).toBe(true);
  return result as Extract<ExecResult, { ok: true }>;
}
function fail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  expect(result.ok).toBe(false);
  return result as Extract<ExecResult, { ok: false }>;
}

describe("Word Counter", () => {
  it("counts words, sentences and paragraphs the way a writer means them", () => {
    const r = analyseText("Hello world. This is a test!\n\nSecond paragraph here? Yes.");
    expect(r.words).toBe(10);
    expect(r.sentences).toBe(4);
    expect(r.paragraphs).toBe(2);
    expect(r.longestWord).toBe("paragraph");
  });

  it("treats contractions and hyphenated words as one word, and counts non-Latin scripts", () => {
    expect(analyseText("don't stop well-known").words).toBe(3);
    expect(analyseText("こんにちは 世界 Привет мир").words).toBe(4);
  });

  it("counts characters as people see them, not as UTF-16 units", () => {
    expect(analyseText("a😀b").characters).toBe(3);
    expect(analyseText("a b c").charactersNoSpaces).toBe(3);
  });

  it("lists keywords without everyday words, most used first", () => {
    const r = analyseText("Apples and oranges. Apples are red. Oranges are orange. Apples!", 2);
    expect(r.keywords.map((k) => k.word)).toEqual(["apples", "oranges"]);
    expect(r.keywords[0]).toMatchObject({ count: 3 });
  });

  it("handles empty-looking input without dividing by zero", async () => {
    const r = analyseText("... !!!");
    expect(r.words).toBe(0);
    expect(r.averageWordLength).toBe(0);
    expect(fail(await run("word-counter", "   ")).message).toMatch(/paste|choose/i);
  });

  it("works on an uploaded text file and can save a report", async () => {
    const r = ok(
      await run("word-counter", [{ name: "essay.txt", text: "One two three." }], {
        saveReport: true,
      }),
    );
    expect(r.summary).toMatch(/3 words/);
    expect(r.files?.[0]?.name).toBe("word-count.json");
  });
});

describe("Line Sorter & Cleaner", () => {
  const base: LineOptions = {
    trim: true,
    removeEmpty: true,
    dedupe: false,
    ignoreCase: false,
    sort: "none",
    prefix: "",
    suffix: "",
    numberLines: false,
  };

  it("trims, drops empty lines and ignores the phantom line after a final newline", () => {
    expect(processLines("  b \n\n a\n", base).lines).toEqual(["b", "a"]);
    expect(processLines("a\nb\n", { ...base, removeEmpty: false }).lines).toEqual(["a", "b"]);
  });

  it("removes duplicates keeping the first, with or without case", () => {
    const text = "Apple\napple\nPear\nApple";
    expect(processLines(text, { ...base, dedupe: true }).lines).toEqual(["Apple", "apple", "Pear"]);
    const ci = processLines(text, { ...base, dedupe: true, ignoreCase: true });
    expect(ci.lines).toEqual(["Apple", "Pear"]);
    expect(ci.duplicatesRemoved).toBe(2);
  });

  it("sorts alphabetically, naturally and by length", () => {
    const text = "file10\nfile2\nFile1\nb";
    expect(processLines(text, { ...base, sort: "az", ignoreCase: true }).lines).toEqual([
      "b",
      "File1",
      "file10",
      "file2",
    ]);
    expect(processLines(text, { ...base, sort: "natural", ignoreCase: true }).lines).toEqual([
      "b",
      "File1",
      "file2",
      "file10",
    ]);
    expect(processLines(text, { ...base, sort: "shortest" }).lines[0]).toBe("b");
    expect(processLines("a\nb\nc", { ...base, sort: "reverse" }).lines).toEqual(["c", "b", "a"]);
  });

  it("shuffles without losing or inventing a line", () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const shuffled = processLines(text, { ...base, sort: "shuffle" }).lines;
    expect([...shuffled].sort()).toEqual(text.split("\n").sort());
  });

  it("adds a prefix, suffix and right-aligned numbers", () => {
    const lines = processLines(Array.from({ length: 10 }, (_, i) => `x${i}`).join("\n"), {
      ...base,
      prefix: "- ",
      suffix: ";",
      numberLines: true,
    }).lines;
    expect(lines[0]).toBe(" 1. - x0;");
    expect(lines[9]).toBe("10. - x9;");
  });

  it("names the download sensibly and reports what it did", async () => {
    const r = ok(await run("line-sorter-and-cleaner", "b\na\n\nb", { sort: "az", dedupe: true }));
    expect(r.files?.[0]?.name).toBe("lines-cleaned.txt");
    expect(r.summary).toMatch(/4 lines in, 2 lines out/);
    expect((r.output as { result: string }).result).toBe("a\nb");
  });
});

describe("HTML Entity Converter", () => {
  it("escapes the five characters that matter, and only those by default", () => {
    expect(encodeHtmlEntities(`<a href="x">Tom & 'Jerry'</a> é`, { nonAscii: false })).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt; é",
    );
  });

  it("can also encode non-ASCII, preferring the readable name", () => {
    expect(encodeHtmlEntities("© é 😀", { nonAscii: true })).toBe("&copy; &eacute; &#128512;");
  });

  it("decodes named, decimal and hex entities, and leaves what it does not know", () => {
    const r = decodeHtmlEntities("&lt;b&gt; &amp;amp; &#65;&#x42; &copy; &notreal; &#99999999;");
    expect(r.text).toBe("<b> &amp; AB © &notreal; &#99999999;");
    expect(r.unknown).toEqual(["&notreal;", "&#99999999;"]);
  });

  it("round-trips arbitrary text", () => {
    const text = `Fish & Chips <"quoted"> 'single' café ©`;
    expect(decodeHtmlEntities(encodeHtmlEntities(text, { nonAscii: true })).text).toBe(text);
  });

  it("does not double-decode (&amp;lt; is the text &lt;, not <)", () => {
    expect(decodeHtmlEntities("&amp;lt;").text).toBe("&lt;");
  });
});

describe("Number Base Converter", () => {
  it("reads prefixes and bare digits, with underscores and signs", () => {
    expect(parseInteger("0xFF", "auto").value).toBe(255n);
    expect(parseInteger("0b1010", "auto").value).toBe(10n);
    expect(parseInteger("0o17", "auto").value).toBe(15n);
    expect(parseInteger("1_000", "auto").value).toBe(1000n);
    expect(parseInteger("-42", "auto").value).toBe(-42n);
    expect(parseInteger("ff", 16).value).toBe(255n);
    expect(parseInteger("0xff", 16).value).toBe(255n);
    expect(parseInteger("zz", 36).value).toBe(1295n);
  });

  it("refuses a digit that does not belong to the base, and says which", () => {
    expect(() => parseInteger("12", 2)).toThrow(/"2" is not a base-2 digit/);
    expect(() => parseInteger("0xZZ", "auto")).toThrow(/not a base-16 digit/);
    expect(() => parseInteger("", "auto")).toThrow(/whole number/);
  });

  it("is exact beyond 2^53, where a JavaScript number would not be", async () => {
    const r = ok(await run("number-base-converter", "9007199254740993"));
    expect((r.output as { hexadecimal: string }).hexadecimal).toBe("20000000000001");
  });

  it("writes Roman numerals only where they exist", () => {
    expect(toRoman(1994)).toBe("MCMXCIV");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(0)).toBeNull();
    expect(toRoman(4000)).toBeNull();
  });

  it("converts to every base in one go", async () => {
    const r = ok(await run("number-base-converter", "255")).output as Record<string, unknown>;
    expect(r).toMatchObject({
      decimal: "255",
      binary: "11111111",
      octal: "377",
      hexadecimal: "FF",
      base36: "73",
      bits: 8,
      bytes: 1,
    });
    const neg = ok(await run("number-base-converter", "-10")).output as Record<string, unknown>;
    expect(neg).toMatchObject({ binary: "-1010", hexadecimal: "-A", roman: null });
  });
});

describe("Date Calculator", () => {
  const d = (s: string) => parseDate(s, "Date");
  const iso = (x: Date) => x.toISOString().slice(0, 10);

  it("reads ISO, day-first and month-first dates, and refuses impossible ones", () => {
    expect(iso(d("2026-03-15"))).toBe("2026-03-15");
    expect(iso(d("15 March 2026"))).toBe("2026-03-15");
    expect(iso(d("Mar 15, 2026"))).toBe("2026-03-15");
    expect(iso(d("March 5th, 2026"))).toBe("2026-03-05");
    expect(() => d("2026-02-30")).toThrow(/does not exist/);
    expect(() => d("2026-13-01")).toThrow();
    expect(() => d("yesterday")).toThrow(/enter a date like/i);
    expect(() => d("Ma 5, 2026")).toThrow();
  });

  it("knows leap years: 29 February exists in 2028 and 2000, not in 2027 or 1900", () => {
    expect(iso(d("2028-02-29"))).toBe("2028-02-29");
    expect(iso(d("2000-02-29"))).toBe("2000-02-29");
    expect(() => d("2027-02-29")).toThrow();
    expect(() => d("1900-02-29")).toThrow();
  });

  it("adds days across a year and a leap day", () => {
    expect(iso(addToDate(d("2027-12-31"), 60, "days"))).toBe("2028-02-29");
    expect(iso(addToDate(d("2026-03-01"), -1, "days"))).toBe("2026-02-28");
  });

  it("clamps month arithmetic instead of overflowing: 31 January plus a month is the end of February", () => {
    expect(iso(addToDate(d("2027-01-31"), 1, "months"))).toBe("2027-02-28");
    expect(iso(addToDate(d("2028-01-31"), 1, "months"))).toBe("2028-02-29");
    expect(iso(addToDate(d("2028-02-29"), 1, "years"))).toBe("2029-02-28");
    expect(iso(addToDate(d("2026-11-15"), 3, "months"))).toBe("2027-02-15");
    expect(iso(addToDate(d("2026-01-15"), -2, "months"))).toBe("2025-11-15");
  });

  it("adds business days, skipping weekends both ways", () => {
    // Friday 2026-03-13 + 1 business day is Monday the 16th.
    expect(iso(addToDate(d("2026-03-13"), 1, "business-days"))).toBe("2026-03-16");
    expect(iso(addToDate(d("2026-03-16"), -1, "business-days"))).toBe("2026-03-13");
    expect(iso(addToDate(d("2026-03-13"), 10, "business-days"))).toBe("2026-03-27");
  });

  it("says how far apart two dates are in years, months and days", () => {
    expect(calendarDifference(d("2026-01-31"), d("2026-03-01"))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
    // 29 February plus 26 years is 28 February (the clamping "add years" uses), so this is exact.
    expect(calendarDifference(d("2000-02-29"), d("2026-02-28"))).toEqual({
      years: 26,
      months: 0,
      days: 0,
    });
    expect(calendarDifference(d("2000-02-29"), d("2026-02-27"))).toEqual({
      years: 25,
      months: 11,
      days: 29,
    });
    expect(calendarDifference(d("2025-12-25"), d("2026-01-05"))).toEqual({
      years: 0,
      months: 0,
      days: 11,
    });
    expect(calendarDifference(d("2026-03-01"), d("2026-01-31"))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
  });

  it("counts weekdays between two dates", () => {
    // Monday 2026-03-02 to Monday 2026-03-09: five weekdays.
    expect(businessDaysBetween(d("2026-03-02"), d("2026-03-09"))).toBe(5);
    expect(businessDaysBetween(d("2026-03-07"), d("2026-03-09"))).toBe(0); // Saturday to Monday
    expect(businessDaysBetween(d("2026-03-02"), d("2026-03-02"))).toBe(0);
  });

  it("gets the ISO week right at the awkward year boundaries", () => {
    expect(isoWeek(d("2026-01-01"))).toEqual({ year: 2026, week: 1 });
    expect(isoWeek(d("2020-12-31"))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(d("2021-01-01"))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(d("2024-12-30"))).toEqual({ year: 2025, week: 1 });
  });

  it("runs all three modes end to end", async () => {
    const diff = ok(
      await run("date-calculator", null, {
        mode: "difference",
        start: "2026-01-01",
        end: "2026-12-25",
      }),
    );
    expect(diff.output).toMatchObject({
      totalDays: 358,
      weeks: 51,
      remainderDays: 1,
      months: 11,
      days: 24,
    });
    const add = ok(
      await run("date-calculator", null, {
        mode: "add",
        start: "2026-03-15",
        amount: 30,
        unit: "days",
      }),
    );
    expect((add.output as { date: string }).date).toBe("2026-04-14");
    const info = ok(await run("date-calculator", null, { mode: "info", start: "2026-03-15" }));
    expect(info.output).toMatchObject({
      weekday: "Sunday",
      dayOfYear: 74,
      quarter: 1,
      leapYear: false,
    });
  });

  it("notes when the end date is before the start date rather than pretending it is not", async () => {
    const r = ok(
      await run("date-calculator", null, {
        mode: "difference",
        start: "2026-12-25",
        end: "2026-01-01",
      }),
    );
    expect(r.summary).toMatch(/before the start/i);
    expect((r.output as { totalDays: number }).totalDays).toBe(358);
  });

  it("names the field that is wrong", async () => {
    expect(
      fail(await run("date-calculator", null, { mode: "difference", start: "nonsense" })).message,
    ).toMatch(/^Start date:/);
    expect(
      fail(
        await run("date-calculator", null, {
          mode: "difference",
          start: "2026-01-01",
          end: "2026-02-31",
        }),
      ).message,
    ).toMatch(/^End date:/);
  });
});

describe("Percentage Calculator", () => {
  it("does the six common questions", () => {
    expect(percentage("of", 15, 240).value).toBe(36);
    expect(percentage("what-percent", 36, 240).value).toBe(15);
    expect(percentage("change", 80, 100).value).toBe(25);
    expect(percentage("change", 100, 80).value).toBe(-20);
    expect(percentage("increase", 10, 200).value).toBeCloseTo(220);
    expect(percentage("decrease", 25, 200).value).toBe(150);
    expect(percentage("reverse", 30, 15).value).toBe(200);
  });

  it("measures change against the size of the start, even when it is negative", () => {
    expect(percentage("change", -50, -25).value).toBe(50);
  });

  it("refuses to divide by zero with a sentence that says why", () => {
    expect(() => percentage("what-percent", 5, 0)).toThrow(/zero/);
    expect(() => percentage("change", 0, 5)).toThrow(/zero/);
    expect(() => percentage("reverse", 5, 0)).toThrow(/zero/);
  });

  it("keeps decimals in its inputs (15.5% is not 16%) and rounds only the shown answer", async () => {
    const r = ok(
      await run("percentage-calculator", null, { mode: "of", a: 15.5, b: 200, decimals: 2 }),
    );
    expect((r.output as { result: number }).result).toBe(31);
    const third = ok(
      await run("percentage-calculator", null, { mode: "what-percent", a: 1, b: 3, decimals: 2 }),
    );
    expect((third.output as { result: number }).result).toBe(33.33);
    expect(third.summary).toMatch(/33\.33/);
    const tiny = ok(
      await run("percentage-calculator", null, { mode: "of", a: 0.1, b: 0.2, decimals: 4 }),
    );
    expect((tiny.output as { exact: number }).exact).toBeCloseTo(0.0002, 10);
  });

  it("accepts numbers typed into a form as strings", async () => {
    const r = ok(await run("percentage-calculator", null, { mode: "of", a: "12.5", b: "80" }));
    expect((r.output as { result: number }).result).toBe(10);
  });
});

describe("YAML Formatter & Validator", () => {
  it("reformats with the chosen indent and says comments are lost", async () => {
    const r = ok(
      await run("yaml-formatter-and-validator", "a:\n      b: 1   # note\n      c: [1,2]\n", {
        indent: "2",
      }),
    );
    expect(new TextDecoder().decode(r.files![0]!.bytes)).toBe(
      "a:\n  b: 1\n  c:\n    - 1\n    - 2\n",
    );
    expect(r.summary).toMatch(/comments .* not kept/i);
  });

  it("keeps several documents separate", async () => {
    const r = ok(await run("yaml-formatter-and-validator", "a: 1\n---\nb: 2\n"));
    expect(new TextDecoder().decode(r.files![0]!.bytes)).toBe("a: 1\n---\nb: 2\n");
    expect((r.output as { documents: number }).documents).toBe(2);
  });

  it("points at the line and column of the first problem", async () => {
    const r = fail(await run("yaml-formatter-and-validator", "a: 1\nb: [1, 2\nc: 3\n"));
    expect(r.message).toMatch(/not valid/i);
    expect(r.message).toMatch(/Line \d+, column \d+/);
  });

  it("can only validate, without producing a file", async () => {
    const r = ok(await run("yaml-formatter-and-validator", "a: 1\n", { validateOnly: true }));
    expect(r.files).toEqual([]);
    expect(r.summary).toMatch(/valid YAML/i);
  });

  it("cannot be tricked into building objects: custom tags are refused", async () => {
    expect(
      fail(await run("yaml-formatter-and-validator", "a: !!js/function 'function(){}'\n")).ok,
    ).toBe(false);
  });
});

describe("registration", () => {
  const ids = [
    "word-counter",
    "line-sorter-and-cleaner",
    "html-entity-converter",
    "number-base-converter",
    "date-calculator",
    "percentage-calculator",
    "yaml-formatter-and-validator",
  ];
  it("every one is in the registry, available, phase 22, with options that have defaults", () => {
    for (const id of ids) {
      const tool = getTool(id);
      expect(tool, id).toBeDefined();
      expect(tool!.phase).toBe("22");
      expect(tool!.status).toBe("available");
    }
  });
});

describe("offline", () => {
  const saved = {
    fetch: globalThis.fetch,
    hg: http.get,
    hr: http.request,
    sg: https.get,
    sr: https.request,
  };
  afterEach(() => {
    globalThis.fetch = saved.fetch;
    http.get = saved.hg;
    http.request = saved.hr;
    https.get = saved.sg;
    https.request = saved.sr;
  });

  it("runs every one of them with the network trapped, and records the proof", async () => {
    const trap = () => {
      throw new Error("network used");
    };
    globalThis.fetch = trap as unknown as typeof fetch;
    http.get = trap as unknown as typeof http.get;
    http.request = trap as unknown as typeof http.request;
    https.get = trap as unknown as typeof https.get;
    https.request = trap as unknown as typeof https.request;
    const cases: Record<string, [Parameters<typeof run>[1], Record<string, unknown>?]> = {
      "word-counter": ["The quick brown fox jumps over the lazy dog."],
      "line-sorter-and-cleaner": ["b\na\nb", { sort: "az", dedupe: true }],
      "html-entity-converter": ["<b>Tom & Jerry</b>"],
      "number-base-converter": ["0xFF"],
      "date-calculator": [null, { mode: "difference", start: "2026-01-01", end: "2026-03-01" }],
      "percentage-calculator": [null, { mode: "of", a: 15, b: 240 }],
      "yaml-formatter-and-validator": ["a: 1\nb:\n  - 2\n"],
    };
    const proved: string[] = [];
    for (const [id, [input, options]] of Object.entries(cases)) {
      ok(await run(id, input, options ?? {}));
      proved.push(id);
    }
    const claimed = tools.filter((t) => t.phase === "22" && t.offline).map((t) => t.id);
    expect([...claimed].sort()).toEqual([...proved].sort());
    recordOfflineCoverage("everyday-utilities", proved);
  });
});
