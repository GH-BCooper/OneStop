// Word/PowerPoint additions from 21-roadmap-expansion.md (roadmap §1.2): the Track Changes Cleaner,
// Markdown ↔ Word, Markdown → Slides, the Citation Formatter and the Resume Template Filler.
//
// The tracked-changes work is OOXML surgery, the same technique phase 07 already uses for
// merge/split. Markdown → Word reuses phase 12's `markdownToDocx`; Markdown → Slides reuses
// `pptxgenjs`, which phase 06 already depends on. Nothing new is installed, and all five are offline.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { markdownToDocx } from "../dev-utils/markdown.ts";
import {
  MIME,
  baseName,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  readSingleDoc,
  readTextInput,
  runDocTool,
  unsupported,
} from "./common.ts";
import { openPackage, readText, savePackage } from "./ooxml.ts";
import { openDocx, paragraphText } from "./wordStructure.ts";

// ---- track changes cleaner ---------------------------------------------------------------------

export interface RevisionCounts {
  insertions: number;
  deletions: number;
  comments: number;
  formatting: number;
  moves: number;
}

/**
 * Accepting or rejecting a revision in OOXML is a pair of rules:
 *  • `<w:ins>` wraps content that was added — accepting unwraps it, rejecting deletes it.
 *  • `<w:del>` wraps content that was removed — accepting deletes it, rejecting unwraps it, and its
 *    `<w:delText>` has to become `<w:t>` again or the text stays invisible.
 * Doing it with string surgery rather than a DOM keeps it honest about what it touches: anything it
 * does not recognise is left exactly as it was.
 */
export function resolveRevisions(
  xml: string,
  accept: boolean,
  { stripComments = true, stripFormatting = true }: { stripComments?: boolean; stripFormatting?: boolean } = {},
): { xml: string; counts: RevisionCounts } {
  const counts: RevisionCounts = { insertions: 0, deletions: 0, comments: 0, formatting: 0, moves: 0 };
  let out = xml;

  const resolveWrapper = (tag: "w:ins" | "w:del" | "w:moveFrom" | "w:moveTo", keep: boolean, countKey: keyof RevisionCounts) => {
    // Walk from the inside out so nested revisions (an insertion inside a deletion) resolve correctly.
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>((?:(?!<${tag}[\\s>])[\\s\\S])*?)</${tag}>|<${tag}(?:\\s[^>]*)?/>`, "g");
    for (let pass = 0; pass < 12; pass += 1) {
      let changed = false;
      out = out.replace(pattern, (_match, inner: string | undefined) => {
        changed = true;
        counts[countKey] += 1;
        if (!keep) return "";
        const body = inner ?? "";
        return tag === "w:del" || tag === "w:moveFrom"
          ? body.replace(/<w:delText(\s[^>]*)?>/g, "<w:t$1>").replace(/<\/w:delText>/g, "</w:t>")
          : body;
      });
      if (!changed) break;
    }
  };

  resolveWrapper("w:ins", accept, "insertions");
  resolveWrapper("w:del", !accept, "deletions");
  resolveWrapper("w:moveTo", accept, "moves");
  resolveWrapper("w:moveFrom", !accept, "moves");

  if (stripFormatting) {
    // Property-change markers (`w:rPrChange`, `w:pPrChange`, `w:tblPrChange`…) only record *that* a
    // format changed; dropping the marker keeps the current formatting and clears the revision.
    out = out.replace(/<w:(r|p|tbl|tblGrid|tc|sect)PrChange[\s\S]*?<\/w:\1PrChange>|<w:(r|p|tbl|tblGrid|tc|sect)PrChange(\s[^>]*)?\/>/g, () => {
      counts.formatting += 1;
      return "";
    });
  }
  if (stripComments) {
    out = out
      .replace(/<w:commentRangeStart(\s[^>]*)?\/>/g, () => {
        counts.comments += 1;
        return "";
      })
      .replace(/<w:commentRangeEnd(\s[^>]*)?\/>/g, "")
      .replace(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, "")
      .replace(/<w:commentReference[^>]*\/>/g, "");
  }
  // `w:rsid*` attributes are revision-save ids: harmless, but they are revision metadata too.
  out = out.replace(/\s+w:rsid[A-Za-z]*="[^"]*"/g, "");
  return { xml: out, counts };
}

export const trackChangesCleanerExecutor: Executor = (input, options, ctx) =>
  runDocTool("track-changes-cleaner", async () => {
    const file = await readSingleDoc(input, ctx);
    const zip = await openPackage(file.bytes, "Word document");
    const mode = optEnum(options, "mode", ["accept", "reject"] as const, "accept");
    const stripComments = optBool(options, "comments", true);
    const stripFormatting = optBool(options, "formatting", true);

    const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name));
    if (parts.length === 0) throw unsupported("This does not look like a Word document.");
    const total: RevisionCounts = { insertions: 0, deletions: 0, comments: 0, formatting: 0, moves: 0 };
    for (const part of parts) {
      const xml = await readText(zip, part);
      if (!xml) continue;
      const { xml: cleaned, counts } = resolveRevisions(xml, mode === "accept", { stripComments, stripFormatting });
      for (const key of Object.keys(total) as (keyof RevisionCounts)[]) total[key] += counts[key];
      zip.file(part, cleaned);
    }
    if (stripComments) {
      for (const part of ["word/comments.xml", "word/commentsExtended.xml", "word/commentsIds.xml", "word/commentsExtensible.xml"]) {
        if (zip.file(part)) zip.remove(part);
      }
    }
    // Turn tracking off in the settings, or Word starts recording again the moment it is opened.
    const settings = await readText(zip, "word/settings.xml");
    if (settings) {
      zip.file("word/settings.xml", settings.replace(/<w:trackChanges(\s[^>]*)?\/>|<w:trackChanges[\s\S]*?<\/w:trackChanges>/g, ""));
    }

    const bytes = await savePackage(zip);
    const changes = total.insertions + total.deletions + total.moves;
    return {
      ok: true,
      output: { mode, ...total, result: `${changes} revisions ${mode}ed` },
      summary:
        changes === 0 && total.comments === 0 && total.formatting === 0
          ? "This document had no tracked changes or comments in it. It has been saved with change tracking switched off."
          : `${mode === "accept" ? "Accepted" : "Rejected"} ${plural(changes, "tracked change")} (${total.insertions} insertions, ${total.deletions} deletions)${total.comments > 0 ? `, removed ${plural(total.comments, "comment")}` : ""}${total.formatting > 0 ? `, cleared ${plural(total.formatting, "formatting revision")}` : ""}. Change tracking is now off.`,
      files: [{ name: `${baseName(file.ref.name)}-${mode}ed.docx`, mimeType: MIME.docx, bytes }],
    };
  });

// ---- Markdown → Word ---------------------------------------------------------------------------

export const markdownToWordExecutor: Executor = (input, options, ctx) =>
  runDocTool("markdown-to-word", async () => {
    const source = await readTextInput(input, ctx);
    const title = optString(options, "title", "") || source.name;
    const bytes = await markdownToDocx(source.text, title);
    const headings = (source.text.match(/^#{1,6}\s/gm) ?? []).length;
    return {
      ok: true,
      output: { characters: source.text.length, headings, result: title },
      summary: `Converted ${source.text.length} characters of Markdown into a Word document${headings > 0 ? `, with ${plural(headings, "heading")} carried over as real Word heading styles` : ""}.`,
      files: [{ name: `${source.name}.docx`, mimeType: MIME.docx, bytes }],
    };
  });

// ---- Word → Markdown ---------------------------------------------------------------------------

const STYLE_HEADING = /w:val="(?:Heading|heading)(\d)"/;

/**
 * Walks the document body and turns each paragraph into Markdown by its style and numbering.
 * Deliberately conservative: it keeps headings, lists, bold/italic, links, tables and code blocks,
 * and it does not try to reproduce arbitrary formatting as HTML.
 */
export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const docx = await openDocx(bytes);
  const body = /<w:body[^>]*>([\s\S]*)<\/w:body>/.exec(docx.xml)?.[1] ?? docx.xml;
  const blocks = body.match(/<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)|<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) ?? [];
  const lines: string[] = [];

  const runsToMarkdown = (paragraph: string): string => {
    const runs = paragraph.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? [];
    let out = "";
    for (const run of runs) {
      let text = (run.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("");
      text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
      if (text === "") {
        if (/<w:br\s*\/>/.test(run)) out += "  \n";
        if (/<w:tab\s*\/>/.test(run)) out += "\t";
        continue;
      }
      const bold = /<w:b(?:\s[^>]*)?\/>|<w:b(?:\s[^>]*)?>[\s\S]*?<\/w:b>/.test(run) && !/w:val="(?:0|false)"/.test(run);
      const italic = /<w:i(?:\s[^>]*)?\/>|<w:i(?:\s[^>]*)?>[\s\S]*?<\/w:i>/.test(run) && !/w:val="(?:0|false)"/.test(run);
      const code = /w:ascii="(?:Consolas|Courier New|Cascadia[^"]*)"/.test(run);
      // Markers go outside the text but inside its surrounding spaces, or the emphasis does not render.
      const leading = /^\s*/.exec(text)![0];
      const trailing = /\s*$/.exec(text)![0];
      let core = text.trim();
      if (core !== "") {
        if (code) core = `\`${core}\``;
        if (bold) core = `**${core}**`;
        if (italic) core = `*${core}*`;
      }
      out += `${leading}${core}${trailing}`;
    }
    return out;
  };

  for (const block of blocks) {
    if (block.startsWith("<w:tbl")) {
      const rows = block.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) ?? [];
      const table = rows.map((row) =>
        (row.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) ?? []).map((cell) =>
          (cell.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).map(paragraphText).join(" ").trim().replace(/\|/g, "\\|"),
        ),
      );
      if (table.length === 0) continue;
      const width = Math.max(...table.map((r) => r.length));
      lines.push("", `| ${table[0]!.concat(Array(width - table[0]!.length).fill("")).join(" | ")} |`);
      lines.push(`| ${Array(width).fill("---").join(" | ")} |`);
      for (const row of table.slice(1)) {
        lines.push(`| ${row.concat(Array(width - row.length).fill("")).join(" | ")} |`);
      }
      lines.push("");
      continue;
    }
    const properties = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(block)?.[0] ?? "";
    const style = /<w:pStyle[^>]*\/>/.exec(properties)?.[0] ?? "";
    const text = runsToMarkdown(block);
    const heading = STYLE_HEADING.exec(style);
    if (heading) {
      lines.push("", `${"#".repeat(Math.min(6, Number(heading[1])))} ${text.trim()}`, "");
      continue;
    }
    if (/w:val="Title"/.test(style)) {
      lines.push("", `# ${text.trim()}`, "");
      continue;
    }
    if (/<w:numPr>/.test(properties)) {
      const level = Number(/<w:ilvl w:val="(\d+)"/.exec(properties)?.[1] ?? 0);
      // Word records the numbering *definition*, not "ordered or not", so a numId of 1 is a
      // reasonable guess at a numbered list and everything else reads as a bullet.
      const numbered = /<w:numFmt w:val="decimal"/.test(properties) || /w:val="ListParagraph"/.test(style) === false;
      lines.push(`${"  ".repeat(level)}${numbered ? "1." : "-"} ${text.trim()}`);
      continue;
    }
    if (/w:val="(?:Quote|IntenseQuote)"/.test(style)) {
      lines.push("", `> ${text.trim()}`, "");
      continue;
    }
    if (/w:val="(?:HTMLPreformatted|SourceCode|Code)"/.test(style)) {
      lines.push("```", text, "```");
      continue;
    }
    lines.push("", text, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trimEnd() + "\n";
}

export const wordToMarkdownExecutor: Executor = (input, _options, ctx) =>
  runDocTool("word-to-markdown", async () => {
    const file = await readSingleDoc(input, ctx);
    if (!file.ref.name.toLowerCase().endsWith(".docx")) {
      throw unsupported("Only .docx files can be converted to Markdown. Convert an old .doc file to .docx first.");
    }
    const markdown = await docxToMarkdown(file.bytes);
    const headings = (markdown.match(/^#{1,6}\s/gm) ?? []).length;
    const tables = (markdown.match(/^\| --- /gm) ?? []).length;
    return {
      ok: true,
      output: { characters: markdown.length, headings, tables, result: markdown },
      summary: `Converted to ${markdown.length} characters of Markdown, keeping ${plural(headings, "heading")}${tables > 0 ? `, ${plural(tables, "table")}` : ""}, lists and emphasis. Images and page layout are not carried over — Markdown has no way to hold them.`,
      files: [{ name: `${baseName(file.ref.name)}.md`, mimeType: "text/markdown; charset=utf-8", bytes: new TextEncoder().encode(markdown) }],
    };
  });

// ---- Markdown → slides -------------------------------------------------------------------------

export interface ParsedSlide {
  title: string;
  bullets: { text: string; level: number }[];
  notes: string;
  image: string | null;
}

/** Splits on `---` or on a heading at the chosen level, whichever the document actually uses. */
export function parseMarkdownSlides(markdown: string, splitLevel: number): ParsedSlide[] {
  const normalised = markdown.replace(/\r\n?/g, "\n");
  const chunks = /^\s*---\s*$/m.test(normalised)
    ? normalised.split(/^\s*---\s*$/m)
    : normalised.split(new RegExp(`^(?=#{${splitLevel}}\\s)`, "m"));

  const slides: ParsedSlide[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    let title = "";
    const bullets: { text: string; level: number }[] = [];
    const notes: string[] = [];
    let image: string | null = null;
    let inNotes = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (line.trim() === "") continue;
      if (/^(?:notes?|speaker notes?)\s*:/i.test(line.trim()) || /^<!--\s*notes?:/i.test(line.trim())) {
        inNotes = true;
        notes.push(line.replace(/^.*?:\s*/, "").replace(/-->\s*$/, ""));
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (heading) {
        inNotes = false;
        if (title === "") title = heading[2]!.trim();
        else bullets.push({ text: heading[2]!.trim(), level: 0 });
        continue;
      }
      const picture = /^!\[[^\]]*\]\(([^)]+)\)/.exec(line.trim());
      if (picture) {
        image = picture[1]!;
        continue;
      }
      const bullet = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (bullet) {
        inNotes = false;
        bullets.push({ text: bullet[2]!.trim(), level: Math.min(4, Math.floor(bullet[1]!.replace(/\t/g, "  ").length / 2)) });
        continue;
      }
      if (inNotes) notes.push(line.trim());
      else bullets.push({ text: line.trim(), level: 0 });
    }
    if (title !== "" || bullets.length > 0) slides.push({ title: title || "Slide", bullets, notes: notes.join(" "), image });
  }
  if (slides.length === 0) {
    throw unsupported("No slides were found. Separate them with a line of `---`, or start each one with a heading.");
  }
  return slides;
}

const DECK_THEMES = {
  lacquer: { background: "111417", title: "EEF1F5", body: "C3CCD6", accent: "7F8D9D" },
  chrome: { background: "F7FAFC", title: "0E141A", body: "3D4B57", accent: "798E9E" },
  paper: { background: "FBF7EF", title: "2A2520", body: "4A443C", accent: "9A8F7C" },
} as const;

export const markdownToSlidesExecutor: Executor = (input, options, ctx) =>
  runDocTool("markdown-to-slides", async () => {
    const source = await readTextInput(input, ctx);
    const splitLevel = optNumber(options, "splitLevel", 2, { min: 1, max: 4 });
    const slides = parseMarkdownSlides(source.text, splitLevel);
    const theme = DECK_THEMES[optEnum(options, "theme", ["lacquer", "chrome", "paper"] as const, "chrome")];
    const widescreen = optBool(options, "widescreen", true);

    const PptxGenJS = (await import("pptxgenjs")).default;
    const deck = new PptxGenJS();
    deck.layout = widescreen ? "LAYOUT_16x9" : "LAYOUT_4x3";
    const width = widescreen ? 10 : 10;
    deck.title = optString(options, "title", "") || source.name;

    for (const slide of slides) {
      const page = deck.addSlide();
      page.background = { color: theme.background };
      page.addText(slide.title, {
        x: 0.6,
        y: 0.45,
        w: width - 1.2,
        h: 0.9,
        fontSize: 30,
        bold: true,
        color: theme.title,
        fontFace: "Calibri Light",
      });
      page.addShape("line", { x: 0.6, y: 1.35, w: 1.6, h: 0, line: { color: theme.accent, width: 2 } });
      if (slide.bullets.length > 0) {
        page.addText(
          slide.bullets.map((b) => ({
            text: b.text,
            options: { bullet: { indent: 18 }, indentLevel: b.level, fontSize: b.level === 0 ? 18 : 16, color: theme.body, breakLine: true },
          })),
          { x: 0.7, y: 1.6, w: width - 1.4, h: 3.6, fontFace: "Calibri", valign: "top" },
        );
      }
      if (slide.notes) page.addNotes(slide.notes);
    }

    const bytes = new Uint8Array((await deck.write({ outputType: "nodebuffer" })) as Buffer);
    const withNotes = slides.filter((s) => s.notes !== "").length;
    const withImages = slides.filter((s) => s.image !== null).length;
    return {
      ok: true,
      output: { slides: slides.map((s) => ({ title: s.title, bullets: s.bullets.length })), count: slides.length, result: `${slides.length} slides` },
      summary: `Built ${plural(slides.length, "slide")}${withNotes > 0 ? `, ${withNotes} with speaker notes` : ""}.${withImages > 0 ? ` ${withImages} slide${withImages === 1 ? "" : "s"} referenced an image; those links are not followed — add the pictures in PowerPoint, or use Image → PDF and merge.` : ""}`,
      files: [{ name: `${source.name}.pptx`, mimeType: MIME.pptx, bytes }],
    };
  });

// ---- citation formatter ------------------------------------------------------------------------

export interface Reference {
  authors: string[];
  year: string;
  title: string;
  container: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  accessed: string;
  raw: string;
}

const STYLES = ["apa", "mla", "chicago", "harvard", "bibtex", "ieee"] as const;
export type CitationStyle = (typeof STYLES)[number];

/**
 * A pragmatic parser for the shapes a reference list actually comes in: either "Field: value" blocks,
 * or one loose line per reference, from which the year, title, DOI and URL can be picked out with
 * reasonable confidence. Anything it cannot place ends up in the title, and the raw line is kept so
 * nothing is silently lost.
 */
export function parseReferences(text: string): Reference[] {
  const blank: Omit<Reference, "raw"> = {
    authors: [], year: "", title: "", container: "", publisher: "", volume: "", issue: "", pages: "", doi: "", url: "", accessed: "",
  };
  const chunks = /^\s*(?:authors?|title)\s*:/im.test(text) ? text.split(/\n\s*\n/) : text.split(/\n/);
  const out: Reference[] = [];

  for (const chunk of chunks) {
    const raw = chunk.trim();
    if (raw === "") continue;
    const ref: Reference = { ...blank, authors: [], raw };
    const fieldLines = raw.split(/\n/).filter((l) => /^\s*[a-z]+\s*:/i.test(l));
    if (fieldLines.length >= 2) {
      for (const line of raw.split(/\n/)) {
        const match = /^\s*([a-z]+)\s*:\s*(.*)$/i.exec(line);
        if (!match) continue;
        const key = match[1]!.toLowerCase();
        const value = match[2]!.trim();
        if (key === "author" || key === "authors") ref.authors = value.split(/\s*(?:;|,\s*and\s+|\s+and\s+|&)\s*/).filter(Boolean);
        else if (key === "year" || key === "date") ref.year = /\d{4}/.exec(value)?.[0] ?? value;
        else if (key === "title") ref.title = value;
        else if (key === "journal" || key === "container" || key === "booktitle") ref.container = value;
        else if (key === "publisher") ref.publisher = value;
        else if (key === "volume") ref.volume = value;
        else if (key === "issue" || key === "number") ref.issue = value;
        else if (key === "pages") ref.pages = value;
        else if (key === "doi") ref.doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
        else if (key === "url") ref.url = value;
        else if (key === "accessed") ref.accessed = value;
      }
    } else {
      const line = raw.replace(/\s+/g, " ");
      ref.year = /\((\d{4})[a-z]?\)/.exec(line)?.[1] ?? /\b(19|20)\d{2}\b/.exec(line)?.[0] ?? "";
      ref.doi = (/\b10\.\d{4,9}\/[^\s,;]+/.exec(line)?.[0] ?? "").replace(/[.,;]$/, "");
      ref.url = /https?:\/\/[^\s,;]+/.exec(line)?.[0]?.replace(/[.,;]$/, "") ?? "";
      // Authors are whatever comes before the year; the title is the sentence after it.
      const beforeYear = ref.year ? line.slice(0, line.indexOf(ref.year)).replace(/[(\s]+$/, "") : "";
      ref.authors = beforeYear
        .split(/\s*(?:;|,\s*(?:and|&)\s+|\s+and\s+|&)\s*/)
        .map((a) => a.replace(/[.,\s]+$/, "").trim())
        .filter((a) => a !== "" && a.length < 60);
      const afterYear = ref.year ? line.slice(line.indexOf(ref.year) + ref.year.length).replace(/^[).,\s]+/, "") : line;
      const sentences = afterYear.split(/\.\s+/);
      ref.title = (sentences[0] ?? afterYear).replace(/[.\s]+$/, "");
      ref.container = (sentences[1] ?? "").replace(/[.\s]+$/, "");
      const pages = /\b(\d+)\s*[–-]\s*(\d+)\b/.exec(afterYear);
      if (pages) ref.pages = `${pages[1]}–${pages[2]}`;
      const volumeIssue = /\b(\d+)\s*\((\d+)\)/.exec(afterYear);
      if (volumeIssue) {
        ref.volume = volumeIssue[1]!;
        ref.issue = volumeIssue[2]!;
      }
    }
    if (ref.title === "" && ref.authors.length === 0) ref.title = raw;
    out.push(ref);
  }
  if (out.length === 0) throw unsupported("No references were found. Put one per line, or use Field: value blocks separated by a blank line.");
  return out;
}

function surnameFirst(author: string): string {
  if (author.includes(",")) return author.trim();
  const parts = author.trim().split(/\s+/);
  if (parts.length < 2) return author.trim();
  const last = parts.pop()!;
  return `${last}, ${parts.map((p) => `${p[0]!.toUpperCase()}.`).join(" ")}`;
}

function bibtexKey(ref: Reference): string {
  const author = (ref.authors[0] ?? "anon").replace(/[^A-Za-z]/g, "").toLowerCase() || "anon";
  const word = (ref.title.split(/\s+/)[0] ?? "untitled").replace(/[^A-Za-z]/g, "").toLowerCase();
  return `${author}${ref.year || "nd"}${word}`;
}

export function formatReference(ref: Reference, style: CitationStyle): string {
  const year = ref.year || "n.d.";
  const doiOrUrl = ref.doi ? `https://doi.org/${ref.doi}` : ref.url;
  switch (style) {
    case "apa": {
      const authors = ref.authors.map(surnameFirst);
      const list = authors.length === 0 ? "" : authors.length === 1 ? authors[0]! : `${authors.slice(0, -1).join(", ")}, & ${authors[authors.length - 1]}`;
      const journal = ref.container ? ` ${ref.container}${ref.volume ? `, ${ref.volume}` : ""}${ref.issue ? `(${ref.issue})` : ""}${ref.pages ? `, ${ref.pages}` : ""}.` : ref.publisher ? ` ${ref.publisher}.` : "";
      return `${list ? `${list} ` : ""}(${year}). ${ref.title}.${journal}${doiOrUrl ? ` ${doiOrUrl}` : ""}`.trim();
    }
    case "mla": {
      const authors = ref.authors.map(surnameFirst);
      const list = authors.length === 0 ? "" : authors.length <= 2 ? authors.join(", and ") : `${authors[0]}, et al.`;
      return `${list ? `${list}. ` : ""}"${ref.title}." ${ref.container ? `${ref.container}, ` : ""}${ref.volume ? `vol. ${ref.volume}, ` : ""}${ref.issue ? `no. ${ref.issue}, ` : ""}${year}${ref.pages ? `, pp. ${ref.pages}` : ""}.${doiOrUrl ? ` ${doiOrUrl}.` : ""}`.replace(/\s+/g, " ").trim();
    }
    case "chicago":
      return `${ref.authors.map(surnameFirst).join(", ")}${ref.authors.length ? ". " : ""}"${ref.title}." ${ref.container ? `${ref.container} ` : ""}${ref.volume ? `${ref.volume}, ` : ""}${ref.issue ? `no. ${ref.issue} ` : ""}(${year})${ref.pages ? `: ${ref.pages}` : ""}.${doiOrUrl ? ` ${doiOrUrl}.` : ""}`.replace(/\s+/g, " ").trim();
    case "harvard":
      return `${ref.authors.map(surnameFirst).join(", ")}${ref.authors.length ? " " : ""}${year}. ${ref.title}. ${ref.container ? `${ref.container}, ` : ""}${ref.volume ? `${ref.volume}` : ""}${ref.issue ? `(${ref.issue})` : ""}${ref.pages ? `, pp.${ref.pages}` : ""}.${doiOrUrl ? ` Available at: ${doiOrUrl}` : ""}`.replace(/\s+/g, " ").trim();
    case "ieee":
      return `${ref.authors.map((a) => a.trim()).join(", ")}, "${ref.title}," ${ref.container ? `${ref.container}, ` : ""}${ref.volume ? `vol. ${ref.volume}, ` : ""}${ref.issue ? `no. ${ref.issue}, ` : ""}${ref.pages ? `pp. ${ref.pages}, ` : ""}${year}.${doiOrUrl ? ` doi: ${ref.doi || doiOrUrl}.` : ""}`.replace(/\s+/g, " ").trim();
    case "bibtex": {
      const type = ref.container ? "article" : ref.publisher ? "book" : "misc";
      const fields: [string, string][] = [
        ["author", ref.authors.map(surnameFirst).join(" and ")],
        ["title", ref.title],
        ["year", ref.year],
        [type === "article" ? "journal" : "booktitle", ref.container],
        ["publisher", ref.publisher],
        ["volume", ref.volume],
        ["number", ref.issue],
        ["pages", ref.pages.replace("–", "--")],
        ["doi", ref.doi],
        ["url", ref.url],
      ].filter(([, value]) => value !== "") as [string, string][];
      return `@${type}{${bibtexKey(ref)},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
    }
  }
}

export const citationFormatterExecutor: Executor = (input, options, ctx) =>
  runDocTool("citation-formatter", async () => {
    const source = await readTextInput(input, ctx);
    const style = optEnum(options, "style", STYLES, "apa");
    const refs = parseReferences(source.text);
    const formatted = refs.map((ref) => formatReference(ref, style));
    const sorted = optBool(options, "sort", true) && style !== "bibtex" ? [...formatted].sort((a, b) => a.localeCompare(b)) : formatted;
    const text = sorted.join(style === "bibtex" ? "\n\n" : "\n") + "\n";
    const thin = refs.filter((r) => r.authors.length === 0 || r.year === "").length;
    return {
      ok: true,
      output: { style, references: refs, formatted: sorted, result: text },
      summary: `Reformatted ${plural(refs.length, "reference")} into ${style.toUpperCase()}.${thin > 0 ? ` ${thin} of them were missing an author or a year, so check those by hand — this reads what is there rather than looking anything up.` : ""}`,
      files: [
        {
          name: `references-${style}.${style === "bibtex" ? "bib" : "txt"}`,
          mimeType: style === "bibtex" ? "application/x-bibtex" : MIME.txt,
          bytes: new TextEncoder().encode(text),
        },
      ],
    };
  });

// ---- resume template filler --------------------------------------------------------------------

export interface ResumeData {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
  summary: string;
  experience: string[];
  education: string[];
  skills: string[];
}

/** Field: value, with `Experience:` and friends taking a bullet list underneath. */
export function parseResume(text: string): ResumeData {
  const data: ResumeData = {
    name: "", headline: "", email: "", phone: "", location: "", links: [], summary: "",
    experience: [], education: [], skills: [],
  };
  let section: keyof ResumeData | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const field = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(line);
    if (field) {
      const key = field[1]!.toLowerCase().replace(/\s+/g, "");
      const value = field[2]!.trim();
      const map: Record<string, keyof ResumeData> = {
        name: "name", headline: "headline", title: "headline", email: "email", phone: "phone",
        location: "location", links: "links", link: "links", summary: "summary", about: "summary",
        experience: "experience", work: "experience", education: "education", skills: "skills",
      };
      const target = map[key];
      if (target) {
        if (Array.isArray(data[target])) {
          section = target;
          if (value !== "") (data[target] as string[]).push(...value.split(/\s*[;,|]\s*/).filter(Boolean));
        } else {
          (data[target] as string) = value;
          section = null;
        }
        continue;
      }
    }
    const bullet = /^[-*•]\s*(.*)$/.exec(line);
    if (bullet && section) {
      (data[section] as string[]).push(bullet[1]!.trim());
      continue;
    }
    if (section) (data[section] as string[]).push(line);
    else if (data.name === "") data.name = line;
    else if (data.headline === "") data.headline = line;
    else data.summary = `${data.summary} ${line}`.trim();
  }
  if (data.name === "") throw unsupported('Start with a name, or a line like "Name: Your Name".');
  return data;
}

export function resumeMarkdown(data: ResumeData): string {
  const contact = [data.email, data.phone, data.location, ...data.links].filter(Boolean).join(" · ");
  const section = (title: string, items: string[]) =>
    items.length === 0 ? [] : ["", `## ${title}`, "", ...items.map((i) => `- ${i}`)];
  return [
    `# ${data.name}`,
    ...(data.headline ? ["", `**${data.headline}**`] : []),
    ...(contact ? ["", contact] : []),
    ...(data.summary ? ["", "## Summary", "", data.summary] : []),
    ...section("Experience", data.experience),
    ...section("Education", data.education),
    ...(data.skills.length ? ["", "## Skills", "", data.skills.join(" · ")] : []),
    "",
  ].join("\n");
}

export const resumeFillerExecutor: Executor = (input, options, ctx) =>
  runDocTool("resume-template-filler", async () => {
    const source = await readTextInput(input, ctx);
    const data = parseResume(source.text);
    const markdown = resumeMarkdown(data);
    const format = optEnum(options, "format", ["docx", "pdf", "both"] as const, "docx");
    const files: OutputFile[] = [];
    const stem = data.name.replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-") || "resume";

    if (format !== "pdf") {
      files.push({ name: `${stem}-resume.docx`, mimeType: MIME.docx, bytes: await markdownToDocx(markdown, `${data.name} — resume`) });
    }
    if (format !== "docx") {
      // Straight through the shared Markdown → Word → PDF path, so the PDF matches the Word file.
      const docx = await markdownToDocx(markdown, `${data.name} — resume`);
      const { officeToPdf } = await import("../shared/office-convert.ts");
      const result = await officeToPdf(docx, "docx", { engine: "auto" });
      files.push({ name: `${stem}-resume.pdf`, mimeType: MIME.pdf, bytes: result.bytes });
    }
    return {
      ok: true,
      output: { ...data, markdown, result: markdown },
      summary: `Built a resume for ${data.name} with ${plural(data.experience.length, "experience entry")}, ${plural(data.education.length, "education entry")} and ${plural(data.skills.length, "skill")}.`,
      files,
    };
  });
