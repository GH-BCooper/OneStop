// Tests for the Word & PowerPoint tools (07-word-ppt-tools.md): fixture round trips per
// conversion, multi-file merges, slide renumbering, metadata strip + re-read, the no-LibreOffice
// fallback path, and an offline test that runs every tool with the network trapped.
import http from "node:http";
import https from "node:https";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeScannedPdf, makeTextPdf } from "../pdf/fixtures.ts";
import { pageText, withPdfJs } from "../pdf/render.ts";
import { setLibreOfficeLocator } from "../shared/office-convert.ts";
import { rtfToText } from "../shared/office/rtf.ts";
import { compressDocumentsExecutor, compressPresentationExecutor } from "./compress.ts";
import {
  documentToImagesExecutor,
  documentToPdfExecutor,
  powerPointToImagesExecutor,
  powerPointToPdfExecutor,
  wordToExcelExecutor,
  wordToHtmlExecutor,
  wordToPdfExecutor,
  wordToTextExecutor,
} from "./convert.ts";
import { LONG_TEXT, makeDocx, makeNoisyPng, makeOdt, makePptx, RTF_FIXTURE } from "./fixtures.ts";
import { DOCUMENT_EXECUTORS } from "./index.ts";
import { documentMetadataExecutor, readOoxmlMetadata } from "./metadata.ts";
import { ocrToWordExecutor } from "./ocrToWord.ts";
import {
  extractSlidesExecutor,
  mergePresentationsExecutor,
  powerPointToTextExecutor,
  rearrangeSlidesExecutor,
  removeSlidesExecutor,
  splitPresentationExecutor,
} from "./powerpoint.ts";
import { openDeck, slideTexts } from "./slides.ts";
import { formatText, titleCase } from "./text/formatter.ts";
import { applyFixes, checkGrammar } from "./text/grammar.ts";
import { splitSentences, summarize } from "./text/summarize.ts";
import { translateText } from "./text/translate.ts";
import {
  documentSummarizerExecutor,
  documentTranslatorExecutor,
  grammarCheckerExecutor,
  textFormatterExecutor,
} from "./textTools.ts";
import { mergeDocumentsExecutor, splitDocumentsExecutor } from "./wordStructure.ts";

// ---- helpers ----------------------------------------------------------------------------------

type Exec = (typeof DOCUMENT_EXECUTORS)[number][1];
type Fixture = { name: string; bytes: Uint8Array };

function inputs(files: Fixture[]): { refs: FileRef[]; ctx: ExecContext } {
  const refs: FileRef[] = files.map((f, i) => ({
    name: f.name,
    size: f.bytes.length,
    type: "",
    tempId: `fixture-${i}`,
  }));
  const byId = new Map(refs.map((ref, i) => [ref.tempId!, files[i]!.bytes]));
  return {
    refs,
    ctx: {
      jobId: "test-job",
      readFile: async (file) => {
        const bytes = byId.get(file.tempId ?? "");
        if (!bytes) throw new Error("unknown temp id");
        return bytes;
      },
    },
  };
}

async function run(
  executor: Exec,
  files: Fixture[] | string,
  options: Record<string, unknown> = {},
) {
  if (typeof files === "string") {
    return executor(files, options, { jobId: "t", readFile: async () => new Uint8Array() });
  }
  const { refs, ctx } = inputs(files);
  return executor(refs, options, ctx);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

function fail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error(`expected a failure, got success: ${result.summary}`);
  return result;
}

function file(result: ExecResult, ext?: string): OutputFile {
  const files = ok(result).files ?? [];
  const found = ext ? files.find((f) => f.name.endsWith(`.${ext}`)) : files[0];
  expect(found, `no .${ext ?? "any"} output`).toBeDefined();
  return found!;
}

const text = (f: OutputFile) => new TextDecoder().decode(f.bytes);

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  return withPdfJs(bytes, async (doc) => {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) out.push(await pageText(doc, n));
    return out;
  });
}

async function docxRaw(bytes: Uint8Array): Promise<string> {
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

async function zipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name]!.dir) out.set(name, await zip.file(name)!.async("uint8array"));
  }
  return out;
}

async function deckTexts(bytes: Uint8Array): Promise<string[]> {
  return (await slideTexts(await openDeck(bytes))).map((s) => s.text.join(" "));
}

async function slideNumberFields(bytes: Uint8Array): Promise<string[]> {
  const deck = await openDeck(bytes);
  const out: string[] = [];
  for (const s of deck.slides) {
    const xml = await deck.zip.file(s.path)!.async("string");
    out.push(/<a:fld\b[^>]*type="slidenum"[^>]*>[\s\S]*?<a:t>([^<]*)<\/a:t>/.exec(xml)?.[1] ?? "?");
  }
  return out;
}

let report: Uint8Array;
let chapters: Uint8Array;
let paged: Uint8Array;
let deck5: Uint8Array;
let deck2: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  const { makePng } = await import("../pdf/fixtures.ts");
  png = await makePng();
  report = await makeDocx({
    title: "Quarterly Report",
    creator: "Jane Secret",
    description: "Internal only",
    keywords: "finance, q3",
    header: "Report header",
    paragraphs: [
      "# Quarterly Report",
      "Revenue grew strongly this quarter.",
      "## Details",
      "Costs were flat.",
    ],
    table: [
      ["Region", "Sales"],
      ["North", "1200"],
      ["South", "950.5"],
    ],
    image: png,
    list: ["First point", "Second point"],
    footnote: "Source: internal ledger.",
    comment: { author: "Jane Secret", text: "Check this number." },
  });
  chapters = await makeDocx({
    paragraphs: [
      "# Chapter One",
      "Alpha text.",
      "# Chapter Two",
      "Beta text.",
      "# Chapter Three",
      "Gamma text.",
    ],
  });
  paged = await makeDocx({
    paragraphs: ["Page one text.", ">> Page two text.", ">> Page three text."],
  });
  deck5 = await makePptx({ slides: 5, prefix: "Main", title: "Main deck", author: "Deck Author" });
  deck2 = await makePptx({ slides: 2, prefix: "Extra", layout: "LAYOUT_4x3" });
}, 60_000);

afterEach(() => setLibreOfficeLocator(null));

// ---- registry ---------------------------------------------------------------------------------

describe("registry", () => {
  it("registers all 24 phase-07 tools as available, local and offline-verified", () => {
    expect(DOCUMENT_EXECUTORS).toHaveLength(24);
    for (const [id] of DOCUMENT_EXECUTORS) {
      const tool = getTool(id);
      expect(tool, `missing registry entry for ${id}`).toBeDefined();
      expect(tool!.phase).toBe("07");
      expect(tool!.status).toBe("available");
      expect(tool!.execution).toBe("local");
      expect(tool!.network).toBe("none");
      expect(tool!.offline, `${id} passed the offline test below`).toBe(true);
    }
  });
});

// ---- conversions ------------------------------------------------------------------------------

describe("Word / Document / PowerPoint → PDF", () => {
  it("converts .docx with the built-in path when LibreOffice is unavailable (fallback)", async () => {
    setLibreOfficeLocator(() => null);
    const result = await run(wordToPdfExecutor, [{ name: "report.docx", bytes: report }]);
    expect(ok(result).summary).toMatch(/LibreOffice isn't installed/);
    const pages = (await pdfText(file(result, "pdf").bytes)).join(" ");
    for (const s of ["Quarterly Report", "Revenue grew strongly", "North", "Costs were flat"]) {
      expect(pages).toContain(s);
    }
  });

  it("converts several documents at once into one ZIP", async () => {
    setLibreOfficeLocator(() => null);
    const result = await run(wordToPdfExecutor, [
      { name: "a.docx", bytes: report },
      { name: "b.docx", bytes: chapters },
    ]);
    const entries = await zipEntries(file(result, "zip").bytes);
    expect([...entries.keys()].sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("converts .txt, .rtf and .odt without LibreOffice", async () => {
    setLibreOfficeLocator(() => null);
    const cases: [string, Uint8Array, string][] = [
      ["notes.txt", new TextEncoder().encode("Plain text line one.\nLine two."), "Line two."],
      ["letter.rtf", RTF_FIXTURE, "Hello RTF world."],
      ["paper.odt", await makeOdt(), "Second ODT paragraph."],
    ];
    for (const [name, bytes, expected] of cases) {
      const out = file(await run(documentToPdfExecutor, [{ name, bytes }]), "pdf");
      expect((await pdfText(out.bytes)).join(" ")).toContain(expected);
    }
  });

  it("refuses legacy .doc without LibreOffice with an actionable message", async () => {
    setLibreOfficeLocator(() => null);
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const failure = fail(await run(documentToPdfExecutor, [{ name: "old.doc", bytes: doc }]));
    expect(failure.code).toBe("UNSUPPORTED_INPUT");
    expect(failure.message).toMatch(/LibreOffice/);
    const alsoFails = fail(await run(wordToTextExecutor, [{ name: "old.doc", bytes: doc }]));
    expect(alsoFails.message).toMatch(/libreoffice\.org/);
  });

  it("converts PowerPoint to PDF, one page per slide", async () => {
    setLibreOfficeLocator(() => null);
    const pages = await pdfText(
      file(await run(powerPointToPdfExecutor, [{ name: "d.pptx", bytes: deck5 }]), "pdf").bytes,
    );
    expect(pages).toHaveLength(5);
    expect(pages[2]).toContain("Main slide 3");
  });
});

describe("Document / PowerPoint → Images", () => {
  it("renders every slide as a PNG in a ZIP", async () => {
    setLibreOfficeLocator(() => null);
    const out = file(
      await run(powerPointToImagesExecutor, [{ name: "d.pptx", bytes: deck5 }], { dpi: 36 }),
      "zip",
    );
    const entries = await zipEntries(out.bytes);
    expect(entries.size).toBe(5);
    for (const bytes of entries.values())
      expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it("renders document pages as JPG, respecting a page selection", async () => {
    setLibreOfficeLocator(() => null);
    const result = await run(documentToImagesExecutor, [{ name: "p.docx", bytes: paged }], {
      format: "jpg",
      dpi: 36,
      pages: "1",
    });
    const out = file(result, "jpg");
    expect([...out.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
  });
});

describe("Word → Text / HTML / Excel", () => {
  it("extracts plain text", async () => {
    const out = text(
      file(await run(wordToTextExecutor, [{ name: "r.docx", bytes: report }]), "txt"),
    );
    expect(out).toContain("Revenue grew strongly this quarter.");
    expect(out).toContain("Second point");
  });

  it("produces a self-contained, script-free HTML page", async () => {
    const html = text(
      file(await run(wordToHtmlExecutor, [{ name: "r.docx", bytes: report }]), "html"),
    );
    expect(html).toContain("<h1>Quarterly Report</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("default-src 'none'");
    expect(html).toMatch(/<img src="data:image\/png;base64,/);
    expect(html).not.toMatch(/<script/i);
    const noImages = text(
      file(
        await run(wordToHtmlExecutor, [{ name: "r.docx", bytes: report }], { images: "omit" }),
        "html",
      ),
    );
    expect(noImages).not.toContain("<img");
  });

  it("moves tables into Excel with numbers as numbers", async () => {
    const out = file(await run(wordToExcelExecutor, [{ name: "r.docx", bytes: report }]), "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(out.bytes) as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Table 1")!;
    expect(sheet.getCell("A1").value).toBe("Region");
    expect(sheet.getCell("B2").value).toBe(1200);
    expect(sheet.getCell("B3").value).toBe(950.5);
  });

  it("falls back to one row per paragraph when there are no tables", async () => {
    const result = await run(wordToExcelExecutor, [{ name: "c.docx", bytes: chapters }]);
    expect(ok(result).summary).toMatch(/No tables were found/);
  });
});

// ---- merge / split documents ------------------------------------------------------------------

describe("Merge Documents", () => {
  it("merges three documents in order, each as its own section, keeping lists, notes and pictures", async () => {
    const result = await run(mergeDocumentsExecutor, [
      { name: "a.docx", bytes: chapters },
      { name: "b.docx", bytes: report },
      { name: "c.docx", bytes: paged },
    ]);
    const merged = file(result, "docx").bytes;
    const raw = await docxRaw(merged);
    const order = [
      "Chapter One",
      "Gamma text.",
      "Quarterly Report",
      "Second point",
      "Page one text.",
      "Page three text.",
    ];
    let last = -1;
    for (const s of order) {
      const at = raw.indexOf(s);
      expect(at, s).toBeGreaterThan(last);
      last = at;
    }
    const entries = await zipEntries(merged);
    const xml = new TextDecoder().decode(entries.get("word/document.xml"));
    expect(xml.match(/<w:sectPr\b/g)).toHaveLength(3);
    expect([...entries.keys()].some((n) => /^word\/media\//.test(n))).toBe(true);
    expect(new TextDecoder().decode(entries.get("word/footnotes.xml"))).toContain(
      "Source: internal ledger.",
    );
    expect(xml).toMatch(/<w:numId w:val="\d+"\/>/);
    expect(xml).not.toContain("commentReference");
    // Every relationship id used in the body exists.
    const rels = new TextDecoder().decode(entries.get("word/_rels/document.xml.rels"));
    for (const m of xml.matchAll(/r:(?:id|embed)="([^"]+)"/g))
      expect(rels).toContain(`Id="${m[1]}"`);
    // And the result still converts, so it is a readable document.
    setLibreOfficeLocator(() => null);
    const pdf = file(await run(wordToPdfExecutor, [{ name: "m.docx", bytes: merged }]), "pdf");
    expect((await pdfText(pdf.bytes)).join(" ")).toContain("Beta text.");
  });

  it("asks for at least two documents", async () => {
    expect(
      fail(await run(mergeDocumentsExecutor, [{ name: "a.docx", bytes: chapters }])).message,
    ).toMatch(/at least 2/);
  });
});

describe("Split Documents", () => {
  it("splits at Heading 1, naming each part after its heading", async () => {
    const result = await run(splitDocumentsExecutor, [{ name: "book.docx", bytes: chapters }]);
    const entries = await zipEntries(file(result, "zip").bytes);
    const names = [...entries.keys()].sort();
    expect(names).toEqual([
      "book-01-chapter-one.docx",
      "book-02-chapter-two.docx",
      "book-03-chapter-three.docx",
    ]);
    const second = await docxRaw(entries.get("book-02-chapter-two.docx")!);
    expect(second).toContain("Beta text.");
    expect(second).not.toContain("Alpha text.");
    expect(second).not.toContain("Gamma text.");
  });

  it("splits at page breaks and drops the break itself", async () => {
    const result = await run(splitDocumentsExecutor, [{ name: "p.docx", bytes: paged }], {
      mode: "breaks",
      packaging: "files",
    });
    const files = ok(result).files!;
    expect(files).toHaveLength(3);
    const third = await docxRaw(files[2]!.bytes);
    expect(third.trim()).toBe("Page three text.");
    const xml = new TextDecoder().decode(
      (await zipEntries(files[1]!.bytes)).get("word/document.xml"),
    );
    expect(xml).not.toMatch(/w:type="page"/);
  });

  it("prunes pictures a part no longer uses", async () => {
    const withImage = await makeDocx({
      paragraphs: ["# One", "No picture here.", "# Two"],
      image: png,
    });
    const files = ok(
      await run(splitDocumentsExecutor, [{ name: "i.docx", bytes: withImage }], {
        packaging: "files",
      }),
    ).files!;
    const media = async (f: OutputFile) =>
      [...(await zipEntries(f.bytes)).keys()].filter((n) => n.includes("media/"));
    expect(await media(files[0]!)).toHaveLength(0);
    expect(await media(files[1]!)).toHaveLength(1);
  });

  it("explains when there is nothing to split at", async () => {
    const plain = await makeDocx({ paragraphs: ["Just one paragraph."] });
    expect(
      fail(await run(splitDocumentsExecutor, [{ name: "x.docx", bytes: plain }])).message,
    ).toMatch(/no headings or page breaks/);
  });
});

// ---- compress ---------------------------------------------------------------------------------

describe("Compress Documents / Presentation", () => {
  it("shrinks a picture-heavy .docx and keeps it readable", async () => {
    const heavy = await makeDocx({
      paragraphs: ["Picture below."],
      image: await makeNoisyPng(),
      imageSize: [600, 400],
    });
    const result = await run(compressDocumentsExecutor, [{ name: "h.docx", bytes: heavy }], {
      level: "strong",
    });
    const out = file(result, "docx");
    expect(out.bytes.length).toBeLessThan(heavy.length / 2);
    expect(ok(result).output).toMatchObject({ imagesOptimized: 1 });
    expect(await docxRaw(out.bytes)).toContain("Picture below.");
    const entries = await zipEntries(out.bytes);
    const media = [...entries.keys()].filter((n) => n.includes("media/"));
    expect(media).toHaveLength(1);
    expect(media[0]).toMatch(/\.jpeg$/);
    const rels = new TextDecoder().decode(entries.get("word/_rels/document.xml.rels"));
    expect(rels).toContain(media[0]!.replace("word/", ""));
  }, 30_000);

  it("shrinks a picture-heavy .pptx, keeping every slide", async () => {
    const heavy = await makePptx({ slides: 2, image: await makeNoisyPng(1800, 1200) });
    const out = file(
      await run(compressPresentationExecutor, [{ name: "h.pptx", bytes: heavy }]),
      "pptx",
    );
    expect(out.bytes.length).toBeLessThan(heavy.length);
    expect(await deckTexts(out.bytes)).toEqual(["Deck slide 1", "Deck slide 2"]);
  }, 30_000);

  it("never returns a bigger file", async () => {
    const result = await run(compressDocumentsExecutor, [{ name: "c.docx", bytes: chapters }], {
      level: "light",
    });
    expect(file(result, "docx").bytes.length).toBeLessThanOrEqual(chapters.length);
  });
});

// ---- OCR → Word -------------------------------------------------------------------------------

describe("OCR → Word", () => {
  it("recognises a scanned PDF into an editable document", async () => {
    const scan = await makeScannedPdf();
    const out = file(await run(ocrToWordExecutor, [{ name: "scan.pdf", bytes: scan }]), "docx");
    const raw = await docxRaw(out.bytes);
    expect(raw).toMatch(/Invoice number 4821/);
    expect(raw).toMatch(/Total due 1250/);
  }, 60_000);

  it("recognises a photo of text", async () => {
    const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
    const { findPackageDir } = await import("../shared/node-modules.ts");
    const dir = findPackageDir("pdfjs-dist", "standard_fonts");
    GlobalFonts.registerFromPath(`${dir}/standard_fonts/LiberationSans-Regular.ttf`, "OcrSans");
    const canvas = createCanvas(900, 200);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 900, 200);
    ctx.fillStyle = "#000";
    ctx.font = "48px OcrSans";
    ctx.fillText("Meeting moved to Friday", 40, 110);
    const photo = new Uint8Array(canvas.toBuffer("image/png"));
    const result = await run(ocrToWordExecutor, [{ name: "photo.png", bytes: photo }], {
      includeImage: true,
    });
    const out = file(result, "docx");
    expect(await docxRaw(out.bytes)).toMatch(/Meeting moved to Friday/);
    expect([...(await zipEntries(out.bytes)).keys()].some((n) => n.includes("media/"))).toBe(true);
  }, 60_000);
});

// ---- text tools -------------------------------------------------------------------------------

describe("Grammar Checker", () => {
  const sample =
    "this is a example. i think the the cat could of gone.Next  sentence has an problem .";

  it("finds spelling, grammar, punctuation and style issues", () => {
    const issues = checkGrammar(sample);
    const messages = issues.map((i) => `${i.kind}:${i.text}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        "grammar:this",
        "grammar:a example",
        "grammar:i think",
        "grammar:the the",
        "grammar:could of",
        "punctuation:.Next",
        "grammar:an problem",
        "punctuation: .",
      ]),
    );
    expect(checkGrammar("I recieve teh mail").some((i) => i.text === "recieve")).toBe(true);
  });

  it("flags real misspellings with dictionary suggestions, not names mid-sentence", () => {
    const issues = checkGrammar("We visited Zanzibar and saw a beautful beach.", { style: false });
    const spelling = issues.filter((i) => i.kind === "spelling").map((i) => i.text);
    expect(spelling).toEqual(["beautful"]);
    expect(issues.find((i) => i.text === "beautful")!.suggestions).toContain("beautiful");
  });

  it("applies only safe fixes to the corrected copy", () => {
    const { text: fixed } = applyFixes(sample, checkGrammar(sample));
    expect(fixed).toBe(
      "This is an example. I think the cat could have gone. Next sentence has a problem.",
    );
  });

  it("accepts pasted text and files, with the AI-upgrade note", async () => {
    const pasted = ok(await run(grammarCheckerExecutor, sample));
    expect(pasted.summary).toMatch(/AI Assistant/);
    expect(pasted.files!.map((f) => f.name)).toEqual([
      "text-grammar-report.txt",
      "text-corrected.txt",
    ]);
    const fromDocx = await run(
      grammarCheckerExecutor,
      [{ name: "r.docx", bytes: await makeDocx({ paragraphs: ["He could of won."] }) }],
      { output: "corrected" },
    );
    expect(text(file(fromDocx))).toContain("He could have won.");
  });
});

describe("Text Formatter", () => {
  it("cleans whitespace, blank lines and line endings", () => {
    expect(formatText("  a   b  \r\n\r\n\r\n\tc  ")).toBe("a b\n\nc\n");
    expect(formatText("a\n\n\nb", { blankLines: "remove", lineEndings: "crlf" })).toBe(
      "a\r\nb\r\n",
    );
    expect(formatText("one line\nwrapped here.\n\nnext para", { unwrap: true })).toBe(
      "one line wrapped here.\n\nnext para\n",
    );
    expect(formatText("“quoted” it’s", { straightQuotes: true })).toBe('"quoted" it\'s\n');
  });

  it("changes letter case", () => {
    expect(formatText("HELLO THERE. how ARE you?", { case: "sentence" })).toBe(
      "Hello there. How are you?\n",
    );
    expect(titleCase("the lord of the rings")).toBe("The Lord of the Rings");
    expect(formatText("abc def", { case: "upper" })).toBe("ABC DEF\n");
    expect(formatText("hello wORLD", { case: "capitalize" })).toBe("Hello World\n");
  });

  it("runs on pasted text", async () => {
    const out = file(await run(textFormatterExecutor, "a    b", { case: "upper" }));
    expect(text(out)).toBe("A B\n");
  });
});

describe("Document Summarizer", () => {
  it("picks central sentences in original order, with key terms", () => {
    const summary = summarize(LONG_TEXT, { length: "short", title: "Solar power" });
    const all = splitSentences(LONG_TEXT);
    expect(summary.totalSentences).toBe(all.length);
    expect(summary.sentences.length).toBeGreaterThanOrEqual(2);
    expect(summary.sentences.length).toBeLessThanOrEqual(4);
    const positions = summary.sentences.map((s) => all.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(summary.sentences.join(" ")).toMatch(/solar/i);
    expect(summary.keywords).toEqual(expect.arrayContaining(["solar"]));
  });

  it("keeps abbreviations inside sentences", () => {
    expect(splitSentences("Dr. Smith arrived, e.g. early. Then he left.")).toEqual([
      "Dr. Smith arrived, e.g. early.",
      "Then he left.",
    ]);
  });

  it("summarizes .txt, .docx and .pdf inputs", async () => {
    const txt = await run(
      documentSummarizerExecutor,
      [{ name: "solar.txt", bytes: new TextEncoder().encode(LONG_TEXT) }],
      { length: "long" },
    );
    expect(text(file(txt))).toMatch(/^Summary of solar\.txt/);
    expect(ok(txt).summary).toMatch(/AI Assistant/);
    const docx = await makeDocx({ paragraphs: LONG_TEXT.split("\n") });
    expect(
      ok(await run(documentSummarizerExecutor, [{ name: "s.docx", bytes: docx }])).output,
    ).toMatchObject({ sentences: expect.any(Number) });
    const pdf = await makeTextPdf({ pages: 2 });
    ok(await run(documentSummarizerExecutor, [{ name: "s.pdf", bytes: pdf }]));
  });
});

describe("Document Translator", () => {
  it("translates phrases first, word by word, preserving case and punctuation", () => {
    expect(translateText("Thank you for the document!", "en", "es")).toBe(
      "Gracias para el documento!",
    );
    expect(translateText("GOOD MORNING, friends.", "en", "fr")).toBe("BONJOUR, amis.");
    expect(translateText("Hola amigo", "es", "en")).toBe("Hello friend");
    expect(translateText("Zyzzyva", "en", "de")).toBe("Zyzzyva");
  });

  it("translates a .docx in place and a .txt, reporting coverage honestly", async () => {
    const doc = await makeDocx({
      paragraphs: ["Thank you for the report.", "The team is very good."],
    });
    const result = await run(documentTranslatorExecutor, [{ name: "r.docx", bytes: doc }], {
      from: "en",
      to: "de",
    });
    expect(await docxRaw(file(result, "docx").bytes)).toContain("Danke für der Bericht.");
    expect(ok(result).summary).toMatch(/rough, literal/);
    const txt = await run(
      documentTranslatorExecutor,
      [{ name: "t.txt", bytes: new TextEncoder().encode("Good night") }],
      { to: "it" },
    );
    expect(text(file(txt, "txt"))).toBe("Buonanotte");
    expect(
      fail(
        await run(
          documentTranslatorExecutor,
          [{ name: "t.txt", bytes: new TextEncoder().encode("x") }],
          { from: "es", to: "es" },
        ),
      ).message,
    ).toMatch(/two different/);
  });
});

// ---- metadata ---------------------------------------------------------------------------------

describe("Document Metadata Viewer/Remover", () => {
  it("shows author, title, dates and comment authors", async () => {
    const result = await run(documentMetadataExecutor, [{ name: "r.docx", bytes: report }]);
    const meta = ok(result).output as { properties: Record<string, string>; people: string[] };
    expect(meta.properties).toMatchObject({
      Title: "Quarterly Report",
      Author: "Jane Secret",
      Keywords: "finance, q3",
      Comments: "Internal only",
    });
    expect(meta.properties.Created).toBeTruthy();
    expect(meta.people).toEqual(["Jane Secret"]);
    expect(file(result, "json").name).toBe("r-metadata.json");
  });

  it("strips it — verified by re-reading the file — and keeps the content", async () => {
    const out = file(
      await run(documentMetadataExecutor, [{ name: "r.docx", bytes: report }], { mode: "remove" }),
      "docx",
    );
    const after = await readOoxmlMetadata(out.bytes);
    expect(after.properties).toEqual({});
    expect(after.people).toEqual(["Author"]);
    const raw = new TextDecoder().decode(out.bytes);
    expect(raw).not.toContain("Jane Secret");
    const entries = await zipEntries(out.bytes);
    for (const [name, bytes] of entries) {
      if (name.endsWith(".xml"))
        expect(new TextDecoder().decode(bytes), name).not.toContain("Jane Secret");
    }
    expect(await docxRaw(out.bytes)).toContain("Revenue grew strongly");
  });

  it("views and strips .odt metadata, keeping a valid OpenDocument package", async () => {
    const odt = await makeOdt();
    const view = ok(await run(documentMetadataExecutor, [{ name: "p.odt", bytes: odt }]))
      .output as { properties: Record<string, string>; custom: Record<string, string> };
    expect(view.properties).toMatchObject({ Title: "ODT Title", Author: "Olga Author" });
    expect(view.custom).toEqual({ Client: "Acme Secret" });
    const out = file(
      await run(documentMetadataExecutor, [{ name: "p.odt", bytes: odt }], { mode: "remove" }),
      "odt",
    );
    const entries = await zipEntries(out.bytes);
    expect(new TextDecoder().decode(entries.get("meta.xml"))).not.toMatch(/Olga|Acme|ODT Title/);
    expect(new TextDecoder().decode(out.bytes.slice(30, 38))).toBe("mimetype");
    expect(new TextDecoder().decode(entries.get("content.xml"))).toContain("First ODT paragraph.");
  });
});

// ---- PowerPoint -------------------------------------------------------------------------------

describe("PowerPoint → Text", () => {
  it("extracts slide text and speaker notes, without slide-number placeholders", async () => {
    const out = text(file(await run(powerPointToTextExecutor, [{ name: "d.pptx", bytes: deck5 }])));
    expect(out).toContain("--- Slide 3 ---\nMain slide 3\n\nNotes:\nMain notes 3");
    const noNotes = text(
      file(
        await run(powerPointToTextExecutor, [{ name: "d.pptx", bytes: deck5 }], { notes: false }),
      ),
    );
    expect(noNotes).not.toContain("Notes:");
    expect(noNotes.split("\n").filter((l) => /^\d+$/.test(l.trim()))).toEqual([]);
  });
});

describe("Merge Presentations", () => {
  it("appends every slide in order, bringing the other deck's master, and renumbers", async () => {
    const result = await run(mergePresentationsExecutor, [
      { name: "main.pptx", bytes: deck5 },
      { name: "extra.pptx", bytes: deck2 },
      { name: "main2.pptx", bytes: deck2 },
    ]);
    const merged = file(result, "pptx").bytes;
    expect(ok(result).summary).toMatch(/different slide sizes/);
    expect(await deckTexts(merged)).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => `Main slide ${n}`),
      "Extra slide 1",
      "Extra slide 2",
      "Extra slide 1",
      "Extra slide 2",
    ]);
    expect(await slideNumberFields(merged)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    const entries = await zipEntries(merged);
    const pres = new TextDecoder().decode(entries.get("ppt/presentation.xml"));
    expect(pres.match(/<p:sldMasterId\b/g)).toHaveLength(3);
    const ids = [...pres.matchAll(/<p:sld(?:Master)?Id id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const deck = await openDeck(merged);
    expect(deck.slides.map((s) => s.path)).toEqual(
      Array.from({ length: 9 }, (_, i) => `ppt/slides/slide${i + 1}.xml`),
    );
    const ct = new TextDecoder().decode(entries.get("[Content_Types].xml"));
    for (const s of deck.slides) expect(ct).toContain(`/${s.path}"`);
    // Every relationship in the package resolves to a part that exists.
    for (const [name, bytes] of entries) {
      if (!name.endsWith(".rels")) continue;
      const owner = name.replace(/_rels\/(.*)\.rels$/, "$1");
      for (const m of new TextDecoder()
        .decode(bytes)
        .matchAll(/Target="([^"]+)"(?! TargetMode="External")/g)) {
        const base = owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/")) : "";
        const parts = [...base.split("/"), ...m[1]!.split("/")].filter(Boolean);
        const resolved: string[] = [];
        for (const p of parts) {
          if (p === "..") resolved.pop();
          else resolved.push(p);
        }
        expect(
          entries.has(m[1]!.startsWith("/") ? m[1]!.slice(1) : resolved.join("/")),
          `${name} → ${m[1]}`,
        ).toBe(true);
      }
    }
    // The merged deck still converts with the built-in PDF path.
    setLibreOfficeLocator(() => null);
    const pdf = await pdfText(
      file(await run(powerPointToPdfExecutor, [{ name: "m.pptx", bytes: merged }]), "pdf").bytes,
    );
    expect(pdf).toHaveLength(9);
  });
});

describe("Split / Extract / Rearrange / Remove Slides", () => {
  it("splits every N slides and by ranges", async () => {
    const every = await zipEntries(
      file(
        await run(splitPresentationExecutor, [{ name: "d.pptx", bytes: deck5 }], { size: 2 }),
        "zip",
      ).bytes,
    );
    expect([...every.keys()].sort()).toEqual([
      "d-slide-5.pptx",
      "d-slides-1-2.pptx",
      "d-slides-3-4.pptx",
    ]);
    expect(await deckTexts(every.get("d-slides-3-4.pptx")!)).toEqual([
      "Main slide 3",
      "Main slide 4",
    ]);
    expect(await slideNumberFields(every.get("d-slides-3-4.pptx")!)).toEqual(["1", "2"]);
    const ranges = ok(
      await run(splitPresentationExecutor, [{ name: "d.pptx", bytes: deck5 }], {
        mode: "ranges",
        ranges: "1-2, 3-",
        packaging: "files",
      }),
    );
    expect(ranges.files).toHaveLength(2);
    expect(await deckTexts(ranges.files![1]!.bytes)).toEqual([
      "Main slide 3",
      "Main slide 4",
      "Main slide 5",
    ]);
    expect(
      fail(
        await run(splitPresentationExecutor, [{ name: "d.pptx", bytes: deck5 }], {
          mode: "ranges",
          ranges: "1-3, 3-5",
        }),
      ).message,
    ).toMatch(/more than one range/);
  });

  it("extracts slides, renumbering them and dropping everything else", async () => {
    const out = file(
      await run(extractSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { slides: "2, 4" }),
      "pptx",
    ).bytes;
    expect(await deckTexts(out)).toEqual(["Main slide 2", "Main slide 4"]);
    expect(await slideNumberFields(out)).toEqual(["1", "2"]);
    const entries = await zipEntries(out);
    const slideParts = [...entries.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort();
    expect(slideParts).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    const notes = [...entries.keys()].filter((n) => /^ppt\/notesSlides\/[^/]+\.xml$/.test(n));
    expect(notes).toHaveLength(2);
    const app = new TextDecoder().decode(entries.get("docProps/app.xml"));
    expect(app).toContain("<Slides>2</Slides>");
    const texts = await slideTexts(await openDeck(out));
    expect(texts.map((t) => t.notes.join(" "))).toEqual(["Main notes 2", "Main notes 4"]);
  });

  it("rearranges slides and renumbers them", async () => {
    const out = file(
      await run(rearrangeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { order: "3,1" }),
      "pptx",
    ).bytes;
    expect(await deckTexts(out)).toEqual([
      "Main slide 3",
      "Main slide 1",
      "Main slide 2",
      "Main slide 4",
      "Main slide 5",
    ]);
    expect(await slideNumberFields(out)).toEqual(["1", "2", "3", "4", "5"]);
    const reversed = file(
      await run(rearrangeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { order: "reverse" }),
      "pptx",
    ).bytes;
    expect((await deckTexts(reversed))[0]).toBe("Main slide 5");
    expect(
      fail(await run(rearrangeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { order: "1,1" }))
        .message,
    ).toMatch(/twice/);
  });

  it("removes slides, renumbers the rest, and refuses to remove all", async () => {
    const out = file(
      await run(removeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { slides: "2, 4-5" }),
      "pptx",
    ).bytes;
    expect(await deckTexts(out)).toEqual(["Main slide 1", "Main slide 3"]);
    expect(await slideNumberFields(out)).toEqual(["1", "2"]);
    expect(
      fail(await run(removeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { slides: "1-5" }))
        .message,
    ).toMatch(/keep at least one/);
    expect(
      fail(await run(removeSlidesExecutor, [{ name: "d.pptx", bytes: deck5 }], { slides: "9" }))
        .message,
    ).toMatch(/has 5 slides/);
  });

  it("refuses legacy .ppt without LibreOffice, and reports a LibreOffice failure cleanly", async () => {
    const ppt = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    setLibreOfficeLocator(() => null);
    expect(
      fail(await run(removeSlidesExecutor, [{ name: "a.ppt", bytes: ppt }], { slides: "1" }))
        .message,
    ).toMatch(/needs LibreOffice/);
    setLibreOfficeLocator(() => "Z:/definitely/not/soffice.exe");
    expect(
      fail(await run(removeSlidesExecutor, [{ name: "a.ppt", bytes: ppt }], { slides: "1" }))
        .message,
    ).toMatch(/could not be opened/);
  });
});

describe("shared readers", () => {
  it("reads RTF text including escapes and skips hidden destinations", () => {
    const out = rtfToText(RTF_FIXTURE);
    expect(out).toContain("Hello RTF world.");
    expect(out).toContain("Café costs € 5.");
    expect(out).not.toMatch(/Secret|Fixture|Arial/);
  });
});

// ---- offline ----------------------------------------------------------------------------------

describe("offline", () => {
  it("runs every phase-07 tool with the network trapped", async () => {
    setLibreOfficeLocator(() => null);
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
      const scan = await makeScannedPdf(["Offline OCR check"]);
      const d = { name: "r.docx", bytes: report };
      const p = { name: "d.pptx", bytes: deck5 };
      const cases: Record<string, [Fixture[] | string, Record<string, unknown>?]> = {
        "word-to-pdf": [[d]],
        "word-to-excel": [[d]],
        "word-to-text": [[d]],
        "word-to-html": [[d]],
        "document-to-pdf": [[{ name: "x.odt", bytes: await makeOdt() }]],
        "document-to-images": [[d], { dpi: 36 }],
        "merge-documents": [[d, { name: "c.docx", bytes: chapters }]],
        "split-documents": [[{ name: "c.docx", bytes: chapters }]],
        "compress-documents": [[d]],
        "ocr-to-word": [[{ name: "s.pdf", bytes: scan }]],
        "document-translator": [[d]],
        "grammar-checker": ["i has a apple"],
        "text-formatter": ["  a  b  "],
        "document-summarizer": [[{ name: "s.txt", bytes: new TextEncoder().encode(LONG_TEXT) }]],
        "document-metadata": [[d], { mode: "remove" }],
        "powerpoint-to-pdf": [[p]],
        "powerpoint-to-images": [[p], { dpi: 36 }],
        "powerpoint-to-text": [[p]],
        "merge-presentations": [[p, { name: "e.pptx", bytes: deck2 }]],
        "split-presentation": [[p]],
        "compress-presentation": [[p]],
        "extract-slides": [[p], { slides: "1-2" }],
        "rearrange-slides": [[p], { order: "reverse" }],
        "remove-slides": [[p], { slides: "1" }],
      };
      for (const [id, executor] of DOCUMENT_EXECUTORS) {
        const [input, options] = cases[id]!;
        const result = await run(executor, input, options ?? {});
        expect(result.ok, `${id}: ${result.ok ? "" : result.message}`).toBe(true);
      }
    } finally {
      globalThis.fetch = saved.fetch;
      http.get = saved.hg;
      http.request = saved.hr;
      https.get = saved.sg;
      https.request = saved.sr;
    }
  }, 120_000);
});
