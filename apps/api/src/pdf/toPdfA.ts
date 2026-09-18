// PDF → PDF/A (Features 1.7) — archival PDF/A-2b, plus the conformance check that proves it.
//
// PDF/A-2b ("basic": the pages will look the same forever) needs, among other things: an XMP
// packet identifying the part and level; an output intent with an embedded ICC profile; every
// font embedded; no encryption; no JavaScript, launch actions or other dynamic content; and
// annotations that print. `convertToPdfA` produces that, and `checkPdfA` verifies the same rules
// independently, so the tool never claims conformance it did not check.
//
// Fonts are the one thing that cannot be patched in place: a page that uses a font the file does
// not embed is rebuilt as an image with an invisible, embedded-font text layer (still searchable).
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from "@cantoo/pdf-lib";
import { randomBytes } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optEnum,
  outputName,
  PDF_MIME,
  readSinglePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool } from "./errors.ts";
import { embedUnicodeFont } from "./fonts.ts";
import { plural } from "./inputs.ts";
import { layoutFromDocument } from "./layout.ts";
import { buildXmp, readProperties, setXmp, type PdfProperties } from "./metadata.ts";
import { renderPage, withPdfJs } from "./render.ts";
import { drawInvisibleWords } from "./textLayer.ts";

export const PDF_TO_PDFA_TOOL_ID = "pdf-to-pdfa";

// ---- ICC profile --------------------------------------------------------------------------------

/**
 * A compact ICC v2 RGB display profile with sRGB primaries (D50-adapted) and a 2.2 gamma curve.
 * Generated rather than shipped, so the repo carries no opaque binary; ~500 bytes.
 */
export function srgbIccProfile(): Uint8Array {
  const tags: [string, Uint8Array][] = [];
  const s15 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, Math.round(v * 65536));
    return b;
  };
  const xyz = (x: number, y: number, z: number) =>
    concat([ascii("XYZ "), new Uint8Array(4), s15(x), s15(y), s15(z)]);
  const curve = concat([
    ascii("curv"),
    new Uint8Array(4),
    u32(1),
    new Uint8Array([0x02, 0x33, 0, 0]),
  ]);
  const text = (s: string) => concat([ascii("text"), new Uint8Array(4), ascii(`${s}\0`)]);
  const desc = (s: string) =>
    concat([
      ascii("desc"),
      new Uint8Array(4),
      u32(s.length + 1),
      ascii(`${s}\0`),
      new Uint8Array(4 + 4 + 2 + 1 + 67),
    ]);
  tags.push(["desc", desc("sRGB (OneStop)")]);
  tags.push(["cprt", text("No copyright, use freely")]);
  tags.push(["wtpt", xyz(0.9642, 1.0, 0.8249)]);
  tags.push(["rXYZ", xyz(0.4361, 0.2225, 0.0139)]);
  tags.push(["gXYZ", xyz(0.3851, 0.7169, 0.0971)]);
  tags.push(["bXYZ", xyz(0.1431, 0.0606, 0.7141)]);
  tags.push(["rTRC", curve]);
  tags.push(["gTRC", curve]);
  tags.push(["bTRC", curve]);

  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const table: Uint8Array[] = [u32(tags.length)];
  const data: Uint8Array[] = [];
  for (const [sig, body] of tags) {
    const padded = pad4(body);
    table.push(concat([ascii(sig), u32(offset), u32(body.length)]));
    data.push(padded);
    offset += padded.length;
  }
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  view.setUint32(0, offset);
  header.set(ascii("none"), 4);
  view.setUint32(8, 0x02100000);
  header.set(ascii("mntr"), 12);
  header.set(ascii("RGB "), 16);
  header.set(ascii("XYZ "), 20);
  view.setUint16(24, 2026);
  view.setUint16(26, 1);
  view.setUint16(28, 1);
  header.set(ascii("acsp"), 36);
  view.setInt32(68, Math.round(0.9642 * 65536));
  view.setInt32(72, 65536);
  view.setInt32(76, Math.round(0.8249 * 65536));
  return concat([header, ...table, ...data]);
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
function pad4(b: Uint8Array): Uint8Array {
  const rem = b.length % 4;
  return rem === 0 ? b : concat([b, new Uint8Array(4 - rem)]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- inspection helpers ------------------------------------------------------------------------

function dictOf(doc: PDFDocument, value: unknown): PDFDict | undefined {
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (resolved instanceof PDFDict) return resolved;
  if (resolved instanceof PDFStream) return resolved.dict;
  return undefined;
}

function allDicts(doc: PDFDocument): { ref: PDFRef; dict: PDFDict }[] {
  const out: { ref: PDFRef; dict: PDFDict }[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : null;
    if (dict) out.push({ ref, dict });
  }
  return out;
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  const v = dict.get(PDFName.of(key));
  return v instanceof PDFName ? v.decodeText() : undefined;
}

/** Fonts (by BaseFont name) that are used but not embedded. Type3 fonts are always "embedded". */
export function unembeddedFonts(doc: PDFDocument): string[] {
  const missing = new Set<string>();
  for (const { dict } of allDicts(doc)) {
    if (nameOf(dict, "Type") !== "Font") continue;
    const subtype = nameOf(dict, "Subtype");
    if (subtype === "Type3" || subtype === "Type0") continue;
    const descriptor = dictOf(doc, dict.get(PDFName.of("FontDescriptor")));
    const embedded =
      descriptor &&
      (descriptor.has(PDFName.of("FontFile")) ||
        descriptor.has(PDFName.of("FontFile2")) ||
        descriptor.has(PDFName.of("FontFile3")));
    if (!embedded) missing.add(nameOf(dict, "BaseFont") ?? "unnamed font");
  }
  return [...missing];
}

const FORBIDDEN_ACTIONS = new Set([
  "Launch",
  "Sound",
  "Movie",
  "ResetForm",
  "ImportData",
  "JavaScript",
  "Hide",
  "SetOCGState",
  "Rendition",
  "Trans",
  "GoTo3DView",
]);
const FORBIDDEN_ANNOTS = new Set(["Sound", "Movie", "Screen", "3D", "RichMedia", "FileAttachment"]);

export interface PdfAReport {
  conforms: boolean;
  part: number | null;
  conformance: string | null;
  problems: string[];
}

/** Checks the core PDF/A-2b rules. Not a full veraPDF, but every rule it checks is a real one. */
export async function checkPdfA(bytes: Uint8Array): Promise<PdfAReport> {
  const problems: string[] = [];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 32));
  if (!/^%PDF-1\.[4-7]/.test(head)) problems.push("header is not %PDF-1.4 to 1.7");
  const nl = head.indexOf("\n");
  const comment = bytes.subarray(nl + 1, nl + 6);
  if (comment[0] !== 0x25 || [...comment.subarray(1, 5)].some((b) => b < 128)) {
    problems.push("missing binary comment after the header");
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { conforms: false, part: null, conformance: null, problems: ["file cannot be parsed"] };
  }
  const trailer = doc.context.trailerInfo;
  if (trailer.Encrypt) problems.push("file is encrypted");
  if (!trailer.ID) problems.push("trailer has no /ID");

  let part: number | null = null;
  let conformance: string | null = null;
  const metadata = doc.catalog.lookup(PDFName.of("Metadata"));
  if (!(metadata instanceof PDFStream)) {
    problems.push("catalog has no XMP metadata stream");
  } else {
    if (metadata.dict.has(PDFName.of("Filter"))) problems.push("XMP metadata stream is compressed");
    const xmp = new TextDecoder().decode(
      metadata instanceof PDFRawStream ? metadata.contents : new Uint8Array(),
    );
    const p = /<pdfaid:part>(\d)<\/pdfaid:part>|pdfaid:part="(\d)"/.exec(xmp);
    const c = /<pdfaid:conformance>([ABU])<\/pdfaid:conformance>|pdfaid:conformance="([ABU])"/.exec(
      xmp,
    );
    part = p ? Number(p[1] ?? p[2]) : null;
    conformance = c ? (c[1] ?? c[2])! : null;
    if (!part) problems.push("XMP does not identify a PDF/A part");
    if (!conformance) problems.push("XMP does not identify a PDF/A conformance level");
    const info = readProperties(doc);
    if (info.Title) {
      const t = /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(xmp);
      const unescape = (s: string) =>
        s
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&");
      if (!t || unescape(t[1]!) !== info.Title)
        problems.push("Info /Title and XMP dc:title disagree");
    }
  }

  const intents = doc.catalog.lookup(PDFName.of("OutputIntents"));
  const intent = intents instanceof PDFArray ? dictOf(doc, intents.get(0)) : undefined;
  if (!intent) {
    problems.push("no output intent");
  } else {
    if (nameOf(intent, "S") !== "GTS_PDFA1") problems.push("output intent is not GTS_PDFA1");
    const profile = intent.lookup(PDFName.of("DestOutputProfile"));
    if (!(profile instanceof PDFStream)) problems.push("output intent has no ICC profile");
    else if (profile instanceof PDFRawStream) {
      const icc = profile.dict.has(PDFName.of("Filter")) ? null : profile.contents;
      if (icc && new TextDecoder("latin1").decode(icc.subarray(36, 40)) !== "acsp") {
        problems.push("output intent ICC profile is not valid");
      }
    }
  }

  const missing = unembeddedFonts(doc);
  if (missing.length) problems.push(`fonts not embedded: ${missing.join(", ")}`);

  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) {
    if (names.has(PDFName.of("JavaScript"))) problems.push("document contains JavaScript");
    if (names.has(PDFName.of("EmbeddedFiles"))) problems.push("document contains embedded files");
  }
  const acroForm = dictOf(doc, doc.catalog.get(PDFName.of("AcroForm")));
  if (acroForm?.get(PDFName.of("NeedAppearances"))?.toString() === "true") {
    problems.push("form sets NeedAppearances");
  }
  if (acroForm?.has(PDFName.of("XFA"))) problems.push("form contains XFA");

  for (const { dict } of allDicts(doc)) {
    const s = nameOf(dict, "S");
    if (s && FORBIDDEN_ACTIONS.has(s) && (nameOf(dict, "Type") ?? "Action") === "Action") {
      problems.push(`forbidden action: ${s}`);
    }
    if (
      nameOf(dict, "Type") === "Annot" ||
      (dict.has(PDFName.of("Subtype")) && dict.has(PDFName.of("Rect")))
    ) {
      const subtype = nameOf(dict, "Subtype");
      if (subtype && FORBIDDEN_ANNOTS.has(subtype))
        problems.push(`forbidden annotation: ${subtype}`);
      if (subtype && subtype !== "Popup" && nameOf(dict, "Type") === "Annot") {
        const flags = dict.get(PDFName.of("F"));
        const f = flags instanceof PDFNumber ? flags.asNumber() : 0;
        if ((f & 4) === 0 || (f & 3) !== 0)
          problems.push(`annotation ${subtype} is not set to print`);
      }
    }
    if (dict.has(PDFName.of("AA"))) problems.push("additional-actions (/AA) present");
    const filter = dict.get(PDFName.of("Filter"));
    if (filter instanceof PDFName && filter.decodeText() === "LZWDecode")
      problems.push("LZW compression used");
  }

  const unique = [...new Set(problems)];
  return { conforms: unique.length === 0, part, conformance, problems: unique };
}

// ---- conversion -------------------------------------------------------------------------------

/** Removes everything PDF/A forbids that can be removed without changing how pages look. */
function stripDynamicContent(doc: PDFDocument): string[] {
  const removed = new Set<string>();
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) {
    if (names.has(PDFName.of("JavaScript"))) removed.add("JavaScript");
    if (names.has(PDFName.of("EmbeddedFiles"))) removed.add("embedded files");
    names.delete(PDFName.of("JavaScript"));
    names.delete(PDFName.of("EmbeddedFiles"));
  }
  const open = dictOf(doc, doc.catalog.get(PDFName.of("OpenAction")));
  if (open && nameOf(open, "S") && FORBIDDEN_ACTIONS.has(nameOf(open, "S")!)) {
    doc.catalog.delete(PDFName.of("OpenAction"));
    removed.add("open action");
  }
  const acroForm = dictOf(doc, doc.catalog.get(PDFName.of("AcroForm")));
  if (acroForm) {
    acroForm.delete(PDFName.of("XFA"));
    acroForm.delete(PDFName.of("NeedAppearances"));
  }
  for (const { ref, dict } of allDicts(doc)) {
    if (dict.has(PDFName.of("AA"))) {
      dict.delete(PDFName.of("AA"));
      removed.add("automatic actions");
    }
    const s = nameOf(dict, "S");
    if (s && FORBIDDEN_ACTIONS.has(s) && !dict.has(PDFName.of("Subtype"))) {
      // Neutralise the action rather than deleting an object something may still reference.
      dict.set(PDFName.of("S"), PDFName.of("GoTo"));
      dict.set(PDFName.of("D"), doc.context.obj([doc.getPage(0).ref, PDFName.of("Fit")]));
      dict.delete(PDFName.of("JS"));
      dict.delete(PDFName.of("F"));
      removed.add(`${s} actions`);
    }
    if (
      nameOf(dict, "Type") === "Annot" ||
      (dict.has(PDFName.of("Rect")) && dict.has(PDFName.of("Subtype")) && dict.has(PDFName.of("P")))
    ) {
      const subtype = nameOf(dict, "Subtype");
      if (subtype && FORBIDDEN_ANNOTS.has(subtype)) {
        doc.context.delete(ref);
        removed.add(`${subtype} annotations`);
        continue;
      }
      if (subtype && subtype !== "Popup") {
        const flags = dict.get(PDFName.of("F"));
        const f = flags instanceof PDFNumber ? flags.asNumber() : 0;
        dict.set(PDFName.of("F"), PDFNumber.of((f | 4) & ~3));
      }
    }
  }
  // Drop now-dangling annotation references.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const entry = annots.get(i);
      if (entry instanceof PDFRef && !doc.context.lookup(entry)) annots.remove(i);
    }
  }
  return [...removed];
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Writes the PDF/A identification: XMP, matching /Info, output intent and file ID. */
function identify(doc: PDFDocument, properties: PdfProperties): void {
  const now = pdfDate(new Date());
  const props: PdfProperties = {
    ...properties,
    Producer: "OneStop (PDF/A-2b)",
    CreationDate: properties.CreationDate ?? now,
    ModDate: now,
  };
  const info = doc.context.obj({}) as PDFDict;
  for (const [key, value] of Object.entries(props)) {
    if (value) info.set(PDFName.of(key), PDFHexString.fromText(value));
  }
  doc.context.trailerInfo.Info = doc.context.register(info);
  setXmp(doc, buildXmp({ properties: props, pdfa: { part: 2, conformance: "B" } }));

  const icc = doc.context.stream(srgbIccProfile(), { N: 3 });
  const intent = doc.context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: doc.context.register(icc),
  });
  doc.catalog.set(PDFName.of("OutputIntents"), doc.context.obj([doc.context.register(intent)]));
  const id = PDFHexString.of(randomBytes(16).toString("hex"));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
}

/** Rebuilds every page as an image + invisible embedded-font text layer (for unembedded fonts). */
async function rasterisedCopy(bytes: Uint8Array, signal?: AbortSignal): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const font = await embedUnicodeFont(out);
  await withPdfJs(bytes, async (pdf) => {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      throwIfAborted(signal);
      const rendered = await renderPage(pdf, n, { dpi: 200, format: "jpg", quality: 0.85 });
      const page = out.addPage([rendered.pointWidth, rendered.pointHeight]);
      const image = await out.embedJpg(rendered.bytes);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: rendered.pointWidth,
        height: rendered.pointHeight,
      });
      const [layout] = await layoutFromDocument(pdf, [n]);
      drawInvisibleWords(
        page,
        font,
        (layout?.lines ?? []).flatMap((line) =>
          line.runs.map((run) => ({
            text: run.text,
            x: run.x,
            y: rendered.pointHeight - run.baseline - run.fontSize * 0.2,
            width: run.width,
            height: run.fontSize,
          })),
        ),
      );
    }
  });
  return out;
}

export interface PdfAResult {
  bytes: Uint8Array;
  rasterised: boolean;
  removed: string[];
  report: PdfAReport;
}

export async function convertToPdfA(
  bytes: Uint8Array,
  { mode = "auto", signal }: { mode?: "auto" | "image"; signal?: AbortSignal } = {},
): Promise<PdfAResult> {
  const source = await loadPdf(bytes);
  const properties = readProperties(source);
  const needsRaster = mode === "image" || unembeddedFonts(source).length > 0;
  const doc = needsRaster ? await rasterisedCopy(bytes, signal) : source;
  const removed = needsRaster ? [] : stripDynamicContent(doc);
  identify(doc, properties);
  // Uncompressed object streams keep the XMP readable and the file PDF/A-1-friendly too.
  const out = await doc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
  const fixed = setHeaderVersion(out, "1.7");
  return { bytes: fixed, rasterised: needsRaster, removed, report: await checkPdfA(fixed) };
}

/** Rewrites "%PDF-1.x" in place (same length), since PDF/A-2 is based on PDF 1.7. */
function setHeaderVersion(bytes: Uint8Array, version: string): Uint8Array {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!/^%PDF-\d\.\d$/.test(head)) return bytes;
  const copy = new Uint8Array(bytes);
  copy.set(new TextEncoder().encode(`%PDF-${version}`), 0);
  return copy;
}

export const pdfToPdfAExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(PDF_TO_PDFA_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const mode = optEnum(options, "mode", ["auto", "image"] as const, "auto");
    const result = await convertToPdfA(file.bytes, {
      mode,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    if (!result.report.conforms) {
      console.error("[pdf:pdf-to-pdfa] conformance check failed", result.report.problems);
    }
    const notes: string[] = [];
    if (result.rasterised) {
      notes.push(
        mode === "image"
          ? "Pages were rebuilt as images with a searchable text layer."
          : "Some fonts were not embedded, so pages were rebuilt as images with a searchable text layer.",
      );
    }
    if (result.removed.length) notes.push(`Removed: ${result.removed.join(", ")}.`);
    return {
      ok: true,
      output: {
        conformance: "PDF/A-2b",
        check: result.report,
        rasterised: result.rasterised,
        removed: result.removed,
      },
      summary: result.report.conforms
        ? `Converted to PDF/A-2b and passed the conformance check. ${notes.join(" ")}`.trim()
        : `Converted, but ${plural(result.report.problems.length, "check")} did not pass: ${result.report.problems.join("; ")}.`,
      files: [{ name: outputName(file.ref.name, "pdfa"), mimeType: PDF_MIME, bytes: result.bytes }],
    };
  });
