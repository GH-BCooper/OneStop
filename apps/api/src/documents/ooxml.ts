// Low-level helpers for Office Open XML packages (.docx / .pptx) — 07-word-ppt-tools.md.
//
// A .docx or .pptx is a ZIP of XML "parts" wired together by relationship (.rels) files and typed
// by [Content_Types].xml. Merge, split, slide surgery, compression and metadata removal all come
// down to the same few moves — read/write rels, copy a part together with everything it points
// at, rename parts, drop parts nothing reaches — so they live here once, working on a JSZip.
import JSZip from "jszip";
import { unsupported } from "./common.ts";

export const CONTENT_TYPES = "[Content_Types].xml";

export const REL = {
  officeDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  handoutMaster:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  customProperties:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
  thumbnail: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail",
} as const;

export interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

export async function openPackage(bytes: Uint8Array, label: string): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file(CONTENT_TYPES)) throw new Error("no [Content_Types].xml");
    return zip;
  } catch (err) {
    throw unsupported(`This ${label} file could not be read. It may be damaged.`, err);
  }
}

export async function savePackage(zip: JSZip, level = 6): Promise<Uint8Array> {
  // [Content_Types].xml first is what Office itself writes; some readers insist on it.
  const out = new JSZip();
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  names.sort((a, b) => (a === CONTENT_TYPES ? -1 : b === CONTENT_TYPES ? 1 : 0));
  for (const name of names) out.file(name, await zip.file(name)!.async("uint8array"));
  return out.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level },
  });
}

export async function readText(zip: JSZip, part: string): Promise<string | undefined> {
  return zip.file(part)?.async("string");
}

// ---- XML string helpers -----------------------------------------------------------------------

export function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}="([^"]*)"`);
  return re.exec(tag)?.[1];
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The top-level child elements of an XML fragment, as source strings, in order. Text between
 * elements is dropped. Enough for Office XML, which has no CDATA and escapes `>` in attributes.
 */
export function childElements(fragment: string): string[] {
  const out: string[] = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/)?([A-Za-z_][\w.:-]*)(?:[^>"]|"[^"]*")*?(\/)?>/g;
  let depth = 0;
  let start = -1;
  for (let m = re.exec(fragment); m; m = re.exec(fragment)) {
    if (!m[2]) continue; // comment / processing instruction
    if (m[1]) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(fragment.slice(start, re.lastIndex));
        start = -1;
      }
    } else if (m[3]) {
      if (depth === 0) out.push(m[0]);
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return out;
}

// ---- paths & relationships --------------------------------------------------------------------

export function dirOf(part: string): string {
  const i = part.lastIndexOf("/");
  return i < 0 ? "" : part.slice(0, i);
}

/** `word/document.xml` → `word/_rels/document.xml.rels`; the package root → `_rels/.rels`. */
export function relsPathFor(part: string): string {
  if (part === "") return "_rels/.rels";
  const dir = dirOf(part);
  const base = part.slice(dir.length ? dir.length + 1 : 0);
  return `${dir ? `${dir}/` : ""}_rels/${base}.rels`;
}

/** Inverse of `relsPathFor`. */
export function ownerOfRels(relsPath: string): string {
  const m = /^(.*?)_rels\/(.*)\.rels$/.exec(relsPath);
  if (!m) return "";
  return `${m[1]}${m[2]}`;
}

function normalize(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Resolves a relationship target against the part that owns the .rels file. */
export function resolveTarget(fromPart: string, target: string): string {
  let t = target;
  try {
    t = decodeURI(target);
  } catch {
    // keep the raw target
  }
  if (t.startsWith("/")) return normalize(t.split("/"));
  return normalize([...dirOf(fromPart).split("/"), ...t.split("/")]);
}

/** The relative target a .rels file owned by `fromPart` should use to point at `toPart`. */
export function relativeTarget(fromPart: string, toPart: string): string {
  const from = dirOf(fromPart).split("/").filter(Boolean);
  const to = toPart.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1;
  return [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
}

export function parseRels(xml: string | undefined): Rel[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map((m) => ({
    id: attr(m[1]!, "Id") ?? "",
    type: attr(m[1]!, "Type") ?? "",
    target: decodeXml(attr(m[1]!, "Target") ?? ""),
    external: attr(m[1]!, "TargetMode") === "External",
  }));
}

export function serializeRels(rels: Rel[]): string {
  const body = rels
    .map(
      (r) =>
        `<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

export async function readRels(zip: JSZip, part: string): Promise<Rel[]> {
  return parseRels(await readText(zip, relsPathFor(part)));
}

export function writeRels(zip: JSZip, part: string, rels: Rel[]): void {
  zip.file(relsPathFor(part), serializeRels(rels));
}

export function nextRelId(rels: Rel[], prefix = "rId"): string {
  const used = new Set(rels.map((r) => r.id));
  let n = rels.length + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** The main part of the package (`word/document.xml`, `ppt/presentation.xml`). */
export async function mainPart(zip: JSZip): Promise<string | null> {
  const rel = (await readRels(zip, "")).find((r) => r.type === REL.officeDocument);
  return rel ? resolveTarget("", rel.target) : null;
}

// ---- content types ----------------------------------------------------------------------------

export interface ContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

export async function readContentTypes(zip: JSZip): Promise<ContentTypes> {
  const xml = (await readText(zip, CONTENT_TYPES)) ?? "";
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const m of xml.matchAll(/<Default\b([^>]*?)\/?>/g)) {
    const ext = attr(m[1]!, "Extension");
    const type = attr(m[1]!, "ContentType");
    if (ext && type) defaults.set(ext.toLowerCase(), type);
  }
  for (const m of xml.matchAll(/<Override\b([^>]*?)\/?>/g)) {
    const name = attr(m[1]!, "PartName");
    const type = attr(m[1]!, "ContentType");
    if (name && type) overrides.set(name.replace(/^\//, ""), type);
  }
  return { defaults, overrides };
}

export function writeContentTypes(zip: JSZip, ct: ContentTypes): void {
  const defaults = [...ct.defaults]
    .map(([e, t]) => `<Default Extension="${escapeXml(e)}" ContentType="${escapeXml(t)}"/>`)
    .join("");
  const overrides = [...ct.overrides]
    .filter(([name]) => zip.file(name))
    .map(([n, t]) => `<Override PartName="/${escapeXml(n)}" ContentType="${escapeXml(t)}"/>`)
    .join("");
  zip.file(
    CONTENT_TYPES,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${overrides}</Types>`,
  );
}

export function extensionOf(part: string): string {
  const dot = part.lastIndexOf(".");
  return dot > part.lastIndexOf("/") ? part.slice(dot + 1).toLowerCase() : "";
}

export function contentTypeOf(ct: ContentTypes, part: string): string | undefined {
  return ct.overrides.get(part) ?? ct.defaults.get(extensionOf(part));
}

// ---- whole-package operations -----------------------------------------------------------------

/**
 * Deletes every part no relationship chain reaches from the package root, with its .rels file
 * and content-type override. Run after removing slides or document content so the media they
 * used does not linger in the file.
 */
export async function removeUnreachableParts(zip: JSZip): Promise<number> {
  const reachable = new Set<string>();
  const queue = [""];
  while (queue.length > 0) {
    const part = queue.shift()!;
    for (const rel of await readRels(zip, part)) {
      if (rel.external) continue;
      const target = resolveTarget(part, rel.target);
      if (!reachable.has(target) && zip.file(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  let removed = 0;
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]!.dir || name === CONTENT_TYPES) continue;
    const isRels = /(^|\/)_rels\/[^/]*\.rels$/.test(name);
    const owner = isRels ? ownerOfRels(name) : name;
    if (isRels ? owner === "" || reachable.has(owner) : reachable.has(name)) continue;
    zip.remove(name);
    if (!isRels) removed += 1;
  }
  const ct = await readContentTypes(zip);
  writeContentTypes(zip, ct);
  return removed;
}

/** A free part name like `ppt/slides/slide7.xml`, never colliding with `taken`. */
export function uniquePartName(zip: JSZip, wanted: string, taken: Set<string>): string {
  const free = (p: string) => !zip.file(p) && !taken.has(p);
  if (free(wanted)) return wanted;
  const m = /^(.*?)(\d*)(\.[^./]+)?$/.exec(wanted)!;
  const stem = m[1]!;
  const ext = m[3] ?? "";
  for (let n = Math.max(1, Number(m[2] || 1)); ; n += 1) {
    const candidate = `${stem}${n}${ext}`;
    if (free(candidate)) return candidate;
  }
}

/**
 * Renames parts, keeping every relationship that points at them (from any .rels file) and every
 * content-type override correct. Two-phase, so `slide2 → slide1, slide1 → slide2` is fine.
 */
export async function renameParts(zip: JSZip, renames: Map<string, string>): Promise<void> {
  const changed = [...renames].filter(([from, to]) => from !== to);
  if (changed.length === 0) return;
  const newOwnerToOld = new Map<string, string>();
  const staged: { to: string; data: Uint8Array; rels?: string }[] = [];
  for (const [from, to] of changed) {
    const file = zip.file(from);
    if (!file) continue;
    staged.push({
      to,
      data: await file.async("uint8array"),
      rels: await readText(zip, relsPathFor(from)),
    });
    zip.remove(from);
    zip.remove(relsPathFor(from));
    newOwnerToOld.set(to, from);
  }
  for (const { to, data, rels } of staged) {
    zip.file(to, data);
    if (rels !== undefined) zip.file(relsPathFor(to), rels);
  }
  for (const name of Object.keys(zip.files)) {
    if (!/(^|\/)_rels\/[^/]*\.rels$/.test(name)) continue;
    const owner = ownerOfRels(name);
    const oldOwner = newOwnerToOld.get(owner) ?? owner;
    const rels = parseRels(await readText(zip, name));
    let dirty = false;
    for (const rel of rels) {
      if (rel.external) continue;
      const oldTarget = resolveTarget(oldOwner, rel.target);
      const newTarget = renames.get(oldTarget) ?? oldTarget;
      if (newTarget !== oldTarget || oldOwner !== owner) {
        rel.target = relativeTarget(owner, newTarget);
        dirty = true;
      }
    }
    if (dirty) zip.file(name, serializeRels(rels));
  }
  const ct = await readContentTypes(zip);
  for (const [from, to] of changed) {
    const type = ct.overrides.get(from);
    if (type) {
      ct.overrides.delete(from);
      ct.overrides.set(to, type);
    }
  }
  writeContentTypes(zip, ct);
}

/**
 * Copies parts from another package into this one, following relationships, so a copied slide or
 * picture arrives with everything it needs under fresh, non-colliding names. `redirect` lets the
 * caller point a relationship at an existing part (e.g. the one allowed notes master) or drop it.
 */
export class PartCopier {
  private readonly memo = new Map<string, string>();
  private readonly taken = new Set<string>();
  readonly copied: { from: string; to: string; type: string | undefined }[] = [];

  private constructor(
    private readonly target: JSZip,
    private readonly source: JSZip,
    private readonly targetCt: ContentTypes,
    private readonly sourceCt: ContentTypes,
    private readonly redirect: (rel: Rel, fromPart: string) => string | null | undefined,
  ) {}

  static async create(
    target: JSZip,
    source: JSZip,
    redirect: (rel: Rel, fromPart: string) => string | null | undefined = () => undefined,
  ): Promise<PartCopier> {
    return new PartCopier(
      target,
      source,
      await readContentTypes(target),
      await readContentTypes(source),
      redirect,
    );
  }

  /** Copies `part` (and what it references); returns its name in the target package. */
  async copy(part: string): Promise<string> {
    const known = this.memo.get(part);
    if (known) return known;
    const name = uniquePartName(this.target, part, this.taken);
    this.memo.set(part, name);
    this.taken.add(name);
    const file = this.source.file(part);
    if (!file) return name;
    this.target.file(name, await file.async("uint8array"));

    const type = contentTypeOf(this.sourceCt, part);
    this.copied.push({ from: part, to: name, type });
    if (this.sourceCt.overrides.has(part)) this.targetCt.overrides.set(name, type!);
    const ext = extensionOf(name);
    if (type && !this.sourceCt.overrides.has(part) && !this.targetCt.defaults.has(ext)) {
      this.targetCt.defaults.set(ext, type);
    }

    const rels: Rel[] = [];
    for (const rel of await readRels(this.source, part)) {
      if (rel.external) {
        rels.push(rel);
        continue;
      }
      const redirected = this.redirect(rel, part);
      if (redirected === null) continue;
      const to = redirected ?? (await this.copy(resolveTarget(part, rel.target)));
      rels.push({ ...rel, target: relativeTarget(name, to) });
    }
    if (rels.length > 0) writeRels(this.target, name, rels);
    return name;
  }

  /** Writes the merged content types. Call once, after the last copy. */
  finish(): void {
    writeContentTypes(this.target, this.targetCt);
  }
}
