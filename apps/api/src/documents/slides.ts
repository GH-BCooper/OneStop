// PowerPoint slide surgery (07-word-ppt-tools.md): keep / reorder / remove slides, and merge decks.
//
// Every operation rewrites the package so the result is a clean, normal presentation:
// - the slide list in presentation.xml is rebuilt in the new order;
// - slides (and notes, pictures, layouts) nothing uses any more are deleted, not left behind;
// - slide parts are renamed slide1.xml…slideN.xml in order, and every slide-number field's cached
//   text is rewritten, so the remaining slides are renumbered correctly even in viewers that show
//   the cached value;
// - sections and custom shows that would point at missing slides are dropped.
// Merging copies each extra deck's slides *with* their layouts, masters and theme, so they keep
// their look; the first deck's slide size wins.
import type JSZip from "jszip";
import {
  attr,
  decodeXml,
  escapeXml,
  mainPart,
  nextRelId,
  openPackage,
  PartCopier,
  readContentTypes,
  readRels,
  readText,
  REL,
  relativeTarget,
  removeUnreachableParts,
  renameParts,
  resolveTarget,
  savePackage,
  writeRels,
} from "./ooxml.ts";
import { unsupported } from "./common.ts";

export interface SlideRef {
  /** `<p:sldId id>` */
  id: number;
  rid: string;
  path: string;
}

export interface Deck {
  zip: JSZip;
  pres: string;
  slides: SlideRef[];
}

const SECTIONS_EXT = /<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/g;

export async function openDeck(bytes: Uint8Array): Promise<Deck> {
  const zip = await openPackage(bytes, "PowerPoint");
  const pres = (await mainPart(zip)) ?? "ppt/presentation.xml";
  const xml = await readText(zip, pres);
  if (!xml || !xml.includes("<p:presentation")) {
    throw unsupported("This PowerPoint file could not be read. It may be damaged.");
  }
  const rels = new Map((await readRels(zip, pres)).map((r) => [r.id, r]));
  const slides: SlideRef[] = [];
  for (const m of xml.matchAll(/<p:sldId\b([^>]*?)\/>/g)) {
    const rid = attr(m[1]!, "r:id");
    const rel = rid ? rels.get(rid) : undefined;
    if (!rid || !rel) continue;
    const path = resolveTarget(pres, rel.target);
    if (zip.file(path)) slides.push({ id: Number(attr(m[1]!, "id")), rid, path });
  }
  return { zip, pres, slides };
}

function sldIdList(slides: SlideRef[]): string {
  return `<p:sldIdLst>${slides.map((s) => `<p:sldId id="${s.id}" r:id="${s.rid}"/>`).join("")}</p:sldIdLst>`;
}

function replaceSlideList(xml: string, slides: SlideRef[]): string {
  const list = sldIdList(slides);
  if (/<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\s*\/>/.test(xml)) {
    return xml.replace(/<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\s*\/>/, list);
  }
  return xml.replace(/<p:sldSz\b/, `${list}<p:sldSz`);
}

/** Renames slides to slide1..N in deck order and refreshes slide-number fields (slides + notes). */
async function renumber(deck: Deck): Promise<void> {
  const renames = new Map<string, string>();
  deck.slides.forEach((s, i) => renames.set(s.path, `ppt/slides/slide${i + 1}.xml`));
  await renameParts(deck.zip, renames);
  for (const [i, slide] of deck.slides.entries()) {
    slide.path = renames.get(slide.path)!;
    const targets = [slide.path];
    for (const rel of await readRels(deck.zip, slide.path)) {
      if (rel.type === REL.notesSlide) targets.push(resolveTarget(slide.path, rel.target));
    }
    for (const part of targets) {
      const xml = await readText(deck.zip, part);
      if (!xml) continue;
      const next = xml.replace(
        /(<a:fld\b[^>]*type="slidenum"[^>]*>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/g,
        `$1${i + 1}$2`,
      );
      if (next !== xml) deck.zip.file(part, next);
    }
  }
}

/**
 * Rebuilds the deck with exactly `order` (1-based indexes into the current slides, no repeats).
 * Anything not listed is removed along with whatever only it used.
 */
export async function keepSlides(deck: Deck, order: number[]): Promise<Uint8Array> {
  if (order.length === 0) throw unsupported("A presentation needs at least one slide.");
  const kept = order.map((n) => deck.slides[n - 1]!);
  const keptRids = new Set(kept.map((s) => s.rid));
  const removed = deck.slides.filter((s) => !keptRids.has(s.rid));
  const reordered = kept.some((s, i) => deck.slides[i] !== s);

  let xml = (await readText(deck.zip, deck.pres))!;
  xml = replaceSlideList(xml, kept);
  if (removed.length > 0 || reordered) {
    xml = xml.replace(SECTIONS_EXT, "");
    if (removed.length > 0) xml = xml.replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, "");
  }
  deck.zip.file(deck.pres, xml);
  const rels = await readRels(deck.zip, deck.pres);
  writeRels(
    deck.zip,
    deck.pres,
    rels.filter((r) => r.type !== REL.slide || keptRids.has(r.id)),
  );
  // Links from a kept slide to a removed one would dangle: point them nowhere instead.
  const removedPaths = new Set(removed.map((s) => s.path));
  for (const slide of kept) {
    const slideRels = await readRels(deck.zip, slide.path);
    const dangling = slideRels.filter(
      (r) => r.type === REL.slide && removedPaths.has(resolveTarget(slide.path, r.target)),
    );
    if (dangling.length === 0) continue;
    let slideXml = (await readText(deck.zip, slide.path))!;
    for (const r of dangling) {
      slideXml = slideXml.replace(
        new RegExp(
          `<a:hlinkClick\\b[^>]*r:id="${r.id}"[^>]*?(?:/>|>[\\s\\S]*?</a:hlinkClick>)`,
          "g",
        ),
        "",
      );
    }
    deck.zip.file(slide.path, slideXml);
    writeRels(
      deck.zip,
      slide.path,
      slideRels.filter((r) => !dangling.includes(r)),
    );
  }
  deck.slides = kept;
  await removeUnreachableParts(deck.zip);
  await renumber(deck);
  await refreshAppProps(deck);
  return savePackage(deck.zip);
}

/** docProps/app.xml caches the slide count; keep it truthful. */
async function refreshAppProps(deck: Deck): Promise<void> {
  const app = await readText(deck.zip, "docProps/app.xml");
  if (!app) return;
  deck.zip.file(
    "docProps/app.xml",
    app
      .replace(/<Slides>\d+<\/Slides>/, `<Slides>${deck.slides.length}</Slides>`)
      .replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, "")
      .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ""),
  );
}

// ---- text -------------------------------------------------------------------------------------

function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map((m) =>
      [...(m[1] ?? m[2] ?? "").matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\b[^>]*\/>/g)]
        .map((t) => (t[0].startsWith("<a:br") ? "\n" : decodeXml(t[1]!)))
        .join(""),
    )
    .filter((p) => p.trim() !== "");
}

/** Removes shapes that are just slide number / date placeholders. */
function withoutFieldPlaceholders(xml: string): string {
  return xml.replace(
    /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph\b[^>]*type="(?:sldNum|dt)"[\s\S]*?<\/p:sp>/g,
    "",
  );
}

export interface SlideText {
  slide: number;
  text: string[];
  notes: string[];
}

export async function slideTexts(deck: Deck): Promise<SlideText[]> {
  const out: SlideText[] = [];
  for (const [i, slide] of deck.slides.entries()) {
    const xml = (await readText(deck.zip, slide.path)) ?? "";
    let notes: string[] = [];
    const notesRel = (await readRels(deck.zip, slide.path)).find((r) => r.type === REL.notesSlide);
    if (notesRel) {
      const notesXml = (await readText(deck.zip, resolveTarget(slide.path, notesRel.target))) ?? "";
      const body = [...notesXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
        .map((m) => m[0])
        .filter((sp) => /<p:ph\b[^>]*type="body"/.test(sp));
      notes = body.flatMap(paragraphs);
    }
    out.push({ slide: i + 1, text: paragraphs(withoutFieldPlaceholders(xml)), notes });
  }
  return out;
}

// ---- merge ------------------------------------------------------------------------------------

function maxIds(xml: string, tag: string): number {
  let max = 0;
  for (const m of xml.matchAll(new RegExp(`<p:${tag}\\b[^>]*\\bid="(\\d+)"`, "g"))) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Appends every slide of `others` to `base`, bringing their layouts, masters and themes along. */
export async function mergeDecks(
  base: Deck,
  others: Uint8Array[],
): Promise<{ bytes: Uint8Array; sizeMismatch: boolean }> {
  const zip = base.zip;
  let presXml = (await readText(zip, base.pres))!;
  const presRels = await readRels(zip, base.pres);
  const size = /<p:sldSz\b[^>]*\/>/.exec(presXml)?.[0] ?? "";
  let sizeMismatch = false;

  const notesMasterRel = presRels.find((r) => r.type === REL.notesMaster);
  const notesMaster = notesMasterRel ? resolveTarget(base.pres, notesMasterRel.target) : null;

  // Master and layout ids share one number space (≥ 2^31) across the whole presentation.
  let nextMasterId = 2147483648;
  const bumpFrom = async (xml: string) => {
    nextMasterId = Math.max(
      nextMasterId,
      maxIds(xml, "sldMasterId") + 1,
      maxIds(xml, "sldLayoutId") + 1,
    );
  };
  await bumpFrom(presXml);
  const ct = await readContentTypes(zip);
  for (const [part, type] of ct.overrides) {
    if (type.endsWith("slideMaster+xml")) await bumpFrom((await readText(zip, part)) ?? "");
  }
  let nextSlideId = Math.max(255, ...base.slides.map((s) => s.id)) + 1;

  for (const bytes of others) {
    const other = await openDeck(bytes);
    const otherPres = (await readText(other.zip, other.pres))!;
    if ((/<p:sldSz\b[^>]*\/>/.exec(otherPres)?.[0] ?? "") !== size) sizeMismatch = true;
    // Only one notes master is allowed, so copied notes pages use the base deck's. Links between
    // slides need no special case: every slide of the deck is copied, and the copier memoises.
    const copier = await PartCopier.create(zip, other.zip, (rel) =>
      rel.type === REL.notesMaster ? (notesMaster ?? null) : undefined,
    );
    for (const slide of other.slides) {
      const copied = await copier.copy(slide.path);
      // Without a notes master in the base, the copied notes page would be invalid: drop it.
      if (!notesMaster) {
        const rels = await readRels(zip, copied);
        const kept = rels.filter((r) => r.type !== REL.notesSlide);
        if (kept.length !== rels.length) writeRels(zip, copied, kept);
      }
      const rid = nextRelId(presRels);
      presRels.push({
        id: rid,
        type: REL.slide,
        target: relativeTarget(base.pres, copied),
        external: false,
      });
      base.slides.push({ id: nextSlideId++, rid, path: copied });
    }
    // Register each master that came along, with fresh master/layout ids.
    for (const part of copier.copied) {
      if (!part.type?.endsWith("slideMaster+xml")) continue;
      let masterXml = (await readText(zip, part.to))!;
      masterXml = masterXml.replace(
        /(<p:sldLayoutId\b[^>]*\bid=")(\d+)"/g,
        (_, pre: string) => `${pre}${nextMasterId++}"`,
      );
      zip.file(part.to, masterXml);
      const rid = nextRelId(presRels);
      presRels.push({
        id: rid,
        type: REL.slideMaster,
        target: relativeTarget(base.pres, part.to),
        external: false,
      });
      presXml = presXml.replace(
        /<\/p:sldMasterIdLst>/,
        `<p:sldMasterId id="${nextMasterId++}" r:id="${escapeXml(rid)}"/></p:sldMasterIdLst>`,
      );
    }
    copier.finish();
  }
  presXml = replaceSlideList(presXml, base.slides).replace(SECTIONS_EXT, "");
  zip.file(base.pres, presXml);
  writeRels(zip, base.pres, presRels);
  await removeUnreachableParts(zip);
  await renumber(base);
  await refreshAppProps(base);
  return { bytes: await savePackage(zip), sizeMismatch };
}
