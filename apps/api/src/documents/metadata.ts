// Document Metadata Viewer/Remover (Features 2.15) — 07-word-ppt-tools.md.
//
// .docx (and any OOXML file): docProps/core.xml (title, author, dates, revision…), app.xml
// (application, company, manager, template, editing time…), custom.xml, the thumbnail, plus the
// names hidden in comments and tracked changes and the revision-session ids in settings.xml.
// .odt: meta.xml and the thumbnail. .doc is converted to .docx through LibreOffice first.
//
// "Remove" rewrites every one of those and the tool re-reads the result before returning it, so
// the summary reports what is actually left, not what we hoped to remove.
import JSZip from "jszip";
import type { Executor } from "@onestop/tool-registry";
import {
  baseName,
  ensureOoxml,
  MIME,
  optBool,
  optEnum,
  plural,
  readSingleDoc,
  runDocTool,
  unsupported,
} from "./common.ts";
import {
  decodeXml,
  openPackage,
  readContentTypes,
  readRels,
  readText,
  REL,
  resolveTarget,
  savePackage,
  writeContentTypes,
  writeRels,
} from "./ooxml.ts";

export const DOCUMENT_METADATA_TOOL_ID = "document-metadata";

export interface DocumentMetadata {
  format: "docx" | "odt";
  properties: Record<string, string>;
  application: Record<string, string>;
  custom: Record<string, string>;
  /** Names found on comments and tracked changes. */
  people: string[];
  hasThumbnail: boolean;
}

const CORE_LABELS: Record<string, string> = {
  "dc:title": "Title",
  "dc:subject": "Subject",
  "dc:creator": "Author",
  "cp:keywords": "Keywords",
  "dc:description": "Comments",
  "cp:lastModifiedBy": "Last modified by",
  "cp:revision": "Revision",
  "dcterms:created": "Created",
  "dcterms:modified": "Modified",
  "cp:lastPrinted": "Last printed",
  "cp:category": "Category",
  "cp:contentStatus": "Status",
  "dc:language": "Language",
  "dc:identifier": "Identifier",
  "cp:version": "Version",
};

const APP_PRIVATE = [
  "Company",
  "Manager",
  "Template",
  "TotalTime",
  "HyperlinkBase",
  "Application",
  "AppVersion",
];

function elements(xml: string): [string, string][] {
  return [...xml.matchAll(/<([\w]+:[\w-]+|[\w]+)(?=[\s>/])[^>]*?(?:\/>|>([^<]*)<\/\1>)/g)]
    .filter((m) => m[2] !== undefined && m[2].trim() !== "")
    .map((m) => [m[1]!, decodeXml(m[2]!.trim())]);
}

const ODT_LABELS: Record<string, string> = {
  "dc:title": "Title",
  "dc:subject": "Subject",
  "dc:description": "Comments",
  "meta:keyword": "Keywords",
  "meta:initial-creator": "Author",
  "dc:creator": "Last modified by",
  "meta:creation-date": "Created",
  "dc:date": "Modified",
  "meta:print-date": "Last printed",
  "meta:printed-by": "Printed by",
  "meta:editing-cycles": "Revision",
  "meta:editing-duration": "Editing time",
  "dc:language": "Language",
  "meta:generator": "Application",
};

// ---- OOXML ------------------------------------------------------------------------------------

async function ooxmlParts(zip: JSZip) {
  const root = await readRels(zip, "");
  const find = (type: string) => {
    const rel = root.find((r) => r.type === type || r.type.endsWith(`/${type}`));
    return rel ? resolveTarget("", rel.target) : null;
  };
  return {
    root,
    core: find("core-properties") ?? "docProps/core.xml",
    app: find("extended-properties") ?? "docProps/app.xml",
    custom: find(REL.customProperties),
    thumbnail: find(REL.thumbnail),
  };
}

function peopleIn(xml: string): string[] {
  return [...xml.matchAll(/\bw:author="([^"]*)"/g)].map((m) => decodeXml(m[1]!));
}

async function wordParts(zip: JSZip): Promise<string[]> {
  return Object.keys(zip.files).filter((n) => /^word\/[^/]+\.xml$/.test(n));
}

export async function readOoxmlMetadata(bytes: Uint8Array): Promise<DocumentMetadata> {
  const zip = await openPackage(bytes, "Word");
  const parts = await ooxmlParts(zip);
  const properties: Record<string, string> = {};
  for (const [tag, value] of elements((await readText(zip, parts.core)) ?? "")) {
    properties[CORE_LABELS[tag] ?? tag] = value;
  }
  const application: Record<string, string> = {};
  const appXml = ((await readText(zip, parts.app)) ?? "").replace(
    /<(HeadingPairs|TitlesOfParts)>[\s\S]*?<\/\1>/g,
    "",
  );
  for (const [tag, value] of elements(appXml)) application[tag] = value;
  const custom: Record<string, string> = {};
  if (parts.custom) {
    const xml = (await readText(zip, parts.custom)) ?? "";
    for (const m of xml.matchAll(/<property\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) {
      custom[decodeXml(m[1]!)] = decodeXml(m[2]!.replace(/<[^>]+>/g, "").trim());
    }
  }
  const people = new Set<string>();
  for (const part of await wordParts(zip)) {
    for (const name of peopleIn((await readText(zip, part)) ?? ""))
      if (name.trim()) people.add(name);
  }
  return {
    format: "docx",
    properties,
    application,
    custom,
    people: [...people],
    hasThumbnail: Boolean(parts.thumbnail && zip.file(parts.thumbnail)),
  };
}

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>`;

export async function stripOoxmlMetadata(
  bytes: Uint8Array,
  { authors = true }: { authors?: boolean } = {},
): Promise<Uint8Array> {
  const zip = await openPackage(bytes, "Word");
  const parts = await ooxmlParts(zip);
  zip.file(parts.core, EMPTY_CORE);
  const app = await readText(zip, parts.app);
  if (app) {
    let next = app;
    for (const tag of APP_PRIVATE) {
      next = next.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>|<${tag}\\s*/>`, "g"), "");
    }
    zip.file(parts.app, next);
  }
  const drop = [parts.custom, parts.thumbnail].filter((p): p is string => Boolean(p));
  for (const part of drop) zip.remove(part);
  writeRels(
    zip,
    "",
    parts.root.filter(
      (r) => !drop.includes(resolveTarget("", r.target)) && r.type !== REL.customProperties,
    ),
  );
  for (const part of await wordParts(zip)) {
    let xml = (await readText(zip, part))!;
    const before = xml;
    if (authors) {
      xml = xml
        .replace(/\bw:author="[^"]*"/g, 'w:author="Author"')
        .replace(/\bw:initials="[^"]*"/g, 'w:initials="A"')
        .replace(/\bw15:author="[^"]*"/g, 'w15:author="Author"')
        .replace(/<w15:presenceInfo\b[^>]*\/>/g, "");
    }
    if (part.endsWith("/settings.xml")) {
      xml = xml
        .replace(/<w:rsids>[\s\S]*?<\/w:rsids>/, "")
        .replace(/<w:attachedTemplate\b[^>]*\/>/, "");
    }
    if (xml !== before) zip.file(part, xml);
  }
  const ct = await readContentTypes(zip);
  writeContentTypes(zip, ct);
  return savePackage(zip);
}

// ---- ODT --------------------------------------------------------------------------------------

async function openOdt(bytes: Uint8Array): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file("content.xml")) throw new Error("no content.xml");
    return zip;
  } catch (err) {
    throw unsupported("This OpenDocument file could not be read. It may be damaged.", err);
  }
}

export async function readOdtMetadata(bytes: Uint8Array): Promise<DocumentMetadata> {
  const zip = await openOdt(bytes);
  const meta = (await readText(zip, "meta.xml")) ?? "";
  const inner = /<office:meta>([\s\S]*?)<\/office:meta>/.exec(meta)?.[1] ?? "";
  const properties: Record<string, string> = {};
  const application: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [tag, value] of elements(
    inner.replace(/<meta:user-defined\b[\s\S]*?<\/meta:user-defined>/g, ""),
  )) {
    const label = ODT_LABELS[tag] ?? tag;
    if (label === "Application") application.Application = value;
    else properties[label] = properties[label] ? `${properties[label]}, ${value}` : value;
  }
  for (const m of inner.matchAll(
    /<meta:user-defined\b[^>]*meta:name="([^"]*)"[^>]*>([^<]*)<\/meta:user-defined>/g,
  )) {
    custom[decodeXml(m[1]!)] = decodeXml(m[2]!);
  }
  const stats = /<meta:document-statistic\b([^>]*)\/>/.exec(inner)?.[1];
  for (const m of stats?.matchAll(/meta:([\w-]+)="([^"]*)"/g) ?? []) application[m[1]!] = m[2]!;
  const content = (await readText(zip, "content.xml")) ?? "";
  const people = new Set(
    [...content.matchAll(/<dc:creator>([^<]*)<\/dc:creator>/g)].map((m) => decodeXml(m[1]!)),
  );
  return {
    format: "odt",
    properties,
    application,
    custom,
    people: [...people].filter(Boolean),
    hasThumbnail: Boolean(zip.file("Thumbnails/thumbnail.png")),
  };
}

export async function stripOdtMetadata(
  bytes: Uint8Array,
  { authors = true }: { authors?: boolean } = {},
): Promise<Uint8Array> {
  const zip = await openOdt(bytes);
  const meta = await readText(zip, "meta.xml");
  if (meta)
    zip.file("meta.xml", meta.replace(/<office:meta>[\s\S]*?<\/office:meta>/, "<office:meta/>"));
  zip.remove("Thumbnails/thumbnail.png");
  const manifest = await readText(zip, "META-INF/manifest.xml");
  if (manifest) {
    zip.file(
      "META-INF/manifest.xml",
      manifest.replace(
        /<manifest:file-entry\b[^>]*manifest:full-path="Thumbnails\/[^"]*"[^>]*\/>/g,
        "",
      ),
    );
  }
  if (authors) {
    for (const part of ["content.xml", "styles.xml"]) {
      const xml = await readText(zip, part);
      if (xml) {
        zip.file(
          part,
          xml
            .replace(/<dc:creator>[^<]*<\/dc:creator>/g, "<dc:creator>Author</dc:creator>")
            .replace(/<dc:date>[^<]*<\/dc:date>/g, ""),
        );
      }
    }
  }
  // An OpenDocument package must start with an uncompressed "mimetype" entry.
  const out = new JSZip();
  const mimetype = await readText(zip, "mimetype");
  if (mimetype !== undefined) out.file("mimetype", mimetype, { compression: "STORE" });
  for (const name of Object.keys(zip.files)) {
    if (name === "mimetype" || zip.files[name]!.dir) continue;
    out.file(name, await zip.file(name)!.async("uint8array"), { compression: "DEFLATE" });
  }
  return out.generateAsync({ type: "uint8array" });
}

// ---- executor ---------------------------------------------------------------------------------

function properties(n: number): string {
  return `${n} ${n === 1 ? "property" : "properties"}`;
}

function isEmpty(meta: DocumentMetadata): boolean {
  return Object.keys(meta.properties).length === 0 && Object.keys(meta.custom).length === 0;
}

function listing(meta: DocumentMetadata): string[] {
  return [
    ...Object.entries(meta.properties).map(([k, v]) => `${k}: ${v}`),
    ...Object.entries(meta.custom).map(([k, v]) => `${k} (custom): ${v}`),
  ];
}

export const documentMetadataExecutor: Executor = async (input, options, ctx) =>
  runDocTool(DOCUMENT_METADATA_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx);
    const mode = optEnum(options, "mode", ["view", "remove"] as const, "view");
    const odt = file.ext === "odt";
    const { bytes, converted } = odt
      ? { bytes: file.bytes, converted: false }
      : await ensureOoxml(file, "docx", ctx?.signal);
    const read = odt ? readOdtMetadata : readOoxmlMetadata;
    const before = await read(bytes);
    const stem = baseName(file.ref.name);

    if (mode === "view") {
      const lines = listing(before);
      return {
        ok: true,
        output: before as unknown as Record<string, unknown>,
        summary: isEmpty(before)
          ? "This document has no descriptive metadata."
          : `Found ${properties(lines.length)}${before.people.length ? ` and ${plural(before.people.length, "name")} on comments or tracked changes` : ""}: ${lines.slice(0, 4).join("; ")}${lines.length > 4 ? "…" : ""}`,
        files: [
          {
            name: `${stem}-metadata.json`,
            mimeType: MIME.json,
            bytes: new TextEncoder().encode(`${JSON.stringify(before, null, 2)}\n`),
          },
        ],
      };
    }

    const authors = optBool(options, "authors", true);
    const strip = odt ? stripOdtMetadata : stripOoxmlMetadata;
    const cleaned = await strip(bytes, { authors });
    // Verify by re-reading the file we are about to hand back.
    const after = await read(cleaned);
    const leftover = listing(after);
    if (leftover.length > 0) {
      console.error("[documents:document-metadata] metadata survived removal", leftover);
      throw unsupported("The metadata could not be removed completely from this document.");
    }
    const removed = listing(before).length;
    const ext = odt ? "odt" : "docx";
    return {
      ok: true,
      output: { removed: before, remaining: after, convertedToDocx: converted },
      summary: `Removed ${properties(removed)}${before.hasThumbnail ? ", the preview thumbnail" : ""}${authors && before.people.length ? ` and ${plural(before.people.length, "name")} from comments/tracked changes` : ""}.${converted ? " The .doc file was converted to .docx." : ""}`,
      files: [
        { name: `${stem}-clean.${ext}`, mimeType: odt ? MIME.odt : MIME.docx, bytes: cleaned },
      ],
    };
  });
