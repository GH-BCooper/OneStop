// Edit PDF Metadata (Features 1.22) and Remove PDF Metadata (Features 1.23).
//
// A PDF keeps its properties in two places: the classic /Info dictionary and an XMP packet on the
// catalogue. Editing rewrites both so every reader agrees; removing strips both, plus the
// per-page and per-object XMP packets and application private data (/PieceInfo) that leak
// authoring details.
import {
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFHexString,
  type PDFDocument,
} from "@cantoo/pdf-lib";
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import {
  loadPdf,
  optEnum,
  optString,
  outputName,
  PDF_MIME,
  readPdfInputs,
  readSinglePdf,
  savePdf,
  throwIfAborted,
} from "./document.ts";
import { runPdfTool, unsupported } from "./errors.ts";
import { packageOutputs, plural, zipNameFor } from "./inputs.ts";

export const EDIT_METADATA_TOOL_ID = "edit-pdf-metadata";
export const REMOVE_METADATA_TOOL_ID = "remove-pdf-metadata";

export const INFO_FIELDS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
] as const;
export type InfoField = (typeof INFO_FIELDS)[number];
const DATE_FIELDS = ["CreationDate", "ModDate"] as const;

export type PdfProperties = Partial<Record<InfoField | (typeof DATE_FIELDS)[number], string>>;

function decodeText(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

/** Reads the /Info properties as plain strings. */
export function readProperties(doc: PDFDocument): PdfProperties {
  const info = infoDict(doc);
  const out: PdfProperties = {};
  if (!info) return out;
  for (const key of [...INFO_FIELDS, ...DATE_FIELDS]) {
    const text = decodeText(info.lookup(PDFName.of(key)));
    if (text) out[key] = text;
  }
  return out;
}

function infoDict(doc: PDFDocument): PDFDict | undefined {
  const ref = doc.context.trailerInfo.Info;
  if (!ref) return undefined;
  const info = doc.context.lookup(ref);
  return info instanceof PDFDict ? info : undefined;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "D:20260918120000Z" or a Date → ISO 8601, as XMP wants it. */
export function toIsoDate(value: string | Date | undefined): string | undefined {
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (!value) return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!m) return undefined;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z`;
}

export interface XmpOptions {
  properties: PdfProperties;
  /** PDF/A identification, e.g. { part: 2, conformance: "B" }. */
  pdfa?: { part: number; conformance: string };
}

/** Builds an XMP packet that mirrors the /Info properties (and, optionally, PDF/A identification). */
export function buildXmp({ properties: p, pdfa }: XmpOptions): string {
  const created = toIsoDate(p.CreationDate);
  const modified = toIsoDate(p.ModDate);
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    '  xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '  xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '  xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
    pdfa ? '  xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"' : "",
    ">",
    "<dc:format>application/pdf</dc:format>",
    p.Title
      ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(p.Title)}</rdf:li></rdf:Alt></dc:title>`
      : "",
    p.Author
      ? `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(p.Author)}</rdf:li></rdf:Seq></dc:creator>`
      : "",
    p.Subject
      ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(p.Subject)}</rdf:li></rdf:Alt></dc:description>`
      : "",
    p.Keywords ? `<pdf:Keywords>${xmlEscape(p.Keywords)}</pdf:Keywords>` : "",
    p.Producer ? `<pdf:Producer>${xmlEscape(p.Producer)}</pdf:Producer>` : "",
    p.Creator ? `<xmp:CreatorTool>${xmlEscape(p.Creator)}</xmp:CreatorTool>` : "",
    created ? `<xmp:CreateDate>${created}</xmp:CreateDate>` : "",
    modified ? `<xmp:ModifyDate>${modified}</xmp:ModifyDate>` : "",
    modified ? `<xmp:MetadataDate>${modified}</xmp:MetadataDate>` : "",
    pdfa ? `<pdfaid:part>${pdfa.part}</pdfaid:part>` : "",
    pdfa ? `<pdfaid:conformance>${pdfa.conformance}</pdfaid:conformance>` : "",
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ];
  return lines.filter(Boolean).join("\n");
}

/** Replaces the catalogue's XMP packet. Uncompressed, as PDF/A requires. */
export function setXmp(doc: PDFDocument, xmp: string): void {
  const stream = doc.context.stream(new TextEncoder().encode(xmp), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
}

/** Writes /Info (and a matching XMP packet). `undefined` keeps a field, `""` clears it. */
export function writeProperties(doc: PDFDocument, changes: PdfProperties): PdfProperties {
  const current = readProperties(doc);
  const next: PdfProperties = { ...current };
  for (const [key, value] of Object.entries(changes) as [
    keyof PdfProperties,
    string | undefined,
  ][]) {
    if (value === undefined) continue;
    if (value === "") delete next[key];
    else next[key] = value;
  }
  const info = doc.context.obj({}) as PDFDict;
  for (const [key, value] of Object.entries(next)) {
    if (value) info.set(PDFName.of(key), PDFHexString.fromText(value));
  }
  doc.context.trailerInfo.Info = doc.context.register(info);
  setXmp(doc, buildXmp({ properties: next }));
  return next;
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export const editMetadataExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(EDIT_METADATA_TOOL_ID, async () => {
    const file = await readSinglePdf(input, ctx);
    const doc = await loadPdf(file.bytes);
    const before = readProperties(doc);

    const changes: PdfProperties = {};
    for (const field of INFO_FIELDS) {
      const raw = optString(options, field.toLowerCase()).trim();
      if (raw === "") continue;
      if (raw.length > 1000)
        throw unsupported(`Keep the ${field.toLowerCase()} under 1000 characters.`);
      changes[field] = raw === "-" ? "" : raw;
    }
    if (Object.keys(changes).length === 0) {
      throw unsupported("Enter at least one property to change (a single - clears a field).");
    }
    changes.ModDate = pdfDate(new Date());
    if (!before.CreationDate) changes.CreationDate = changes.ModDate;
    const after = writeProperties(doc, changes);

    const changed = INFO_FIELDS.filter((f) => (before[f] ?? "") !== (after[f] ?? ""));
    return {
      ok: true,
      output: { before, after, changed },
      summary: changed.length
        ? `Updated ${changed.join(", ").toLowerCase()}.`
        : "Nothing needed changing — the values were already set.",
      files: [
        {
          name: outputName(file.ref.name, "edited"),
          mimeType: PDF_MIME,
          bytes: await savePdf(doc),
        },
      ],
    };
  });

/** Strips document properties, XMP packets and private application data. Returns what it found. */
export function stripMetadata(doc: PDFDocument): {
  properties: string[];
  xmpPackets: number;
  privateData: number;
} {
  const properties = Object.keys(readProperties(doc));
  const info = infoDict(doc);
  for (const key of info?.keys() ?? []) {
    if (!properties.includes(key.decodeText())) properties.push(key.decodeText());
  }
  delete doc.context.trailerInfo.Info;

  let xmpPackets = 0;
  let privateData = 0;
  const metadataKey = PDFName.of("Metadata");
  const pieceKey = PDFName.of("PieceInfo");
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFDict ? object : object instanceof PDFRawStream ? object.dict : null;
    if (!dict) continue;
    if (dict.get(PDFName.of("Type")) === metadataKey) {
      doc.context.delete(ref);
      continue;
    }
    if (dict.has(metadataKey)) {
      dict.delete(metadataKey);
      xmpPackets += 1;
    }
    if (dict.has(pieceKey)) {
      dict.delete(pieceKey);
      privateData += 1;
    }
    dict.delete(PDFName.of("LastModified"));
  }
  if (doc.catalog.has(metadataKey)) {
    doc.catalog.delete(metadataKey);
    xmpPackets += 1;
  }
  return { properties, xmpPackets, privateData };
}

export const removeMetadataExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(REMOVE_METADATA_TOOL_ID, async () => {
    const files = await readPdfInputs(input, ctx);
    const packaging = optEnum(options, "packaging", ["zip", "files"] as const, "zip");
    const results: OutputFile[] = [];
    const reports: {
      file: string;
      properties: string[];
      xmpPackets: number;
      privateData: number;
    }[] = [];
    for (const file of files) {
      throwIfAborted(ctx?.signal);
      const doc = await loadPdf(file.bytes);
      reports.push({ file: file.ref.name, ...stripMetadata(doc) });
      results.push({
        name: outputName(file.ref.name, "clean"),
        mimeType: PDF_MIME,
        bytes: await savePdf(doc),
      });
    }
    const found = reports.reduce(
      (n, r) => n + r.properties.length + r.xmpPackets + r.privateData,
      0,
    );
    return {
      ok: true,
      output: { files: reports },
      summary:
        found === 0
          ? `No metadata was found in ${plural(files.length, "PDF")}; a clean copy was saved anyway.`
          : `Removed ${plural(found, "metadata item")} from ${plural(files.length, "PDF")}.`,
      files: packageOutputs(results, zipNameFor(files[0]!, "clean"), packaging),
    };
  });
