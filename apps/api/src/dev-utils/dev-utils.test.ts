// Tests for the developer & file utilities (12-dev-utility-tools.md).
//
// The build file asks for: a unit test per formatter/encoder against known-good and known-bad
// input, hashes against published test vectors, a ZIP round trip with nested folders and mixed
// file types, and a duplicate detector that groups two identical files and leaves a third alone.
// On top of those: the Password Generator really using the CSPRNG (proved by making
// `Math.random` throw), the Regex Tester's capture groups, the File Type Converter routing to a
// tool from an earlier phase rather than converting anything itself, and an offline run of all
// twenty-five tools.
import http from "node:http";
import https from "node:https";
import {
  defaultOptionValues,
  getExecutor,
  getTool,
  getToolOptions,
  hasExecutor,
  tools,
} from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { describe, expect, it } from "vitest";

// Registering phase 09's executors is what gives the File Type Converter something to route to;
// phase 04's registers the File Metadata Viewer this phase deliberately does not reimplement.
import "../file-processing/index.ts";
import "../images/index.ts";
import { DEV_UTIL_EXECUTORS } from "./index.ts";
import { compactJs, formatSource, minifyCss, minifyHtml } from "./formatters.ts";
import { markdownToHtml, markdownToText, sanitizeHtml } from "./markdown.ts";
import { decodeBase64, encodeBase64, decodeUrl, encodeUrl, looksLikeText } from "./encoders.ts";
import {
  buildAlphabet,
  generatePassword,
  generateUuids,
  passwordEntropy,
  uuidV7,
} from "./generators.ts";
import { hashText, hashBytes, hmacText, digestsMatch } from "./hashing.ts";
import { parseTimestampInput, relativeTo, timestampViews } from "./timestamps.ts";
import { compileRegex, testRegex } from "./regex.ts";
import { parseUserAgent } from "./userAgent.ts";
import { buildZip, readZip, safeEntryPath } from "./zip.ts";
import { findRoute, mergedName, naturalCompare, splitBytes, targetsFor } from "./fileOps.ts";
import { findDuplicates } from "./duplicateDetector.ts";
import { removerRouteFor } from "./fileMeta.ts";
import { recordOfflineCoverage } from "../../../../tests/offline/coverage.ts";

// ---- helpers ----------------------------------------------------------------------------------

type Fixture = { name: string; bytes: Uint8Array; type?: string };
const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const f = (name: string, content: string | Uint8Array, type = ""): Fixture => ({
  name,
  bytes: typeof content === "string" ? enc(content) : content,
  type,
});
const tool = (id: string) => DEV_UTIL_EXECUTORS.find(([k]) => k === id)![1];

async function run(
  id: string,
  input: Fixture[] | string | null,
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  const fixtures = Array.isArray(input) ? input : [];
  const refs: FileRef[] | string | null = Array.isArray(input)
    ? input.map((x, i) => ({
        name: x.name,
        size: x.bytes.length,
        type: x.type ?? "",
        tempId: `f-${i}`,
      }))
    : input;
  const ctx: ExecContext = {
    jobId: "t",
    readFile: async (ref) => fixtures[Number(ref.tempId!.slice(2))]!.bytes,
  };
  return tool(id)(refs, options, ctx);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}
function fail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error(`expected failure, got: ${result.summary}`);
  return result;
}
function out(result: ExecResult, index = 0): OutputFile {
  const file = (ok(result).files ?? [])[index];
  if (!file) throw new Error("no output file");
  return file;
}
function output(result: ExecResult): Record<string, unknown> {
  return ok(result).output as Record<string, unknown>;
}

/** A real 1x1 PNG (a handcrafted byte array is easy to get subtly wrong, and libpng notices). */
const PNG_1PX = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
    "base64",
  ),
);

// ---- registry ---------------------------------------------------------------------------------

describe("registry", () => {
  it("registers an executor for every phase-12 tool, and each one is marked available", () => {
    for (const [id] of DEV_UTIL_EXECUTORS) {
      const meta = getTool(id);
      expect(meta, `${id} is not in the registry`).toBeTruthy();
      expect(meta!.phase, `${id} is not a phase-12 tool`).toBe("12");
      expect(meta!.status, `${id} is not marked available`).toBe("available");
      expect(meta!.network).toBe("none");
    }
  });

  it("covers every dev-utility and file-utility tool the registry lists", () => {
    const registered = new Set<string>(DEV_UTIL_EXECUTORS.map(([id]) => id));
    const owed = tools.filter((t) => t.category === "dev-utility" || t.category === "file-utility");
    expect(owed.length).toBeGreaterThan(0);
    // Every one of them runs; File Metadata Viewer's executor is phase 04's, not this phase's.
    expect(owed.filter((t) => !hasExecutor(t.id)).map((t) => t.id)).toEqual([]);
    expect(owed.filter((t) => !registered.has(t.id)).map((t) => t.id)).toEqual([
      "file-metadata-viewer",
    ]);
  });

  it("gives every option a default the tool accepts", async () => {
    for (const [id] of DEV_UTIL_EXECUTORS) {
      for (const option of getToolOptions(id)) {
        expect(option.default, `${id}.${option.id} has no default`).toBeDefined();
      }
    }
    // The generic tool page sends exactly these values, so they must not make a tool fail.
    expect(defaultOptionValues("uuid-generator").version).toBe("v4");
  });
});

// ---- formatters -------------------------------------------------------------------------------

describe("formatters", () => {
  it("pretty-prints CSS, HTML and JavaScript", async () => {
    expect(await formatSource("a{color:red;background:blue}", "css")).toBe(
      "a {\n  color: red;\n  background: blue;\n}\n",
    );
    expect(await formatSource("<div><p>hi</p></div>", "html")).toContain("<p>hi</p>");
    expect(await formatSource("const x=1;function f(){return x}", "js")).toBe(
      "const x = 1;\nfunction f() {\n  return x;\n}\n",
    );
  });

  it("reports a syntax error with its position instead of mangling the input", async () => {
    const result = fail(await run("javascript-formatter", "function ( {"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/could not be parsed at line \d+/);
    expect(result.message).not.toMatch(/at Object|node_modules/); // no stack trace in the UI
  });

  it("honours the indent and tab options", async () => {
    const four = dec(out(await run("css-formatter", "a{color:red}", { indent: 4 })).bytes);
    expect(four).toContain("    color: red;");
    const tabs = dec(out(await run("css-formatter", "a{color:red}", { tabs: true })).bytes);
    expect(tabs).toContain("\tcolor: red;");
  });

  it("minifies CSS without touching string literals or breaking selectors", () => {
    expect(minifyCss("/* c */ a > b { color : red ; }")).toBe("a>b{color:red}");
    expect(minifyCss('a::after { content: "  keep  me  " }')).toBe(
      'a::after{content:"  keep  me  "}',
    );
  });

  it("minifies HTML but leaves <pre> alone", () => {
    const html = "<div>\n  <p>a</p>\n  <pre>  keep\n  this  </pre>\n</div>";
    const min = minifyHtml(html);
    expect(min).toContain("<div><p>a</p>");
    expect(min).toContain("<pre>  keep\n  this  </pre>");
    expect(minifyHtml("<p>a</p><!-- gone --><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });

  it("compacts JavaScript without removing anything inside a literal", () => {
    const src = [
      "// a comment",
      "const url = 'http://not-a-comment';",
      "/* block */",
      "const re = /a\\/b/g; // trailing",
      "const t = `keep  // this`;",
      "  const indented = 1;",
    ].join("\n");
    const compact = compactJs(src);
    expect(compact).not.toContain("a comment");
    expect(compact).not.toContain("trailing");
    expect(compact).toContain("'http://not-a-comment'");
    expect(compact).toContain("/a\\/b/g");
    expect(compact).toContain("`keep  // this`");
    expect(compact).toContain("const indented = 1;");
    // Line structure survives, so automatic semicolon insertion cannot change meaning.
    expect(compact.split("\n").length).toBe(4);
  });

  it("refuses to minify broken input rather than producing plausible rubbish", async () => {
    const result = fail(await run("css-formatter", "a { color: red", { mode: "minify" }));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
  });

  it("says plainly that JavaScript is compacted, not fully minified", async () => {
    const result = ok(await run("javascript-formatter", "const a = 1; // hi", { mode: "minify" }));
    expect(result.summary).toMatch(/compacted/);
  });
});

// ---- markdown ---------------------------------------------------------------------------------

describe("markdown", () => {
  const source = [
    "# Title",
    "",
    "Some **bold** and a [link](https://example.com).",
    "",
    "- one",
    "- two",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```js",
    "const x = 1;",
    "```",
  ].join("\n");

  it("renders HTML, including GitHub tables", () => {
    const html = markdownToHtml(source);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<table>");
    expect(html).toContain("<li>one</li>");
  });

  it("wraps the fragment in a complete page when asked", () => {
    const page = markdownToHtml("# Hi", { fullDocument: true, title: "notes" });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("<title>notes</title>");
  });

  it("strips scripts from raw HTML unless they are explicitly kept", () => {
    const risky = 'Hello\n\n<script>alert(1)</script>\n\n<p onclick="steal()">x</p>';
    expect(markdownToHtml(risky)).not.toContain("alert(1)");
    expect(markdownToHtml(risky)).not.toContain("onclick");
    expect(markdownToHtml(risky, { rawHtml: true })).toContain("alert(1)");
    expect(sanitizeHtml('<a href="javascript:evil()">x</a>')).toContain('href="#"');
  });

  it("renders plain text with the formatting markers gone", () => {
    const text = markdownToText(source);
    expect(text).toContain("Title");
    expect(text).not.toContain("**");
    expect(text).toContain("- one");
    expect(text).toContain("link (https://example.com)");
    expect(text).toContain("    const x = 1;");
  });

  it("produces a real .docx", async () => {
    const file = out(await run("markdown-converter", source, { target: "docx" }));
    expect(file.name.endsWith(".docx")).toBe(true);
    // PK.. — an OOXML package, not a text file with the wrong extension.
    expect([...file.bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(file.bytes.length).toBeGreaterThan(1000);
  });

  it("Markdown → HTML always gives HTML, whatever the options say", async () => {
    const file = out(await run("markdown-to-html", "# Hi", { target: "txt" }));
    expect(file.name.endsWith(".html")).toBe(true);
  });
});

// ---- encoders ---------------------------------------------------------------------------------

describe("Base64", () => {
  it("matches the RFC 4648 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(encodeBase64(enc(plain))).toBe(encoded);
      if (plain !== "") expect(dec(decodeBase64(encoded).bytes)).toBe(plain);
    }
  });

  it("round-trips arbitrary bytes, including the URL-safe alphabet", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    for (const variant of ["standard", "urlsafe"] as const) {
      const text = encodeBase64(bytes, { variant });
      expect([...decodeBase64(text).bytes]).toEqual([...bytes]);
    }
    expect(encodeBase64(new Uint8Array([251, 255]), { variant: "urlsafe" })).toBe("-_8");
  });

  it("wraps lines and reads them back", () => {
    const text = encodeBase64(enc("x".repeat(200)), { wrap: 76 });
    expect(text.split("\n").every((line) => line.length <= 76)).toBe(true);
    expect(dec(decodeBase64(text).bytes)).toBe("x".repeat(200));
  });

  it("understands data: URLs and gives back a typed file", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(PNG_1PX).toString("base64")}`;
    const result = ok(await run("base64-decoder", dataUrl));
    expect(out(result).mimeType).toBe("image/png");
    expect(out(result).name.endsWith(".png")).toBe(true);
    expect([...out(result).bytes]).toEqual([...PNG_1PX]);
  });

  it("rejects input that is not Base64, saying where", () => {
    expect(() => decodeBase64("not base64!!")).toThrow(/not valid Base64/);
    expect(() => decodeBase64("Zm9vYmF")).toThrow(/incomplete/);
    expect(() => decodeBase64("data:text/plain,hello")).toThrow(/not Base64-encoded/);
  });

  it("encodes an uploaded file as well as typed text", async () => {
    const result = ok(
      await run("base64-encoder", [f("pixel.png", PNG_1PX, "image/png")], { dataUrl: true }),
    );
    expect(String(output(result).result)).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it("tells text from binary", () => {
    expect(looksLikeText(enc("héllo\nworld"))).toBe(true);
    expect(looksLikeText(PNG_1PX)).toBe(false);
  });
});

describe("URL encoding", () => {
  it("encodes each style the way that style is defined", () => {
    expect(encodeUrl("a b&c=d", "component")).toBe("a%20b%26c%3Dd");
    expect(encodeUrl("a b&c=d", "form")).toBe("a+b%26c%3Dd");
    expect(encodeUrl("https://x.test/a b?q=1&r=2", "uri")).toBe("https://x.test/a%20b?q=1&r=2");
  });

  it("round-trips and reports a bad escape sequence clearly", () => {
    for (const mode of ["component", "form", "uri"] as const) {
      expect(decodeUrl(encodeUrl("ünïcode /?&=", mode), mode)).toBe("ünïcode /?&=");
    }
    expect(() => decodeUrl("%zz", "component")).toThrow(/not followed by two hex digits/);
  });

  it("breaks a decoded URL into its parts", async () => {
    const result = ok(await run("url-decoder", "https%3A%2F%2Fx.test%2Fp%3Fq%3D1"));
    expect((output(result).parts as Record<string, unknown>).host).toBe("x.test");
  });

  it("can work line by line", async () => {
    const result = ok(await run("url-encoder", "a b\nc d", { perLine: true }));
    expect(output(result).result).toBe("a%20b\nc%20d");
  });
});

// ---- generators -------------------------------------------------------------------------------

describe("UUID Generator", () => {
  it("makes well-formed, unique version 4 UUIDs", () => {
    const uuids = generateUuids(200, "v4");
    expect(new Set(uuids).size).toBe(200);
    for (const uuid of uuids) {
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("makes version 7 UUIDs that sort by the time they were made", () => {
    const early = uuidV7(1_700_000_000_000);
    const late = uuidV7(1_800_000_000_000);
    expect(early < late).toBe(true);
    expect(early[14]).toBe("7");
    expect("89ab").toContain(early[19]);
  });

  it("applies the formatting options", async () => {
    const result = ok(
      await run("uuid-generator", null, {
        count: 3,
        uppercase: true,
        noHyphens: true,
        braces: true,
      }),
    );
    const uuids = output(result).uuids as string[];
    expect(uuids).toHaveLength(3);
    expect(uuids[0]).toMatch(/^\{[0-9A-F]{32}\}$/);
  });
});

describe("Password Generator", () => {
  it("never falls back to Math.random", () => {
    const saved = Math.random;
    Math.random = () => {
      throw new Error("Math.random must not be used for passwords");
    };
    try {
      const password = generatePassword({ length: 32, symbols: true });
      expect(password).toHaveLength(32);
    } finally {
      Math.random = saved;
    }
  });

  it("includes every character class that is switched on", () => {
    for (let i = 0; i < 40; i += 1) {
      const password = generatePassword({ length: 8, symbols: true });
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("does not park the guaranteed characters at the front", () => {
    const firsts = new Set(
      Array.from({ length: 60 }, () => generatePassword({ length: 12, symbols: true })[0]),
    );
    expect(firsts.size).toBeGreaterThan(4);
  });

  it("leaves out look-alike characters when asked", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(generatePassword({ length: 24, avoidAmbiguous: true, symbols: true })).not.toMatch(
        /[Il1O0o]/,
      );
    }
    expect(buildAlphabet({ avoidAmbiguous: true }).alphabet).not.toContain("0");
  });

  it("reports entropy honestly and refuses an empty alphabet", async () => {
    expect(passwordEntropy(20, 62)).toBe(119);
    const result = fail(
      await run("password-generator", null, {
        lower: false,
        upper: false,
        digits: false,
        symbols: false,
      }),
    );
    expect(result.message).toMatch(/at least one character type/);
  });

  it("generates the requested number of passwords", async () => {
    const result = ok(await run("password-generator", null, { count: 5, length: 16 }));
    const passwords = output(result).passwords as string[];
    expect(passwords).toHaveLength(5);
    expect(new Set(passwords).size).toBe(5);
    expect(passwords.every((p) => p.length === 16)).toBe(true);
  });
});

// ---- hashing ----------------------------------------------------------------------------------

describe("hashing", () => {
  it('matches the published test vectors for the empty string and "abc"', () => {
    expect(hashText("", "md5")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hashText("abc", "md5")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hashText("", "sha1")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(hashText("abc", "sha1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hashText("", "sha256")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hashText("abc", "sha256")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashText("abc", "sha512").slice(0, 32)).toBe("ddaf35a193617abacc417349ae204131");
    expect(hashText("abc", "crc32")).toBe("352441c2");
  });

  it("matches RFC 2202's HMAC-MD5 vector", () => {
    expect(hmacText("Hi There", "\x0b".repeat(16), "md5")).toBe("9294727a3638bb1c13f48ef8158bfc9d");
  });

  it("can render a digest as Base64", () => {
    expect(hashText("abc", "sha256", "base64")).toBe(
      "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
  });

  it("compares digests without leaking timing, and only when they are equal", () => {
    expect(digestsMatch("ABCDEF", "abcdef")).toBe(true);
    expect(digestsMatch("abcdef", "abcdeg")).toBe(false);
    expect(digestsMatch("abc", "abcdef")).toBe(false);
  });

  it("hashes text through the tool and labels the legacy algorithms", async () => {
    const result = ok(await run("hash-generator", "abc", { algorithm: "all" }));
    const hashes = output(result).hashes as Record<string, string>;
    expect(hashes["SHA-256"]).toBe(hashText("abc", "sha256"));
    expect(result.summary).toMatch(/must not be used for passwords/);
  });

  it("checksums files and verifies against a published value", async () => {
    const files = [f("a.txt", "abc"), f("b.txt", "different")];
    const result = ok(
      await run("checksum-generator", files, { expected: hashText("abc", "sha256") }),
    );
    const verification = output(result).verification as { ok: boolean; matched: string[] };
    expect(verification.ok).toBe(true);
    expect(verification.matched).toEqual(["a.txt"]);
    // The output file is in `sha256sum` format, so the standard tools can read it.
    expect(dec(out(result).bytes)).toContain(`${hashText("abc", "sha256")}  a.txt`);
  });

  it("says so when nothing matches the expected checksum", async () => {
    const result = ok(
      await run("checksum-generator", [f("a.txt", "abc")], { expected: "deadbeef" }),
    );
    expect(result.summary).toMatch(/None of these files matches/);
  });
});

// ---- timestamps -------------------------------------------------------------------------------

describe("Timestamp Converter", () => {
  it("tells seconds from milliseconds by magnitude", () => {
    expect(parseTimestampInput("1700000000").date.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseTimestampInput("1700000000000").date.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z",
    );
    expect(parseTimestampInput("1700000000", "milliseconds").date.toISOString()).toBe(
      "1970-01-20T superseded".slice(0, 0) + new Date(1700000000).toISOString(),
    );
  });

  it("reads a calendar date and the word now", () => {
    expect(parseTimestampInput("2023-11-14T22:13:20Z").date.getTime()).toBe(1700000000000);
    expect(parseTimestampInput("now").interpretation).toBe("the current time");
  });

  it("refuses what is not a date, with a usable message", () => {
    expect(() => parseTimestampInput("tomorrow-ish")).toThrow(/not a timestamp or a date/);
  });

  it("gives every representation, including the spreadsheet serial", () => {
    const views = timestampViews(new Date("2023-11-14T22:13:20Z"), "UTC");
    expect(views.unixSeconds).toBe(1700000000);
    expect(views.iso8601).toBe("2023-11-14T22:13:20.000Z");
    expect(views.dayOfWeek).toBe("Tuesday");
    expect(Math.round(views.excelSerial)).toBe(45245);
  });

  it("shows the time in the browser's zone when the page supplies it", async () => {
    const result = ok(await run("timestamp-converter", "1700000000", { timeZone: "Asia/Kolkata" }));
    expect(output(result).timeZone).toBe("Asia/Kolkata");
    expect(String(output(result).local)).toContain("15 November 2023");
    // An unknown zone falls back to UTC rather than failing.
    const fallback = ok(
      await run("timestamp-converter", "1700000000", { timeZone: "Mars/Olympus" }),
    );
    expect(output(fallback).timeZone).toBe("UTC");
  });

  it("describes how long ago something was", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    expect(relativeTo(new Date("2023-12-31T23:59:00Z"), now)).toBe("1 minute ago");
    expect(relativeTo(new Date("2024-01-03T00:00:00Z"), now)).toBe("in 2 days");
  });
});

// ---- regex ------------------------------------------------------------------------------------

describe("Regex Tester", () => {
  const sample = "ada@example.com and grace@navy.mil";

  it("reports each match with its position and capture groups", () => {
    const report = testRegex(sample, "(\\w+)@([\\w.]+)", "g");
    expect(report.matchCount).toBe(2);
    expect(report.matches[0]!.text).toBe("ada@example.com");
    expect(report.matches[0]!.index).toBe(0);
    expect(report.matches[0]!.line).toBe(1);
    expect(report.matches[0]!.column).toBe(1);
    expect(report.matches[0]!.groups).toEqual(["ada", "example.com"]);
    expect(report.matches[1]!.groups).toEqual(["grace", "navy.mil"]);
  });

  it("reports named groups", () => {
    const report = testRegex(sample, "(?<user>\\w+)@(?<host>[\\w.]+)", "g");
    expect(report.matches[0]!.named).toEqual({ user: "ada", host: "example.com" });
    expect(report.groupNames).toEqual(["user", "host"]);
  });

  it("splits the sample into segments a highlighter can use", () => {
    const report = testRegex("a1b2", "\\d", "g");
    expect(report.segments.map((s) => s.text)).toEqual(["a", "1", "b", "2"]);
    expect(report.segments.map((s) => s.match)).toEqual([false, true, false, true]);
    expect(report.highlighted).toBe("a\u00AB1\u00BBb\u00AB2\u00BB");
  });

  it("tracks line and column across newlines", () => {
    const report = testRegex("one\ntwo\nthree", "t\\w+", "g");
    expect(report.matches[0]).toMatchObject({ line: 2, column: 1 });
    expect(report.matches[1]).toMatchObject({ line: 3, column: 1 });
  });

  it("refuses a pattern that could backtrack catastrophically", () => {
    expect(() => compileRegex("(a+)+$", "")).toThrow(/nests one repeat inside another/);
    expect(() => compileRegex("(", "")).toThrow(/not a valid regular expression/);
    expect(() => compileRegex("", "")).toThrow(/Enter a regular expression/);
  });

  it("stops at the match limit rather than running away", () => {
    const report = testRegex("a".repeat(100), "a", "g", { limit: 10 });
    expect(report.matchCount).toBe(10);
    expect(report.truncated).toBe(true);
  });

  it("can replace and split as well as match", async () => {
    const replaced = ok(
      await run("regex-tester", sample, {
        pattern: "(\\w+)@[\\w.]+",
        mode: "replace",
        replacement: "$1",
      }),
    );
    expect(output(replaced).replaced).toBe("ada and grace");
    const split = ok(await run("regex-tester", "a, b ,c", { pattern: "\\s*,\\s*", mode: "split" }));
    expect(output(split).parts).toEqual(["a", "b", "c"]);
  });

  it("says clearly when nothing matched", async () => {
    const result = ok(await run("regex-tester", "hello", { pattern: "\\d+" }));
    expect(result.summary).toMatch(/^No matches/);
  });
});

// ---- user agent -------------------------------------------------------------------------------

describe("User-Agent Viewer", () => {
  it("reads the common browsers, including the ones pretending to be Chrome", () => {
    const chrome = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    expect(chrome.browser).toMatchObject({ name: "Chrome", version: "120.0.0.0" });
    expect(chrome.os).toMatchObject({ name: "Windows", version: "10 or 11" });
    expect(chrome.device.type).toBe("desktop");

    const edge = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    );
    expect(edge.browser!.name).toBe("Microsoft Edge");

    const iphone = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    );
    expect(iphone.browser!.name).toBe("Safari");
    expect(iphone.os).toMatchObject({ name: "iOS", version: "17.1" });
    expect(iphone.device).toMatchObject({ type: "mobile", vendor: "Apple" });

    const ipad = parseUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );
    expect(ipad.device.type).toBe("tablet");
  });

  it("spots a crawler", () => {
    const bot = parseUserAgent(
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    );
    expect(bot.bot).toBe(true);
    expect(bot.device.type).toBe("bot");
  });

  it("asks the browser for the string and fails helpfully without one", async () => {
    const result = ok(await run("user-agent-viewer", null, { userAgent: "curl/8.4.0" }));
    expect((output(result).browser as { name: string }).name).toBe("curl");
    expect(fail(await run("user-agent-viewer", null, {})).message).toMatch(/did not share/);
  });
});

// ---- ZIP --------------------------------------------------------------------------------------

describe("ZIP tools", () => {
  const mixed: Fixture[] = [
    f("notes.txt", "hello world"),
    f("data.json", JSON.stringify({ a: 1 })),
    f("pixel.png", PNG_1PX, "image/png"),
    f("empty-ish.csv", "a,b\n1,2\n"),
  ];

  it("round-trips a folder of mixed file types without corruption", async () => {
    const zipped = out(await run("zip-creator", mixed));
    expect(zipped.mimeType).toBe("application/zip");
    const extracted = await readZip(zipped.bytes);
    expect(extracted).toHaveLength(mixed.length);
    for (const original of mixed) {
      const found = extracted.find((e) => e.name === original.name);
      expect(found, `${original.name} is missing from the archive`).toBeTruthy();
      expect([...found!.bytes]).toEqual([...original.bytes]);
    }
  });

  it("round-trips nested folders, flattening the names safely", async () => {
    const nested = await buildZip(
      [
        { name: "docs/readme.txt", bytes: enc("top") },
        { name: "docs/deep/inner.txt", bytes: enc("deep") },
        { name: "../../escape.txt", bytes: enc("nope") },
        { name: "C:\\Windows\\evil.txt", bytes: enc("nope") },
      ],
      9,
    );
    const entries = await readZip(nested);
    const names = entries.map((e) => e.name);
    expect(names.every((n) => !n.includes("/") && !n.includes("\\") && !n.includes(".."))).toBe(
      true,
    );
    expect(dec(entries.find((e) => e.name.includes("readme"))!.bytes)).toBe("top");
    expect(dec(entries.find((e) => e.name.includes("inner"))!.bytes)).toBe("deep");
  });

  it("closes zip-slip on every shape of malicious name", () => {
    for (const evil of [
      "../../etc/passwd",
      "..\\..\\windows\\system32\\a.dll",
      "/etc/shadow",
      "C:/boot.ini",
      "....//x.txt",
    ]) {
      const safe = safeEntryPath(evil);
      expect(safe).not.toContain("/");
      expect(safe).not.toContain("\\");
      expect(safe.startsWith("..")).toBe(false);
    }
    // Entries with no extension still get a usable download name.
    expect(safeEntryPath("LICENSE")).toBe("LICENSE.bin");
  });

  it("actually compresses, and says when a file was already compressed", async () => {
    const compressible = f("repeat.txt", "abcdefgh".repeat(4000));
    const result = ok(await run("file-compressor", [compressible]));
    const { bytesBefore, bytesAfter } = output(result) as {
      bytesBefore: number;
      bytesAfter: number;
    };
    expect(bytesAfter).toBeLessThan(bytesBefore / 5);
    const packed = ok(await run("file-compressor", [f("pixel.png", PNG_1PX, "image/png")]));
    expect(output(packed).alreadyCompressed).toEqual(["pixel.png"]);
  });

  it("extracts an archive, skipping empty entries and filtering by type", async () => {
    const archive = await buildZip(
      [
        { name: "a.txt", bytes: enc("one") },
        { name: "b.json", bytes: enc("{}") },
        { name: "nothing.txt", bytes: new Uint8Array(0) },
      ],
      6,
    );
    const result = ok(await run("zip-extractor", [f("bundle.zip", archive, "application/zip")]));
    expect((ok(result).files ?? []).map((x) => x.name).sort()).toEqual(["a.txt", "b.json"]);
    expect(output(result).skippedEmpty).toEqual(["nothing.txt"]);

    const filtered = ok(
      await run("zip-extractor", [f("bundle.zip", archive, "application/zip")], { only: "json" }),
    );
    expect((ok(filtered).files ?? []).map((x) => x.name)).toEqual(["b.json"]);
  });

  it("refuses something that is not a ZIP, and an archive with nothing in it", async () => {
    expect(fail(await run("zip-extractor", [f("fake.zip", "not a zip at all")])).message).toMatch(
      /not a readable ZIP/,
    );
    const emptyArchive = await buildZip([{ name: "gone.txt", bytes: new Uint8Array(0) }], 6);
    expect(fail(await run("zip-extractor", [f("e.zip", emptyArchive)])).message).toMatch(/empty/);
  });
});

// ---- split / merge ----------------------------------------------------------------------------

describe("File Splitter and Merger", () => {
  const original = new Uint8Array(25_000).map((_, i) => (i * 7) % 256);

  it("splits into parts and merges them back byte for byte", async () => {
    const parts = splitBytes(original, "video.mp4", { partBytes: 10_000 });
    expect(parts.map((p) => p.name)).toEqual([
      "video.mp4.part001",
      "video.mp4.part002",
      "video.mp4.part003",
    ]);
    expect(parts[2]!.bytes.length).toBe(5_000);

    const merged = ok(
      await run(
        "file-merger",
        parts.map((p) => f(p.name, p.bytes)),
      ),
    );
    expect(out(merged).name).toBe("video.mp4");
    expect([...out(merged).bytes]).toEqual([...original]);
  });

  it("splits by a number of parts too, and packages the rejoin instructions", async () => {
    const result = ok(
      await run("file-splitter", [f("big.bin", original)], { by: "count", parts: 4 }),
    );
    const entries = await readZip(out(result).bytes);
    expect(entries.filter((e) => /\.part\d+$/.test(e.name))).toHaveLength(4);
    const note = entries.find((e) => e.name.endsWith("-rejoin.txt"))!;
    expect(dec(note.bytes)).toContain("cat big.bin.part001");
  });

  it("orders parts naturally, so part10 comes after part9", () => {
    expect(["a.part10", "a.part9", "a.part1"].sort(naturalCompare)).toEqual([
      "a.part1",
      "a.part9",
      "a.part10",
    ]);
  });

  it("refuses to merge when a part is missing rather than writing a corrupt file", async () => {
    const parts = splitBytes(original, "video.mp4", { partBytes: 10_000 });
    const result = fail(
      await run("file-merger", [
        f(parts[0]!.name, parts[0]!.bytes),
        f(parts[2]!.name, parts[2]!.bytes),
      ]),
    );
    expect(result.message).toMatch(/Part 2 is missing/);
  });

  it("names the merged file after the parts", () => {
    const fx = (name: string) => ({
      ref: { name, size: 1, type: "" },
      bytes: new Uint8Array(1),
      ext: "",
      name,
    });
    expect(mergedName([fx("clip.mov.part001"), fx("clip.mov.part002")])).toBe("clip.mov");
  });

  it("ignores the rejoin note if it is uploaded along with the parts", async () => {
    const parts = splitBytes(original, "big.bin", { partBytes: 10_000 });
    const merged = ok(
      await run("file-merger", [
        ...parts.map((p) => f(p.name, p.bytes)),
        f("big-rejoin.txt", "instructions"),
      ]),
    );
    expect([...out(merged).bytes]).toEqual([...original]);
  });
});

// ---- File Type Converter ----------------------------------------------------------------------

describe("File Type Converter", () => {
  it("routes to the tool from the phase that owns the format, rather than converting itself", () => {
    const route = findRoute("png", "jpg");
    expect(route).toBeTruthy();
    expect(route!.tool.phase).toBe("09");
    expect(route!.tool.category).toBe("images");
    // And it knows which option makes that tool produce the requested format.
    expect(route!.formatOption).toBe("format");
  });

  it("really converts through the delegate", async () => {
    const result = ok(
      await run("file-type-converter", [f("pixel.png", PNG_1PX, "image/png")], { target: "jpg" }),
    );
    expect(out(result).name.toLowerCase()).toMatch(/\.jpe?g$/);
    // FF D8 FF — a real JPEG, produced by phase 09's converter.
    expect([...out(result).bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(
      String(output(result).routedTo ? JSON.stringify(output(result).routedTo) : ""),
    ).toContain("Image");
  });

  it("lists what it can do instead when the conversion does not exist", async () => {
    const result = fail(
      await run("file-type-converter", [f("pixel.png", PNG_1PX, "image/png")], { target: "mp3" }),
    );
    expect(result.message).toMatch(/cannot turn a \.png file into \.mp3/);
    expect(result.message).toMatch(/From \.png it can make/);
    expect(targetsFor("png")).toContain("jpg");
  });

  it("says so rather than doing nothing when the file is already that type", async () => {
    const result = fail(
      await run("file-type-converter", [f("pixel.png", PNG_1PX)], { target: "png" }),
    );
    expect(result.message).toMatch(/already a \.png file/);
  });

  it("never routes to a tool that takes anything, which would match every request", () => {
    for (const target of ["pdf", "json", "png"]) {
      const route = findRoute("zip", target);
      expect(route?.tool.id).not.toBe("file-type-converter");
    }
  });
});

// ---- metadata ---------------------------------------------------------------------------------

describe("Metadata Remover", () => {
  it("leaves the File Metadata Viewer to phase 04, which already built it for real", () => {
    // Phase 12 only promotes it to "available"; there must not be a second implementation.
    expect(DEV_UTIL_EXECUTORS.map(([id]) => id)).not.toContain("file-metadata-viewer");
    expect(hasExecutor("file-metadata-viewer")).toBe(true);
    expect(getTool("file-metadata-viewer")!.status).toBe("available");
  });

  it("routes metadata removal to the tool that knows the format", () => {
    expect(removerRouteFor("jpg")).toEqual({ toolId: "remove-image-metadata" });
    expect(removerRouteFor("pdf")).toEqual({ toolId: "remove-pdf-metadata" });
    expect(removerRouteFor("docx")!.toolId).toBe("document-metadata");
    expect(removerRouteFor("bin")).toBeNull();
  });

  it("really strips the metadata, through the phase-09 tool", async () => {
    const result = ok(await run("metadata-remover", [f("pixel.png", PNG_1PX, "image/png")]));
    expect(output(result).cleaned).toEqual(["pixel.png"]);
    expect(out(result).bytes.length).toBeGreaterThan(0);
  });

  it("explains itself for a format nothing can clean", async () => {
    const result = fail(await run("metadata-remover", [f("notes.txt", "hello")]));
    expect(result.message).toMatch(/no metadata stripper for \.txt/);
  });

  it("cleans what it can and names what it could not", async () => {
    const result = ok(
      await run("metadata-remover", [f("pixel.png", PNG_1PX, "image/png"), f("notes.txt", "hi")]),
    );
    expect(output(result).cleaned).toEqual(["pixel.png"]);
    expect(result.summary).toMatch(/notes\.txt/);
  });
});

// ---- duplicates -------------------------------------------------------------------------------

describe("Duplicate File Detector", () => {
  it("groups the two identical files and leaves the different one alone", async () => {
    const files = [
      f("a.txt", "same content"),
      f("b.txt", "same content"),
      f("c.txt", "other content"),
    ];
    const result = ok(await run("duplicate-file-detector", files));
    const report = output(result) as unknown as {
      groups: { files: string[]; sha256: string }[];
      unique: string[];
    };
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]!.files.sort()).toEqual(["a.txt", "b.txt"]);
    expect(report.groups[0]!.sha256).toBe(hashBytes(enc("same content"), "sha256"));
    expect(report.unique).toEqual(["c.txt"]);
  });

  it("does not flag similar-but-different files, even at the same size", () => {
    const fx = (name: string, text: string) => ({
      ref: { name, size: text.length, type: "" },
      bytes: enc(text),
      ext: "txt",
      name,
    });
    const report = findDuplicates([fx("x.txt", "aaaaaaaa"), fx("y.txt", "aaaaaaab")]);
    expect(report.groups).toHaveLength(0);
    expect(report.duplicateFiles).toBe(0);
  });

  it("counts the space that could be freed", async () => {
    const payload = "x".repeat(1000);
    const files = [f("1.bin", payload), f("2.bin", payload), f("3.bin", payload)];
    const result = ok(await run("duplicate-file-detector", files));
    expect(output(result).wastedBytes).toBe(2000);
    expect(result.summary).toMatch(/2 copies could be deleted/);
    expect(dec(out(result).bytes)).toMatch(/keep:\s+1\.bin/);
  });

  it("says plainly when there is nothing to clean up", async () => {
    const result = ok(await run("duplicate-file-detector", [f("a.txt", "one"), f("b.txt", "two")]));
    expect(result.summary).toMatch(/No duplicates/);
  });
});

// ---- offline ----------------------------------------------------------------------------------

describe("offline", () => {
  it("runs every phase-12 tool with the network trapped", async () => {
    const trap = () => {
      throw new Error("network access attempted");
    };
    const saved = {
      fetch: globalThis.fetch,
      hg: http.get,
      hr: http.request,
      sg: https.get,
      sr: https.request,
    };
    globalThis.fetch = trap as typeof fetch;
    http.get = trap as typeof http.get;
    http.request = trap as typeof http.request;
    https.get = trap as typeof https.get;
    https.request = trap as typeof https.request;
    try {
      const parts = splitBytes(enc("0123456789".repeat(50)), "data.bin", { partBytes: 200 });
      const archive = await buildZip([{ name: "inside.txt", bytes: enc("hello") }], 6);
      const cases: Record<string, [Fixture[] | string | null, Record<string, unknown>?]> = {
        "html-formatter": ["<p>hi</p>"],
        "css-formatter": ["a{color:red}"],
        "javascript-formatter": ["const a=1"],
        "markdown-converter": ["# Hi", { target: "docx" }],
        "markdown-to-html": ["# Hi"],
        "base64-encoder": ["hello"],
        "base64-decoder": ["aGVsbG8="],
        "url-encoder": ["a b"],
        "url-decoder": ["a%20b"],
        "uuid-generator": [null],
        "password-generator": [null],
        "hash-generator": ["abc"],
        "timestamp-converter": ["1700000000"],
        "regex-tester": ["abc", { pattern: "b" }],
        "user-agent-viewer": [null, { userAgent: "curl/8.4.0" }],
        "file-compressor": [[f("a.txt", "hello")]],
        "zip-creator": [[f("a.txt", "hello")]],
        "zip-extractor": [[f("bundle.zip", archive, "application/zip")]],
        "file-merger": [parts.map((p) => f(p.name, p.bytes))],
        "file-splitter": [[f("data.bin", "x".repeat(500))], { by: "count", parts: 2 }],
        "file-type-converter": [[f("pixel.png", PNG_1PX, "image/png")], { target: "jpg" }],
        "metadata-remover": [[f("pixel.png", PNG_1PX, "image/png")]],
        "checksum-generator": [[f("a.txt", "hello")]],
        "duplicate-file-detector": [[f("a.txt", "x"), f("b.txt", "x")]],
      };
      expect(Object.keys(cases).sort()).toEqual(DEV_UTIL_EXECUTORS.map(([id]) => id).sort());
      for (const [id, [input, options]] of Object.entries(cases)) {
        const result = await run(id, input, options ?? {});
        expect(result.ok, `${id} failed offline: ${result.ok ? "" : result.message}`).toBe(true);
      }
      // File Metadata Viewer belongs to this phase in the catalogue but is phase 04's executor,
      // so it is not in DEV_UTIL_EXECUTORS - and the registry still flags it offline. Prove it
      // here rather than leave the one claim in the list with nothing behind it (19-testing.md).
      const metaBytes = enc("hello");
      const metadata = await getExecutor(getTool("file-metadata-viewer")!)(
        [{ name: "a.txt", size: metaBytes.length, type: "text/plain", tempId: "f-0" }],
        {},
        { jobId: "t", readFile: async () => metaBytes },
      );
      expect(metadata.ok, "file-metadata-viewer failed offline").toBe(true);
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }
    recordOfflineCoverage("dev-utils", [
      ...DEV_UTIL_EXECUTORS.map(([id]) => id),
      "file-metadata-viewer",
    ]);
  });
});
