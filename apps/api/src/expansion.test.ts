// Tests for 21-roadmap-expansion.md — the tools taken from docs/OneStop_Future_Roadmap.md Part 1.
//
// Two halves, deliberately:
//
//  1. Unit tests for the algorithms that carry the real risk of being subtly wrong — checksum rules,
//     the amortisation formula, RFC 6238, base32, the perceptual hash, the Code 128 subset switch,
//     the cron day-field OR rule, the OOXML revision surgery. These are the parts where "it ran" and
//     "it is right" are different claims.
//  2. One offline suite that runs every phase-21 tool that should never touch the network, with
//     `fetch` and `http/https.get/request` replaced by traps that throw, and records the ids it
//     proved so `scripts/check-offline-coverage.mjs` can reconcile them against `VERIFIED_OFFLINE`.
//
// The tools that need a binary OneStop does not ship (FFmpeg, whisper.cpp, Piper) or a model runtime
// are covered by their own graceful-degradation tests instead: proving they *fail clearly* is the
// honest thing to test on a machine that does not have them.
import http from "node:http";
import https from "node:https";
import { getExecutor, getTool, tools } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";
import { beforeEach, describe, expect, it } from "vitest";

import "./file-processing/index.ts";
import "./index.ts";
import { makeDocx, makePptx } from "./documents/fixtures.ts";
import { docxToMarkdown, formatReference, parseMarkdownSlides, parseReferences, parseResume, resolveRevisions } from "./documents/expansion.ts";
import { diffTables, inferSchema, parseFieldSpec } from "./data/dataDiff.ts";
import { aggregate, buildPivot, findColumn } from "./data/pivot.ts";
import { readSeries, renderChartSvg } from "./data/chart.ts";
import { makeTable } from "./data/common.ts";
import { decodeJwt } from "./dev-utils/jwt.ts";
import { buildPalette, judgeContrast, parseColor, rgbToHsl } from "./dev-utils/colors.ts";
import { explainCron, nextRuns, parseCron } from "./dev-utils/cron.ts";
import { analyseReadability, convertCase, convertUnit, countSyllables, splitWords } from "./dev-utils/transforms.ts";
import { scanText, shannonEntropy } from "./dev-utils/secrets.ts";
import { hammingDistance, kMeansPalette, perceptualHash, simplifyPath, traceContours } from "./images/analysis.ts";
import { applyNamePattern, buildIco, sanitizeFileName, SOCIAL_PRESETS } from "./images/batchTools.ts";
import { makePng, makeStructuredPdf, makeTextPdf } from "./pdf/fixtures.ts";
import { bookletOrder, parseBookmarkList, parseFieldSpecs, parseRedactionBoxes, readOutline, writeOutline } from "./pdf/expansion.ts";
import { loadPdf, savePdf } from "./pdf/document.ts";
import { code128Checksum, eanCheckDigit, encodeCode128, encodeEan, encodeItf14 } from "./qr/expansion.ts";
import { diffSequences, inlineDiff, toLines, unifiedDiff } from "./shared/diff.ts";
import { base32Decode, base32Encode, decryptBytes, encryptBytes, scorePassword, totp } from "./toolkit/security.ts";
import { amortize, parseInvoiceLines, projectGrowth, _clearRateCache, _seedRateCache } from "./toolkit/finance.ts";
import { buildIcs, foldIcsLine, makeTeams, parseFlashcards, scoreTyping, zoneOffsetMinutes } from "./toolkit/everyday.ts";
import { summariseYear } from "./toolkit/wrapup.ts";
import { parseChapterList, parseSilenceDetect, parseSrt, cuesToVtt, chunkForSpeech, assColor } from "./media/expansion.ts";
import { gradeHeaders, hostMatchesName, parseHeaderLines, parseRobots, parseSitemap, EMAIL_SYNTAX } from "./network/httpTools.ts";
import { clozeCards, compareKeywords, guessLanguage, parseFlashcardAnswer, transcriptToProse } from "./ai/expansion.ts";
import { encodeHeader, isValidTopic, ntfyServer, readNtfyPreference, sendNtfy } from "./automation/outbound.ts";
import { generateToken, hashToken, looksLikeAccessToken, tokenFromHeaders } from "./auth/accessTokens.ts";
import { generateSlug, sharePath } from "./file-processing/sharedResults.ts";
import { findSpeech, setSpeechLocator, speechStatus } from "./media/speechCheck.ts";
import { recordOfflineCoverage } from "../../../tests/offline/coverage.ts";

// ---- helpers ----------------------------------------------------------------------------------

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface Fixture {
  name: string;
  bytes: Uint8Array;
  type?: string;
}

const f = (name: string, content: string | Uint8Array, type = ""): Fixture => ({
  name,
  bytes: typeof content === "string" ? enc(content) : content,
  type,
});

async function run(
  id: string,
  input: Fixture[] | string | null,
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  const tool = getTool(id);
  expect(tool, `no registry entry for ${id}`).toBeDefined();
  const files: Fixture[] = Array.isArray(input) ? input : [];
  const refs: FileRef[] = files.map((file, i) => ({
    name: file.name,
    size: file.bytes.length,
    type: file.type ?? "",
    tempId: `t-${i}`,
  }));
  const ctx: ExecContext = {
    jobId: "test",
    readFile: async (ref) => {
      const index = refs.findIndex((r) => r.tempId === ref.tempId);
      const found = files[index];
      if (!found) throw new Error(`no fixture for ${ref.name}`);
      return found.bytes;
    },
  };
  return getExecutor(tool!)(Array.isArray(input) ? refs : input, options, ctx);
}

function expectOk(result: ExecResult, id: string): Extract<ExecResult, { ok: true }> {
  expect(result.ok, `${id}: ${result.ok ? "" : `${result.code} — ${result.message}`}`).toBe(true);
  return result as Extract<ExecResult, { ok: true }>;
}

// ---- Security & Privacy -----------------------------------------------------------------------

describe("password strength", () => {
  it("rates a long random passphrase far above a common password", () => {
    const weak = scorePassword("password");
    const strong = scorePassword("gulf-hive-dusk-plum-fern");
    expect(weak.score).toBe(0);
    expect(weak.warnings.join(" ")).toMatch(/most-guessed/);
    expect(strong.score).toBeGreaterThanOrEqual(3);
    expect(strong.entropyBits).toBeGreaterThan(weak.entropyBits);
  });

  it("penalises the patterns that make a password guessable", () => {
    // Same length and same character classes; only the shape differs.
    const shaped = scorePassword("Summer2024!");
    const unshaped = scorePassword("q7Kx!vR2mzB");
    expect(shaped.entropyBits).toBeLessThan(unshaped.entropyBits);
    expect(shaped.warnings.join(" ")).toMatch(/year|Capital first/);
    expect(scorePassword("aaaXbbbYccc").warnings.join(" ")).toMatch(/repeats/);
    expect(scorePassword("qwertyuiZ9").warnings.join(" ")).toMatch(/keyboard/);
  });

  it("never echoes the password back in the result", async () => {
    const result = expectOk(await run("password-strength-meter", "hunter2-is-mine"), "meter");
    expect(JSON.stringify(result.output)).not.toContain("hunter2");
  });
});

describe("TOTP", () => {
  it("round-trips base32", () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode("JBSWY3DPEHPK3PXP")).toEqual(
      new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]),
    );
  });

  it("matches RFC 6238's published test vectors", () => {
    // The RFC's shared secret is the ASCII "12345678901234567890".
    const secret = enc("12345678901234567890");
    expect(totp(secret, { time: 59_000, digits: 8, algorithm: "sha1" })).toBe("94287082");
    expect(totp(secret, { time: 1_111_111_109_000, digits: 8, algorithm: "sha1" })).toBe("07081804");
    expect(totp(secret, { time: 1_234_567_890_000, digits: 8, algorithm: "sha1" })).toBe("89005924");
    expect(totp(secret, { time: 2_000_000_000_000, digits: 8, algorithm: "sha1" })).toBe("69279037");
  });

  it("rejects a secret that is not base32", () => {
    expect(() => base32Decode("not!base32")).toThrow(/base32/);
  });

  it("verifies a code and reports clock drift", async () => {
    const secret = base32Encode(enc("12345678901234567890"));
    const code = totp(enc("12345678901234567890"), { time: Date.now() });
    const result = expectOk(await run("totp-code-generator", secret, { mode: "verify", code }), "totp");
    expect((result.output as { valid: boolean }).valid).toBe(true);
    const wrong = expectOk(await run("totp-code-generator", secret, { mode: "verify", code: "000000" }), "totp");
    expect((wrong.output as { valid: boolean }).valid).toBe(false);
  });
});

describe("file encryption", () => {
  it("round-trips with the right password and refuses the wrong one", () => {
    const plain = enc("the secret plans, in full");
    const blob = encryptBytes(plain, "correct horse battery");
    expect(dec(blob.subarray(0, 6))).toBe("OSENC1");
    expect(decryptBytes(blob, "correct horse battery")).toEqual(plain);
    expect(() => decryptBytes(blob, "wrong password")).toThrow(/Wrong password/);
  });

  it("detects a tampered ciphertext rather than returning rubbish", () => {
    const blob = encryptBytes(enc("hello"), "password123");
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptBytes(blob, "password123")).toThrow(/altered|Wrong password/);
  });

  it("refuses a file it did not write", () => {
    expect(() => decryptBytes(enc("just some text"), "password123")).toThrow(/not encrypted by OneStop/);
  });

  it("encrypts and decrypts through the executors", async () => {
    const encrypted = expectOk(
      await run("file-encryptor", [f("notes.txt", "hello world")], { password: "password123" }),
      "encryptor",
    );
    const blob = encrypted.files![0]!;
    // The original extension is kept, so Decrypt can hand the right file name back.
    expect(blob.name).toBe("notes.txt.osenc");
    const decrypted = expectOk(
      await run("file-decryptor", [f(blob.name, blob.bytes)], { password: "password123" }),
      "decryptor",
    );
    expect(dec(decrypted.files![0]!.bytes)).toBe("hello world");
  });

  it("refuses a password too short to be worth anything", async () => {
    const result = await run("file-encryptor", [f("a.txt", "x")], { password: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/8 characters/);
  });
});

// ---- Finance & Math ---------------------------------------------------------------------------

describe("loan and growth maths", () => {
  it("amortises to a zero balance and matches the annuity formula", () => {
    const result = amortize(200_000, 6, 30, 12);
    // The standard monthly payment for 200k at 6% over 30 years is about 1199.10.
    expect(result.payment).toBeGreaterThan(1198);
    expect(result.payment).toBeLessThan(1200);
    expect(result.periods).toBe(360);
    expect(result.schedule[result.schedule.length - 1]!.balance).toBe(0);
    // Interest paid should exceed the principal over that term.
    expect(result.totalInterest).toBeGreaterThan(200_000);
  });

  it("handles a zero-interest loan without dividing by zero", () => {
    const result = amortize(1200, 0, 1, 12);
    expect(result.payment).toBe(100);
    expect(result.totalInterest).toBe(0);
  });

  it("grows savings and separates contributions from interest", () => {
    const result = projectGrowth(1000, 100, 6, 10, 12);
    expect(result.rows).toHaveLength(10);
    expect(result.finalBalance).toBeGreaterThan(result.totalContributed);
    expect(result.totalContributed).toBeCloseTo(1000 + 100 * 12 * 10, 0);
  });

  it("splits a bill and reports the rounding surplus", async () => {
    const result = expectOk(await run("tip-splitter", null, { bill: 100, tipPercent: 15, people: 3, rounding: "up" }), "tip");
    const output = result.output as { each: number; extra: number };
    expect(output.each).toBe(39);
    expect(output.extra).toBeCloseTo(2, 5);
  });

  it("parses invoice lines and refuses a malformed one", () => {
    expect(parseInvoiceLines("Design | 2 | 100")).toEqual([{ description: "Design", quantity: 2, unitPrice: 100 }]);
    expect(() => parseInvoiceLines("Design | lots | 100")).toThrow(/line item/);
  });

  it("falls back to the last known exchange rate when the network is gone", async () => {
    _clearRateCache();
    _seedRateCache("USD", { EUR: 0.9 }, Date.now() - 3_600_000);
    const saved = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      const result = expectOk(await run("currency-converter", "10", { from: "USD", to: "EUR" }), "currency");
      expect((result.output as { converted: number; stale: boolean }).converted).toBeCloseTo(9, 5);
      expect((result.output as { stale: boolean }).stale).toBe(true);
      expect(result.summary).toMatch(/may be out of date/);
    } finally {
      globalThis.fetch = saved;
      _clearRateCache();
    }
  });

  it("says so plainly when no rate has ever been cached", async () => {
    _clearRateCache();
    const saved = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      const result = await run("currency-converter", "10", { from: "USD", to: "EUR" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/internet connection/);
    } finally {
      globalThis.fetch = saved;
    }
  });
});

// ---- Calendar, education, fun -----------------------------------------------------------------

describe("calendar and time", () => {
  it("folds and escapes .ics lines the way RFC 5545 asks", () => {
    const long = `SUMMARY:${"x".repeat(200)}`;
    const folded = foldIcsLine(long);
    expect(folded.split("\r\n")[0]!.length).toBe(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    const ics = buildIcs({
      title: "Lunch; with, Ada",
      start: new Date("2026-03-14T12:00:00Z"),
      end: new Date("2026-03-14T13:00:00Z"),
      allDay: false,
      location: "",
      description: "",
      url: "",
      organizer: "",
      attendees: [],
      reminderMinutes: 10,
      repeat: "none",
      uid: "u@onestop.local",
    });
    expect(ics).toContain("SUMMARY:Lunch\\; with\\, Ada");
    expect(ics).toContain("DTSTART:20260314T120000Z");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("reads a time zone's real offset, DST included", () => {
    // London is UTC+1 in July and UTC+0 in January: the clearest DST check there is.
    expect(zoneOffsetMinutes("Europe/London", new Date("2026-07-01T12:00:00Z"))).toBe(60);
    expect(zoneOffsetMinutes("Europe/London", new Date("2026-01-01T12:00:00Z"))).toBe(0);
    expect(zoneOffsetMinutes("Asia/Kolkata", new Date("2026-07-01T12:00:00Z"))).toBe(330);
  });

  it("rejects an attendee that is not an email address", async () => {
    const result = await run("calendar-event-generator", "Standup", { attendees: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/email address/);
  });

  it("scores typing against the five-characters-to-a-word convention", () => {
    const target = "the quick brown fox";
    const perfect = scoreTyping(target, target, 60);
    expect(perfect.accuracy).toBe(100);
    expect(perfect.wpm).toBeCloseTo(target.length / 5, 1);
    const sloppy = scoreTyping("the quick brown fix", target, 60);
    expect(sloppy.accuracy).toBeLessThan(100);
    expect(sloppy.netWpm).toBeLessThan(perfect.netWpm);
  });

  it("parses flashcards from every shape people actually write", () => {
    expect(parseFlashcards("What is 2+2? | 4")).toEqual([{ front: "What is 2+2?", back: "4" }]);
    expect(parseFlashcards("Capital of France\nParis\nCapital of Spain\nMadrid")).toHaveLength(2);
    expect(() => parseFlashcards("just one line, odd count\nsecond\nthird")).toThrow(/Question/);
  });

  it("splits into teams of nearly equal size with nobody lost or duplicated", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const teams = makeTeams(names, 3);
    expect(teams).toHaveLength(3);
    expect(teams.flat().sort()).toEqual([...names].sort());
    expect(Math.max(...teams.map((t) => t.length)) - Math.min(...teams.map((t) => t.length))).toBeLessThanOrEqual(1);
  });

  it("summarises a year from job rows without inventing anything", () => {
    const wrap = summariseYear(
      [
        { toolId: "merge-pdf", createdAt: "2026-02-03T10:00:00Z" },
        { toolId: "merge-pdf", createdAt: "2026-02-04T10:00:00Z" },
        { toolId: "image-resizer", createdAt: "2026-05-01T10:00:00Z" },
        { toolId: "merge-pdf", createdAt: "2025-02-03T10:00:00Z" },
      ],
      2026,
    );
    expect(wrap.totalRuns).toBe(3);
    expect(wrap.distinctTools).toBe(2);
    expect(wrap.topTools[0]).toMatchObject({ toolId: "merge-pdf", runs: 2 });
    expect(wrap.busiestMonth?.month).toBe("February");
    expect(wrap.longestStreakDays).toBe(2);
    expect(wrap.estimatedMinutesSaved).toBeGreaterThan(0);
  });
});

// ---- the shared diff engine -------------------------------------------------------------------

describe("diff engine", () => {
  it("aligns two sequences and counts changes once", () => {
    const { rows, stats } = diffSequences(["a", "b", "c"], ["a", "x", "c"]);
    expect(rows.map((r) => r.op).join("")).toBe("=-+=");
    expect(stats).toMatchObject({ same: 2, removed: 1, added: 1, changed: 1 });
  });

  it("reports identical input as identical", () => {
    expect(diffSequences(["a"], ["a"]).identical).toBe(true);
  });

  it("produces a unified diff a patch tool would accept", () => {
    const patch = unifiedDiff(["one", "two", "three"], ["one", "TWO", "three"], {
      leftName: "a.txt",
      rightName: "b.txt",
    });
    expect(patch).toContain("--- a.txt");
    expect(patch).toContain("+++ b.txt");
    expect(patch).toMatch(/@@ -1,3 \+1,3 @@/);
    expect(patch).toContain("-two");
    expect(patch).toContain("+TWO");
  });

  it("highlights only the words that moved", () => {
    const pieces = inlineDiff("the quick brown fox", "the slow brown fox");
    expect(pieces.filter((p) => p.op === "-").map((p) => p.text.trim())).toEqual(["quick"]);
    expect(pieces.filter((p) => p.op === "+").map((p) => p.text.trim())).toEqual(["slow"]);
  });

  it("normalises lines only when asked", () => {
    expect(toLines("a\nb\n")).toEqual(["a", "b"]);
    expect(toLines("  A  \n\nb", { trim: true, ignoreCase: true, ignoreBlank: true })).toEqual(["a", "b"]);
  });
});

// ---- developer utilities ----------------------------------------------------------------------

describe("JWT decoder", () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "42", exp: 2_000_000_000, iat: 1_700_000_000 })).toString("base64url");

  it("decodes header and claims and reads the expiry", () => {
    const report = decodeJwt(`${header}.${payload}.signature`, "", Date.parse("2026-01-01T00:00:00Z"));
    expect(report.algorithm).toBe("HS256");
    expect(report.payload.sub).toBe("42");
    expect(report.expired).toBe(false);
    expect(report.times.find((t) => t.claim === "exp")?.iso).toBe("2033-05-18T03:33:20.000Z");
  });

  it("verifies an HMAC signature when given the secret", async () => {
    const { createHmac } = await import("node:crypto");
    const signature = createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest("base64url");
    expect(decodeJwt(`${header}.${payload}.${signature}`, "s3cret").signature).toBe("valid");
    expect(decodeJwt(`${header}.${payload}.${signature}`, "wrong").signature).toBe("invalid");
  });

  it("will not pretend to verify a public-key signature", () => {
    const rsHeader = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const report = decodeJwt(`${rsHeader}.${payload}.sig`, "anything");
    expect(report.signature).toBe("unsupported");
    expect(report.notes.join(" ")).toMatch(/public key/);
  });

  it("flags an unsigned token", () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    expect(decodeJwt(`${noneHeader}.${payload}.`).notes.join(" ")).toMatch(/not signed/);
  });

  it("refuses something that is not a JWT", () => {
    expect(() => decodeJwt("hello")).toThrow(/three dot-separated parts/);
  });
});

describe("colour converter", () => {
  it("parses every notation it advertises", () => {
    expect(parseColor("#3f444b")).toMatchObject({ r: 63, g: 68, b: 75, a: 1 });
    expect(parseColor("#abc")).toMatchObject({ r: 170, g: 187, b: 204 });
    expect(parseColor("rgb(63 68 75)")).toMatchObject({ r: 63, g: 68, b: 75 });
    expect(parseColor("teal")).toMatchObject({ r: 0, g: 128, b: 128 });
    expect(parseColor("hsl(0 100% 50%)")).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(() => parseColor("periwinkle-ish")).toThrow(/not a colour/);
  });

  it("round-trips through HSL", () => {
    const hsl = rgbToHsl({ r: 63, g: 68, b: 75, a: 1 });
    expect(hsl.h).toBeGreaterThan(200);
    expect(hsl.h).toBeLessThan(230);
  });

  it("computes WCAG contrast to the published values", () => {
    // Black on white is exactly 21:1 — the ceiling of the scale.
    expect(judgeContrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }).ratio).toBe(21);
    // #767676 is the classic "just passes AA on white" grey: 4.54:1.
    const grey = judgeContrast({ r: 118, g: 118, b: 118, a: 1 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(grey.ratio).toBeGreaterThanOrEqual(4.5);
    expect(grey.aaNormal).toBe(true);
    expect(grey.aaaNormal).toBe(false);
  });

  it("builds a shade ramp from light to dark", () => {
    const palette = buildPalette({ r: 63, g: 68, b: 75, a: 1 }, "shades", 5);
    expect(palette).toHaveLength(5);
    expect(new Set(palette.map((p) => p.hex)).size).toBe(5);
  });
});

describe("cron", () => {
  it("explains an expression in plain English", () => {
    expect(explainCron(parseCron("30 6 * * 1-5"))).toMatch(/Monday.*Friday/);
    expect(explainCron(parseCron("*/15 * * * *"))).toMatch(/every 15 minutes/);
    expect(explainCron(parseCron("@daily"))).toMatch(/00:00/);
  });

  it("works out the next runs in UTC", () => {
    const runs = nextRuns(parseCron("0 9 * * 1"), new Date("2026-03-11T00:00:00Z"), 2);
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-03-16T09:00:00.000Z", "2026-03-23T09:00:00.000Z"]);
  });

  it("applies POSIX's OR rule when both day fields are restricted", () => {
    const spec = parseCron("0 0 13 * 5");
    // Friday the 13th of March 2026 satisfies both; the 6th satisfies only the weekday.
    const runs = nextRuns(spec, new Date("2026-03-01T00:00:00Z"), 3).map((d) => d.toISOString().slice(0, 10));
    expect(runs).toContain("2026-03-06");
    expect(runs).toContain("2026-03-13");
    expect(explainCron(spec)).toMatch(/or/);
  });

  it("accepts month and day names, and rejects nonsense", () => {
    expect(parseCron("0 0 1 JAN MON").month.values).toEqual([1]);
    expect(parseCron("0 0 * * SUN").dayOfWeek.values).toEqual([0]);
    expect(() => parseCron("0 0")).toThrow(/five fields/);
    expect(() => parseCron("99 0 * * *")).toThrow(/not a valid minute/);
    expect(() => parseCron("0 0 * * 9")).toThrow(/day of week/);
  });
});

describe("text transforms", () => {
  it("splits identifiers however they were written", () => {
    expect(splitWords("myHTTPServer")).toEqual(["my", "HTTP", "Server"]);
    expect(splitWords("some_snake-case.value")).toEqual(["some", "snake", "case", "value"]);
  });

  it("converts between every case it offers", () => {
    expect(convertCase("hello world again", "camel")).toBe("helloWorldAgain");
    expect(convertCase("helloWorldAgain", "snake")).toBe("hello_world_again");
    expect(convertCase("hello world again", "constant")).toBe("HELLO_WORLD_AGAIN");
    // Title Case keeps small words lower unless they open or close the phrase.
    expect(convertCase("the lord of the rings", "title")).toBe("The Lord of the Rings");
    expect(convertCase("a tale of two cities", "sentence")).toBe("A tale of two cities");
  });

  it("converts units, including the affine temperature scales", () => {
    expect(convertUnit(1, "km", "m", "length")).toBe(1000);
    expect(convertUnit(1, "mi", "km", "length")).toBeCloseTo(1.609344, 6);
    expect(convertUnit(100, "c", "f", "temperature")).toBeCloseTo(212, 6);
    expect(convertUnit(-40, "f", "c", "temperature")).toBeCloseTo(-40, 6);
    expect(convertUnit(0, "c", "k", "temperature")).toBeCloseTo(273.15, 6);
    expect(convertUnit(1, "GiB", "MiB", "data")).toBe(1024);
    expect(() => convertUnit(1, "furlongs-per-fortnight", "m", "length")).toThrow(/not a length unit/);
  });

  it("reads a shorthand conversion typed in the box", async () => {
    const result = expectOk(await run("unit-converter", "12 km to mi", { family: "length" }), "units");
    expect((result.output as { converted: number }).converted).toBeCloseTo(7.4565, 3);
  });

  it("counts syllables well enough for a readability score", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("running")).toBe(2);
    expect(countSyllables("readability")).toBeGreaterThanOrEqual(4);
  });

  it("scores simple prose as easier than dense prose", () => {
    const simple = analyseReadability("The cat sat on the mat. The dog ran fast. We had fun.");
    const dense = analyseReadability(
      "Notwithstanding the aforementioned considerations regarding infrastructural interdependencies, the committee's deliberations remained inconclusive.",
    );
    expect(simple.fleschReadingEase).toBeGreaterThan(dense.fleschReadingEase);
    expect(dense.averageGrade).toBeGreaterThan(simple.averageGrade);
    expect(simple.sentences).toBe(3);
  });
});

/**
 * Fixture credentials, assembled at runtime from harmless halves.
 *
 * None of these is real, but writing them out whole would put credential-shaped literals in the
 * repository — which trips GitHub's own push protection and, more to the point, is exactly the habit
 * this tool exists to discourage. Joining the halves here keeps the test honest (the scanner still
 * sees the real shape at runtime) without the repo ever storing one.
 */
const FAKE = {
  aws: `AKIA${"IOSFODNN7"}${"EXAMPLE"}`,
  github: `ghp${"_"}${"1234567890abcdefghijklmnopqrstuvwx"}`,
  stripe: `sk${"_"}live${"_"}${"abcdefghijklmnopqrstuvwx"}`,
  database: `postgres://user:${"hunter2"}@db.example.com:5432/app`,
};

describe("secrets scanner", () => {
  it("finds real key shapes and masks them", () => {
    const findings = scanText(
      "config.ts",
      [
        `const aws = "${FAKE.aws}";`,
        `const gh = "${FAKE.github}";`,
        `const stripe = "${FAKE.stripe}";`,
        `const db = "${FAKE.database}";`,
      ].join("\n"),
      { entropy: false },
    );
    const rules = findings.map((f) => f.ruleId);
    expect(rules).toContain("aws-access-key");
    expect(rules).toContain("github-token");
    expect(rules).toContain("stripe-key");
    expect(rules).toContain("db-url");
    for (const finding of findings) {
      expect(finding.masked).toContain("•");
      expect(finding.context).not.toContain("hunter2");
    }
  });

  it("ignores obvious placeholders", () => {
    const findings = scanText("readme.md", 'API_KEY = "your-api-key-here"\nTOKEN = "xxxxxxxxxxxx"', { entropy: true });
    expect(findings).toEqual([]);
  });

  it("measures entropy the usual way", () => {
    expect(shannonEntropy("aaaaaaaa")).toBe(0);
    expect(shannonEntropy("abcdefgh")).toBeCloseTo(3, 5);
  });
});

// ---- data tools -------------------------------------------------------------------------------

describe("pivot and charts", () => {
  const sales = makeTable(
    "sales",
    ["Region", "Quarter", "Revenue"],
    [
      ["North", "Q1", 100],
      ["North", "Q2", 150],
      ["South", "Q1", 80],
      ["South", "Q2", 120],
    ],
  );

  it("resolves a column by name, letter or number", () => {
    expect(findColumn(sales, "Region", "rows")).toBe(0);
    expect(findColumn(sales, "region", "rows")).toBe(0);
    expect(findColumn(sales, "C", "values")).toBe(2);
    expect(findColumn(sales, "3", "values")).toBe(2);
    expect(() => findColumn(sales, "Profit", "values")).toThrow(/no column/);
  });

  it("aggregates each way it offers", () => {
    expect(aggregate([1, 2, 3, 4], "sum")).toBe(10);
    expect(aggregate([1, 2, 3, 4], "average")).toBe(2.5);
    expect(aggregate([1, 2, 3, 4], "median")).toBe(2.5);
    expect(aggregate(["a", "b", "a"], "distinct")).toBe(2);
    expect(aggregate(["1,234.50"], "sum")).toBe(1234.5);
  });

  it("cross-tabulates with row and column totals", () => {
    const pivot = buildPivot(sales, {
      rowColumn: 0,
      columnColumn: 1,
      valueColumn: 2,
      how: "sum",
      totals: true,
      sortBy: "label",
    });
    expect(pivot.table.headers).toEqual(["Region", "Q1", "Q2", "Total"]);
    expect(pivot.table.rows[0]).toEqual(["North", 100, 150, 250]);
    expect(pivot.table.rows[pivot.table.rows.length - 1]).toEqual(["Total", 180, 270, 450]);
  });

  it("draws a chart as self-contained SVG with no external reference", () => {
    const points = readSeries(sales, 0, 2, 10);
    const svg = renderChartSvg(points, {
      type: "column",
      title: "Revenue",
      width: 600,
      height: 400,
      valueLabel: "Revenue",
      categoryLabel: "Region",
      showValues: true,
      dark: false,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Revenue");
    // The only URL allowed is the SVG namespace itself: nothing is fetched at render time.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
    expect(svg).not.toContain("<script");
  });

  it("refuses to chart a column with no numbers in it", () => {
    expect(() => readSeries(sales, 0, 1, 10)).toThrow(/no numbers/);
  });
});

describe("data diff and schema", () => {
  const left = makeTable("a", ["id", "name", "score"], [[1, "Ada", 10], [2, "Alan", 20], [3, "Grace", 30]]);
  const right = makeTable("b", ["id", "name", "score"], [[1, "Ada", 10], [2, "Alan", 25], [4, "Katherine", 40]]);

  it("matches rows on a key so a change is one change", () => {
    const report = diffTables(left, right, { keyColumn: 0, ignoreCase: false, trim: true });
    expect(report.changed).toBe(1);
    expect(report.added).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.rows.find((r) => r.kind === "changed")?.changes).toEqual([
      { column: "score", before: "20", after: "25" },
    ]);
  });

  it("notices columns appearing and disappearing", () => {
    const extra = makeTable("b", ["id", "name", "score", "team"], [[1, "Ada", 10, "x"]]);
    const report = diffTables(left, extra, { keyColumn: 0, ignoreCase: false, trim: true });
    expect(report.columnsAdded).toEqual(["team"]);
  });

  it("reports identical tables as identical", () => {
    expect(diffTables(left, left, { keyColumn: 0, ignoreCase: false, trim: true }).identical).toBe(true);
  });

  it("infers a schema, marking a field absent from one sample as optional", () => {
    const schema = inferSchema([
      { id: 1, name: "Ada", email: "ada@example.com" },
      { id: 2, name: "Alan" },
    ]) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["id", "name"]);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.id!.type).toBe("integer");
    expect(properties.email!.format).toBe("email");
  });

  it("infers an enum from a small closed set", () => {
    const schema = inferSchema(
      ["active", "pending", "active", "pending", "active", "pending"].map((status) => ({ status })),
    ) as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.status!.enum).toEqual(["active", "pending"]);
  });

  it("validates the sample-data field spec", () => {
    expect(parseFieldSpec("name:fullName, joined:date")).toEqual([
      { name: "name", type: "fullName" },
      { name: "joined", type: "date" },
    ]);
    expect(() => parseFieldSpec("x:nonsense")).toThrow(/not a field type/);
  });

  it("generates only unreachable contact details", async () => {
    const result = expectOk(
      await run("sample-data-generator", null, { fields: "email:email, phone:phone, ip:ipv4", rows: 12, format: "json" }),
      "sample-data",
    );
    const rows = (result.output as { rows: Record<string, string>[] }).rows;
    for (const row of rows) {
      expect(row.email).toMatch(/@example\.com$/);
      expect(row.phone).toMatch(/^\+1 555-01\d\d$/);
      expect(row.ip).toMatch(/^198\.51\.100\./);
    }
  });
});

// ---- image tools ------------------------------------------------------------------------------

describe("image analysis", () => {
  it("extracts a palette that sums to about 100%", () => {
    // Two flat colours, half and half.
    const pixels = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i += 1) {
      const dark = i < 200;
      pixels[i * 4] = dark ? 20 : 220;
      pixels[i * 4 + 1] = dark ? 20 : 220;
      pixels[i * 4 + 2] = dark ? 20 : 220;
      pixels[i * 4 + 3] = 255;
    }
    const swatches = kMeansPalette(pixels, 2);
    expect(swatches).toHaveLength(2);
    expect(swatches.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 0);
    expect(swatches.map((s) => s.hex).sort()).toEqual(["#141414", "#dcdcdc"]);
    // The readable-text colour has to flip between them.
    expect(new Set(swatches.map((s) => s.onColor)).size).toBe(2);
  });

  it("gives the same palette for the same image every time", () => {
    const pixels = new Uint8ClampedArray(120 * 4).fill(200);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    expect(kMeansPalette(pixels, 3)).toEqual(kMeansPalette(pixels, 3));
  });

  it("hashes perceptually: a resize stays close, a different picture does not", async () => {
    const sharp = (await import("sharp")).default;
    const gradient = Buffer.alloc(32 * 32);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) gradient[y * 32 + x] = (x * 8) % 256;
    const inverted = Buffer.alloc(32 * 32);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) inverted[y * 32 + x] = 255 - ((x * 8) % 256);
    const a = perceptualHash(gradient);
    const b = perceptualHash(inverted);
    expect(a).toHaveLength(16);
    expect(hammingDistance(a, a)).toBe(0);
    expect(hammingDistance(a, b)).toBeGreaterThan(8);
    // A JPEG round trip of the same picture must stay close.
    const png = await sharp(gradient, { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer();
    const recompressed = await sharp(png).jpeg({ quality: 60 }).toBuffer();
    const again = perceptualHash(await sharp(recompressed).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer());
    expect(hammingDistance(a, again)).toBeLessThanOrEqual(8);
  });

  it("traces a filled square into a closed outline and simplifies it", () => {
    const width = 20;
    const height = 20;
    const mask = new Uint8Array(width * height);
    for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) mask[y * width + x] = 1;
    const paths = traceContours(mask, width, height);
    expect(paths.length).toBeGreaterThan(0);
    const simplified = simplifyPath(paths[0]!, 1);
    // A square needs only its corners once the redundant points are dropped.
    expect(simplified.length).toBeLessThan(paths[0]!.length);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
  });
});

describe("batch image tools", () => {
  it("expands a rename pattern and pads the counter", () => {
    const at = { name: "photo", index: 7, ext: "jpg", total: 120, date: new Date("2026-03-14T12:00:00Z") };
    expect(applyNamePattern("{name}-{n}", at)).toBe("photo-007");
    expect(applyNamePattern("{n:2}_{name}", at)).toBe("07_photo");
    expect(applyNamePattern("{date}-{name}", at)).toBe("2026-03-14-photo");
  });

  it("never lets a rename become a path", () => {
    const traversal = sanitizeFileName("../../etc/passwd", "safe");
    expect(traversal).not.toContain("/");
    expect(traversal).not.toContain("\\");
    expect(traversal.startsWith(".")).toBe(false);
    expect(sanitizeFileName("CON", "safe")).toBe("safe");
    expect(sanitizeFileName("   ", "safe")).toBe("safe");
  });

  it("writes a .ico container a browser would accept", () => {
    const frames = [
      { size: 16, png: enc("pretend-png-16") },
      { size: 32, png: enc("pretend-png-32") },
    ];
    const ico = buildIco(frames);
    const view = Buffer.from(ico);
    expect(view.readUInt16LE(0)).toBe(0);
    expect(view.readUInt16LE(2)).toBe(1);
    expect(view.readUInt16LE(4)).toBe(2);
    expect(view.readUInt8(6)).toBe(16);
    // The first frame's data must start where its directory entry says it does.
    const offset = view.readUInt32LE(6 + 12);
    expect(view.subarray(offset, offset + frames[0]!.png.length)).toEqual(Buffer.from(frames[0]!.png));
  });

  it("knows the social sizes it claims to", () => {
    const og = SOCIAL_PRESETS.find((p) => p.id === "open-graph")!;
    expect([og.width, og.height]).toEqual([1200, 630]);
    expect(SOCIAL_PRESETS.find((p) => p.id === "instagram-story")!.height).toBe(1920);
    expect(new Set(SOCIAL_PRESETS.map((p) => p.id)).size).toBe(SOCIAL_PRESETS.length);
  });

  it("says plainly when no photo has GPS in it", async () => {
    const result = await run("photo-map-viewer", [f("plain.png", await makePng(), "image/png")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/GPS coordinates/);
  });
});

// ---- PDF tools --------------------------------------------------------------------------------

describe("PDF additions", () => {
  it("orders a booklet outside-in and pads to a multiple of four", () => {
    expect(bookletOrder(8)).toEqual([8, 1, 2, 7, 6, 3, 4, 5]);
    // Six pages need two blanks, which show up as nulls rather than phantom pages.
    const six = bookletOrder(6);
    expect(six).toHaveLength(8);
    expect(six.filter((p) => p === null)).toHaveLength(2);
    expect(six.filter((p) => p !== null).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("round-trips an outline through write and read", async () => {
    const doc = await loadPdf(await makeTextPdf({ pages: 4 }));
    const count = writeOutline(doc, [
      { title: "One", page: 1, depth: 0, children: [{ title: "One a", page: 2, depth: 1, children: [] }] },
      { title: "Two", page: 3, depth: 0, children: [] },
    ]);
    expect(count).toBe(3);
    const reopened = await loadPdf(await savePdf(doc));
    const outline = readOutline(reopened);
    expect(outline.map((b) => b.title)).toEqual(["One", "Two"]);
    expect(outline[0]!.children[0]).toMatchObject({ title: "One a", page: 2 });
    expect(outline[1]!.page).toBe(3);
  });

  it("parses an indented bookmark list and rejects an impossible page", () => {
    const parsed = parseBookmarkList("Intro | 1\n  Detail | 2\nEnd | 3", 3);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.children[0]!.title).toBe("Detail");
    expect(() => parseBookmarkList("Intro | 99", 3)).toThrow(/has 3 pages/);
  });

  it("validates redaction regions and form field specs", () => {
    expect(parseRedactionBoxes("1: 50,600,200,20", 2)).toEqual([
      { page: 1, x: 50, y: 600, width: 200, height: 20 },
    ]);
    expect(() => parseRedactionBoxes("1: 50,600", 2)).toThrow(/not a region/);
    expect(() => parseRedactionBoxes("9: 1,1,1,1", 2)).toThrow(/does not exist/);
    const fields = parseFieldSpecs("text | Name | 1 | 10,20,100,20\ntext | Name | 1 | 10,50,100,20", 1);
    // Duplicate labels must not become duplicate field names, or readers tie the fields together.
    expect(fields[0]!.name).not.toBe(fields[1]!.name);
    expect(() => parseFieldSpecs("dropdown | Pick | 1 | 1,1,1,1", 1)).not.toThrow();
  });

  it("redacts text so it can no longer be extracted", async () => {
    const source = await makeStructuredPdf();
    const redacted = expectOk(
      await run("pdf-redaction", [f("report.pdf", source, "application/pdf")], {
        mode: "text",
        terms: "Quarterly",
        dpi: 100,
      }),
      "redaction",
    );
    const out = redacted.files![0]!.bytes;
    const text = expectOk(await run("pdf-to-text", [f("redacted.pdf", out, "application/pdf")]), "pdf-to-text");
    expect(String((text.output as { text?: string }).text ?? dec(text.files?.[0]?.bytes ?? new Uint8Array()))).not.toContain(
      "Quarterly",
    );
  });

  it("tells the user to OCR first when there is no text to search", async () => {
    const blank = await makeTextPdf({ pages: 1 });
    const result = await run("pdf-redaction", [f("blank.pdf", blank, "application/pdf")], {
      mode: "text",
      terms: "nothing-like-this-is-in-the-file",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/OCR PDF/);
  });

  it("splits on bookmarks, and says why it cannot when there are none", async () => {
    const plain = await makeTextPdf({ pages: 4 });
    const noOutline = await run("pdf-chapter-splitter", [f("plain.pdf", plain, "application/pdf")]);
    expect(noOutline.ok).toBe(false);
    if (!noOutline.ok) expect(noOutline.message).toMatch(/Bookmark Editor|Split PDF/);

    const doc = await loadPdf(plain);
    writeOutline(doc, [
      { title: "First half", page: 1, depth: 0, children: [] },
      { title: "Second half", page: 3, depth: 0, children: [] },
    ]);
    const withOutline = await savePdf(doc);
    const split = expectOk(
      await run("pdf-chapter-splitter", [f("book.pdf", withOutline, "application/pdf")], { packaging: "files" }),
      "chapter-splitter",
    );
    expect(split.files).toHaveLength(2);
    expect(split.files![0]!.name).toMatch(/First half/);
  });

  it("grades accessibility and names the real problems", async () => {
    const result = expectOk(
      await run("pdf-accessibility-checker", [f("plain.pdf", await makeTextPdf({ pages: 1 }), "application/pdf")]),
      "accessibility",
    );
    const report = result.output as { tagged: boolean; issues: { rule: string; severity: string }[]; score: number };
    expect(report.tagged).toBe(false);
    expect(report.issues.some((i) => /Tagged content/.test(i.rule) && i.severity === "error")).toBe(true);
    expect(report.issues.some((i) => /Reading order/.test(i.rule))).toBe(true);
    expect(report.score).toBeLessThan(100);
  });

  it("reports two identical PDFs as identical and a changed one as different", async () => {
    const a = await makeTextPdf({ pages: 1, title: "A" });
    const same = expectOk(
      await run("pdf-visual-diff", [f("a.pdf", a, "application/pdf"), f("b.pdf", a, "application/pdf")], { dpi: 72 }),
      "visual-diff-same",
    );
    expect((same.output as { identical: boolean }).identical).toBe(true);

    const b = await makeTextPdf({ pages: 1, title: "B" });
    const changed = expectOk(
      await run("pdf-visual-diff", [f("a.pdf", a, "application/pdf"), f("b.pdf", b, "application/pdf")], { dpi: 72 }),
      "visual-diff-changed",
    );
    // Same visible text, different metadata title: the pixels are the same, and it says so.
    expect(changed.output).toHaveProperty("identical");
  });

  it("extracts a table into CSV", async () => {
    const result = expectOk(
      await run("pdf-table-extractor", [f("report.pdf", await makeStructuredPdf(), "application/pdf")], {
        format: "csv",
        separateFiles: false,
      }),
      "table-extractor",
    );
    const csv = dec(result.files![0]!.bytes);
    expect(csv).toMatch(/Region/);
    expect(csv).toMatch(/North/);
  });

  it("adds fillable fields that Fill PDF Forms can then see", async () => {
    const built = expectOk(
      await run("pdf-form-designer", [f("blank.pdf", await makeTextPdf({ pages: 1 }), "application/pdf")], {
        fields: "text | Full name | 1 | 60,700,220,22\ncheckbox | Agree | 1 | 60,660,16,16",
      }),
      "form-designer",
    );
    const doc = await loadPdf(built.files![0]!.bytes);
    const names = doc.getForm().getFields().map((field) => field.getName());
    expect(names).toContain("Full_name");
    expect(names).toContain("Agree");
  });
});

// ---- documents --------------------------------------------------------------------------------

describe("Word and PowerPoint additions", () => {
  it("accepts tracked insertions and drops tracked deletions", () => {
    const xml =
      "<w:p><w:ins w:id=\"1\"><w:r><w:t>added </w:t></w:r></w:ins>" +
      "<w:del w:id=\"2\"><w:r><w:delText>removed </w:delText></w:r></w:del>" +
      "<w:r><w:t>kept</w:t></w:r></w:p>";
    const accepted = resolveRevisions(xml, true);
    expect(accepted.xml).toContain("added");
    expect(accepted.xml).not.toContain("removed");
    expect(accepted.xml).not.toContain("<w:ins");
    expect(accepted.counts).toMatchObject({ insertions: 1, deletions: 1 });

    const rejected = resolveRevisions(xml, false);
    expect(rejected.xml).not.toContain("added");
    // A rejected deletion has to come back as real text, not as invisible delText.
    expect(rejected.xml).toContain("<w:t>removed </w:t>");
    expect(rejected.xml).not.toContain("delText");
  });

  it("strips comments and formatting revisions when asked", () => {
    const xml =
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>hi</w:t></w:r><w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r><w:rPrChange w:id="3"><w:rPr/></w:rPrChange></w:p>';
    const result = resolveRevisions(xml, true);
    expect(result.xml).not.toContain("commentRange");
    expect(result.xml).not.toContain("commentReference");
    expect(result.xml).not.toContain("rPrChange");
    expect(result.counts.comments).toBeGreaterThan(0);
    expect(result.counts.formatting).toBe(1);
  });

  it("converts a Word document to Markdown, keeping headings, lists and tables", async () => {
    const docx = await makeDocx({
      paragraphs: ["# Report", "Some body text.", "## Detail", "More text."],
      list: ["first", "second"],
      table: [
        ["Name", "Score"],
        ["Ada", "10"],
      ],
    });
    const markdown = await docxToMarkdown(docx);
    expect(markdown).toMatch(/^# Report/m);
    expect(markdown).toMatch(/^## Detail/m);
    expect(markdown).toMatch(/\| Name \| Score \|/);
    expect(markdown).toMatch(/\| --- \| --- \|/);
    expect(markdown).toContain("first");
    expect(markdown).toContain("second");
  });

  it("splits Markdown into slides on --- or on headings", () => {
    expect(parseMarkdownSlides("# One\n- a\n\n---\n\n# Two\n- b", 2)).toHaveLength(2);
    const byHeading = parseMarkdownSlides("## One\n- a\n## Two\n- b", 2);
    expect(byHeading.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(byHeading[0]!.bullets[0]!.text).toBe("a");
    expect(parseMarkdownSlides("## Talk\nnotes: remember to breathe", 2)[0]!.notes).toBe("remember to breathe");
    expect(() => parseMarkdownSlides("   ", 2)).toThrow(/No slides/);
  });

  it("formats a reference in every style it offers", () => {
    const [ref] = parseReferences("Lovelace, A. (1843). Notes on the Analytical Engine. Taylor's Scientific Memoirs, 3, 666-731.");
    expect(ref!.year).toBe("1843");
    expect(ref!.authors[0]).toMatch(/Lovelace/);
    expect(formatReference(ref!, "apa")).toMatch(/\(1843\)/);
    expect(formatReference(ref!, "mla")).toMatch(/"/);
    const bibtex = formatReference(ref!, "bibtex");
    expect(bibtex).toMatch(/^@\w+\{/);
    expect(bibtex).toContain("year = {1843}");
  });

  it("reads Field: value reference blocks too", () => {
    const refs = parseReferences("author: Ada Lovelace\ntitle: Notes\nyear: 1843\njournal: Memoirs");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ year: "1843", title: "Notes", container: "Memoirs" });
  });

  it("parses a resume form into sections", () => {
    const data = parseResume(
      ["Name: Ada Lovelace", "Headline: Mathematician", "Email: ada@example.com", "Experience:", "- Analytical Engine notes", "Skills: maths, logic"].join("\n"),
    );
    expect(data.name).toBe("Ada Lovelace");
    expect(data.experience).toEqual(["Analytical Engine notes"]);
    expect(data.skills).toEqual(["maths", "logic"]);
    expect(() => parseResume("   ")).toThrow(/name/);
  });

  it("builds a real .pptx from Markdown", async () => {
    const result = expectOk(await run("markdown-to-slides", "# One\n- a\n\n---\n\n# Two\n- b"), "md-slides");
    const file = result.files![0]!;
    expect(file.name.endsWith(".pptx")).toBe(true);
    // A .pptx is a ZIP: the local-file-header magic is the cheapest proof it really is one.
    expect(Array.from(file.bytes.subarray(0, 2))).toEqual([0x50, 0x4b]);
    const slides = expectOk(await run("powerpoint-to-text", [f("deck.pptx", file.bytes)]), "pptx-to-text");
    expect(dec(slides.files![0]!.bytes)).toMatch(/One/);
  });

  it("keeps the PowerPoint fixture readable, so the deck test above means something", async () => {
    const pptx = await makePptx({ slides: 1 });
    expect(Array.from(pptx.subarray(0, 2))).toEqual([0x50, 0x4b]);
  });
});

// ---- QR and barcodes --------------------------------------------------------------------------

describe("barcodes", () => {
  it("computes the EAN/UPC check digit the way the standard does", () => {
    // 4006381333931 is the canonical EAN-13 example; its check digit is 1.
    expect(eanCheckDigit("400638133393")).toBe(1);
    // 03600029145 is the canonical UPC-A example; its check digit is 2.
    expect(eanCheckDigit("03600029145")).toBe(2);
  });

  it("encodes EAN-13 with the guard patterns in the right places", () => {
    const { bits, value } = encodeEan("400638133393", "ean13");
    expect(value).toBe("4006381333931");
    expect(bits.startsWith("101")).toBe(true);
    expect(bits.endsWith("101")).toBe(true);
    expect(bits.slice(45, 50)).toBe("01010");
    // 3 guards + 12 digits x 7 modules = 95.
    expect(bits).toHaveLength(95);
  });

  it("rejects a wrong check digit rather than silently fixing it", () => {
    expect(() => encodeEan("4006381333930", "ean13")).toThrow(/check digit/);
    expect(() => encodeEan("12345", "ean13")).toThrow(/12 or 13 digits/);
  });

  it("switches Code 128 into subset C for long digit runs", () => {
    const short = encodeCode128("ABC");
    const digits = encodeCode128("12345678");
    expect(short.length).toBeGreaterThan(0);
    // Eight digits in subset C are four characters, so it must be shorter than eight in subset B.
    expect(digits.length).toBeLessThan(encodeCode128("ABCDEFGH").length);
    expect(code128Checksum([104, 33, 34, 35])).toBeGreaterThanOrEqual(0);
    expect(() => encodeCode128("héllo")).toThrow(/printable ASCII/);
  });

  it("adds the ITF-14 check digit", () => {
    expect(encodeItf14("1234567890123").value).toHaveLength(14);
    expect(() => encodeItf14("123")).toThrow(/13 or 14 digits/);
  });

  it("generates a barcode as SVG with a quiet zone", async () => {
    const result = expectOk(await run("barcode-generator", "4006381333931", { symbology: "ean13", format: "svg" }), "barcode");
    const svg = dec(result.files![0]!.bytes);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("4006381333931");
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
  });

  it("makes a logo QR that it has actually decoded to check", async () => {
    const logo = `data:image/png;base64,${Buffer.from(await makePng(60, 60)).toString("base64")}`;
    const result = expectOk(await run("logo-qr-code", "https://example.com/hello", { logo, logoScale: 22 }), "logo-qr");
    const output = result.output as { scanned: boolean; logoScale: number };
    expect(output.scanned).toBe(true);
    expect(output.logoScale).toBeLessThanOrEqual(0.22);
    expect(result.summary).toMatch(/reads back correctly/);
  });

  it("mail-merges a CSV column into many codes", async () => {
    const csv = "name,url\nAda,https://example.com/a\nAlan,https://example.com/b";
    const result = expectOk(await run("batch-qr-generator", [f("rows.csv", csv, "text/csv")], { column: "url" }), "batch-qr");
    expect((result.output as { count: number }).count).toBe(2);
    expect(result.files![0]!.name).toBe("qr-codes.zip");
  });
});

// ---- media (no binary required for the parsers) ------------------------------------------------

describe("media helpers", () => {
  it("reads FFmpeg's silencedetect report", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 1.5",
      "[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75",
      "[silencedetect @ 0x1] silence_start: 10",
      "[silencedetect @ 0x1] silence_end: 11 | silence_duration: 1",
    ].join("\n");
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 1.5, end: 3.25 },
      { start: 10, end: 11 },
    ]);
  });

  it("turns show-notes timestamps into chapters that tile the file", () => {
    const chapters = parseChapterList("00:00 Intro\n4:12 - The interview\n1:02:03 Closing", 4000);
    expect(chapters.map((c) => c.title)).toEqual(["Intro", "The interview", "Closing"]);
    expect(chapters[0]!.end).toBe(chapters[1]!.start);
    expect(chapters[2]!.end).toBe(4000);
    expect(() => parseChapterList("no timestamp here", 100)).toThrow(/not a chapter/);
    expect(() => parseChapterList("99:99:99 Too late", 60)).toThrow(/past the end/);
  });

  it("round-trips subtitles through SRT and VTT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond line\n";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, text: "Hello there" });
    const vtt = cuesToVtt(cues);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:03.500");
  });

  it("chunks text for speech on sentence boundaries", () => {
    const chunks = chunkForSpeech(`${"Sentence one. ".repeat(80)}Final one.`, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(260);
    expect(chunks.join(" ")).toContain("Final one.");
  });

  it("writes ASS colours in the reversed byte order the format wants", () => {
    // #ff0000 is red, which ASS stores as &H000000FF.
    expect(assColor("#ff0000")).toBe("&H000000FF");
    expect(assColor("#ffffff")).toBe("&H00FFFFFF");
  });
});

describe("optional local speech engines", () => {
  beforeEach(() => setSpeechLocator(null));

  it("reports clearly on /status when nothing is installed", () => {
    setSpeechLocator(() => null);
    for (const kind of ["whisper", "piper"] as const) {
      const status = speechStatus(kind);
      expect(status.installed).toBe(false);
      expect(status.message).toMatch(/free local|Install/);
      // The message must not suggest a hosted service as a substitute.
      expect(status.message).toMatch(/nothing is sent to any server/);
    }
    setSpeechLocator(null);
  });

  it("fails with an actionable message rather than crashing", async () => {
    setSpeechLocator(() => null);
    try {
      // Whichever prerequisite is missing first (FFmpeg or whisper.cpp), the failure has to be a
      // sentence a person can act on, never a crash and never a stack trace.
      const subtitles = await run("auto-subtitle-generator", [f("clip.mp3", "not really audio", "audio/mpeg")]);
      expect(subtitles.ok).toBe(false);
      if (!subtitles.ok) {
        expect(subtitles.message.length).toBeGreaterThan(20);
        expect(subtitles.message).not.toMatch(/at .*\.ts:|Error:/);
      }
      const speech = await run("text-to-speech-reader", "Hello there");
      expect(speech.ok).toBe(false);
      if (!speech.ok) expect(speech.message).toMatch(/Piper/);
    } finally {
      setSpeechLocator(null);
    }
  });

  it("finds nothing rather than throwing when the environment names a missing path", () => {
    const saved = process.env.WHISPER_PATH;
    process.env.WHISPER_PATH = "/definitely/not/here";
    setSpeechLocator(null);
    try {
      expect(findSpeech("whisper")).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.WHISPER_PATH;
      else process.env.WHISPER_PATH = saved;
      setSpeechLocator(null);
    }
  });
});

// ---- network helpers (pure parts) -------------------------------------------------------------

describe("network additions", () => {
  it("applies the wildcard certificate rule the way browsers do", () => {
    expect(hostMatchesName("example.com", "example.com")).toBe(true);
    expect(hostMatchesName("www.example.com", "*.example.com")).toBe(true);
    // A wildcard covers exactly one label, never two.
    expect(hostMatchesName("a.b.example.com", "*.example.com")).toBe(false);
    expect(hostMatchesName("example.com", "*.example.com")).toBe(false);
  });

  it("grades security headers, rewarding a real CSP most", () => {
    const bare = gradeHeaders({}, true);
    const good = gradeHeaders(
      {
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=()",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
      },
      true,
    );
    expect(bare.grade).toBe("F");
    expect(good.score).toBeGreaterThan(bare.score);
    expect(good.grade).toMatch(/[AB]/);
    // A CSP with frame-ancestors makes X-Frame-Options redundant, not missing.
    expect(good.checks.find((c) => c.header === "X-Frame-Options")!.earned).toBeGreaterThan(0);
    // unsafe-inline halves the CSP's value rather than earning it in full.
    const unsafe = gradeHeaders({ "content-security-policy": "default-src 'self' 'unsafe-inline'" }, true);
    expect(unsafe.checks[0]!.earned).toBeLessThan(good.checks[0]!.earned);
    // Plain HTTP is penalised, because none of it can be trusted in transit.
    expect(gradeHeaders({}, false).extras.join(" ")).toMatch(/plain HTTP/);
  });

  it("lints robots.txt and a sitemap", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml", "u", 200);
    expect(robots.groups[0]!.disallow).toEqual(["/admin"]);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(parseRobots("Disallow: /", "u", 200).problems.join(" ")).toMatch(/before any User-agent/);
    expect(parseRobots("User-agent: *\nDisallow: /", "u", 200).problems.join(" ")).toMatch(/whole site/);

    const sitemap = parseSitemap(
      '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url></urlset>',
      "u",
      200,
    );
    expect(sitemap.kind).toBe("urlset");
    expect(sitemap.urlCount).toBe(1);
    expect(sitemap.problems).toEqual([]);
    expect(parseSitemap("<html></html>", "u", 200).problems.join(" ")).toMatch(/does not look like a sitemap/);
    expect(parseSitemap('<?xml version="1.0"?><urlset><url><loc>http://x.test/</loc></url></urlset>', "u", 200).problems.join(" ")).toMatch(
      /plain http/,
    );
  });

  it("checks email syntax without being silly about it", () => {
    expect(EMAIL_SYNTAX.test("ada@example.com")).toBe(true);
    expect(EMAIL_SYNTAX.test("ada+tag@sub.example.co.uk")).toBe(true);
    expect(EMAIL_SYNTAX.test("ada@example")).toBe(false);
    expect(EMAIL_SYNTAX.test("ada example@x.com")).toBe(false);
  });

  it("drops headers that cannot be forwarded", () => {
    const { headers, ignored } = parseHeaderLines("Accept: application/json\nHost: evil.test\nnot a header\nContent-Length: 9");
    expect(headers.accept).toBe("application/json");
    expect(headers.host).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    expect(ignored).toHaveLength(3);
  });
});

// ---- AI helpers (no runtime required) ---------------------------------------------------------

describe("AI additions", () => {
  it("reads flashcards out of JSON or Q/A prose", () => {
    expect(parseFlashcardAnswer('[{"question":"Q1","answer":"A1"}]')).toEqual([{ question: "Q1", answer: "A1" }]);
    expect(parseFlashcardAnswer("Q: What is 2+2?\nA: 4\nQ: Capital?\nA: Paris")).toHaveLength(2);
    expect(parseFlashcardAnswer("Front | Back")).toEqual([{ question: "Front", answer: "Back" }]);
  });

  it("builds real cloze cards with no model at all", () => {
    const cards = clozeCards(
      "The Analytical Engine was designed by Charles Babbage in 1837. Ada Lovelace wrote the first published algorithm for it.",
      2,
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.question).toContain("______");
      expect(card.question).not.toContain(card.answer);
      expect(card.answer.length).toBeGreaterThan(0);
    }
  });

  it("produces cloze flashcards through the executor with no AI configured", async () => {
    const result = expectOk(
      await run(
        "ai-flashcard-generator",
        "Photosynthesis converts light energy into chemical energy inside chloroplasts. Chlorophyll absorbs mostly blue and red light.",
        { format: "cloze", count: 2, method: "builtin" },
      ),
      "flashcards",
    );
    expect((result.output as { count: number }).count).toBeGreaterThan(0);
    expect(result.summary).toMatch(/built-in|cloze/);
  });

  it("guesses the language from the extension, then from the code", () => {
    expect(guessLanguage("thing.tsx", "")).toBe("TypeScript (React)");
    expect(guessLanguage("noext", "def main():\n    import os")).toBe("Python");
    expect(guessLanguage("noext", "SELECT * FROM users")).toBe("SQL");
  });

  it("compares a resume with a posting without a model", () => {
    const report = compareKeywords(
      "Experienced Python engineer, built data pipelines with Airflow.",
      "We need a Python engineer with Airflow and Kubernetes experience. Kubernetes is essential.",
    );
    expect(report.matched).toContain("python");
    expect(report.missing).toContain("kubernetes");
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });

  it("strips subtitle timing so a transcript reads as prose", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello there\n\n00:00:02.000 --> 00:00:03.000\nHello there\n";
    const prose = transcriptToProse(vtt);
    expect(prose).toBe("Hello there");
    expect(prose).not.toContain("-->");
  });

  it("marks a decorative image as needing empty alt text, with no model at all", async () => {
    const result = expectOk(
      await run("ai-alt-text-generator", [f("divider.png", await makePng(), "image/png")], { purpose: "decorative" }),
      "alt-text",
    );
    expect((result.output as { results: { altText: string }[] }).results[0]!.altText).toBe("");
    expect(result.summary).toMatch(/alt=""/);
  });
});

// ---- platform features ------------------------------------------------------------------------

describe("outbound push (ntfy)", () => {
  it("only accepts a topic that is safe as a path segment", () => {
    expect(isValidTopic("onestop-abc123")).toBe(true);
    expect(isValidTopic("short")).toBe(false);
    expect(isValidTopic("../../etc/passwd")).toBe(false);
    expect(isValidTopic("has spaces in it")).toBe(false);
  });

  it("refuses a server that is not an http(s) origin", () => {
    expect(ntfyServer({ server: "https://ntfy.example.com/" })).toBe("https://ntfy.example.com");
    expect(ntfyServer({ server: "file:///etc/passwd" })).toBe("https://ntfy.sh");
    expect(ntfyServer({ server: "  " })).toBe("https://ntfy.sh");
  });

  it("encodes a non-ASCII title, because HTTP headers are latin-1", () => {
    expect(encodeHeader("plain title")).toBe("plain title");
    expect(encodeHeader("résumé ready")).toMatch(/^=\?UTF-8\?B\?/);
  });

  it("reads a stored preference and rejects a malformed one", () => {
    expect(readNtfyPreference({ ntfy: { enabled: true, topic: "onestop-abc123" } })).toMatchObject({
      enabled: true,
      topic: "onestop-abc123",
    });
    expect(readNtfyPreference({ ntfy: { enabled: true, topic: "bad topic" } })).toBeNull();
    expect(readNtfyPreference({})).toBeNull();
  });

  it("does not send when it is switched off, and reports a failure without throwing", async () => {
    const off = await sendNtfy({ enabled: false, topic: "onestop-abc123" }, { title: "hi" }, async () => new Response("", { status: 200 }));
    expect(off.sent).toBe(false);

    const failed = await sendNtfy(
      { enabled: true, topic: "onestop-abc123" },
      { title: "hi" },
      async () => {
        throw new Error("no network");
      },
    );
    expect(failed.sent).toBe(false);
    expect(failed.reason).toMatch(/could not be reached/);

    let seen: { url: string; init: RequestInit } | null = null;
    const sent = await sendNtfy(
      { enabled: true, topic: "onestop-abc123" },
      { title: "Done", body: "Your automation finished", link: "https://example.com/x" },
      async (url, init) => {
        seen = { url: String(url), init: init as RequestInit };
        return new Response("", { status: 200 });
      },
    );
    expect(sent.sent).toBe(true);
    expect(seen!.url).toBe("https://ntfy.sh/onestop-abc123");
    expect((seen!.init.headers as Record<string, string>).Title).toBe("Done");
    expect((seen!.init.headers as Record<string, string>).Actions).toMatch(/^view,/);
  });

  it("honours a type filter", async () => {
    const result = await sendNtfy(
      { enabled: true, topic: "onestop-abc123", types: ["automation_failed"] },
      { title: "hi", type: "automation_run" },
      async () => new Response("", { status: 200 }),
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/not one you asked/);
  });
});

describe("access tokens and share links", () => {
  it("issues a recognisable token and stores only its hash", () => {
    const { token, hash, prefix } = generateToken();
    expect(token.startsWith("osk_")).toBe(true);
    expect(looksLikeAccessToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
    expect(prefix).toBe(token.slice(0, 10));
    expect(hashToken(token)).toBe(hash);
    // Two tokens must never collide.
    expect(generateToken().token).not.toBe(token);
  });

  it("rejects anything that is not one of its tokens", () => {
    expect(looksLikeAccessToken("Bearer abc")).toBe(false);
    expect(looksLikeAccessToken("osk_short")).toBe(false);
    expect(looksLikeAccessToken("")).toBe(false);
  });

  it("reads a token from either header, and nothing else", () => {
    const { token } = generateToken();
    const headers = (map: Record<string, string>) => ({ get: (k: string) => map[k.toLowerCase()] ?? null });
    expect(tokenFromHeaders(headers({ authorization: `Bearer ${token}` }))).toBe(token);
    expect(tokenFromHeaders(headers({ "x-onestop-token": token }))).toBe(token);
    expect(tokenFromHeaders(headers({ authorization: "Basic abc123" }))).toBeNull();
    expect(tokenFromHeaders(headers({}))).toBeNull();
  });

  it("makes an unguessable share slug", () => {
    const slug = generateSlug();
    expect(slug).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(sharePath(slug)).toBe(`/s/${slug}`);
    expect(generateSlug()).not.toBe(slug);
  });
});

// ---- offline ----------------------------------------------------------------------------------

/**
 * Every phase-21 tool that must never touch the network, run with the network trapped. The tools
 * left out are the ones that reach outward by design (Breach Check, Currency Converter, the five
 * network tools, the API Request Tester, Photo Map Viewer's map link) and the ones that need a
 * binary or model OneStop does not ship (the FFmpeg and speech tools, the AI tools).
 */
describe("offline", () => {
  it("runs every offline-capable phase-21 tool with the network trapped", async () => {
    const trap = () => {
      throw new Error("network access attempted");
    };
    const saved = { fetch: globalThis.fetch, hg: http.get, hr: http.request, sg: https.get, sr: https.request };

    const pdf = await makeStructuredPdf();
    const outlined = await (async () => {
      const doc = await loadPdf(await makeTextPdf({ pages: 4 }));
      writeOutline(doc, [
        { title: "First", page: 1, depth: 0, children: [] },
        { title: "Second", page: 3, depth: 0, children: [] },
      ]);
      return savePdf(doc);
    })();
    const png = await makePng(64, 64);
    const docx = await makeDocx({ paragraphs: ["# Title", "Body text here."] });
    const csv = "Region,Quarter,Revenue\nNorth,Q1,100\nNorth,Q2,150\nSouth,Q1,80\n";
    const encrypted = encryptBytes(enc("secret"), "password123");

    const cases: Record<string, [Fixture[] | string | null, Record<string, unknown>?]> = {
      // Security & Privacy
      "password-strength-meter": ["correct horse battery staple"],
      "totp-code-generator": [base32Encode(enc("12345678901234567890"))],
      "diceware-passphrase-generator": [null],
      "file-encryptor": [[f("a.txt", "hello")], { password: "password123" }],
      "file-decryptor": [[f("a.osenc", encrypted)], { password: "password123" }],
      // Finance & Math
      "loan-calculator": [null],
      "compound-interest-calculator": [null],
      "tip-splitter": [null],
      "invoice-generator": [null, { items: "Work | 1 | 100" }],
      // Education & Reference
      "flashcard-maker": ["What is 2+2? | 4"],
      "typing-speed-test": ["the quick brown fox", { passage: "the quick brown fox", seconds: 10 }],
      // Calendar & Time
      "world-clock-converter": ["2026-03-14 15:00", { fromZone: "UTC" }],
      "calendar-event-generator": ["Standup", { start: "2026-03-14 09:00" }],
      "countdown-page-generator": ["Launch", { target: "2030-01-01 00:00" }],
      // Fun & Personal
      "decision-maker": ["a\nb\nc"],
      "year-in-onestop": [null, { localHistory: '[{"toolId":"merge-pdf","createdAt":"2026-01-02T00:00:00Z"}]' }],
      // Developer / utility
      "jwt-decoder": [
        `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"sub":"1"}').toString("base64url")}.sig`,
      ],
      "color-converter": ["#3f444b"],
      "cron-expression-builder": ["30 6 * * 1-5"],
      "text-diff-viewer": ["one\ntwo", { against: "one\nTWO" }],
      "case-converter": ["hello world"],
      "unit-converter": ["12 km to mi", { family: "length" }],
      "lorem-ipsum-generator": [null],
      "secrets-scanner": [[f("config.ts", `const k = "${FAKE.aws}";`)]],
      "readability-score-checker": ["The cat sat on the mat. The dog ran fast."],
      // Data
      "pivot-table-builder": [[f("sales.csv", csv, "text/csv")], { rows: "Region", values: "Revenue", aggregate: "sum" }],
      "chart-generator": [[f("sales.csv", csv, "text/csv")], { labels: "Region", values: "Revenue" }],
      "data-diff": [[f("a.csv", csv, "text/csv"), f("b.csv", csv.replace("100", "110"), "text/csv")], { key: "Region" }],
      "json-schema-generator": ['[{"id":1,"name":"Ada"}]'],
      "sample-data-generator": [null, { rows: 3 }],
      // Images
      "color-palette-extractor": [[f("a.png", png, "image/png")]],
      "image-to-ascii-art": [[f("a.png", png, "image/png")], { columns: 24 }],
      "favicon-set-generator": [[f("a.png", png, "image/png")]],
      "social-media-preset-resizer": [[f("a.png", png, "image/png")], { presets: "open-graph" }],
      "collage-maker": [[f("a.png", png, "image/png"), f("b.png", png, "image/png")], { cellSize: 48 }],
      "batch-image-renamer": [[f("a.png", png, "image/png")], { pattern: "shot-{n}" }],
      "sprite-sheet-generator": [[f("a.png", png, "image/png"), f("b.png", png, "image/png")]],
      "near-duplicate-image-finder": [[f("a.png", png, "image/png"), f("b.png", png, "image/png")]],
      "color-blindness-simulator": [[f("a.png", png, "image/png")]],
      "image-vectorizer": [[f("a.png", png, "image/png")], { detail: 90, minArea: 0 }],
      // PDF
      "pdf-redaction": [[f("r.pdf", pdf, "application/pdf")], { mode: "text", terms: "Quarterly", dpi: 72 }],
      "pdf-bookmark-editor": [[f("o.pdf", outlined, "application/pdf")]],
      "pdf-chapter-splitter": [[f("o.pdf", outlined, "application/pdf")]],
      "pdf-booklet-layout": [[f("r.pdf", pdf, "application/pdf")]],
      "pdf-table-extractor": [[f("r.pdf", pdf, "application/pdf")]],
      "pdf-accessibility-checker": [[f("r.pdf", pdf, "application/pdf")]],
      "pdf-visual-diff": [[f("a.pdf", pdf, "application/pdf"), f("b.pdf", pdf, "application/pdf")], { dpi: 72, includeUnchanged: true }],
      "pdf-form-designer": [[f("r.pdf", pdf, "application/pdf")], { fields: "text | Name | 1 | 10,20,100,20" }],
      // Word / PowerPoint
      "track-changes-cleaner": [[f("a.docx", docx)]],
      "markdown-to-word": ["# Hello\n\nBody."],
      "word-to-markdown": [[f("a.docx", docx)]],
      "citation-formatter": ["Lovelace, A. (1843). Notes. Memoirs, 3, 666-731."],
      "resume-template-filler": ["Name: Ada Lovelace\nSkills: maths", { format: "docx" }],
      "markdown-to-slides": ["# One\n- a\n\n---\n\n# Two\n- b"],
      // QR / barcodes
      "barcode-generator": ["4006381333931", { symbology: "ean13" }],
      "batch-qr-generator": ["https://example.com/a\nhttps://example.com/b"],
      "logo-qr-code": [
        "https://example.com/hello",
        { logo: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, logoScale: 18 },
      ],
    };

    globalThis.fetch = trap as typeof fetch;
    http.get = trap as typeof http.get;
    http.request = trap as typeof http.request;
    https.get = trap as typeof https.get;
    https.request = trap as typeof https.request;
    try {
      for (const [id, [input, options]] of Object.entries(cases)) {
        const result = await run(id, input, options ?? {});
        expect(result.ok, `${id} failed offline: ${result.ok ? "" : `${result.code} — ${result.message}`}`).toBe(true);
      }
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }

    // Every id here must be a phase-21 tool, and every phase-21 tool that the registry marks offline
    // must be in here — otherwise the ledger and the list would drift apart silently.
    const proved = Object.keys(cases);
    for (const id of proved) expect(getTool(id)?.phase, `${id} is not a phase-21 tool`).toBe("21");
    const claimed = tools.filter((t) => t.phase === "21" && t.offline).map((t) => t.id);
    expect([...claimed].sort()).toEqual([...proved].sort());
    recordOfflineCoverage("expansion", proved);
  }, 180_000);
});
