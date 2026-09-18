// Phase 06 test suite (06-pdf-tools-advanced.md — Test Cases).
//
// Fixture-based tests for every advanced PDF tool, the password security test, the OCR accuracy
// smoke test, a PDF/A conformance check, Office round-trips, the missing-LibreOffice degradation
// path, and an offline test that runs every tool with the network trapped.
import { createHash } from "node:crypto";
import { getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import { PDFDocument, PDFName, PDFDict } from "@cantoo/pdf-lib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import forge from "node-forge";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  officeToPdf,
  OfficeConvertError,
  pdfToOffice,
  setLibreOfficeLocator,
} from "../shared/office-convert.ts";
import { comparePdfsExecutor } from "./compare.ts";
import { fillFormExecutor, parseFieldValues } from "./fillForm.ts";
import { embedUnicodeFont } from "./fonts.ts";
import {
  makeEncryptedPdf,
  makeFormPdf,
  makePng,
  makeScannedPdf,
  makeStructuredPdf,
  makeTextPdf,
} from "./fixtures.ts";
import { PDF_ADVANCED_EXECUTORS } from "./index.ts";
import { editMetadataExecutor, readProperties, removeMetadataExecutor } from "./metadata.ts";
import { ocrPdfExecutor } from "./ocr.ts";
import { addPageNumbersExecutor, formatPageNumber } from "./pageNumbers.ts";
import { protectPdfExecutor } from "./protect.ts";
import { pageText, withPdfJs } from "./render.ts";
import { signPdfExecutor } from "./sign.ts";
import { pdfToHtmlExecutor } from "./toHtml.ts";
import { pdfToExcelExecutor, pdfToPowerPointExecutor, pdfToWordExecutor } from "./toOffice.ts";
import { checkPdfA, convertToPdfA, pdfToPdfAExecutor, srgbIccProfile } from "./toPdfA.ts";
import { isPdfEncrypted, unprotectPdfExecutor } from "./unprotect.ts";
import { addWatermarkExecutor } from "./watermark.ts";

// ---- helpers ----------------------------------------------------------------------------------

function inputs(files: { name: string; bytes: Uint8Array; type?: string }[]): {
  refs: FileRef[];
  ctx: ExecContext;
} {
  const refs: FileRef[] = files.map((f, i) => ({
    name: f.name,
    size: f.bytes.length,
    type: f.type ?? "application/pdf",
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
  executor: (typeof PDF_ADVANCED_EXECUTORS)[number][1],
  files: { name: string; bytes: Uint8Array }[],
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
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

async function textOf(bytes: Uint8Array, password?: string): Promise<string[]> {
  return withPdfJs(
    bytes,
    async (doc) => {
      const out: string[] = [];
      for (let n = 1; n <= doc.numPages; n += 1) out.push(await pageText(doc, n));
      return out;
    },
    password !== undefined ? { password } : {},
  );
}

let multiPage: Uint8Array;
let scanned: Uint8Array;
let structured: Uint8Array;
let formPdf: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  multiPage = await makeTextPdf({ pages: 5, title: "Five pages" });
  scanned = await makeScannedPdf();
  structured = await makeStructuredPdf();
  formPdf = await makeFormPdf();
  png = await makePng();
}, 60_000);

afterEach(() => setLibreOfficeLocator(null));

// ---- registry ---------------------------------------------------------------------------------

describe("registry", () => {
  it("registers a real executor for all 15 phase-06 tools and marks them available", () => {
    expect(PDF_ADVANCED_EXECUTORS).toHaveLength(15);
    for (const [id] of PDF_ADVANCED_EXECUTORS) {
      const tool = getTool(id);
      expect(tool, `missing registry entry for ${id}`).toBeDefined();
      expect(tool!.phase).toBe("06");
      expect(tool!.status).toBe("available");
      expect(tool!.execution).toBe("local");
      expect(tool!.network).toBe("none");
      expect(tool!.offline, `${id} passed the offline test below`).toBe(true);
    }
  });

  it("lets Sign PDF and Watermark accept an image next to the PDF, and Compare two PDFs", () => {
    expect(getTool("sign-pdf")!.inputTypes).toEqual(expect.arrayContaining(["pdf", "png", "jpg"]));
    expect(getTool("add-watermark-to-pdf")!.inputTypes).toEqual(expect.arrayContaining(["png"]));
    expect(getTool("compare-pdfs")!.supportsBatch).toBe(true);
  });
});

// ---- watermark & page numbers -----------------------------------------------------------------

describe("Add Watermark", () => {
  it("stamps text on every page of a multi-page PDF", async () => {
    const out = file(
      await run(addWatermarkExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        text: "DRAFT COPY",
      }),
    );
    const pages = await textOf(out.bytes);
    expect(pages).toHaveLength(5);
    for (const text of pages) expect(text).toContain("DRAFT COPY");
  });

  it("tiles the watermark and respects a page selection", async () => {
    const out = file(
      await run(addWatermarkExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        text: "TILE",
        position: "tile",
        pages: "2-3",
      }),
    );
    const pages = await textOf(out.bytes);
    expect(pages[0]).not.toContain("TILE");
    expect(pages[1]!.split("TILE").length - 1).toBeGreaterThan(3);
    expect(pages[3]).not.toContain("TILE");
  });

  it("uses an uploaded image as the watermark on every page", async () => {
    const out = file(
      await run(addWatermarkExecutor, [
        { name: "doc.pdf", bytes: multiPage },
        { name: "logo.png", bytes: png },
      ]),
    );
    const doc = await PDFDocument.load(out.bytes);
    for (const page of doc.getPages()) {
      const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
      expect(xobjects?.keys().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("watermarks a batch into one ZIP, and supports non-Latin text", async () => {
    const result = ok(
      await run(
        addWatermarkExecutor,
        [
          { name: "a.pdf", bytes: multiPage },
          { name: "b.pdf", bytes: structured },
        ],
        { text: "Черновик Ω" },
      ),
    );
    expect(result.files).toHaveLength(1);
    expect(result.files![0]!.name).toMatch(/\.zip$/);
  });

  it("rejects a watermark with no text and no image", async () => {
    expect(
      fail(await run(addWatermarkExecutor, [{ name: "doc.pdf", bytes: multiPage }], { text: " " }))
        .message,
    ).toMatch(/watermark text/);
  });
});

describe("Add Page Numbers", () => {
  it("numbers every page of a multi-page PDF in the chosen format", async () => {
    const out = file(
      await run(addPageNumbersExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        format: "page-of",
      }),
    );
    const pages = await textOf(out.bytes);
    pages.forEach((text, i) => expect(text).toContain(`Page ${i + 1} of 5`));
  });

  it("can skip the cover and start from another number", async () => {
    const out = file(
      await run(addPageNumbersExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        format: "slash",
        skipFirst: true,
        start: 10,
      }),
    );
    const pages = await textOf(out.bytes);
    expect(pages[0]).not.toMatch(/\d+ \/ \d+/);
    expect(pages[1]).toContain("10 / 13");
    expect(pages[4]).toContain("13 / 13");
  });

  it("numbers a rotated page too", async () => {
    const doc = await PDFDocument.load(multiPage);
    doc.getPage(0).setRotation({ type: "degrees", angle: 90 } as never);
    const rotated = await doc.save();
    const out = file(
      await run(addPageNumbersExecutor, [{ name: "r.pdf", bytes: rotated }], { format: "page" }),
    );
    expect((await textOf(out.bytes))[0]).toContain("Page 1");
  });

  it("formats placeholders", () => {
    expect(formatPageNumber("Page {n} of {total}", 3, 9)).toBe("Page 3 of 9");
  });
});

// ---- passwords (security test) ------------------------------------------------------------------

describe("Password Protect / Remove Password", () => {
  it("round-trips: protect, then remove with the right password returns the original content", async () => {
    const original = await textOf(multiPage);
    const locked = file(
      await run(protectPdfExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        password: "s3cret!",
      }),
    );
    expect(await isPdfEncrypted(locked.bytes)).toBe(true);
    // pdf.js refuses it without the password …
    await expect(textOf(locked.bytes)).rejects.toThrow(/password/i);
    // … and opens it with the password.
    expect(await textOf(locked.bytes, "s3cret!")).toEqual(original);

    const unlocked = file(
      await run(unprotectPdfExecutor, [{ name: "doc-protected.pdf", bytes: locked.bytes }], {
        password: "s3cret!",
      }),
    );
    expect(await isPdfEncrypted(unlocked.bytes)).toBe(false);
    expect(await textOf(unlocked.bytes)).toEqual(original);
  });

  it("rejects the wrong password with a clear message, and does not crack it", async () => {
    const locked = file(
      await run(protectPdfExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        password: "right-one",
      }),
    );
    const result = fail(
      await run(unprotectPdfExecutor, [{ name: "l.pdf", bytes: locked.bytes }], {
        password: "wrong-one",
      }),
    );
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toBe(
      "That password is not correct for this PDF. Check it and try again.",
    );
    expect(
      fail(
        await run(unprotectPdfExecutor, [{ name: "l.pdf", bytes: locked.bytes }], { password: "" }),
      ).message,
    ).toMatch(/current password/);
  });

  it("also unlocks with the owner password, and supports AES-128", async () => {
    const locked = file(
      await run(protectPdfExecutor, [{ name: "doc.pdf", bytes: multiPage }], {
        password: "user-pw",
        ownerPassword: "owner-pw",
        algorithm: "AES-128",
      }),
    );
    const unlocked = file(
      await run(unprotectPdfExecutor, [{ name: "l.pdf", bytes: locked.bytes }], {
        password: "owner-pw",
      }),
    );
    expect((await textOf(unlocked.bytes))[0]).toContain("Page 1 of 5");
  });

  it("explains when a PDF has no password, and refuses weak passwords", async () => {
    expect(
      fail(
        await run(unprotectPdfExecutor, [{ name: "d.pdf", bytes: multiPage }], { password: "x" }),
      ).message,
    ).toMatch(/not password protected/);
    expect(
      fail(
        await run(protectPdfExecutor, [{ name: "d.pdf", bytes: multiPage }], { password: "abc" }),
      ).message,
    ).toMatch(/at least 4/);
  });

  it("other tools still refuse an encrypted PDF with the phase-05 message", async () => {
    const result = fail(
      await run(addPageNumbersExecutor, [{ name: "e.pdf", bytes: makeEncryptedPdf() }]),
    );
    expect(result.message).toMatch(/password protected/);
  });
});

// ---- signing ----------------------------------------------------------------------------------

function verifyPkcs7(bytes: Uint8Array): { valid: boolean; commonName: string } {
  const text = Buffer.from(bytes).toString("latin1");
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text)!;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  const signed = Buffer.concat([
    Buffer.from(bytes.subarray(a, a + b)),
    Buffer.from(bytes.subarray(c, c + d)),
  ]);
  const hex = text.slice(a + b + 1, c - 1).replace(/0+$/, "");
  const der = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex").toString("binary");
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as forge.pkcs7.PkcsSignedData & {
    rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
  };
  const cert = p7.certificates[0]!;
  const attrs = p7.rawCapture.authenticatedAttributes;
  const digestAttr = attrs.find(
    (attr) =>
      forge.asn1.derToOid((attr.value as forge.asn1.Asn1[])[0]!.value as string) ===
      forge.pki.oids.messageDigest!,
  )!;
  const digest = ((digestAttr.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0]!
    .value as string;
  const contentOk = digest === createHash("sha256").update(signed).digest("binary");
  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(set).getBytes());
  const sigOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
    md.digest().getBytes(),
    p7.rawCapture.signature,
  );
  return { valid: contentOk && sigOk, commonName: String(cert.subject.getField("CN").value) };
}

describe("Sign PDF", () => {
  const drawn = () => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;

  it("places a drawn signature and caption on the last page by default", async () => {
    const out = file(
      await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], {
        source: "draw",
        signature: drawn(),
        signerName: "Ada Lovelace",
      }),
    );
    const doc = await PDFDocument.load(out.bytes);
    const last = doc.getPage(4).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    expect(last?.keys().length).toBeGreaterThan(0);
    expect((await textOf(out.bytes))[4]).toContain("Signed by Ada Lovelace on");
  });

  it("supports an uploaded image and a typed signature", async () => {
    ok(
      await run(
        signPdfExecutor,
        [
          { name: "c.pdf", bytes: multiPage },
          { name: "sig.png", bytes: png },
        ],
        { source: "upload", page: "2" },
      ),
    );
    const typed = file(
      await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], {
        source: "type",
        signerName: "Grace Hopper",
        page: "first",
      }),
    );
    expect((await textOf(typed.bytes))[0]).toContain("Grace Hopper");
  });

  it("seals with a self-signed certificate whose PKCS#7 signature verifies", async () => {
    const result = ok(
      await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], {
        source: "draw",
        signature: drawn(),
        signerName: "Alan Turing",
        certify: true,
      }),
    );
    const bytes = result.files![0]!.bytes;
    expect(Buffer.from(bytes).toString("latin1")).toContain("/adbe.pkcs7.detached");
    const check = verifyPkcs7(bytes);
    expect(check.valid).toBe(true);
    expect(check.commonName).toBe("Alan Turing");
    // Any change to the signed bytes breaks it.
    const tampered = new Uint8Array(bytes);
    tampered[20] = tampered[20]! ^ 0xff;
    expect(verifyPkcs7(tampered).valid).toBe(false);
    expect(result.summary).toMatch(/self-signed/);
  }, 30_000);

  it("rejects a missing or forged drawing and an impossible page", async () => {
    expect(
      fail(await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], { source: "draw" }))
        .message,
    ).toMatch(/Draw your signature/);
    expect(
      fail(
        await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], {
          source: "draw",
          signature: "data:image/png;base64,PHNjcmlwdD4=",
        }),
      ).message,
    ).toMatch(/Draw your signature/);
    expect(
      fail(
        await run(signPdfExecutor, [{ name: "c.pdf", bytes: multiPage }], {
          source: "type",
          signerName: "A",
          page: "9",
        }),
      ).message,
    ).toMatch(/page 9 does not exist/);
  });
});

// ---- forms ------------------------------------------------------------------------------------

describe("Fill PDF Forms", () => {
  it("lists the fields when no values are given", async () => {
    const result = ok(await run(fillFormExecutor, [{ name: "form.pdf", bytes: formPdf }]));
    const output = result.output as { fields: { name: string; type: string }[] };
    expect(output.fields.map((f) => [f.name, f.type])).toEqual([
      ["Name", "text"],
      ["Subscribe", "checkbox"],
      ["Country", "dropdown"],
      ["Plan", "radio"],
    ]);
    expect(result.files![0]!.name).toMatch(/fields\.txt$/);
  });

  it("fills text, checkbox, dropdown and radio fields", async () => {
    const out = file(
      await run(fillFormExecutor, [{ name: "form.pdf", bytes: formPdf }], {
        values: "Name = Zoë Łukasz\nSubscribe = yes\ncountry = uk\nPlan = pro",
      }),
    );
    const form = (await PDFDocument.load(out.bytes)).getForm();
    expect(form.getTextField("Name").getText()).toBe("Zoë Łukasz");
    expect(form.getCheckBox("Subscribe").isChecked()).toBe(true);
    expect(form.getDropdown("Country").getSelected()).toEqual(["UK"]);
    expect(form.getRadioGroup("Plan").getSelected()).toBe("pro");
  });

  it("accepts JSON, flattens, and explains bad input", async () => {
    const flat = file(
      await run(fillFormExecutor, [{ name: "form.pdf", bytes: formPdf }], {
        values: '{"Name":"Ada"}',
        flatten: true,
      }),
    );
    expect((await PDFDocument.load(flat.bytes)).getForm().getFields()).toHaveLength(0);
    expect((await textOf(flat.bytes))[0]).toContain("Ada");
    expect(
      fail(
        await run(fillFormExecutor, [{ name: "f.pdf", bytes: formPdf }], {
          values: "Country = France",
        }),
      ).message,
    ).toMatch(/Choices: India, UK, US/);
    expect(
      fail(await run(fillFormExecutor, [{ name: "f.pdf", bytes: formPdf }], { values: "Nope = 1" }))
        .message,
    ).toMatch(/None of those fields exist/);
    expect(
      fail(await run(fillFormExecutor, [{ name: "p.pdf", bytes: multiPage }], {})).message,
    ).toMatch(/no form fields/);
    expect(parseFieldValues("A: 1\n# comment\nB = x=y").get("B")).toBe("x=y");
  });
});

// ---- metadata ---------------------------------------------------------------------------------

describe("Edit / Remove PDF Metadata", () => {
  it("edits Info and XMP together, keeping blank fields and clearing '-'", async () => {
    const out = file(
      await run(editMetadataExecutor, [{ name: "d.pdf", bytes: multiPage }], {
        title: "New Title",
        author: "Ada",
        subject: "-",
      }),
    );
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    const props = readProperties(doc);
    expect(props.Title).toBe("New Title");
    expect(props.Author).toBe("Ada");
    expect(props.Subject).toBeUndefined();
    expect(Buffer.from(out.bytes).toString("latin1")).toContain(
      '<rdf:li xml:lang="x-default">New Title</rdf:li>',
    );
    expect(
      fail(await run(editMetadataExecutor, [{ name: "d.pdf", bytes: multiPage }], {})).message,
    ).toMatch(/at least one/);
  });

  it("removes Info, XMP and private data from a batch", async () => {
    const edited = file(
      await run(editMetadataExecutor, [{ name: "d.pdf", bytes: multiPage }], {
        title: "Secret",
        author: "Someone",
      }),
    );
    const result = ok(
      await run(removeMetadataExecutor, [{ name: "d.pdf", bytes: edited.bytes }], {
        packaging: "files",
      }),
    );
    const clean = result.files![0]!.bytes;
    const doc = await PDFDocument.load(clean, { updateMetadata: false });
    expect(readProperties(doc)).toEqual({});
    expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(false);
    const raw = Buffer.from(clean).toString("latin1");
    expect(raw).not.toContain("Someone");
    expect(raw).not.toContain("x:xmpmeta");
    expect((await textOf(clean))[0]).toContain("Page 1 of 5");
  });
});

// ---- compare ----------------------------------------------------------------------------------

describe("Compare PDFs", () => {
  it("reports identical documents as identical", async () => {
    const result = ok(
      await run(comparePdfsExecutor, [
        { name: "a.pdf", bytes: multiPage },
        { name: "b.pdf", bytes: multiPage },
      ]),
    );
    expect((result.output as { identical: boolean }).identical).toBe(true);
  });

  it("finds changed text and highlights the changed page", async () => {
    const changed = await makeTextPdf({ pages: 5, title: "Five pages" });
    const doc = await PDFDocument.load(changed);
    const font = await embedUnicodeFont(doc);
    doc.getPage(2).drawText("An inserted sentence", { x: 40, y: 400, size: 14, font });
    const result = ok(
      await run(comparePdfsExecutor, [
        { name: "a.pdf", bytes: multiPage },
        { name: "b.pdf", bytes: await doc.save() },
      ]),
    );
    const output = result.output as {
      identical: boolean;
      textChanges: { added: number };
      visuallyChangedPages: number[];
    };
    expect(output.identical).toBe(false);
    expect(output.textChanges.added).toBe(1);
    expect(output.visuallyChangedPages).toEqual([3]);
    const html = new TextDecoder().decode(file(result, "html").bytes);
    expect(html).toContain("<ins>An inserted sentence</ins>");
    expect(html).not.toMatch(/<script/i);
    expect(await PDFDocument.load(file(result, "pdf").bytes).then((d) => d.getPageCount())).toBe(5);
  });

  it("notices added pages and requires exactly two files", async () => {
    const result = ok(
      await run(comparePdfsExecutor, [
        { name: "a.pdf", bytes: multiPage },
        { name: "b.pdf", bytes: await makeTextPdf({ pages: 6, title: "x" }) },
      ]),
    );
    expect((result.output as { visuallyChangedPages: number[] }).visuallyChangedPages).toContain(6);
    expect(
      fail(await run(comparePdfsExecutor, [{ name: "a.pdf", bytes: multiPage }])).message,
    ).toMatch(/at least 2/);
  });
});

// ---- OCR (accuracy smoke test) ------------------------------------------------------------------

describe("OCR PDF", () => {
  it("reads the words of an image-only scan and makes the PDF searchable", async () => {
    // The fixture really has no text layer.
    expect((await textOf(scanned))[0]).toBe("");
    const result = ok(
      await run(ocrPdfExecutor, [{ name: "scan.pdf", bytes: scanned }], { dpi: 200 }),
    );
    const text = new TextDecoder().decode(file(result, "txt").bytes);
    for (const word of ["Invoice", "4821", "Total", "1250", "OneStop", "scanned", "fixture"])
      expect(text).toContain(word);
    const searchable = (await textOf(file(result, "pdf").bytes))[0]!;
    expect(searchable).toContain("Invoice");
    expect(searchable).toContain("4821");
    expect((result.output as { confidence: number }).confidence).toBeGreaterThan(70);
  }, 60_000);

  it("leaves pages that already have text alone", async () => {
    const result = ok(
      await run(ocrPdfExecutor, [{ name: "text.pdf", bytes: multiPage }], { output: "txt" }),
    );
    expect((result.output as { recognised: number; skipped: number }).recognised).toBe(0);
    expect((result.output as { skipped: number }).skipped).toBe(5);
  });
});

// ---- PDF/A ------------------------------------------------------------------------------------

describe("PDF → PDF/A", () => {
  it("a plain PDF fails the conformance check", async () => {
    const report = await checkPdfA(multiPage);
    expect(report.conforms).toBe(false);
    expect(report.problems).toEqual(
      expect.arrayContaining(["catalog has no XMP metadata stream", "no output intent"]),
    );
  });

  it("converts a PDF with unembedded fonts and passes the check, keeping searchable text", async () => {
    const result = ok(await run(pdfToPdfAExecutor, [{ name: "doc.pdf", bytes: multiPage }]));
    const bytes = file(result).bytes;
    const report = await checkPdfA(bytes);
    expect(report.problems).toEqual([]);
    expect(report).toMatchObject({ conforms: true, part: 2, conformance: "B" });
    expect((result.output as { rasterised: boolean }).rasterised).toBe(true);
    expect((await textOf(bytes))[0]).toContain("Page 1 of 5");
    expect(readProperties(await PDFDocument.load(bytes)).Title).toBe("Five pages");
  }, 60_000);

  it("keeps vector pages when fonts are embedded, and strips JavaScript", async () => {
    const doc = await PDFDocument.create();
    const font = await embedUnicodeFont(doc);
    doc.addPage().drawText("Embedded font page", { x: 50, y: 700, size: 18, font });
    doc.addJavaScript("hello", "app.alert('hi')");
    const result = await convertToPdfA(await doc.save());
    expect(result.rasterised).toBe(false);
    expect(result.removed).toContain("JavaScript");
    expect(result.report.problems).toEqual([]);
    expect((await textOf(result.bytes))[0]).toContain("Embedded font page");
  });

  it("generates a valid ICC profile", () => {
    const icc = srgbIccProfile();
    expect(new DataView(icc.buffer).getUint32(0)).toBe(icc.length);
    expect(new TextDecoder().decode(icc.subarray(36, 40))).toBe("acsp");
  });
});

// ---- PDF → HTML -------------------------------------------------------------------------------

describe("PDF → HTML", () => {
  it("exact layout: page images plus selectable text, no script, strict CSP", async () => {
    const html = new TextDecoder().decode(
      file(await run(pdfToHtmlExecutor, [{ name: "r.pdf", bytes: structured }])).bytes,
    );
    expect(html).toContain("Quarterly Report");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/class="page/g)).toHaveLength(2);
  });

  it("reflowable layout rebuilds headings and paragraphs", async () => {
    const html = new TextDecoder().decode(
      file(await run(pdfToHtmlExecutor, [{ name: "r.pdf", bytes: structured }], { mode: "flow" }))
        .bytes,
    );
    expect(html).toContain("<h1>Quarterly Report</h1>");
    expect(html).toContain(
      "<p>Revenue grew steadily across every region this quarter. The team shipped three major releases on schedule.</p>",
    );
    expect(html).not.toContain("data:image");
  });

  it("escapes text taken from the PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("<img src=x onerror=alert(1)>", { x: 50, y: 700, size: 12 });
    const html = new TextDecoder().decode(
      file(
        await run(pdfToHtmlExecutor, [{ name: "x.pdf", bytes: await doc.save() }], {
          mode: "text",
        }),
      ).bytes,
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});

// ---- PDF ↔ Office -----------------------------------------------------------------------------

describe("PDF ↔ Word / Excel / PowerPoint", () => {
  it("PDF → Word keeps headings, paragraphs and page order", async () => {
    const docx = file(await run(pdfToWordExecutor, [{ name: "r.pdf", bytes: structured }]), "docx");
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(docx.bytes) });
    expect(html).toContain("<h1>Quarterly Report</h1>");
    expect(html).toContain("Revenue grew steadily across every region this quarter.");
    expect(html.indexOf("Quarterly Report")).toBeLessThan(html.indexOf("Next Steps"));
  });

  it("round-trips PDF → Word → PDF with the text intact", async () => {
    const { bytes: docx } = await pdfToOffice(structured, "docx");
    const back = await officeToPdf(docx, "docx", { engine: "builtin" });
    const text = (await textOf(back.bytes)).join("\n");
    for (const phrase of [
      "Quarterly Report",
      "Revenue grew steadily",
      "Next Steps",
      "Hire two engineers",
    ])
      expect(text).toContain(phrase);
  });

  it("PDF → Excel puts table cells in columns, with real numbers", async () => {
    const xlsx = file(
      await run(pdfToExcelExecutor, [{ name: "r.pdf", bytes: structured }]),
      "xlsx",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.bytes) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Page 1")!;
    const rows: unknown[][] = [];
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows).toContainEqual(["Region", "Units", "Revenue"]);
    expect(rows).toContainEqual(["North", 120, 4500.5]);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Page 1", "Page 2"]);

    const back = await officeToPdf(xlsx.bytes, "xlsx", { engine: "builtin" });
    const text = (await textOf(back.bytes)).join("\n");
    expect(text).toContain("North");
    expect(text).toContain("4500.5");
  });

  it("PDF → PowerPoint: exact slides carry the page image and the text in notes; editable slides round-trip", async () => {
    const exact = file(
      await run(pdfToPowerPointExecutor, [{ name: "r.pdf", bytes: structured }]),
      "pptx",
    );
    const zip = await JSZip.loadAsync(exact.bytes);
    expect(
      Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)),
    ).toHaveLength(2);
    expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
    const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(notes).toContain("Quarterly Report");

    const editable = file(
      await run(pdfToPowerPointExecutor, [{ name: "r.pdf", bytes: structured }], {
        layout: "editable",
      }),
      "pptx",
    );
    const back = await officeToPdf(editable.bytes, "pptx", { engine: "builtin" });
    const text = await textOf(back.bytes);
    expect(text).toHaveLength(2);
    expect(text[0]).toContain("Quarterly Report");
    expect(text[1]).toContain("Hire two engineers");
  });

  it("refuses to make an empty document from a scan, pointing at OCR", async () => {
    expect(fail(await run(pdfToWordExecutor, [{ name: "s.pdf", bytes: scanned }])).message).toMatch(
      /OCR PDF/,
    );
    ok(await run(pdfToWordExecutor, [{ name: "s.pdf", bytes: scanned }], { layout: "exact" }));
  });
});

// ---- missing optional dependency ----------------------------------------------------------------

describe("LibreOffice is optional", () => {
  it("with LibreOffice missing, Office → PDF degrades to the built-in converter with a notice", async () => {
    setLibreOfficeLocator(() => null);
    const { bytes: docx } = await pdfToOffice(structured, "docx");
    const result = await officeToPdf(docx, "docx");
    expect(result.engine).toBe("builtin");
    expect(result.notice).toMatch(/LibreOffice isn't installed/);
    expect((await textOf(result.bytes))[0]).toContain("Quarterly Report");
  });

  it("with LibreOffice missing, a format only it can read fails with an actionable message", async () => {
    setLibreOfficeLocator(() => null);
    const error = await officeToPdf(new Uint8Array([1, 2, 3]), "doc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OfficeConvertError);
    expect((error as Error).message).toMatch(/needs LibreOffice.*libreoffice\.org.*\.docx/);
  });

  it("PDF → Word asked to use LibreOffice still succeeds without it, and says so", async () => {
    setLibreOfficeLocator(() => null);
    const result = ok(
      await run(pdfToWordExecutor, [{ name: "r.pdf", bytes: structured }], {
        engine: "libreoffice",
      }),
    );
    expect(result.summary).toMatch(/LibreOffice isn't installed/);
    expect((result.output as { engine: string }).engine).toBe("builtin");
  });

  it("a LibreOffice that fails to run falls back instead of crashing", async () => {
    // Node itself rejects the soffice flags and exits non-zero: a broken install, harmlessly.
    setLibreOfficeLocator(() => process.execPath);
    const { bytes: docx } = await pdfToOffice(structured, "docx");
    const result = await officeToPdf(docx, "docx");
    expect(result.engine).toBe("builtin");
    expect(result.notice).toMatch(/LibreOffice could not convert/);
  }, 30_000);
});

// ---- offline ----------------------------------------------------------------------------------

describe("offline", () => {
  it("every phase-06 tool runs with the network disabled", async () => {
    const calls: string[] = [];
    const trap = (label: string) =>
      ((...args: unknown[]) => {
        calls.push(`${label}(${String(args[0])})`);
        throw new Error(`${label} must not be called offline`);
      }) as never;
    const http = await import("node:http");
    const https = await import("node:https");
    const real = {
      fetch: globalThis.fetch,
      httpGet: http.default.get,
      httpsGet: https.default.get,
      httpRequest: http.default.request,
      httpsRequest: https.default.request,
    };
    globalThis.fetch = trap("fetch");
    http.default.get = trap("http.get");
    https.default.get = trap("https.get");
    http.default.request = trap("http.request");
    https.default.request = trap("https.request");
    setLibreOfficeLocator(() => null);

    const locked = file(
      await run(protectPdfExecutor, [{ name: "d.pdf", bytes: multiPage }], { password: "offline" }),
    );
    const cases: Record<string, [{ name: string; bytes: Uint8Array }[], Record<string, unknown>]> =
      {
        "pdf-to-pdfa": [[{ name: "d.pdf", bytes: multiPage }], {}],
        "pdf-to-html": [[{ name: "d.pdf", bytes: structured }], {}],
        "add-watermark-to-pdf": [[{ name: "d.pdf", bytes: multiPage }], {}],
        "add-page-numbers-to-pdf": [[{ name: "d.pdf", bytes: multiPage }], {}],
        "password-protect-pdf": [[{ name: "d.pdf", bytes: multiPage }], { password: "offline" }],
        "remove-pdf-password": [[{ name: "d.pdf", bytes: locked.bytes }], { password: "offline" }],
        "sign-pdf": [
          [{ name: "d.pdf", bytes: multiPage }],
          { source: "type", signerName: "Offline", certify: true },
        ],
        "fill-pdf-forms": [[{ name: "f.pdf", bytes: formPdf }], { values: "Name = Offline" }],
        "edit-pdf-metadata": [[{ name: "d.pdf", bytes: multiPage }], { title: "Offline" }],
        "remove-pdf-metadata": [[{ name: "d.pdf", bytes: multiPage }], {}],
        "compare-pdfs": [
          [
            { name: "a.pdf", bytes: multiPage },
            { name: "b.pdf", bytes: structured },
          ],
          {},
        ],
        "ocr-pdf": [[{ name: "s.pdf", bytes: scanned }], { dpi: 150 }],
        "pdf-to-word": [[{ name: "d.pdf", bytes: structured }], {}],
        "pdf-to-excel": [[{ name: "d.pdf", bytes: structured }], {}],
        "pdf-to-powerpoint": [[{ name: "d.pdf", bytes: structured }], {}],
      };
    try {
      for (const [id, executor] of PDF_ADVANCED_EXECUTORS) {
        const [files, options] = cases[id]!;
        const result = await run(executor, files, options);
        expect(result.ok, `${id} failed offline: ${result.ok ? "" : result.message}`).toBe(true);
      }
    } finally {
      globalThis.fetch = real.fetch;
      http.default.get = real.httpGet;
      https.default.get = real.httpsGet;
      http.default.request = real.httpRequest;
      https.default.request = real.httpsRequest;
    }
    expect(calls).toEqual([]);
  }, 180_000);
});
